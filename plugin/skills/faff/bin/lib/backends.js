// ===========================================================================
// === region:factory — backends — FAFF-523: shared model/provider/auth backend ===
// config namespace. A top-level `backends:` map (name -> Backend record) that
// generalizes the top-level `engines:` map: every entry carries the same core
// fields (provider/model/host/api_key_env/reasoning_off/timeout) PLUS two new
// first-class dimensions — `auth: subscription-seat|api-key|none` and
// `egress: local|external` — so a consumer can be referenced by NAME from
// anywhere (a slot occupant, a models.X lane, a fallback chain), and a
// residency-sensitive consumer can fail closed rather than silently egress.
// `engines:` entries fold into this namespace at load (collision = hard
// error); `engine:<name>` keeps resolving against the MERGED namespace
// (config.js's resolveEngineForLane/validateEngineRef call into here).
// No `seat_ref` field — `auth: subscription-seat` binds to the ambient
// interactive session (2026-07-16 operator resolution; see the ADR).
// ===========================================================================

const { dig } = require("./shared-infra");

function present(v) { return v !== null && v !== undefined && v !== ""; }

// The full Backend field set a normalized entry carries (beyond `name`).
const BACKEND_RECORD_KEYS = [
  "provider", "model", "host", "bin_path", "auth", "api_key_env", "egress", "reasoning_off", "timeout",
  "telemetry",
];

const AUTH_VALUES = ["subscription-seat", "api-key", "none"];
const EGRESS_VALUES = ["local", "external"];
// FAFF-604: where this backend's SPEND can be read. `transcript-jsonl` is the
// Claude Code transcript path budget/economics have always walked;
// `exec-json-events` is the usage carried on a spawned child's own JSONL event
// stream; `none` says the spend is unobservable — the value that makes a dollar
// ceiling REFUSE rather than read the engine as free.
const TELEMETRY_VALUES = ["transcript-jsonl", "exec-json-events", "none"];

// PURE: derive `auth` when not explicitly set (explicit value always wins —
// callers only invoke this on an absent/unset raw auth). Mirrors the spec's
// deriveAuth procedure exactly: api_key_env present -> api-key; keyless
// anthropic -> subscription-seat (binds to the ambient interactive session,
// no handle field); keyless codex -> subscription-seat (FAFF-593: the ChatGPT
// seat travels with the codex CLI's own login state, not the harness); else none.
function deriveAuth(b) {
  if (present(b.api_key_env)) return "api-key";
  const provider = String(b.provider || "").toLowerCase();
  if (provider === "anthropic" || provider === "codex") return "subscription-seat";
  return "none";
}

// PURE: derive `telemetry` when not explicitly set (explicit value always wins —
// callers only invoke this on an absent/unset raw telemetry). Mirrors deriveAuth's
// shape: an anthropic backend's spend lands in the Claude Code transcript; a codex
// backend's lands on its own `codex exec --json` event stream; every other family
// has no spend source faff can read today, so it derives `none` — the honest
// default, which refuses a dollar ceiling rather than counting the engine as free.
function deriveTelemetry(b) {
  const provider = String(b.provider || "").toLowerCase();
  if (provider === "anthropic") return "transcript-jsonl";
  if (provider === "codex") return "exec-json-events";
  return "none";
}

// PURE: classify a host as local (loopback / RFC1918 / tailscale *.ts.net) or
// external (any public host) — mirrors the spec's deriveEgress procedure. A
// missing/unparsable host derives "external" — the conservative choice: an
// unknown host must never be silently treated as safe-local (the residency
// check runs BEFORE the host-presence check, so this is the value that
// governs a requires:local refusal for an as-yet-unrealizable backend too).
function deriveEgress(b) {
  const raw = String(b.host || "");
  if (!raw) return "external";
  let hostname = raw;
  try { hostname = new URL(raw).hostname; } catch { /* not a valid URL — fall through, test the raw string */ }
  if (/^(localhost|127\.0\.0\.1|::1|\[::1\])$/i.test(hostname)) return "local";
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return "local";
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return "local";
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return "local";
  // `.ts.net` (Tailscale MagicDNS) is classified `local` BY POLICY, not by
  // accident: a tailnet is a private overlay network, and `ts.net` itself is
  // a Tailscale-controlled, non-publicly-registrable suffix — an attacker
  // cannot stand up an arbitrary `evil.ts.net` the way they could register
  // an arbitrary public domain. This is an intended trust boundary, not a
  // residency leak; see checkRealizable's fresh re-derivation below for why
  // an EXPLICIT `egress: local` claim on a genuinely public host still can't
  // ride on this classification.
  if (/\.ts\.net$/i.test(hostname)) return "local";
  return "external";
}

// PURE: the three CONSTRAINT rules from the Backend record (spec §3) — each
// auth value ties to exactly one token source. Returns null | a named error.
function validateBackendConstraints(name, b) {
  if (!AUTH_VALUES.includes(b.auth)) {
    return `backends.${name}: invalid auth "${b.auth}" — legal set: ${AUTH_VALUES.join(" | ")}`;
  }
  if (!EGRESS_VALUES.includes(b.egress)) {
    return `backends.${name}: invalid egress "${b.egress}" — legal set: ${EGRESS_VALUES.join(" | ")}`;
  }
  if (b.auth === "api-key" && !present(b.api_key_env)) {
    return `backends.${name}: auth: api-key requires api_key_env`;
  }
  if (b.auth === "subscription-seat" && present(b.api_key_env)) {
    return `backends.${name}: auth: subscription-seat must not carry api_key_env (it binds to the ambient interactive session — no handle field, FAFF-523)`;
  }
  if (b.auth === "none" && present(b.api_key_env)) {
    return `backends.${name}: auth: none must not carry api_key_env`;
  }
  // FAFF-604: telemetry is a CLOSED enum with family-capability constraints — a
  // backend may not CLAIM a spend source its family cannot physically serve
  // (only anthropic writes a Claude Code transcript; only codex emits an exec
  // event stream). `none` is legal everywhere: it is the safe universal claim.
  // Caught here, at normalize time, rather than at spend-read time — where the
  // symptom would be a silently missing contribution instead of a named fault.
  if (!TELEMETRY_VALUES.includes(b.telemetry)) {
    return `backends.${name}: invalid telemetry "${b.telemetry}" — legal set: ${TELEMETRY_VALUES.join(" | ")}`;
  }
  const provider = String(b.provider || "").toLowerCase();
  if (b.telemetry === "transcript-jsonl" && provider !== "anthropic") {
    return `backends.${name}: telemetry: transcript-jsonl requires provider anthropic (only the Claude Code transcript carries that spend); provider is "${b.provider}"`;
  }
  if (b.telemetry === "exec-json-events" && provider !== "codex") {
    return `backends.${name}: telemetry: exec-json-events requires provider codex (only a codex exec child emits that event stream); provider is "${b.provider}"`;
  }
  return null;
}

// PURE: normalize one raw config-shaped record into a Backend. Applies
// auth/egress derivation (explicit value always wins) and validates the
// constraints. Deliberately does NOT require provider/model/host presence —
// an empty host makes a backend merely unrealizable (checkRealizable), not a
// normalize-time error; the engine-lane consumer enforces its own stricter
// presence requirement at its own boundary (config.js's validateEngineRef).
function normalizeBackend(name, raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: `backends.${name}: not a valid backend record` };
  }
  const b = { name };
  b.provider = present(raw.provider) ? String(raw.provider) : undefined;
  b.model = present(raw.model) ? String(raw.model) : undefined;
  b.host = present(raw.host) ? String(raw.host) : undefined;
  b.bin_path = present(raw.bin_path) ? String(raw.bin_path) : undefined;
  b.api_key_env = present(raw.api_key_env) ? String(raw.api_key_env) : undefined;
  b.reasoning_off = raw.reasoning_off === true ? true : undefined;
  b.timeout = present(raw.timeout) ? Number(raw.timeout) : undefined;
  b.auth = present(raw.auth) ? String(raw.auth) : deriveAuth(b);
  b.telemetry = present(raw.telemetry) ? String(raw.telemetry) : deriveTelemetry(b);
  const egressExplicit = present(raw.egress);
  b.egress = egressExplicit ? String(raw.egress) : deriveEgress(b);
  b._egress_explicit = egressExplicit; // internal marker — the derived-egress config-check guard only

  const err = validateBackendConstraints(name, b);
  if (err) return { error: err };
  return { backend: b };
}

// FAFF-604: the engine backends this run's fleet can reach, resolved from the
// `engine:<name>` values on the models.* lanes (the only place a config points a
// lane at a backend). Returns the resolved Backend records, so a caller can read
// each one's declared telemetry source.
//
// Lives HERE, in the factory region, because it is a fact about backends —
// governance (budget.js) may never require this module (ADR-0042's require-graph
// direction invariant), so the governance side is HANDED the resolved answer
// rather than reaching for it. The dispatch shell, which is exempt by design, is
// where the two regions meet for `budget check`.
function fleetEngineBackends(cfg) {
  const lanes = dig(cfg, "models");
  if (!lanes || typeof lanes !== "object" || Array.isArray(lanes)) return [];
  const refs = [];
  const walk = (node) => {
    for (const v of Object.values(node)) {
      if (typeof v === "string" && v.startsWith("engine:")) {
        const n = v.slice("engine:".length).trim();
        if (n && !refs.includes(n)) refs.push(n);
      } else if (v && typeof v === "object" && !Array.isArray(v)) walk(v);
    }
  };
  walk(lanes);
  if (!refs.length) return [];
  const merged = mergeBackendsNamespace(cfg);
  if (merged.error) return [];
  return refs.map((n) => merged.backends[n]).filter(Boolean);
}

// The fleet engines whose spend is UNOBSERVABLE (`telemetry: none`) and which
// the budget block has not explicitly waived. This is the set that makes a
// dollar ceiling refuse: counting them as zero would report "under budget" on
// a figure that never saw their spend at all.
function unmeteredFleetEngines(cfg, allowUnmetered) {
  const allow = new Set(Array.isArray(allowUnmetered) ? allowUnmetered.map(String) : []);
  return fleetEngineBackends(cfg)
    .filter((b) => b.telemetry === "none" && !allow.has(b.name))
    .map((b) => b.name);
}


// PURE: fold the top-level `engines:` map into `backends:` at load (spec §4
// "Load-time merge + normalize"). A name present in BOTH is a hard error
// (ambiguous reference, never last-wins). Every entry — from either source —
// is normalized (derivation + constraint validation) so callers see one
// canonical shape regardless of which block it was declared under. Returns
// { backends: {name: Backend} } | { error }.
function mergeBackendsNamespace(cfg) {
  const backendsRaw = dig(cfg, "backends");
  const enginesRaw = dig(cfg, "engines");
  const backendsBlock = (backendsRaw && typeof backendsRaw === "object" && !Array.isArray(backendsRaw)) ? backendsRaw : {};
  const enginesBlock = (enginesRaw && typeof enginesRaw === "object" && !Array.isArray(enginesRaw)) ? enginesRaw : {};

  const collisions = Object.keys(enginesBlock).filter((k) => Object.prototype.hasOwnProperty.call(backendsBlock, k));
  if (collisions.length > 0) {
    return { error: `engines:/backends: name collision at merge — declared in BOTH blocks: ${collisions.join(", ")} (rename one; never last-wins)` };
  }

  const merged = {};
  for (const name of Object.keys(backendsBlock)) {
    const res = normalizeBackend(name, backendsBlock[name]);
    if (res.error) return { error: res.error };
    merged[name] = res.backend;
  }
  for (const name of Object.keys(enginesBlock)) {
    const res = normalizeBackend(name, enginesBlock[name]);
    if (res.error) return { error: res.error };
    merged[name] = res.backend;
  }
  return { backends: merged };
}

// PURE: resolve an ordered list of backend NAMES against the merged
// namespace, preserving order (index 0 = first-served, no "primary" —
// FAFF-261's flip). An unknown name hard-fails — fail loud, never a silent
// skip (spec §4 "Reference resolution").
function resolveBackendRefs(cfg, refs) {
  const merged = mergeBackendsNamespace(cfg);
  if (merged.error) return { error: merged.error };
  const chain = [];
  for (const name of refs) {
    const b = merged.backends[name];
    if (!b) {
      const configured = Object.keys(merged.backends);
      return { error: `unknown backend: ${name} — configured backends: ${configured.length ? configured.join(", ") : "(none)"}` };
    }
    chain.push(b);
  }
  return { chain };
}

// The single harness value the CLI passes today (spec §7 Assumptions: "the
// harness axis ... is fixed to the single value the CLI passes today"). The
// harness-varying half of the model x harness matrix (design/portable-
// runtime.md) lands with FAFF-395's `faff run` spine; v1 only needs enough of
// the matrix to gate `subscription-seat` to the interactive session it
// actually exists on.
const CURRENT_HARNESS = "claude-code";

// PURE: (harness, provider, auth) admission. The Anthropic subscription-seat
// only exists on the interactive/claude-code harness (the ambient session IS
// the seat); the codex seat travels with the codex CLI's own login state
// ($CODEX_HOME/auth.json), independent of the harness faff runs on, so it
// admits everywhere (FAFF-593). api-key and none are harness-agnostic
// direct-transport auth modes.
function portableMatrixAdmits(harness, provider, auth) {
  if (auth === "subscription-seat") {
    if (String(provider || "").toLowerCase() === "codex") return true;
    return harness === CURRENT_HARNESS;
  }
  if (auth === "api-key" || auth === "none") return true;
  return false;
}

// The documented `consumer.requires` vocabulary (spec §3): "local", alias
// "no-egress". A CLOSED enum — checkRealizable/backendsConfigCheckFindings
// must fail loud on anything else present-but-unrecognized (a typo like
// "locla"/"Local"/a trailing space must never silently disable the
// residency gate — see checkRealizable below).
const RESIDENCY_REQUIRED_VALUES = ["local", "no-egress"];

// PURE: run-start realizability — fail closed (spec §4 "Run-start
// realizability", the security surface). `consumer` is a BackendReferenceList
// shape: { refs: [name...], requires?: "local", deadline?: N }. Residency is
// checked per-ENTRY and absolute (any egressing ref in a requires:local chain
// refuses, before host/matrix realizability is even considered); host/matrix
// realizability is checked per-CHAIN (>=1 served ref admits; zero -> refuse).
function checkRealizable(cfg, consumer, harness) {
  const h = harness || CURRENT_HARNESS;
  const resolved = resolveBackendRefs(cfg, (consumer && consumer.refs) || []);
  if (resolved.error) return { refuse: true, reason: resolved.error };

  // consumer.requires is a CLOSED enum, validated fail-closed: a present but
  // unrecognized value must surface a hard/needs-human refusal, never a
  // silent skip of the residency gate (that would fail OPEN on a typo).
  const requiresRaw = consumer && consumer.requires;
  let residencyRequired = false;
  if (present(requiresRaw)) {
    if (RESIDENCY_REQUIRED_VALUES.includes(requiresRaw)) {
      residencyRequired = true;
    } else {
      return {
        refuse: true,
        needsHuman: true,
        reason: `unrecognized consumer.requires "${requiresRaw}" — legal set: ${RESIDENCY_REQUIRED_VALUES.join(" | ")}. A misspelled residency constraint is never silently skipped: fix the value or the residency gate would not engage.`,
      };
    }
  }

  let realizableCount = 0;
  for (const b of resolved.chain) {
    // Re-derive egress at CHECK time (spec §4's PROCEDURE literally calls
    // deriveEgress(b) here) instead of trusting the stored/normalized
    // b.egress. deriveEgress is purely host-based, so this closes the
    // "explicit egress: local lie on a public host slips through" gap: a
    // backend can set egress: local explicitly (and that explicit value
    // still wins for the STORED field / config-check guard / resolve
    // output), but the residency GATE never takes that claim on faith — it
    // re-checks the actual host every time.
    if (residencyRequired && deriveEgress(b) === "external") {
      return { refuse: true, reason: `residency-violation: ${b.name} egresses` };
    }
    // Host presence gates realizability for the HTTP families only: a codex
    // backend has no host by construction (FAFF-593) — its binary's existence
    // is a dispatch-time fact, not a config-time one, so realizability for
    // codex is matrix admission alone.
    if (String(b.provider || "").toLowerCase() !== "codex" && !present(b.host)) continue;
    if (!portableMatrixAdmits(h, b.provider, b.auth)) continue;
    realizableCount++;
  }
  if (realizableCount === 0) return { refuse: true, reason: "chain-unrealizable" };
  return { ok: true };
}

// PURE: where a resolved Backend's token comes from — the DONE-listed
// "auth: api-key resolves to the named env var; auth: subscription-seat
// resolves to the ambient interactive session (no handle)" behaviour.
function resolveTokenSource(b) {
  if (b.auth === "api-key") return { source: "env", env: b.api_key_env || null };
  if (b.auth === "subscription-seat") return { source: "ambient-session" };
  return { source: "none" };
}

// PURE: `faff config check`'s derived-egress residency-soundness guard (spec
// DONE list). Scans the one reference-list consumer the spec names today
// (faffter_dark.adversarial's refs:+requires:) for a requires:local chain
// that leans on a DERIVED (not explicit) egress:local classification — a
// convenience default is not the residency guarantee's asserted basis.
// Also surfaces a namespace-level merge error (e.g. a name collision) as a
// finding, so it is visible without invoking any specific consumer.
function backendsConfigCheckFindings(cfg) {
  const findings = [];
  const merged = mergeBackendsNamespace(cfg);
  if (merged.error) {
    const severity = /name collision/.test(merged.error) ? "error" : "warn";
    findings.push({ severity, surface: "backends", message: merged.error });
    return findings;
  }
  // FAFF-604: a `budget.allow_unmetered` entry naming a backend that no longer
  // exists is a DEAD waiver — it silently protects nothing, and the operator who
  // wrote it believes a ceiling is waived when it is not. A warn (not an error):
  // a renamed backend must not brick the config, but the stale name should be
  // visible in the one place a human actually reads config posture.
  const allowUnmetered = dig(cfg, "budget.allow_unmetered");
  if (Array.isArray(allowUnmetered)) {
    for (const raw of allowUnmetered) {
      const name = String(raw).trim();
      if (name === "" || merged.backends[name]) continue;
      findings.push({
        severity: "warn",
        surface: "budget.allow_unmetered",
        message: `budget.allow_unmetered names "${name}", which is not a configured backend — the waiver is dead (it protects nothing). Remove it, or fix the name to match a backends: entry.`,
      });
    }
  }
  const adv = dig(cfg, "faffter_dark.adversarial");
  if (adv && typeof adv === "object" && !Array.isArray(adv) && present(adv.requires) && Array.isArray(adv.refs)) {
    if (!RESIDENCY_REQUIRED_VALUES.includes(adv.requires)) {
      // Same fail-closed enum as checkRealizable: an unrecognized requires:
      // value must surface loudly here too — this is the config-check path a
      // human actually reads, and a silently-skipped residency gate is
      // exactly the failure a typo like "locla"/"Local" would otherwise hide.
      findings.push({
        severity: "error",
        surface: "faffter_dark.adversarial.requires",
        message: `faffter_dark.adversarial.requires: unrecognized value "${adv.requires}" — legal set: ${RESIDENCY_REQUIRED_VALUES.join(" | ")}. Not silently skipped: fix the typo, or the residency gate never engages for this consumer.`,
      });
    } else {
      for (const name of adv.refs) {
        const b = merged.backends[name];
        if (b && b.egress === "local" && !b._egress_explicit) {
          findings.push({
            severity: "warn",
            surface: `faffter_dark.adversarial.refs[${name}]`,
            message: `backend "${name}" is admitted into a requires: local chain on a DERIVED (not explicit) egress: local classification — set egress: local explicitly on backends.${name} so the residency guarantee is asserted against an explicit value, not a convenience default.`,
          });
        }
      }
    }
  }
  return findings;
}

const { parseArgs, usageError } = require("./argv");
const BACKENDS_SPEC = { flags: {
  "--selftest": { arity: 0 }, "--json": { arity: 0 },
  "--refs": { arity: 1 }, "--requires": { arity: 1 }, "--harness": { arity: 1 }, "--root": { arity: 1 },
}, positionals: { min: 0, max: 1, name: "verb" } };

function cmdBackends(args) {
  if (args.includes("--selftest")) return backendsSelftest();
  const { findRoot } = require("./shared-infra");
  const { loadConfig } = require("./config");
  const { values, positionals, errors } = parseArgs(args, BACKENDS_SPEC);
  if (errors.length) return usageError(errors, "usage: faff backends <resolve|realizable> --refs a,b,c [--requires local] [--harness NAME] [--json] [--root DIR]");
  const sub = positionals[0];
  const json = !!values["--json"];
  const get = (f) => (values[f] === undefined ? null : values[f]);
  const root = get("--root") || findRoot();
  const [cfg] = loadConfig(root);

  if (sub === "resolve") {
    const refsArg = get("--refs");
    const refs = refsArg ? refsArg.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const res = resolveBackendRefs(cfg, refs);
    if (res.error) { process.stderr.write(`faff backends resolve: ${res.error}\n`); return 2; }
    console.log(JSON.stringify(res.chain.map((b) => {
      const out = {};
      for (const k of BACKEND_RECORD_KEYS) if (b[k] !== undefined) out[k] = b[k];
      out.name = b.name;
      return out;
    })));
    return 0;
  }

  if (sub === "realizable") {
    const refsArg = get("--refs");
    const refs = refsArg ? refsArg.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const requires = get("--requires") || undefined;
    const harness = get("--harness") || undefined;
    const res = checkRealizable(cfg, { refs, requires }, harness);
    if (json) { console.log(JSON.stringify(res)); }
    else if (res.ok) { console.log("ok: realizable"); }
    else { console.log(`refuse: ${res.reason}`); }
    return res.ok ? 0 : 1;
  }

  process.stderr.write("usage: faff backends <resolve|realizable> --refs a,b,c [--requires local] [--harness NAME] [--json] [--root DIR]\n");
  return 2;
}

function backendsSelftest() {
  let fail = 0;
  const ok = (label, cond) => { console.log(`${cond ? "ok  " : "FAIL"} ${label}`); if (!cond) fail++; };

  // --- deriveAuth ------------------------------------------------------------
  ok("deriveAuth: api_key_env present -> api-key", deriveAuth({ api_key_env: "K" }) === "api-key");
  ok("deriveAuth: keyless anthropic -> subscription-seat", deriveAuth({ provider: "anthropic" }) === "subscription-seat");
  ok("deriveAuth: keyless non-anthropic -> none", deriveAuth({ provider: "ollama" }) === "none");
  ok("deriveAuth: api_key_env wins over anthropic", deriveAuth({ provider: "anthropic", api_key_env: "K" }) === "api-key");

  // --- deriveEgress ------------------------------------------------------------
  ok("deriveEgress: tailscale host -> local", deriveEgress({ host: "http://studio.longhair-escalator.ts.net:11434" }) === "local");
  ok("deriveEgress: public host -> external", deriveEgress({ host: "https://integrate.api.nvidia.com/v1" }) === "external");
  ok("deriveEgress: localhost -> local", deriveEgress({ host: "http://localhost:11434" }) === "local");
  ok("deriveEgress: 127.0.0.1 -> local", deriveEgress({ host: "http://127.0.0.1:11434" }) === "local");
  ok("deriveEgress: RFC1918 10.x -> local", deriveEgress({ host: "http://10.0.0.5:1234" }) === "local");
  ok("deriveEgress: RFC1918 192.168.x -> local", deriveEgress({ host: "http://192.168.1.5:1234" }) === "local");
  ok("deriveEgress: RFC1918 172.16-31.x -> local", deriveEgress({ host: "http://172.20.0.5:1234" }) === "local");
  ok("deriveEgress: empty host -> external (conservative, never a false-safe local)", deriveEgress({ host: "" }) === "external");

  // --- deriveTelemetry (FAFF-604) ---------------------------------------------
  ok("deriveTelemetry: anthropic -> transcript-jsonl", deriveTelemetry({ provider: "anthropic" }) === "transcript-jsonl");
  ok("deriveTelemetry: codex -> exec-json-events", deriveTelemetry({ provider: "codex" }) === "exec-json-events");
  ok("deriveTelemetry: ollama -> none (no readable spend source)", deriveTelemetry({ provider: "ollama" }) === "none");
  ok("deriveTelemetry: nvidia -> none", deriveTelemetry({ provider: "nvidia" }) === "none");
  ok("deriveTelemetry: absent provider -> none (never a false-metered claim)", deriveTelemetry({}) === "none");
  ok("normalizeBackend: telemetry derived for codex",
    normalizeBackend("cx", { provider: "codex", model: "gpt-5" }).backend.telemetry === "exec-json-events");
  ok("normalizeBackend: explicit telemetry wins over derivation",
    normalizeBackend("cx", { provider: "codex", model: "gpt-5", telemetry: "none" }).backend.telemetry === "none");
  ok("normalizeBackend: unknown telemetry value -> named error",
    /invalid telemetry "bogus"/.test(normalizeBackend("cx", { provider: "codex", model: "m", telemetry: "bogus" }).error || ""));
  ok("normalizeBackend: exec-json-events on a non-codex provider -> named error",
    /requires provider codex/.test(normalizeBackend("x", { provider: "ollama", model: "m", host: "http://localhost:11434", telemetry: "exec-json-events" }).error || ""));
  ok("normalizeBackend: transcript-jsonl on a non-anthropic provider -> named error",
    /requires provider anthropic/.test(normalizeBackend("x", { provider: "codex", model: "m", telemetry: "transcript-jsonl" }).error || ""));
  ok("normalizeBackend: telemetry none is legal on any provider",
    normalizeBackend("x", { provider: "nvidia", model: "m", host: "https://h/v1", api_key_env: "K", telemetry: "none" }).error === undefined);
  ok("BACKEND_RECORD_KEYS carries telemetry (so `faff backends resolve` prints it)",
    BACKEND_RECORD_KEYS.includes("telemetry"));

  // --- fleet telemetry scan (FAFF-604) — moved here from budget.js: governance
  // may not require this module, so the factory owns the resolution.
  const codexFleet = { backends: { seat: { provider: "codex", model: "gpt-5-codex" } }, models: { methodology: "engine:seat" } };
  const localFleet = { backends: { lan: { provider: "ollama", model: "q", host: "http://localhost:11434" } }, models: { intake: "engine:lan" } };
  ok("fleetEngineBackends: resolves an engine:<name> lane value to its backend",
    fleetEngineBackends(codexFleet).map((b) => b.name).join(",") === "seat");
  ok("fleetEngineBackends: no engine lanes -> empty (an all-Agent-token fleet)",
    fleetEngineBackends({ models: { build: "sonnet" } }).length === 0);
  ok("fleetEngineBackends: an engine ref naming no configured backend is dropped, never a throw",
    fleetEngineBackends({ backends: {}, models: { intake: "engine:ghost" } }).length === 0);
  ok("unmeteredFleetEngines: a codex engine is METERED (exec-json-events), never flagged",
    unmeteredFleetEngines(codexFleet, []).length === 0);
  ok("unmeteredFleetEngines: an ollama engine derives telemetry: none -> flagged",
    unmeteredFleetEngines(localFleet, []).join(",") === "lan");
  ok("unmeteredFleetEngines: an explicit budget.allow_unmetered waiver clears the flag",
    unmeteredFleetEngines(localFleet, ["lan"]).length === 0);

  // --- validateBackendConstraints ------------------------------------------------------------
  ok("constraints: api-key without api_key_env -> error",
    !!validateBackendConstraints("x", { auth: "api-key", egress: "local", telemetry: "none" }));
  ok("constraints: subscription-seat WITH api_key_env -> error (no handle field)",
    !!validateBackendConstraints("x", { auth: "subscription-seat", api_key_env: "K", egress: "local", telemetry: "none" }));
  ok("constraints: none WITH api_key_env -> error",
    !!validateBackendConstraints("x", { auth: "none", api_key_env: "K", egress: "local", telemetry: "none" }));
  ok("constraints: subscription-seat, no api_key_env -> ok",
    validateBackendConstraints("x", { auth: "subscription-seat", egress: "local", telemetry: "none" }) === null);
  ok("constraints: invalid auth value -> error",
    !!validateBackendConstraints("x", { auth: "bogus", egress: "local", telemetry: "none" }));
  ok("constraints: invalid egress value -> error",
    !!validateBackendConstraints("x", { auth: "none", egress: "bogus", telemetry: "none" }));

  // --- mergeBackendsNamespace ------------------------------------------------------------
  {
    const cfg = {
      backends: { a: { provider: "nvidia", model: "m1", host: "https://a/v1", api_key_env: "K1" } },
      engines: { b: { provider: "ollama", model: "m2", host: "http://studio.x.ts.net:11434" } },
    };
    const res = mergeBackendsNamespace(cfg);
    ok("merge: no collision -> both present", !res.error && !!res.backends.a && !!res.backends.b);
    ok("merge: engines entry normalized (derived auth=none, egress=local)", res.backends.b.auth === "none" && res.backends.b.egress === "local");
    ok("merge: backends entry normalized (derived auth=api-key)", res.backends.a.auth === "api-key");
  }
  {
    const cfg = {
      backends: { shared: { provider: "nvidia", model: "m1", host: "https://a/v1" } },
      engines: { shared: { provider: "ollama", model: "m2", host: "http://h:1" } },
    };
    const res = mergeBackendsNamespace(cfg);
    ok("merge: name collision -> hard error, never last-wins", /name collision/.test(res.error || ""));
  }

  // --- resolveBackendRefs ------------------------------------------------------------
  {
    const cfg = { backends: {
      a: { provider: "nvidia", model: "m1", host: "https://a/v1", api_key_env: "K1" },
      b: { provider: "gemini", model: "m2", host: "https://b/v1", api_key_env: "K2" },
    } };
    const res = resolveBackendRefs(cfg, ["b", "a"]);
    ok("resolveBackendRefs: order preserved (index 0 first-served, no primary)", !res.error && res.chain[0].name === "b" && res.chain[1].name === "a");
  }
  {
    const res = resolveBackendRefs({ backends: {} }, ["nope"]);
    ok("resolveBackendRefs: unknown name hard-fails (fail loud)", /unknown backend/.test(res.error || ""));
  }

  // --- checkRealizable ------------------------------------------------------------
  {
    // residency-violation scenario straight from the spec's holdout example
    const cfg = { backends: {
      "studio-ollama": { provider: "ollama", model: "m1", host: "http://studio.x.ts.net:11434" },
      "gemini-gemma": { provider: "gemini", model: "m2", host: "https://generativelanguage.googleapis.com/v1beta/openai", api_key_env: "GEMINI_API_KEY" },
    } };
    const res = checkRealizable(cfg, { refs: ["studio-ollama", "gemini-gemma"], requires: "local" });
    ok("checkRealizable: requires:local + external ref -> refuse residency-violation naming the backend", res.refuse === true && /residency-violation: gemini-gemma/.test(res.reason));
  }
  {
    // the fixed critical: an EXPLICIT egress: local claim on a genuinely public
    // host must NOT slip the residency gate — checkRealizable re-derives at
    // check time (spec §4's literal deriveEgress(b) call) rather than trusting
    // the stored/normalized value.
    const cfg = { backends: {
      "lying-backend": { provider: "nvidia", model: "m1", host: "https://integrate.api.nvidia.com/v1", api_key_env: "K", egress: "local" },
    } };
    const res = checkRealizable(cfg, { refs: ["lying-backend"], requires: "local" });
    ok("checkRealizable: explicit egress:local LIE on a public host -> re-derived, still refuses", res.refuse === true && /residency-violation: lying-backend/.test(res.reason));
    // the stored field itself keeps "explicit value wins" — only the gate re-derives
    const merged = mergeBackendsNamespace(cfg);
    ok("checkRealizable: stored b.egress still honors explicit value (only the GATE re-derives)", merged.backends["lying-backend"].egress === "local");
  }
  {
    // consumer.requires is a CLOSED enum: alias "no-egress" behaves identically to "local"
    const cfg = { backends: { ext: { provider: "nvidia", model: "m1", host: "https://a/v1", api_key_env: "K" } } };
    const res = checkRealizable(cfg, { refs: ["ext"], requires: "no-egress" });
    ok("checkRealizable: requires: no-egress (documented alias) behaves like requires: local", res.refuse === true && /residency-violation: ext/.test(res.reason));
  }
  {
    // consumer.requires FAIL-CLOSED on an unrecognized value — a typo must never silently
    // skip the residency gate
    const cfg = { backends: { ext: { provider: "nvidia", model: "m1", host: "https://a/v1", api_key_env: "K" } } };
    const res = checkRealizable(cfg, { refs: ["ext"], requires: "locla" });
    ok("checkRealizable: unrecognized requires value -> fail-closed refusal (never a silent skip)", res.refuse === true && res.needsHuman === true && /unrecognized consumer\.requires/.test(res.reason));
  }
  {
    // whole chain unrealizable: every ref host-unset
    const cfg = { backends: { a: { provider: "nvidia", model: "m1" } } }; // no host
    const res = checkRealizable(cfg, { refs: ["a"] });
    ok("checkRealizable: whole chain host-unset -> chain-unrealizable", res.refuse === true && res.reason === "chain-unrealizable");
  }
  {
    // subscription-seat on the current (claude-code) harness admits
    const cfg = { backends: { a: { provider: "anthropic", model: "claude-frontier", host: "https://api.anthropic.com" } } };
    const res = checkRealizable(cfg, { refs: ["a"] }, "claude-code");
    ok("checkRealizable: subscription-seat on claude-code harness -> ok", res.ok === true);
  }
  {
    // subscription-seat on a non-claude-code harness -> matrix miss -> refuse if whole chain
    const cfg = { backends: { a: { provider: "anthropic", model: "claude-frontier", host: "https://api.anthropic.com" } } };
    const res = checkRealizable(cfg, { refs: ["a"] }, "some-other-harness");
    ok("checkRealizable: subscription-seat on a non-claude-code harness -> chain-unrealizable", res.refuse === true && res.reason === "chain-unrealizable");
  }
  {
    // a served fallback admits — not any backend down -> refuse
    const cfg = { backends: {
      down: { provider: "nvidia", model: "m1" }, // no host, unrealizable
      up: { provider: "nvidia", model: "m2", host: "https://a/v1", api_key_env: "K" },
    } };
    const res = checkRealizable(cfg, { refs: ["down", "up"] });
    ok("checkRealizable: a served fallback admits (not any-backend-down -> refuse)", res.ok === true);
  }

  // --- resolveTokenSource ------------------------------------------------------------
  ok("resolveTokenSource: api-key -> named env var", resolveTokenSource({ auth: "api-key", api_key_env: "NVIDIA_API_KEY" }).source === "env"
    && resolveTokenSource({ auth: "api-key", api_key_env: "NVIDIA_API_KEY" }).env === "NVIDIA_API_KEY");
  ok("resolveTokenSource: subscription-seat -> ambient session, no handle", resolveTokenSource({ auth: "subscription-seat" }).source === "ambient-session");
  ok("resolveTokenSource: none -> no source", resolveTokenSource({ auth: "none" }).source === "none");

  // --- backendsConfigCheckFindings (derived-egress guard) ------------------------------------------------------------
  {
    const cfg = {
      backends: { "studio-ollama": { provider: "ollama", model: "m1", host: "http://studio.x.ts.net:11434" } }, // derived local
      faffter_dark: { adversarial: { refs: ["studio-ollama"], requires: "local" } },
    };
    const findings = backendsConfigCheckFindings(cfg);
    ok("configCheck: requires:local chain on a DERIVED-local backend -> warns", findings.some((f) => f.severity === "warn" && /DERIVED/.test(f.message)));
  }
  {
    const cfg = {
      backends: { "studio-ollama": { provider: "ollama", model: "m1", host: "http://studio.x.ts.net:11434", egress: "local" } }, // EXPLICIT local
      faffter_dark: { adversarial: { refs: ["studio-ollama"], requires: "local" } },
    };
    const findings = backendsConfigCheckFindings(cfg);
    ok("configCheck: requires:local chain on an EXPLICIT-local backend -> silent", !findings.some((f) => /DERIVED/.test(f.message)));
  }
  {
    const cfg = {
      backends: { shared: { provider: "nvidia", model: "m1", host: "https://a/v1" } },
      engines: { shared: { provider: "ollama", model: "m2", host: "http://h:1" } },
    };
    const findings = backendsConfigCheckFindings(cfg);
    ok("configCheck: name collision surfaced as an error finding", findings.some((f) => f.severity === "error" && /name collision/.test(f.message)));
  }
  {
    const cfg = {
      backends: { "studio-ollama": { provider: "ollama", model: "m1", host: "http://studio.x.ts.net:11434", egress: "local" } },
      faffter_dark: { adversarial: { refs: ["studio-ollama"], requires: "no-egress" } }, // documented alias
    };
    const findings = backendsConfigCheckFindings(cfg);
    ok("configCheck: requires: no-egress (alias) processes the chain same as requires: local", !findings.some((f) => f.severity === "error"));
  }
  {
    const cfg = {
      backends: { "studio-ollama": { provider: "ollama", model: "m1", host: "http://studio.x.ts.net:11434" } },
      faffter_dark: { adversarial: { refs: ["studio-ollama"], requires: "Local" } }, // typo/case mismatch
    };
    const findings = backendsConfigCheckFindings(cfg);
    ok("configCheck: unrecognized requires value -> fail-loud error finding, not a silent skip", findings.some((f) => f.severity === "error" && /unrecognized value/.test(f.message)));
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (backends, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  AUTH_VALUES, BACKEND_RECORD_KEYS, CURRENT_HARNESS, EGRESS_VALUES, RESIDENCY_REQUIRED_VALUES,
  TELEMETRY_VALUES,
  backendsConfigCheckFindings, backendsSelftest, checkRealizable, cmdBackends,
  deriveAuth, deriveEgress, deriveTelemetry, fleetEngineBackends, mergeBackendsNamespace, normalizeBackend,
  unmeteredFleetEngines,
  portableMatrixAdmits, resolveBackendRefs, resolveTokenSource, validateBackendConstraints,
};
