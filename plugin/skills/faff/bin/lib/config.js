// ===========================================================================
// === region:factory — config — resolve / read .faffrc (YAML subset, no deps) ===
// ===========================================================================
// FAFF-182: the single source of truth for config defaults, keyed by dotted config path.
// `config get <key>` applies these so no caller (skill prose) ever supplies a default via `-d` —
// a prose-supplied default can be forgotten/mistyped/shortcut (the slot-dispatch bug). Slots are
// entries here too (slots are just config-path keys). Computed defaults (spec-docs-path, eligible,
// next, worktree_root) keep their own resolvers — this registry is for simple-scalar + slot defaults.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { overlayHeartbeat, readHeartbeatFile } = require("./heartbeat");
const { runIsHeld } = require("./runcheck");
const { backendsConfigCheckFindings, mergeBackendsNamespace } = require("./backends");
const {
  CANONICAL_CONFIG, CANONICAL_OVERLAY_CONFIG, LEGACY_CONFIG, LEGACY_OVERLAY_CONFIG,
  deepMergeConfig, dig, findConfig, findOverlay, findRoot, isPlainConfigMap,
  parseOverlayStrict, parseYamlSubset, readLedger, scalar, stripInlineComment,
} = require("./shared-infra");

const DEFAULTS = {
  "slots.intake": "faffter-noon-intake",
  "slots.spec": "faffter-noon-spec",
  "slots.spec_review": "faffter-noon-spec-review",
  "slots.adr": "faffter-noon-adr",
  "slots.architecture": "faffter-noon-architecture",
  "slots.env": "faffter-noon-env-compose",
  "slots.evaluator": "faffter-noon-evaluate",
  "slots.review": "faffter-noon-review",
  "slots.ship": "faffter-noon-ship",
  "slots.concurrency": "faffter-noon-concurrency-sequential",
  "slots.methodology": "faffter-noon-methodology-thematic",
  "slots.routing_adaptor": "faffidavit-routing",
  "slots.rendering_adaptor": "faffidavit-rendering",
  // FAFF-191: the L4 PRD-admissibility slot — gap-filled (was documented in the gateway Slots
  // table and relied on by faff-beep-boop's prose parenthetical, but absent from the registry).
  "slots.prd": "faffter-noon-prd",
  "logging": "full",
  "concurrency_max": "4",
  "automation_default": "opt-in",
  "appetite": "high",
  "adr.mode": "offer",
  "intake_gate": "warn",
  // FAFF-536: the self-hosting core-defect intake lane. Default false ⇒ the lane is off and the
  // filing chokepoint is byte-identical to today (an outward item is always outward-new-root). Set
  // true ONLY in the self-hosting repo (faff building faff) to let a concrete same-tracker-team
  // outward defect reclassify as `outward-self-intake` and file to the Backlog `faff-jot-intake`
  // bucket — a NEW classification computed at the chokepoint, never a floor edit (ADR-0079). Both
  // this opt-in AND the same-team structural check must hold; each is fail-closed to outward-new-root.
  "containment.self_hosting_intake": "false",
  "gates.fallback": "fail-closed",
  // FAFF-385: post-merge verification (re-run the declared UNIT rung against the merge sha) —
  // consulted in autonomous mode only; default on so a repo opts OUT, never opts in.
  "post_merge.check": "on",
  "budget.at_ceiling": "stop",
  // FAFF-446: budget.price_per_mtok REMOVED — the ADR-0048 per-model x per-class
  // price map is the sole pricing source now (budget.price_per_mtok_by_model stays,
  // a different knob: a map override, not a competing flat price). A `.faffrc.yaml`
  // that still sets it > 0 is named on the resolved envelope's `price_per_mtok_removed`
  // field (budget.js's envelopeFrom) rather than synthesized a default here.
  // FAFF-255: PRDR thrash-ratchet bounds. thrash_max = supersessions a single lineage may accrue
  // within thrash_window (days) before `prdr admit` escalates (ratchet.breached). Conservative defaults.
  "prdr.thrash_max": "3",
  "prdr.thrash_window": "21",
  // FAFF-199: ADR thrash-ratchet bounds — the same conservative defaults, ported verbatim for the
  // ADR axis (`adr admit`'s ratchet gate). See prdr.thrash_max/window above for the shape.
  "adr.thrash_max": "3",
  "adr.thrash_window": "21",
  // FAFF-463: PRDR git-landing. accept_branch_prefix = the landing-branch prefix `faff prdr accept`
  // commits onto. validate_git = auto (default; the git-awareness validate tier runs, degrading to
  // silent outside a git work tree) | off (skip the git tier entirely).
  "prdr.accept_branch_prefix": "prdr/",
  "prdr.validate_git": "auto",
  // FAFF-315: per-lane model selection. build/prep_explore take the closed Agent-tool token set
  // (MODEL_LANE_VOCAB below); "inherit" = dispatch with no model param (byte-for-byte today).
  // models.eval is the eval frontier driver's pinned default — NEVER the account default (budget guard).
  "models.build": "inherit",
  "models.prep_explore": "inherit",
  // FAFF-372: per-producer model lanes for the migrated interactive prep/jot producer subagents
  // (spec / methodology / spec_review / intake). Same closed Agent-token set as build; "inherit"
  // omits the model param (byte-for-byte today until a repo pins one).
  "models.spec": "inherit",
  "models.spec_review": "inherit",
  "models.methodology": "inherit",
  "models.intake": "inherit",
  // The architecture proposer's producer-subagent dispatch lane (faff-prep's conditional
  // architecture step) — same closed Agent-token set as the sibling producer lanes.
  "models.architecture": "inherit",
  "models.eval": "claude-sonnet-4-6",
  // FAFF-416: per-lane reasoning-EFFORT selection — the effort counterpart to the FAFF-315
  // model lanes. Only the non-prep, subagent-dispatched lanes are tunable: build (concurrency
  // executors' build subagents), methodology + intake (producer-subagent dispatches). "inherit"
  // = omit the effort arg = today's dispatch, byte-for-byte. HARD EXCLUSION: prep/spec lanes
  // (spec / spec_review / prep_explore / architecture) and eval get NO effort lane — prep runs
  // once and gates the whole pipeline, so it stays pinned; the adversarial judge's effort tuning
  // lives in its own faffter_dark.adversarial engine block (compose-not-subsume). See ADR.
  "effort.build": "inherit",
  "effort.methodology": "inherit",
  "effort.intake": "inherit",
  // FAFF-403: bounded retry count for graft's retry-later/awaiting-review hold on a mandatory-review
  // `unavailable` (provider-outage) verdict — graft's own namespace (it owns the disposition loop;
  // faffter_dark.adversarial.* configures the engine call, not loop policy). After this many held
  // drains still unavailable, the arm escalates to the standard needs-human park (never silent-forever).
  "graft.review_outage_retry_limit": "3",
  // FAFF-333: the lights-out host-socket boundedness ATTESTATION (ADR-0041 decision 3) — default
  // false (refuse on positive evidence of a mounted host socket). true is the operator taking
  // responsibility that a same-path socket is a BOUNDED nested engine, not the host daemon;
  // it downgrades the lights-out refuse to a warn without waiving container-check's own
  // containment requirement. This registry entry drives `config get`'s DISPLAY value (so it
  // returns "false" instead of exit-3, and shows in `config defaults`); it does NOT drive the
  // gate. The gate resolves the attestation fail-closed in lights-out.js's engineBoundedFromConfig
  // (only an explicit affirmative attests — unset/unrecognised always refuses), independent of
  // this value, so flipping it here changes the display, never the safety default. Unlike the
  // sibling require_container/require_branch_protection warn|block enums (resolved by SKILL.md
  // prose), this is a boolean.
  "autonomous.engine_bounded": "false",
};

// FAFF-315: closed value vocabulary for the Agent-tool model lanes. A configured value outside
// the set fails LOUD at read (exit 2, names the value + legal set) — a misconfigured model must
// never silently fall back to the session default (the FAFF-50 dropped-slot failure mode).
// models.eval is deliberately absent (open vocabulary — `claude -p` validates the id itself).
const MODEL_LANE_VOCAB = {
  "models.build": ["inherit", "sonnet", "opus", "haiku", "fable"],
  "models.prep_explore": ["inherit", "sonnet", "opus", "haiku", "fable"],
  // FAFF-372: migrated interactive producer lanes reuse the build lane's closed Agent-token set.
  "models.spec": ["inherit", "sonnet", "opus", "haiku", "fable"],
  "models.spec_review": ["inherit", "sonnet", "opus", "haiku", "fable"],
  "models.methodology": ["inherit", "sonnet", "opus", "haiku", "fable"],
  "models.intake": ["inherit", "sonnet", "opus", "haiku", "fable"],
  "models.architecture": ["inherit", "sonnet", "opus", "haiku", "fable"],
};
function validateModelLane(key, value) {
  // FAFF-422: an `engine:<name>` lane value selects the out-of-session one-shot transport
  // (`faff engine call`), legal ONLY on the v1 pure-data-in allowlist. Every other models.*
  // key — the tool-needing/prep lanes, the matcher leaves, AND the open-vocabulary eval lane —
  // rejects it at read, naming the allowlist (the read-time half of the capability-mismatch
  // guard; `faff engine call --lane` is the dispatch-time half). Name existence is checked at
  // resolution (validateEngineRef), not here — the shape is what the vocabulary admits.
  if (/^models\./.test(key) && /^engine:/.test(String(value))) {
    return ENGINE_LANE_KEYS.includes(key) ? null
      : `config get ${key}: engine values are only legal on ${ENGINE_LANE_KEYS.join(" | ")} (FAFF-422 v1 allowlist — a tool-needing lane can never reach a tool-incapable transport)`;
  }
  let vocab = MODEL_LANE_VOCAB[key];
  // FAFF-334: the per-issue build-model matcher leaves (`models.build_by_confidence.<leaf>`) reuse
  // the build lane's closed Agent-token set, so an invalid token in the matcher fails loud at
  // `config get` read time too — never a silent inherit at the per-issue dispatch site.
  if (!vocab && /^models\.build_by_confidence\./.test(key)) vocab = MODEL_LANE_VOCAB["models.build"];
  if (!vocab || vocab.includes(value)) return null;
  return `config get ${key}: invalid model token "${value}" — legal set: ${vocab.join(" | ")} (fail-loud, no silent inherit)`;
}

// FAFF-422: local-engine lane values. The v1 allowlist is exactly the pure-data-in producer
// lanes (their SKILL.md + payload is self-sufficient — no tool use, no repo access), enforced
// at read (validateModelLane above) AND at dispatch (`faff engine call --lane`). Engines live
// in a top-level name-keyed `engines:` map so one definition serves many lanes; the lane value
// stays a scalar (`engine:<name>`) so the closed-vocab machinery extends rather than forks.
const ENGINE_CALL_LANES = ["methodology", "intake"];
const ENGINE_LANE_KEYS = ENGINE_CALL_LANES.map((l) => `models.${l}`);
// Provider families reuse review-call.mjs's whitelist semantics: ollama has its own wire
// format; the rest ride the openai-compatible /v1 shape. `anthropic` is refused at resolution
// (Anthropic engines are what the Agent-token vocabulary is for — two spellings of the same
// dispatch with different transports would be a trap), and an unknown provider fails loud.
const ENGINE_PROVIDER_FAMILY = {
  ollama: "ollama",
  openai: "openai", vllm: "openai", openrouter: "openai", nvidia: "openai",
  deepseek: "openai", "openai-compatible": "openai", gemini: "openai",
};

// PURE: validate an `engine:<name>` value's reference against the shared
// `backends:` namespace (FAFF-523 — `engines:` folds into it at load, name
// collision is a hard error there) — the resolution-time half of the
// FAFF-422 fail-loud surface. Returns null | a named error.
function validateEngineRef(cfg, value) {
  const name = String(value).slice("engine:".length).trim();
  if (!name) return `engine value "${value}": missing engine name (expected engine:<name>)`;
  const merged = mergeBackendsNamespace(cfg);
  if (merged.error) return merged.error;
  const entry = merged.backends[name];
  if (!entry) {
    const configured = Object.keys(merged.backends);
    return `unknown engine "${name}" — configured engines: ${configured.length ? configured.join(", ") : "(none — add a top-level engines: or backends: block)"}`;
  }
  for (const field of ["provider", "model", "host"]) {
    const v = entry[field];
    if (v === null || v === undefined || v === "") return `engines.${name}: missing required field "${field}" (an engine needs provider, model, host)`;
  }
  const provider = String(entry.provider).toLowerCase();
  if (provider === "anthropic") {
    return `engines.${name}: provider "anthropic" is refused — Anthropic models are what the Agent-token vocabulary is for (set models.<lane> to sonnet | opus | haiku | fable instead)`;
  }
  if (!ENGINE_PROVIDER_FAMILY[provider]) {
    return `engines.${name}: unknown provider "${entry.provider}" — legal providers: ${Object.keys(ENGINE_PROVIDER_FAMILY).join(" | ")}`;
  }
  return null;
}

// PURE: resolve an allowlisted lane to its configured engine for dispatch (`faff engine call`).
// Fail-loud at every step — allowlist, engine: shape, engines.<name> reference, and the
// effort×engine conflict (an `effort.<lane>` that isn't inherit is refused, not silently
// dropped: Agent-tool reasoning-effort doesn't map onto a local engine; per-engine tuning
// belongs in the engine object). Returns { name, provider, family, model, host, apiKeyEnv,
// reasoningOff, timeoutMs } or { error }.
function resolveEngineForLane(cfg, lane) {
  if (!ENGINE_CALL_LANES.includes(lane)) {
    return { error: `lane "${lane}" is not engine-dispatchable — v1 allowlist: ${ENGINE_CALL_LANES.join(" | ")} (FAFF-422)` };
  }
  const key = `models.${lane}`;
  const raw = dig(cfg, key);
  const value = (raw === null || raw === undefined || raw === "") ? DEFAULTS[key] : String(raw).trim();
  const laneErr = validateModelLane(key, value);
  if (laneErr) return { error: laneErr };
  if (!/^engine:/.test(value)) {
    return { error: `${key} is "${value}", not an engine:<name> value — faff engine call serves only engine-valued lanes (an Anthropic token keeps the Agent-tool dispatch)` };
  }
  const refErr = validateEngineRef(cfg, value);
  if (refErr) return { error: `${key}: ${refErr}` };
  const effortRaw = dig(cfg, `effort.${lane}`);
  const effort = (effortRaw === null || effortRaw === undefined || effortRaw === "") ? "inherit" : String(effortRaw).trim();
  if (effort !== "inherit") {
    return { error: `effort.${lane} is "${effort}" but ${key} is an engine value — Agent-tool reasoning-effort does not map onto a local engine; set effort.${lane} to inherit and tune the engine in engines.<name> (reasoning_off, timeout)` };
  }
  const name = value.slice("engine:".length).trim();
  // validateEngineRef above already proved the merged backends:+engines: namespace has
  // this entry with provider/model/host, so this re-resolve is non-null today; guard it
  // anyway (parity with validateEngineRef) so a future change loosening that guarantee
  // fails loud, never with a bare TypeError. FAFF-523: resolves against the MERGED
  // namespace (engines: folds into backends: at load), so a backend declared only under
  // top-level `backends:` is equally reachable via engine:<name>.
  const merged = mergeBackendsNamespace(cfg);
  const entry = merged.backends && merged.backends[name];
  if (!entry) return { error: `${key}: engines.${name} vanished after validation (concurrent config edit?)` };
  const provider = String(entry.provider).toLowerCase();
  return {
    name, provider,
    family: ENGINE_PROVIDER_FAMILY[provider],
    model: String(entry.model),
    host: String(entry.host),
    apiKeyEnv: (entry.api_key_env === null || entry.api_key_env === undefined || entry.api_key_env === "") ? null : String(entry.api_key_env),
    reasoningOff: entry.reasoning_off === true,
    timeoutMs: (entry.timeout !== null && entry.timeout !== undefined && entry.timeout !== "") ? Number(entry.timeout) * 1000 : 120000,
  };
}

// FAFF-416: closed value vocabulary for the per-lane reasoning-EFFORT lanes — the FAFF-415
// EFFORT_LEVELS (low|medium|high|xhigh|max) plus "inherit" (omit the effort arg, byte-for-byte
// today). Mirrors validateModelLane: a configured off-vocabulary value fails LOUD at read
// (config get exit 2, names the value + legal set), never a silent inherit at the dispatch site.
const EFFORT_LANE_VOCAB = {
  "effort.build": ["inherit", "low", "medium", "high", "xhigh", "max"],
  "effort.methodology": ["inherit", "low", "medium", "high", "xhigh", "max"],
  "effort.intake": ["inherit", "low", "medium", "high", "xhigh", "max"],
};
function validateEffortLane(key, value) {
  const vocab = EFFORT_LANE_VOCAB[key];
  if (vocab) return vocab.includes(value) ? null : `config get ${key}: invalid effort token "${value}" — legal set: ${vocab.join(" | ")} (fail-loud, no silent inherit)`;
  // FAFF-416: the prep/spec + eval EXCLUSION is enforced by FAIL-LOUD, not silent tolerance —
  // any `effort.<lane>` key that is not a tunable lane (e.g. effort.spec / effort.architecture /
  // effort.eval, or a typo) fails at read so a hand-set value can never masquerade as a live knob
  // no dispatch consumes. Non-`effort.*` keys are not this validator's business (returns null).
  if (/^effort\./.test(key)) return `config get ${key}: "${key}" is not a tunable effort lane — only ${Object.keys(EFFORT_LANE_VOCAB).join(" | ")} are tunable (prep/spec + eval are deliberately excluded; FAFF-416)`;
  return null;
}

// FAFF-308: appetite is level-scoped. `resolveAppetite` is the SINGLE appetite-resolution
// channel — under an active L4 lights-out run appetite resolves to `full` unconditionally
// and config `appetite` is ignored; config stays authoritative for L1–L3. The pin bites
// HERE (behind `faff config get appetite`) so every consumer inherits the L4 guarantee with
// zero per-call-site edits. The hard floor (destructive/irreversible always parks) is
// unchanged and still wins at `full` — "L4 = full" is never "L4 = reckless".
// Precedence: env FAFF_APPETITE (valid token) > LIVE-L4 ledger (FAFF_RUN_DIR, level:"L4" AND
//             the run is live per `runIsHeld` — running owner + fresh heartbeat) > config
// `appetite` > baked default. A missing/unreadable/non-L4 ledger, a DONE/ABANDONED/stale L4
// ledger (FAFF-378 — the level alone never pins; a dead run's ledger falls through), and an
// invalid FAFF_APPETITE token all fail safe to config — the override never fabricates `full`
// nor lowers safety. Staleness can only de-escalate agency here, never escalate it.
const VALID_APPETITES = new Set(["low", "medium", "high", "full"]);

function resolveAppetite(cfg, env = process.env) {
  // 1. env belt — the runner-exported fast-path (greppable in a process; may not cross every
  //    subagent shell, which is why the ledger brace below exists).
  const envApp = env.FAFF_APPETITE;
  if (envApp && VALID_APPETITES.has(String(envApp).toLowerCase())) return String(envApp).toLowerCase();
  // 2. ledger brace — authoritative + subagent-safe (FAFF_RUN_DIR is inherited by beep-boop
  //    subagents, as budget-check/runcheck already rely on). Reads the EXPLICITLY-handed run
  //    dir, never a globally-sorted latest (dodges the latestRunDir lexical-sort hazard).
  const runDir = env.FAFF_RUN_DIR;
  if (runDir) {
    try {
      // FAFF-378: pin only for a LIVE run. `runIsHeld` is the canonical liveness predicate
      // (parity with runcheck/sentry): running owner + heartbeat fresher than the staleness
      // window. A done/abandoned/stale L4 ledger falls through to config — the level alone
      // must not escalate agency in a later session that never armed `full`.
      const ledger = readLedger(runDir);
      // FAFF-355: overlay the dedicated heartbeat file over owner.last_heartbeat before
      // the (unchanged) runIsHeld predicate runs — same file-first liveness every seam gets.
      if (ledger) overlayHeartbeat(ledger, readHeartbeatFile(runDir));
      if (ledger && ledger.level === "L4" && runIsHeld(ledger, Date.now(), env)) return "full";
    }
    catch { /* unreadable / absent ledger → fall through (never fabricate `full`) */ }
  }
  // 3. config → baked default — the unchanged L1–L3 path.
  const v = dig(cfg, "appetite");
  return (v === null || v === undefined) ? DEFAULTS["appetite"] : v;
}

function fmt(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

// FAFF-387: two-file merged resolution — .faffrc.local.yaml (overlay) deep-merged
// over .faffrc.yaml (base) per shared-infra's deepMergeConfig (maps merge per-leaf,
// sequences/scalars are replaced wholesale by the overlay). BACK-COMPAT: the base
// half is byte-for-byte the pre-FAFF-387 behaviour (a non-map base silently reads
// as {}); with no overlay present (findOverlay returns null, the common case today)
// this returns the exact same 2-meaningful-values shape as before, so every
// existing `const [data] = loadConfig(root)` / `const [data, p] = loadConfig(root)`
// call site is unaffected. The overlay half is STRICT (parseOverlayStrict throws
// "overlay-parse-error" on unreadable/non-map content) — an overlay parse failure
// is loud, never a silent partial-apply (the FAFF-50 failure mode reborn). Returns
// [mergedData, basePath|null, overlayPath|null].
function loadConfig(root) {
  const p = findConfig(root);
  const baseRaw = p === null ? {} : parseYamlSubset(fs.readFileSync(p, "utf8"));
  const baseData = isPlainConfigMap(baseRaw) ? baseRaw : {};
  const overlayPath = findOverlay(root);          // may throw legacy-overlay-config-name
  if (overlayPath === null) return [baseData, p, null];
  const overlayData = parseOverlayStrict(overlayPath); // may throw overlay-parse-error
  return [deepMergeConfig(baseData, overlayData), p, overlayPath];
}

// One docs-path resolver for the spec / PRD / PRDR axes (FAFF-252, FAFF-245).
// `configKey` is the tracking.* override; `subdir` is the leaf under docs/ (or
// doc/ when only doc/ exists). An explicit override wins; otherwise prefer an
// existing docs/, then doc/, defaulting to docs/<subdir>.
function resolveDocsPath(root, data, create, configKey, subdir) {
  let rel;
  const val = dig(data, configKey);
  if (val) rel = String(val).trim().replace(/\/+$/, "");
  else if (fs.existsSync(path.join(root, "docs"))) rel = "docs/" + subdir;
  else if (fs.existsSync(path.join(root, "doc"))) rel = "doc/" + subdir;
  else rel = "docs/" + subdir;
  if (create) fs.mkdirSync(path.join(root, rel), { recursive: true });
  return rel;
}
const resolveSpecDocsPath = (root, data, create) => resolveDocsPath(root, data, create, "tracking.spec_docs_path", "specs");
const resolvePrdDocsPath = (root, data, create) => resolveDocsPath(root, data, create, "tracking.prd_docs_path", "prd");
const resolvePrdrDocsPath = (root, data, create) => resolveDocsPath(root, data, create, "tracking.prdr_docs_path", "prdr");

// ---------------------------------------------------------------------------
// config init — FAFF-5: the deterministic WRITE half of the config surface.
// Writes/merges a `tracking` block into `.faffrc.yaml`. Pure-functional except
// the final fs.writeFileSync. NO MCP, NO env reads, NO value discovery — it
// only persists values handed to it on the CLI (lane split; that is FAFF-6's
// job). The write must round-trip: a file the existing parseYamlSubset/scalar
// reads back to the values written. The merge is a SURGICAL raw-text edit —
// never parse-then-reserialise (the parser is lossy and would destroy a user's
// slots:/appetite:/comments).
// ---------------------------------------------------------------------------
const TRACKING_KEYS = [
  "tracking.tracker",
  "tracking.team_key",
  "tracking.repo",
  "tracking.git_host",
  "tracking.spec_docs_path",
  "tracking.prd_docs_path",
  "tracking.prdr_docs_path",
];
const INIT_HEADER = "# .faffrc.yaml — faff configuration (written by `faff config init`)\n";

// The missing inverse of scalar(): produce YAML scalar text for a string value
// such that scalar() reads it back to that exact string. Bare when safe, else
// double-quoted (the parser does NOT process single-quote `''` escaping, so we
// only emit double-quotes, escaping `\` and `"`).
function emitScalar(value) {
  const INDICATORS = new Set(['"', "'", "[", "]", "{", "}", "&", "*", "!", "|",
    ">", "@", "%", "`", ",", ":", "#", " "]);
  const firstNonSpace = value.replace(/^\s+/, "")[0];
  const needsQuote =
    value === "" ||                       // empty → "" so it's not parsed as null
    /^\s|\s$/.test(value) ||              // leading/trailing whitespace
    value.includes(" #") ||              // space-hash → stripped as inline comment
    (firstNonSpace !== undefined && INDICATORS.has(firstNonSpace)) ||
    scalar(value) !== value;             // bare token would coerce to bool/num/null
  if (needsQuote) {
    return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }
  return value;
}

// Emit a fresh, minimal `tracking:` block (create-from-scratch path only).
// `sets` is a map leafKey → rawValue. Keys are emitted in canonical TRACKING_KEYS
// order, restricted to the keys present in `sets`.
function emitTrackingBlock(sets) {
  let out = "tracking:\n";
  for (const fq of TRACKING_KEYS) {
    const leaf = fq.slice("tracking.".length);
    if (leaf in sets) out += "  " + leaf + ": " + emitScalar(sets[leaf]) + "\n";
  }
  return out;
}

// Surgical merge: edit the raw file text in place so only the targeted
// `tracking:` keys change; every other byte (other blocks, comments, ordering,
// trailing newline) survives. Returns { text, conflicts, changed }.
function mergeTrackingBlock(rawText, sets, force) {
  const indentOf = (line) => line.length - line.replace(/^ +/, "").length;
  const lines = rawText.split("\n");
  const conflicts = [];
  let changed = false;

  // Locate the top-level `tracking:` key (indent 0).
  let trackIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (indentOf(lines[i]) === 0 && lines[i].trim() === "tracking:") { trackIdx = i; break; }
  }

  if (trackIdx === -1) {
    // Block absent → append a fresh block. Ensure one blank line separates it
    // from prior non-empty content; preserve the original trailing-newline state.
    const hadTrailingNewline = rawText.endsWith("\n");
    let text = rawText;
    if (text.length > 0) {
      text = text.replace(/\n+$/, "");          // trim trailing blank lines
      if (text.length > 0) text += "\n\n";     // one blank-line separator
    }
    text += emitTrackingBlock(sets);            // emitTrackingBlock ends in \n
    if (!hadTrailingNewline) text = text.replace(/\n$/, "");
    return { text, conflicts, changed: true };
  }

  // Block present: its body is the run of subsequent lines at indent > 0, up to
  // the next indent-0 line (or EOF). Blank/comment lines inside stay in the run.
  let bodyEnd = trackIdx + 1;
  while (bodyEnd < lines.length) {
    const line = lines[bodyEnd];
    if (line.trim() === "") { bodyEnd++; continue; }          // blank — tentatively in body
    if (indentOf(line) > 0) { bodyEnd++; continue; }          // indented child — in body
    break;                                                     // next top-level key
  }
  // bodyEnd is the index of the first line NOT in the body (or lines.length).
  // Trim trailing blank lines back out of the body so inserts land before them.
  let insertAt = bodyEnd;
  while (insertAt > trackIdx + 1 && lines[insertAt - 1].trim() === "") insertAt--;

  // Sample the block's existing child indentation so an inserted key lands at the
  // SAME column as its siblings. parseYamlSubset's parseMap requires exact-indent
  // children (shared-infra.js:340): a line inserted at the wrong indent is read as
  // outside the block → dig() returns null → the round-trip guard fail-closes. The
  // first indented body line wins (a well-formed block's keys share one column);
  // fall back to 2 for an empty block (no indented child to sample). This honours
  // the user's own formatting (e.g. this repo's 4-space tracking body) without
  // touching any existing byte — the surgical-merge invariant. FAFF-531.
  let blockIndent = 2;
  for (let i = trackIdx + 1; i < bodyEnd; i++) {
    if (lines[i].trim() !== "" && indentOf(lines[i]) > 0) { blockIndent = indentOf(lines[i]); break; }
  }
  const pad = " ".repeat(blockIndent);

  for (const fq of TRACKING_KEYS) {
    const leaf = fq.slice("tracking.".length);
    if (!(leaf in sets)) continue;
    const rawValue = sets[leaf];
    const keyRe = new RegExp("^(\\s+)" + leaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:");
    let foundIdx = -1;
    for (let i = trackIdx + 1; i < bodyEnd; i++) {
      if (keyRe.test(lines[i])) { foundIdx = i; break; }
    }
    if (foundIdx !== -1) {
      const colon = lines[foundIdx].indexOf(":");
      const existingRaw = stripInlineComment(lines[foundIdx].slice(colon + 1)).trim();
      const existingVal = scalar(existingRaw);
      // emitScalar guarantees the reader reads rawValue back AS the string rawValue,
      // so the desired post-write parsed value is the raw string itself — never
      // scalar(rawValue) (which would coerce "123" → 123 and mis-detect conflicts).
      const desiredVal = rawValue;
      if (existingVal === desiredVal) continue;              // no-op for this key
      if (!force) { conflicts.push({ key: leaf, existing: existingVal, desired: desiredVal }); continue; }
      const indent = lines[foundIdx].slice(0, indentOf(lines[foundIdx]));
      lines[foundIdx] = indent + leaf + ": " + emitScalar(rawValue);  // drops inline comment (force)
      changed = true;
    } else {
      // Insert a new child line at the end of the block body, at the block's own
      // child indent (sampled above) so it round-trips — never a hardcoded 2 (FAFF-531).
      lines.splice(insertAt, 0, pad + leaf + ": " + emitScalar(rawValue));
      insertAt++;
      bodyEnd++;
      changed = true;
    }
  }
  return { text: lines.join("\n"), conflicts, changed };
}

function cmdConfigInit(args, root) {
  // 1. Parse args.
  const sets = {};            // leafKey → rawValue
  const seen = {};            // leafKey → first rawValue seen (dup-with-conflict guard)
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--set") continue;
    const token = args[++i];
    if (token === undefined) {
      process.stderr.write("faff config init: --set requires KEY=VALUE\n");
      return 2;
    }
    const eq = token.indexOf("=");
    if (eq === -1) {
      process.stderr.write(`faff config init: malformed --set '${token}' (expected KEY=VALUE)\n`);
      return 2;
    }
    const rawKey = token.slice(0, eq);
    const value = token.slice(eq + 1);          // empty value is allowed
    const fq = rawKey.startsWith("tracking.") ? rawKey : "tracking." + rawKey;
    if (!TRACKING_KEYS.includes(fq)) {
      process.stderr.write(`faff config init: unknown key '${rawKey}'. Accepted keys: ${TRACKING_KEYS.join(", ")} (bare leaf keys accepted too).\n`);
      return 2;
    }
    const leaf = fq.slice("tracking.".length);
    if (leaf in seen && seen[leaf] !== value) {
      process.stderr.write(`faff config init: key '${leaf}' set twice with different values ('${seen[leaf]}' vs '${value}') — ambiguous.\n`);
      return 2;
    }
    seen[leaf] = value;
    sets[leaf] = value;
  }
  if (Object.keys(sets).length === 0) {
    process.stderr.write("faff config init: nothing to set (pass --set KEY=VALUE).\n");
    return 2;
  }

  // 2. Resolve target file. findConfig throws legacy-config-name → propagates to
  //    cmdConfig's catch (the refuse-second-file guarantee). Do NOT catch here.
  const existingPath = findConfig(root);          // may throw; intentional
  const canonicalPath = path.join(root, CANONICAL_CONFIG);

  // 3. Compute merged text (surgical; never reserialise).
  let newText, conflicts = [], changed;
  if (existingPath === null) {
    newText = INIT_HEADER + emitTrackingBlock(sets);
    changed = true;
  } else {
    const rawText = fs.readFileSync(existingPath, "utf8");
    ({ text: newText, conflicts, changed } = mergeTrackingBlock(rawText, sets, force));
    if (conflicts.length && !force) {
      process.stderr.write("faff config init: refusing to overwrite differing value(s) without --force:\n");
      for (const c of conflicts) {
        process.stderr.write(`  tracking.${c.key} is '${fmt(c.existing)}' in the file; --set passed '${fmt(c.desired)}'.\n`);
      }
      process.stderr.write("Re-run with --force to overwrite, or change the value.\n");
      return 2;
    }
    if (!changed) {
      console.log("config init: no changes (all values already set).");
      return 0;
    }
  }

  // 4. Round-trip self-verify against the real reader before committing the write.
  const parsed = parseYamlSubset(newText);
  for (const [leaf, rawValue] of Object.entries(sets)) {
    const got = dig(parsed, "tracking." + leaf);
    // emitScalar is the inverse of scalar(): the reader must return the raw string
    // we were handed (quoting coerces "123"/"true"/"~" back to those strings).
    const want = rawValue;
    if (got !== want) {
      process.stderr.write(`faff config init: internal error — written text does not round-trip (tracking.${leaf}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}); aborting to avoid a corrupt config.\n`);
      return 2;
    }
  }

  // 5. Output.
  if (dryRun) {
    process.stdout.write(newText.endsWith("\n") ? newText : newText + "\n");
    return 0;
  }
  fs.writeFileSync(canonicalPath, newText);
  const n = Object.keys(sets).length;
  console.log(existingPath === null
    ? `config init: created ${CANONICAL_CONFIG} with ${n} key(s).`
    : `config init: wrote ${n} key(s) to ${CANONICAL_CONFIG}.`);
  return 0;
}

// In-memory self-test for cmdConfigInit's pure helpers + the round-trip contract.
// Mirrors `next --selftest`: per-case ok/FAIL + a RESULT line, non-zero on any fail.
function configInitSelftest() {
  let fail = 0;
  const check = (label, cond) => {
    if (!cond) fail++;
    console.log(`${cond ? "ok  " : "FAIL"} ${label}`);
  };
  const reads = (text, leaf) => dig(parseYamlSubset(text), "tracking." + leaf);

  // create-fresh: header + canonical-order block, round-trips.
  {
    const text = INIT_HEADER + emitTrackingBlock({ team_key: "FAFF", tracker: "linear" });
    check("create-fresh: canonical order (tracker before team_key)",
      text.indexOf("tracker:") < text.indexOf("team_key:"));
    check("create-fresh: has header", text.startsWith(INIT_HEADER));
    check("create-fresh: round-trips team_key", reads(text, "team_key") === "FAFF");
    check("create-fresh: round-trips tracker", reads(text, "tracker") === "linear");
  }

  // merge-add-key into an existing tracking block, other keys + inline comments intact.
  {
    const orig = "tracking:\n  tracker: linear  # the tracker\n";
    const { text, changed, conflicts } = mergeTrackingBlock(orig, { team_key: "FAFF" }, false);
    check("merge-add-key: changed", changed === true && conflicts.length === 0);
    check("merge-add-key: existing key + inline comment intact", text.includes("tracker: linear  # the tracker"));
    check("merge-add-key: new key inserted", reads(text, "team_key") === "FAFF");
    check("merge-add-key: original tracker reads back", reads(text, "tracker") === "linear");
  }

  // comment / other-block preservation: non-tracking bytes untouched.
  {
    const orig = "# my config\nslots:\n  spec: gstack:autoplan  # custom\nappetite: full\n\ntracking:\n  repo: a/b\n";
    const { text } = mergeTrackingBlock(orig, { team_key: "FAFF" }, false);
    check("preserve: slots block byte-intact", text.includes("slots:\n  spec: gstack:autoplan  # custom"));
    check("preserve: appetite intact", text.includes("appetite: full"));
    check("preserve: leading comment intact", text.startsWith("# my config\n"));
    check("preserve: new tracking key present", reads(text, "team_key") === "FAFF");
    check("preserve: existing tracking key present", reads(text, "repo") === "a/b");
  }

  // append-block to a file that has none.
  {
    const orig = "slots:\n  spec: x\n";
    const { text, changed } = mergeTrackingBlock(orig, { repo: "a/b" }, false);
    check("append-block: changed", changed === true);
    check("append-block: slots intact", text.includes("slots:\n  spec: x"));
    check("append-block: tracking appended", reads(text, "repo") === "a/b");
  }

  // idempotent no-op: identical value, changed=false, no conflict.
  {
    const orig = "tracking:\n  team_key: FAFF\n";
    const { changed, conflicts } = mergeTrackingBlock(orig, { team_key: "FAFF" }, false);
    check("idempotent: no change", changed === false && conflicts.length === 0);
  }

  // conflict-refused-without-force.
  {
    const orig = "tracking:\n  team_key: FAFF\n";
    const { changed, conflicts } = mergeTrackingBlock(orig, { team_key: "OTHER" }, false);
    check("conflict-refused: reported, not written",
      changed === false && conflicts.length === 1 && conflicts[0].existing === "FAFF" && conflicts[0].desired === "OTHER");
  }

  // conflict-overwritten-with-force: only that line changes.
  {
    const orig = "tracking:\n  team_key: FAFF\n  repo: a/b\n";
    const { text, changed, conflicts } = mergeTrackingBlock(orig, { team_key: "OTHER" }, true);
    check("conflict-forced: overwrote", changed === true && conflicts.length === 0 && reads(text, "team_key") === "OTHER");
    check("conflict-forced: other line untouched", reads(text, "repo") === "a/b");
  }

  // quoted/bare emit round-trip (truth table from the spec).
  {
    const cases = [
      ["linear", "linear"], ["FAFF", "FAFF"], ["shftwst/faff", "shftwst/faff"],
      ["docs/specs/", "docs/specs/"], ["true", '"true"'], ["123", '"123"'],
      ["~", '"~"'], ["", '""'], ["a #b", '"a #b"'], ["[x]", '"[x]"'],
      [" lead", '" lead"'], ["trail ", '"trail "'], ["1.5", '"1.5"'], ["false", '"false"'],
    ];
    let ok = true, badEmit = "";
    for (const [input, expectEmit] of cases) {
      const emitted = emitScalar(input);
      if (emitted !== expectEmit) { ok = false; badEmit = `${JSON.stringify(input)}→${JSON.stringify(emitted)} (want ${JSON.stringify(expectEmit)})`; break; }
      // and it must round-trip back to the original string.
      if (scalar(emitted) !== input) { ok = false; badEmit = `${JSON.stringify(input)} does not round-trip`; break; }
    }
    check("emit: quoting truth table + round-trip" + (ok ? "" : " — " + badEmit), ok);
  }

  // unknown-key rejection is enforced in cmdConfigInit (arg parse) — assert the allowlist shape here.
  check("allowlist: known key normalises", TRACKING_KEYS.includes("tracking.team_key"));
  check("allowlist: unknown key absent", !TRACKING_KEYS.includes("tracking.slug"));

  // empty tracking block (key with null body): inserts children.
  {
    const orig = "tracking:\nslots:\n  spec: x\n";
    const { text, changed } = mergeTrackingBlock(orig, { repo: "a/b" }, false);
    check("empty-block: inserts child", changed === true && reads(text, "repo") === "a/b");
    check("empty-block: slots untouched", text.includes("slots:\n  spec: x"));
  }

  // FAFF-531: insert into a 4-space-indented tracking block (like this repo's own
  // .faffrc.yaml). The inserted key must land at the block's own indent (4), not a
  // hardcoded 2, or parseYamlSubset reads it as outside the block → null → the
  // round-trip guard aborts. The `/` in the repro value is coincidental — a
  // non-slash key reproduces the same failure, so both are asserted.
  {
    const orig = "tracking:\n    spec_docs_path: docs/specs/ # where graft commits\n";
    const { text, changed, conflicts } = mergeTrackingBlock(orig, { repo: "shftwst/faff" }, false);
    check("4-space-insert: changed, no conflict", changed === true && conflicts.length === 0);
    check("4-space-insert: slash value round-trips", reads(text, "repo") === "shftwst/faff");
    check("4-space-insert: sibling key + inline comment byte-intact",
      text.includes("    spec_docs_path: docs/specs/ # where graft commits"));
    check("4-space-insert: sibling reads back", reads(text, "spec_docs_path") === "docs/specs/");
    check("4-space-insert: inserted line at 4-space indent",
      text.split("\n").some((l) => l === "    repo: shftwst/faff"));
  }
  {
    // non-slash new key into a 4-space block — proves the fix is indent-general,
    // not slash-specific (a bare `team_key=FAFF` also returned null pre-fix).
    const orig = "tracking:\n    spec_docs_path: docs/specs/\n";
    const { text } = mergeTrackingBlock(orig, { team_key: "FAFF" }, false);
    check("4-space-insert: non-slash key round-trips", reads(text, "team_key") === "FAFF");
    check("4-space-insert: non-slash sibling intact", reads(text, "spec_docs_path") === "docs/specs/");
  }
  {
    // regression guard: inserting into a 2-space block is byte-identical to pre-fix
    // (blockIndent samples 2), so no existing merge selftest output shifts.
    const orig = "tracking:\n  tracker: linear\n";
    const { text } = mergeTrackingBlock(orig, { team_key: "FAFF" }, false);
    check("2-space-insert: byte-identical to pre-fix (2-space pad)",
      text === "tracking:\n  tracker: linear\n  team_key: FAFF\n");
  }

  // FAFF-262: block-sequence parsing (arrays of maps + arrays of scalars).
  {
    const text = "faffter_dark:\n  adversarial:\n    backends:\n      - provider: nvidia\n        model: nemotron\n      - provider: ollama\n        model: qwen3\n";
    const arr = dig(parseYamlSubset(text), "faffter_dark.adversarial.backends");
    check("seq: array of maps is an Array of length 2", Array.isArray(arr) && arr.length === 2);
    check("seq: map item 1 multi-key intact", arr && arr[0] && arr[0].provider === "nvidia" && arr[0].model === "nemotron");
    check("seq: map item 2 multi-key intact", arr && arr[1] && arr[1].provider === "ollama" && arr[1].model === "qwen3");
  }
  {
    const arr = dig(parseYamlSubset("hosts:\n  - alpha\n  - beta\n"), "hosts");
    check("seq: array of scalars", Array.isArray(arr) && arr.length === 2 && arr[0] === "alpha" && arr[1] === "beta");
  }
  {
    // scalar coercion of sequence items (numbers/booleans via scalar()).
    const arr = dig(parseYamlSubset("nums:\n  - 1\n  - 2\n  - true\n"), "nums");
    check("seq: scalar coercion of items", Array.isArray(arr) && arr[0] === 1 && arr[1] === 2 && arr[2] === true);
  }
  {
    // nested map inside a sequence item.
    const arr = dig(parseYamlSubset("items:\n  - name: a\n    opts:\n      x: 1\n"), "items");
    check("seq: nested map inside item", Array.isArray(arr) && arr[0].name === "a" && arr[0].opts && arr[0].opts.x === 1);
  }
  {
    // regression guard: scalars + nested maps + block scalar + JSON-string scalar parse unchanged.
    const text = "tracking:\n  team_key: SHF\n  spec_docs_path: docs/specs/\nnote: |\n  line one\n  line two\nfallbacks: '[{\"provider\":\"x\"}]'\n";
    const d = parseYamlSubset(text);
    check("seq regression: scalar unchanged", dig(d, "tracking.team_key") === "SHF");
    check("seq regression: nested map unchanged", dig(d, "tracking.spec_docs_path") === "docs/specs/");
    check("seq regression: block scalar unchanged", dig(d, "note") === "line one\nline two\n");
    check("seq regression: JSON-string scalar stays a string", dig(d, "fallbacks") === '[{"provider":"x"}]');
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${fail} failed)`);
  return fail ? 1 : 0;
}

// ---------------------------------------------------------------------------
// FAFF-387 — `faff config check`: deterministic posture + integrity checker.
// Read-only, NO tracker/network/writes. Exit 0 clean / 1 >=1 finding / 2 unreadable.
// Part of the factory `config` region (no own banner — a plain sub-section).
// ---------------------------------------------------------------------------

// Secret-scan table (spec Appendix A). Two complementary detectors, tuned for
// near-zero false positives on real config (hosts, model ids, paths all carry the
// `. : /` separators the generic detector excludes; `*_env` keys are exempt by
// design). The table is DATA — one row per pattern — so extending it is a one-line
// change plus a selftest row. `known` matches the VALUE anywhere; `generic` gates on
// the KEY name AND a high-entropy value shape.
const SECRET_KNOWN_PREFIXES = [
  "sk-", "ghp_", "gho_", "ghu_", "ghs_", "github_pat_", "AKIA",
  "nvapi-", "AIza", "-----BEGIN ",
];
// xox[baps]- (Slack) is a shape, not a bare prefix — kept as an explicit regex.
const SECRET_KNOWN_REGEXES = [/xox[baps]-/];
const SECRET_KEYNAME_RE = /key|token|secret|password|credential/i;
const SECRET_GENERIC_VALUE_RE = /^[A-Za-z0-9+/=_-]{32,}$/;

// PURE: does this (keyName, value) look like a leaked credential? Returns a reason
// string ("known-prefix" | "generic-high-entropy") or null. Never returns the value.
function secretScanLeaf(keyName, value) {
  if (typeof value !== "string" || value === "") return null;
  for (const pfx of SECRET_KNOWN_PREFIXES) if (value.startsWith(pfx)) return "known-prefix";
  for (const re of SECRET_KNOWN_REGEXES) if (re.test(value)) return "known-prefix";
  // Generic: key-name-gated, `*_env` exempt (the name-indirection pattern), and the
  // value must be a long separator-free high-entropy blob (excludes hosts/ids/paths).
  if (SECRET_KEYNAME_RE.test(keyName) && !/_env$/.test(keyName) && SECRET_GENERIC_VALUE_RE.test(value)) {
    return "generic-high-entropy";
  }
  return null;
}

// Redact a suspected secret to key-path + length + first-4-chars ONLY — NEVER the
// value. The raw value must never reach any output stream (spec: a checker that
// prints the secret recreates the leak it guards against).
function redactSecret(keyPath, value) {
  const v = String(value);
  return `${keyPath} (len=${v.length}, starts "${v.slice(0, 4)}")`;
}

// PURE: walk a parsed config document, applying secretScanLeaf to every scalar
// (string) leaf. Recurses maps and sequences; keys the finding by dotted path (and
// [i] for sequence items). `fileLabel` prefixes the finding surface so a base vs
// overlay hit is distinguishable. Returns [{severity,surface,message}].
function scanDocForSecrets(doc, fileLabel) {
  const findings = [];
  const walk = (node, keyPath, leafName) => {
    if (typeof node === "string") {
      const reason = secretScanLeaf(leafName, node);
      if (reason) findings.push({ severity: "warn", surface: `${fileLabel}:${keyPath}`, message: `possible secret (${reason}) — ${redactSecret(keyPath, node)}. Move it to an env var (\`*_env\` names the var; the value never lives in config).` });
      return;
    }
    if (Array.isArray(node)) { node.forEach((item, i) => walk(item, `${keyPath}[${i}]`, leafName)); return; }
    if (isPlainConfigMap(node)) { for (const k of Object.keys(node)) walk(node[k], keyPath ? `${keyPath}.${k}` : k, k); }
  };
  walk(doc, "", "");
  return findings;
}

// Git posture probes — read-only, stdlib child_process. Return true/false/null
// (null = probe unavailable, i.e. not in a git repo or git absent).
function gitInRepo(root) {
  const r = spawnSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  return r.status === 0 && (r.stdout || "").trim() === "true";
}
function gitIsIgnored(root, relPath) {
  // exit 0 = ignored, 1 = not ignored, other = error.
  const r = spawnSync("git", ["-C", root, "check-ignore", "-q", relPath], { encoding: "utf8" });
  return r.status === 0;
}
function gitIsTracked(root, relPath) {
  const r = spawnSync("git", ["-C", root, "ls-files", "--error-unmatch", relPath], { encoding: "utf8" });
  return r.status === 0;
}

const MIGRATION_STEPS = [
  "1. Move machine-local values (private hosts, personal model prefs) into .faffrc.local.yaml",
  "2. Edit .gitignore: drop the `.faffrc.yaml` line; add `.faffrc.local.yaml`",
  "3. Run `faff config check`, then commit .faffrc.yaml",
];

// PURE core of `config check` — takes the already-resolved inputs and returns
// { findings, skipped, exit }. Split from cmdConfigCheck's I/O so --selftest can
// drive the secret scan + posture logic in-memory without a real git repo.
// `probes` supplies { inRepo, isIgnored(rel), isTracked(rel) } (nullable inRepo).
function computeConfigCheck({ basePath, baseDoc, overlayPath, overlayDoc, legacyBase, legacyOverlay, probes }) {
  const findings = [];
  const skipped = [];
  const rel = (p) => (p ? path.basename(p) : null);

  // Check 5: legacy filenames present (mirror the loud resolver error as a finding).
  for (const n of [...(legacyBase || []), ...(legacyOverlay || [])]) {
    findings.push({ severity: "error", surface: n, message: `legacy config filename \`${n}\` present — faff uses only \`.faffrc.yaml\` / \`.faffrc.local.yaml\`; rename it.` });
  }

  // Check 2 + 3: posture (git). Skipped entirely outside a git repo.
  if (probes.inRepo) {
    if (basePath) {
      const baseRel = rel(basePath);
      if (probes.isIgnored(baseRel) || !probes.isTracked(baseRel)) {
        findings.push({ severity: "warn", surface: baseRel, message: `\`${baseRel}\` is unmigrated/uncommitted (git-ignored or untracked) — unrecoverable if corrupted. Migrate:\n${MIGRATION_STEPS.map((s) => "     " + s).join("\n")}` });
      }
    }
    if (overlayPath) {
      const ovRel = rel(overlayPath);
      if (!probes.isIgnored(ovRel)) {
        findings.push({ severity: "warn", surface: ovRel, message: `\`${ovRel}\` is NOT git-ignored — the machine-local overlay is about to be committed. Add it to .gitignore.` });
      }
    }
  } else {
    skipped.push("posture checks skipped (not a git repo)");
  }

  // Check 4: secret scan over both files' scalar leaves (redacted output).
  if (baseDoc) findings.push(...scanDocForSecrets(baseDoc, rel(basePath) || ".faffrc.yaml"));
  if (overlayDoc) findings.push(...scanDocForSecrets(overlayDoc, rel(overlayPath) || ".faffrc.local.yaml"));

  // Check 6 (FAFF-523): backends: namespace soundness — a name collision with
  // engines: (error) and the derived-egress residency guard (warn) over the
  // MERGED document (overlay wins scalars over base, same posture as every
  // other resolved value).
  const mergedDoc = overlayDoc ? deepMergeConfig(baseDoc || {}, overlayDoc) : (baseDoc || {});
  findings.push(...backendsConfigCheckFindings(mergedDoc));

  return { findings, skipped, exit: findings.length ? 1 : 0 };
}

function cmdConfigCheck(args, root) {
  if (args.includes("--selftest")) return configCheckSelftest();
  const json = args.includes("--json");

  // Check 1: parse. Resolve both files, reading each independently so a parse fault
  // in EITHER is a loud exit 2 (never a silent skip). Legacy names are collected as
  // findings, not thrown, so `config check` reports them rather than aborting.
  let basePath = null, baseDoc = null, overlayPath = null, overlayDoc = null;
  const legacyBase = [], legacyOverlay = [];
  try {
    basePath = findConfig(root);
  } catch (e) {
    if (e.message === "legacy-config-name") legacyBase.push(...e.legacy);
    else { process.stderr.write(`faff config check: ${e.message}\n`); return 2; }
  }
  try {
    overlayPath = findOverlay(root);
  } catch (e) {
    if (e.message === "legacy-overlay-config-name") legacyOverlay.push(...e.legacy);
    else { process.stderr.write(`faff config check: ${e.message}\n`); return 2; }
  }
  if (basePath) {
    try {
      const raw = parseYamlSubset(fs.readFileSync(basePath, "utf8"));
      baseDoc = isPlainConfigMap(raw) ? raw : {};
    } catch (e) {
      process.stderr.write(`faff config check: ${basePath} unreadable (${e.code || e.message})\n`);
      return 2;
    }
  }
  if (overlayPath) {
    try {
      overlayDoc = parseOverlayStrict(overlayPath);
    } catch (e) {
      process.stderr.write(`faff config check: ${e.file || overlayPath} failed to parse (${e.detail || e.message})\n`);
      return 2;
    }
  }

  const inRepo = gitInRepo(root);
  const probes = {
    inRepo,
    isIgnored: (relPath) => gitIsIgnored(root, relPath),
    isTracked: (relPath) => gitIsTracked(root, relPath),
  };
  const { findings, skipped, exit } = computeConfigCheck({
    basePath, baseDoc, overlayPath, overlayDoc, legacyBase, legacyOverlay, probes,
  });

  if (json) {
    console.log(JSON.stringify({ ok: exit === 0, findings, skipped }, null, 2));
    return exit;
  }
  for (const s of skipped) console.log(`skip  ${s}`);
  for (const f of findings) console.log(`${f.severity === "error" ? "ERROR" : "warn "} ${f.surface}: ${f.message}`);
  if (exit === 0) {
    console.log(skipped.length ? "config check: no findings (some checks skipped)" : "config check: clean");
  }
  return exit;
}

// In-memory selftest of the secret-pattern table + the merge (deepMergeConfig)
// behaviour + the posture logic (via computeConfigCheck's pure core). Mirrors the
// other --selftest commands: per-case ok/FAIL + a RESULT line, non-zero on any fail.
function configCheckSelftest() {
  let fail = 0;
  const check = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "ok  " : "FAIL"} ${label}`); };

  // --- secret-pattern table -------------------------------------------------
  check("secret: sk- prefix flagged", secretScanLeaf("api_key", "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD") === "known-prefix");
  check("secret: ghp_ prefix flagged", secretScanLeaf("anything", "ghp_0123456789abcdefghij") === "known-prefix");
  check("secret: AKIA prefix flagged", secretScanLeaf("aws", "AKIAIOSFODNN7EXAMPLE") === "known-prefix");
  check("secret: nvapi- prefix flagged", secretScanLeaf("k", "nvapi-xxxxxxxxxxxxxxxxxxxx") === "known-prefix");
  check("secret: AIza prefix flagged", secretScanLeaf("k", "AIzaSyBhydeSomethingLong") === "known-prefix");
  check("secret: xoxb- shape flagged", secretScanLeaf("k", "xoxb-123-456-abcdef") === "known-prefix");
  check("secret: PEM header flagged", secretScanLeaf("k", "-----BEGIN RSA PRIVATE KEY-----") === "known-prefix");
  check("secret: generic high-entropy on key-named field flagged",
    secretScanLeaf("api_token", "aB3dEf6hIj9lMn2pQr5tUv8xYz1AbC4d") === "generic-high-entropy");
  // exemptions / non-secrets
  check("secret: *_env key exempt", secretScanLeaf("api_key_env", "NVIDIA_API_KEY") === null);
  check("secret: host NOT flagged", secretScanLeaf("host", "https://integrate.api.nvidia.com/v1") === null);
  check("secret: model id NOT flagged", secretScanLeaf("model", "qwen3-next:80b-a3b-instruct-q4_K_M") === null);
  check("secret: path NOT flagged", secretScanLeaf("spec_docs_path", "docs/specs/") === null);
  check("secret: short value on key-named field NOT flagged (below 32)", secretScanLeaf("token", "shortish") === null);
  check("secret: non-key-named long blob NOT flagged (generic gated on key name)",
    secretScanLeaf("some_field", "aB3dEf6hIj9lMn2pQr5tUv8xYz1AbC4d") === null);

  // redaction NEVER emits the raw value.
  {
    const raw = "sk-SUPERSECRETVALUE1234567890abcdef";
    const red = redactSecret("faffter_dark.adversarial.api_key", raw);
    check("redact: raw value absent from redacted output", !red.includes("SECRETVALUE") && !red.includes(raw));
    check("redact: shows len + 4-char prefix", red.includes("len=") && red.includes(`"sk-S"`));
  }
  {
    // scanDocForSecrets full-path: the raw value must not appear in ANY finding message.
    const raw = "ghp_ZZZZZZZZZZ0123456789abcdefghij";
    const doc = { faffter_dark: { adversarial: { api_key: raw } } };
    const fs2 = scanDocForSecrets(doc, ".faffrc.yaml");
    check("scan: nested leaf flagged by dotted path", fs2.length === 1 && fs2[0].surface === ".faffrc.yaml:faffter_dark.adversarial.api_key");
    check("scan: raw value NEVER in finding message", !fs2[0].message.includes(raw) && !fs2[0].message.includes("ZZZZZZZZZZ"));
    // sequence-item leaf scanning.
    const doc2 = { fallbacks: [{ api_key: raw }] };
    const fs3 = scanDocForSecrets(doc2, "x");
    check("scan: sequence-item leaf flagged with [i] path", fs3.length === 1 && fs3[0].surface === "x:fallbacks[0].api_key");
  }

  // --- merge table (deepMergeConfig) ---------------------------------------
  check("merge: overlay wins scalar",
    deepMergeConfig({ appetite: "high" }, { appetite: "low" }).appetite === "low");
  check("merge: deep-merge maps per leaf (base sibling survives)", (() => {
    const m = deepMergeConfig({ slots: { spec: "a", review: "b" } }, { slots: { review: "c" } });
    return m.slots.spec === "a" && m.slots.review === "c";
  })());
  check("merge: sequences replaced wholesale (never element-merged)", (() => {
    const m = deepMergeConfig({ hosts: ["a", "b", "c"] }, { hosts: ["x"] });
    return Array.isArray(m.hosts) && m.hosts.length === 1 && m.hosts[0] === "x";
  })());
  check("merge: overlay-only key added", deepMergeConfig({ a: 1 }, { b: 2 }).b === 2);
  check("merge: no overlay → base unchanged (identity)", (() => {
    const base = { a: 1, b: { c: 2 } };
    return deepMergeConfig(base, {}).a === 1 && deepMergeConfig(base, {}).b.c === 2;
  })());
  check("merge: type mismatch (map over scalar) → overlay wins", (() => {
    const m = deepMergeConfig({ x: "scalar" }, { x: { nested: 1 } });
    return isPlainConfigMap(m.x) && m.x.nested === 1;
  })());
  check("merge: does not mutate base input", (() => {
    const base = { slots: { spec: "a" } };
    deepMergeConfig(base, { slots: { spec: "z" } });
    return base.slots.spec === "a";
  })());

  // --- posture logic (computeConfigCheck pure core) ------------------------
  {
    // base git-ignored → posture warn with migration steps; exit 1.
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: {}, overlayPath: null, overlayDoc: null,
      legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => true, isTracked: () => false },
    });
    check("posture: ignored base → 1 finding, exit 1", r.findings.length === 1 && r.exit === 1);
    check("posture: finding carries migration steps", r.findings[0].message.includes("Migrate:") && r.findings[0].message.includes(".faffrc.local.yaml"));
  }
  {
    // base tracked + not ignored → clean, exit 0.
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: {}, overlayPath: null, overlayDoc: null,
      legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("posture: tracked base → clean, exit 0", r.findings.length === 0 && r.exit === 0);
  }
  {
    // overlay NOT ignored → hygiene finding.
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: {}, overlayPath: "/r/.faffrc.local.yaml", overlayDoc: {},
      legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: (n) => n === ".faffrc.yaml" ? false : false, isTracked: () => true },
    });
    check("hygiene: un-ignored overlay flagged", r.findings.some((f) => f.surface === ".faffrc.local.yaml" && /NOT git-ignored/.test(f.message)));
  }
  {
    // not a git repo → posture skipped (reported), parse/secret still run; clean → exit 0.
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: { slots: { spec: "x" } }, overlayPath: null, overlayDoc: null,
      legacyBase: [], legacyOverlay: [],
      probes: { inRepo: false, isIgnored: () => false, isTracked: () => false },
    });
    check("not-a-repo: posture skipped + reported", r.skipped.length === 1 && r.exit === 0);
  }
  {
    // secret in base doc → exit 1, redacted (no raw value in any message).
    const raw = "sk-abcdefghijklmnopqrstuvwxyz0123456789";
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: { api_key: raw }, overlayPath: null, overlayDoc: null,
      legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("secret-in-doc: exit 1", r.exit === 1);
    check("secret-in-doc: no raw value in output", !JSON.stringify(r.findings).includes(raw));
  }
  {
    // legacy filename present → error finding, exit 1.
    const r = computeConfigCheck({
      basePath: null, baseDoc: null, overlayPath: null, overlayDoc: null,
      legacyBase: [".faffrc.yml"], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("legacy: present filename → error finding, exit 1", r.exit === 1 && r.findings.some((f) => f.severity === "error"));
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (config check, ${fail} failed)`);
  return fail ? 1 : 0;
}

function cmdConfig(args) {
  let root = null;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
    else rest.push(args[i]);
  }
  root = root || findRoot();
  const cmd = rest[0];
  try {
    if (cmd === "path") {
      // FAFF-387: multi-line — each resolved file on its own line, base first;
      // exit 3 only when NEITHER file exists (first-run offer semantics preserved).
      // BACK-COMPAT: with no overlay (the common case), output is the exact same
      // single line as before.
      const basePath = findConfig(root);
      const overlayPath = findOverlay(root);       // may throw legacy-overlay-config-name
      if (basePath === null && overlayPath === null) return 3;
      if (basePath !== null) console.log(basePath);
      if (overlayPath !== null) console.log(overlayPath);
      return 0;
    }
    if (cmd === "check") {
      return cmdConfigCheck(rest.slice(1), root);
    }
    if (cmd === "get") {
      // FAFF-26: --json prints the value as JSON (structured: lists/objects survive instead of
      // being stringified to "[object Object]"). Key is the first positional that isn't a flag
      // or a flag's value, so `config get --json infra` and `config get infra` both resolve `infra`.
      const wantJson = rest.includes("--json");
      let def = null, key = null;
      for (let i = 1; i < rest.length; i++) {
        const a = rest[i];
        if (a === "-d" || a === "--default") { def = rest[++i] ?? null; continue; }
        if (a === "--json") continue;
        if (key === null) key = a;
      }
      const [data] = loadConfig(root);
      // FAFF-308: appetite is the one level-scoped dial — route it through the sole appetite
      // resolver so an active L4 run forces `full`. Guarded to the `appetite` key ONLY; every
      // other key's resolution below is byte-for-byte unchanged.
      if (key === "appetite") {
        const app = resolveAppetite(data, process.env);
        console.log(wantJson ? JSON.stringify(app) : app);
        return 0;
      }
      const value = dig(data, key);
      if (value === null || value === undefined) {
        // FAFF-182: a registry key resolves to its baked default (exit 0) — no prose `-d` needed.
        if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
          console.log(wantJson ? JSON.stringify(DEFAULTS[key]) : DEFAULTS[key]);
          return 0;
        }
        if (def !== null) console.log(wantJson ? JSON.stringify(def) : def);
        else if (wantJson) console.log("null");
        return 3;
      }
      // FAFF-315: Agent-token model lanes have a closed vocabulary — an invalid configured
      // value fails loud here (exit 2), never a silent inherit at the dispatch site.
      const laneErr = validateModelLane(key, fmt(value)) || validateEffortLane(key, fmt(value));
      if (laneErr) { process.stderr.write(laneErr + "\n"); return 2; }
      // FAFF-422: an allowlisted engine value also resolves its engines.<name> reference at
      // read — a dangling name / missing field / illegal provider fails loud HERE, not at
      // the first dispatch that happens to touch the lane.
      if (/^models\./.test(key) && /^engine:/.test(fmt(value))) {
        const refErr = validateEngineRef(data, fmt(value));
        if (refErr) { process.stderr.write(`config get ${key}: ${refErr}\n`); return 2; }
      }
      console.log(wantJson ? JSON.stringify(value) : fmt(value));
      return 0;
    }
    if (cmd === "defaults") {
      // FAFF-182: print the registry; --selftest asserts it covers the expected slots + scalars.
      if (rest.includes("--selftest")) {
        const expected = [
          "slots.intake", "slots.spec", "slots.spec_review", "slots.review", "slots.ship", "slots.concurrency",
          "slots.methodology", "slots.routing_adaptor", "slots.rendering_adaptor", "slots.adr", "slots.architecture",
          "slots.env", "slots.prd",
          "logging", "concurrency_max", "automation_default", "appetite", "adr.mode", "intake_gate",
          "containment.self_hosting_intake",
          "gates.fallback", "post_merge.check", "budget.at_ceiling",
          "models.build", "models.prep_explore",
          "models.spec", "models.spec_review", "models.methodology", "models.intake",
          "models.architecture",
          "models.eval",
          // FAFF-416: per-lane effort lanes (non-prep, subagent-dispatched only).
          "effort.build", "effort.methodology", "effort.intake",
          // FAFF-403: graft's outage-retry-later bound (graft.* namespace — graft owns the loop).
          "graft.review_outage_retry_limit",
          // FAFF-333: the lights-out host-socket boundedness attestation (default false).
          "autonomous.engine_bounded",
        ];
        const missing = expected.filter((k) => !Object.prototype.hasOwnProperty.call(DEFAULTS, k));
        if (missing.length) { process.stderr.write(`config defaults --selftest: missing ${missing.join(", ")}\n`); return 1; }
        // FAFF-315: the model-lane vocab table must cover every Agent-token lane, accept its own
        // defaults, and reject an off-vocabulary token (the fail-loud path is load-bearing).
        const vocabFail =
          validateModelLane("models.build", DEFAULTS["models.build"]) ||
          validateModelLane("models.prep_explore", DEFAULTS["models.prep_explore"]) ||
          // FAFF-372: the migrated producer lanes accept their own defaults and reject off-vocabulary tokens.
          validateModelLane("models.spec", DEFAULTS["models.spec"]) ||
          validateModelLane("models.spec_review", DEFAULTS["models.spec_review"]) ||
          validateModelLane("models.methodology", DEFAULTS["models.methodology"]) ||
          validateModelLane("models.intake", DEFAULTS["models.intake"]) ||
          validateModelLane("models.architecture", DEFAULTS["models.architecture"]) ||
          (validateModelLane("models.architecture", "gpt-5") ? null : "architecture lane vocab failed to reject an invalid token") ||
          (validateModelLane("models.spec", "gpt-5") ? null : "producer lane vocab failed to reject an invalid token") ||
          (validateModelLane("models.build", "gpt-5") ? null : "vocab table failed to reject an invalid token") ||
          (validateModelLane("models.eval", "any-id-is-fine") ? "models.eval must be open-vocabulary" : null) ||
          // FAFF-334: the per-issue matcher leaves must reuse the build vocab — accept a valid token, reject an invalid one.
          validateModelLane("models.build_by_confidence.high", "sonnet") ||
          (validateModelLane("models.build_by_confidence.high", "gpt-5") ? null : "matcher leaf failed to reject an invalid token") ||
          // FAFF-416: the effort-lane vocab must accept every effort lane's default (inherit) + a
          // real effort level, and reject an off-vocabulary token (the fail-loud path is load-bearing).
          validateEffortLane("effort.build", DEFAULTS["effort.build"]) ||
          validateEffortLane("effort.methodology", "low") ||
          validateEffortLane("effort.intake", "max") ||
          (validateEffortLane("effort.build", "sonnet") ? null : "effort lane vocab failed to reject a model token") ||
          (validateEffortLane("effort.build", "ultra") ? null : "effort lane vocab failed to reject an invalid effort token") ||
          // FAFF-422: engine values are legal on exactly the pure-data-in allowlist — the two
          // allowlisted lanes accept the SHAPE, every other models.* key (incl. the open-vocabulary
          // eval lane and the matcher leaves) rejects it naming the allowlist.
          validateModelLane("models.methodology", "engine:studio") ||
          validateModelLane("models.intake", "engine:studio") ||
          (validateModelLane("models.build", "engine:studio") ? null : "build lane failed to reject an engine value (FAFF-422 allowlist)") ||
          (validateModelLane("models.spec", "engine:studio") ? null : "spec lane failed to reject an engine value (FAFF-422 allowlist)") ||
          (validateModelLane("models.eval", "engine:studio") ? null : "eval lane failed to reject an engine value (FAFF-422 allowlist)") ||
          (validateModelLane("models.build_by_confidence.high", "engine:studio") ? null : "matcher leaf failed to reject an engine value (FAFF-422 allowlist)");
        if (vocabFail) { process.stderr.write(`config defaults --selftest: ${vocabFail}\n`); return 1; }
        console.log("config defaults --selftest: ok");
        return 0;
      }
      console.log(JSON.stringify(DEFAULTS, null, 2));
      return 0;
    }
    if (cmd === "spec-docs-path") {
      const [data] = loadConfig(root);
      console.log(resolveSpecDocsPath(root, data, rest.includes("--create")));
      return 0;
    }
    if (cmd === "prd-docs-path") {
      const [data] = loadConfig(root);
      console.log(resolvePrdDocsPath(root, data, rest.includes("--create")));
      return 0;
    }
    if (cmd === "dump") {
      const [data] = loadConfig(root);
      console.log(JSON.stringify(data, null, 2));
      return 0;
    }
    if (cmd === "init") {
      if (rest.includes("--selftest")) return configInitSelftest();
      return cmdConfigInit(rest.slice(1), root);
    }
    if (cmd === "resolved") {
      // FAFF-50: loud, human-readable echo of the resolved NON-default config — what a run
      // actually uses that overrides a built-in default. Print it in run banners so a dropped
      // slot is visible, not silent.
      const [data, p, overlayPath] = loadConfig(root);
      const slots = (data.slots && typeof data.slots === "object" && !Array.isArray(data.slots)) ? data.slots : {};
      const SLOTS = ["intake", "spec", "spec_review", "architecture", "env", "review", "ship", "concurrency", "methodology",
        "routing_adaptor", "rendering_adaptor"];
      console.log(`config:   ${p || "(none — all defaults)"}`);
      // FAFF-387: an active overlay is echoed on its own line — never silent — so a
      // run banner shows both files in play. BACK-COMPAT: with no overlay (the
      // common case) this line is simply omitted, so output is byte-for-byte the
      // pre-FAFF-387 form.
      if (overlayPath) console.log(`config local: ${overlayPath}`);
      console.log(`appetite: ${dig(data, "appetite") ?? "high (default)"}`);
      // FAFF-212 review F3: surface a non-default intake_gate so a typo'd/overridden
      // value is visible in the run banner, not silently coerced behind the user's back.
      const gate = dig(data, "intake_gate");
      if (gate !== null && gate !== undefined && gate !== "") console.log(`intake_gate: ${gate}`);
      // FAFF-42/350/333: surface a non-default autonomous-entry preflight knob (require_container /
      // require_branch_protection / engine_bounded) so an opt-in `block` — or the engine_bounded
      // attestation — is visible in the run banner, never silent.
      for (const knob of ["require_container", "require_branch_protection", "engine_bounded"]) {
        const v = dig(data, `autonomous.${knob}`);
        if (v !== null && v !== undefined && v !== "") console.log(`autonomous.${knob}: ${v}`);
      }
      let any = false;
      for (const s of SLOTS) {
        const v = slots[s];
        if (v !== null && v !== undefined && v !== "") { console.log(`slot ${s}: ${v}`); any = true; }
      }
      if (!any) console.log("slots:    (all defaults)");
      // FAFF-315: surface non-default per-lane models in the run banner — a pinned model must be
      // visible, not silent (the same FAFF-50 intent as the slot echo above).
      const models = (data.models && typeof data.models === "object" && !Array.isArray(data.models)) ? data.models : {};
      for (const lane of ["build", "prep_explore", "spec", "spec_review", "methodology", "intake", "architecture", "eval"]) {
        const v = models[lane];
        if (v !== null && v !== undefined && v !== "") console.log(`model ${lane}: ${v}`);
      }
      // FAFF-334: surface the per-issue build-model matcher when set — a routing config that flips
      // build-model resolution from per-run to per-issue must be visible in the run banner, not silent.
      const byConf = (models.build_by_confidence && typeof models.build_by_confidence === "object" && !Array.isArray(models.build_by_confidence)) ? models.build_by_confidence : {};
      // Only the buckets that actually route are echoed (default/high/medium) — a `low` leaf is inert
      // (a low-confidence spec parks at prep, never builds), so echoing it would imply a live routing
      // config that does nothing and mislead the reader about what the run will do.
      for (const conf of ["default", "high", "medium"]) {
        const v = byConf[conf];
        if (v !== null && v !== undefined && v !== "") console.log(`model build_by_confidence.${conf}: ${v}`);
      }
      // FAFF-416: surface non-default per-lane effort in the run banner — a pinned effort must be
      // visible, not silent (the same FAFF-50 intent as the slot + model echoes above).
      const effort = (data.effort && typeof data.effort === "object" && !Array.isArray(data.effort)) ? data.effort : {};
      for (const lane of ["build", "methodology", "intake"]) {
        const v = effort[lane];
        if (v !== null && v !== undefined && v !== "") console.log(`effort ${lane}: ${v}`);
      }
      return 0;
    }
  } catch (e) {
    if (e.message === "legacy-config-name") {
      const names = e.legacy.join(", ");
      process.stderr.write(`faff config: legacy config filename found (${names}). faff uses only \`${CANONICAL_CONFIG}\` — rename it to \`${CANONICAL_CONFIG}\`. (FAFF-50: single canonical config name; never a silent default.)\n`);
      return 2;
    }
    if (e.message === "multiple-config") {
      const names = e.files.map((f) => path.basename(f)).join(", ");
      process.stderr.write(`faff config: multiple config files at the repo root (${names}); keep only one.\n`);
      return 2;
    }
    // FAFF-387: the overlay's own legacy-name + parse-fault tags — same LOUD,
    // never-silent discipline as the base file's legacy-config-name above.
    if (e.message === "legacy-overlay-config-name") {
      const names = e.legacy.join(", ");
      process.stderr.write(`faff config: legacy overlay config filename found (${names}). faff uses only \`${CANONICAL_OVERLAY_CONFIG}\` — rename it to \`${CANONICAL_OVERLAY_CONFIG}\`. (FAFF-387: single canonical overlay name; never a silent default.)\n`);
      return 2;
    }
    if (e.message === "overlay-parse-error") {
      process.stderr.write(`faff config: ${e.file} failed to parse (${e.detail}) — an overlay parse failure is never silently skipped (FAFF-387).\n`);
      return 2;
    }
    throw e;
  }
  process.stderr.write("faff config: expected one of path|get|spec-docs-path|dump|resolved|init|check\n");
  return 2;
}

// FAFF-334: per-issue build-model routing. `models.build` (FAFF-315) is a single per-run scalar;
// this resolver keys the build model off an issue's retained spec confidence via the OPTIONAL sibling
// matcher `models.build_by_confidence` (a `default` + confidence-keyed leaves), so a mixed-confidence
// build queue picks the safe model per issue with no rc churn. PURE — the confidence is passed in, no
// tracker call (the orchestrator already holds it at assembly). Fallback chain, in order:
//   models.build_by_confidence.<conf> → models.build_by_confidence.default → models.build (scalar) → "inherit".
// The resolved token is validated against the closed build Agent-token set (fail-loud, never a silent
// inherit — FAFF-315/FAFF-50). An absent/unknown `conf` routes to the `default` bucket (never guesses
// `high`), mirroring the "no confidence line" tolerance the routing gate already applies. Matcher
// ABSENT ⇒ the scalar path, byte-for-byte FAFF-315.
function resolveBuildModel(cfg, conf) {
  const byConf = dig(cfg, "models.build_by_confidence");
  const rawMap = (byConf && typeof byConf === "object" && !Array.isArray(byConf)) ? byConf : null;
  // Normalise leaf keys to lowercase once — a capitalised YAML key (`High:`) must not silently miss
  // and route to the default bucket; the confidence tokens themselves are lowercase (high|medium|low).
  const map = {};
  if (rawMap) for (const k of Object.keys(rawMap)) {
    const v = rawMap[k];
    if (v !== null && v !== undefined && v !== "") map[String(k).trim().toLowerCase()] = String(v).trim();
  }
  // Validate EVERY configured leaf up-front — not just the resolved token. The spec's guarantee is
  // "an invalid Agent-token ANYWHERE in the matcher ⇒ fail-loud at read", so a typo in a not-yet-
  // dispatched leaf is caught at the first resolution, never left dormant until its bucket happens to build.
  for (const k of Object.keys(map)) {
    if (validateModelLane("models.build_by_confidence." + k, map[k])) {
      return { error: `faff models build-for: invalid model token "${map[k]}" in models.build_by_confidence.${k} — legal set: ${MODEL_LANE_VOCAB["models.build"].join(" | ")} (fail-loud, no silent inherit)` };
    }
  }
  const pick = (k) => (k != null && Object.prototype.hasOwnProperty.call(map, k)) ? map[k] : null;
  const key = conf != null ? String(conf).trim().toLowerCase() : null;
  let token = pick(key) ?? pick("default");
  if (token == null) {
    const scalar = dig(cfg, "models.build");
    token = (scalar === null || scalar === undefined || scalar === "") ? DEFAULTS["models.build"] : String(scalar).trim();
  }
  if (validateModelLane("models.build", token)) {
    return { error: `faff models build-for: resolved token "${token}" is not a legal build model — legal set: ${MODEL_LANE_VOCAB["models.build"].join(" | ")} (fail-loud, no silent inherit)` };
  }
  return { token };
}

// `faff models build-for <confidence>` — print the per-issue build model token (or "inherit", which
// the caller maps to "omit the Agent-tool model param"). Pure; exit 0 token / 2 usage or invalid token.
function cmdModels(args) {
  if (args.includes("--selftest")) return modelsSelftest();
  const sub = args.find((a) => !a.startsWith("-"));
  if (sub !== "build-for") {
    process.stderr.write("usage: faff models build-for <confidence> [--root DIR]\n");
    return 2;
  }
  const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  const root = get("--root") || findRoot();
  const bfIdx = args.indexOf("build-for");
  const confArg = (bfIdx !== -1 && args[bfIdx + 1] && !args[bfIdx + 1].startsWith("-")) ? args[bfIdx + 1] : null;
  const [cfg] = loadConfig(root);
  const res = resolveBuildModel(cfg, confArg);
  if (res.error) { process.stderr.write(res.error + "\n"); return 2; }
  console.log(res.token);
  return 0;
}

// Selftest — drives the pure resolver over the fallback chain + the read-time matcher-leaf validation.
function modelsSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { console.log(`FAIL ${name}`); fail++; } else console.log(`ok   ${name}`); };
  const full = { models: { build: "opus", build_by_confidence: { default: "opus", high: "sonnet", medium: "opus" } } };
  ok("build-for high → matcher leaf sonnet", resolveBuildModel(full, "high").token === "sonnet");
  ok("build-for medium → matcher leaf opus", resolveBuildModel(full, "medium").token === "opus");
  ok("build-for HIGH (case-insensitive) → sonnet", resolveBuildModel(full, "HIGH").token === "sonnet");
  ok("unknown conf → default bucket (opus)", resolveBuildModel(full, "zzz").token === "opus");
  ok("null conf → default bucket (opus)", resolveBuildModel(full, null).token === "opus");
  // fallback precedence: leaf absent → default → scalar → inherit
  ok("no leaf, has default → default", resolveBuildModel({ models: { build: "haiku", build_by_confidence: { default: "fable", high: "sonnet" } } }, "medium").token === "fable");
  ok("no leaf, no default → scalar models.build", resolveBuildModel({ models: { build: "haiku", build_by_confidence: { high: "sonnet" } } }, "medium").token === "haiku");
  ok("no matcher, has scalar → scalar (per-run FAFF-315 path)", resolveBuildModel({ models: { build: "fable" } }, "high").token === "fable");
  ok("no matcher, no scalar → inherit", resolveBuildModel({ models: {} }, "high").token === "inherit");
  ok("empty cfg → inherit", resolveBuildModel({}, "high").token === "inherit");
  // fail-loud on an invalid resolved token — never a silent inherit
  ok("invalid matcher leaf token fails loud", !!resolveBuildModel({ models: { build_by_confidence: { high: "gpt-5" } } }, "high").error);
  ok("invalid scalar fallback fails loud", !!resolveBuildModel({ models: { build: "gpt-5" } }, "zzz").error);
  ok("low leaf tolerated (inert but valid token)", resolveBuildModel({ models: { build_by_confidence: { low: "haiku", default: "opus" } } }, "low").token === "haiku");
  // fail-loud ANYWHERE — an invalid token in a NOT-dispatched leaf is caught, never left dormant
  ok("invalid UNUSED leaf fails loud (validate anywhere, not just resolved)",
    !!resolveBuildModel({ models: { build_by_confidence: { high: "gpt-5", default: "opus" } } }, "medium").error);
  // case-insensitive YAML leaf key — a capitalised `High:` must not silently miss → default
  ok("capitalised YAML leaf key (High:) resolves case-insensitively",
    resolveBuildModel({ models: { build_by_confidence: { High: "sonnet", default: "opus" } } }, "high").token === "sonnet");
  // read-time matcher-leaf validation (validateModelLane extension)
  ok("validateModelLane accepts a valid matcher leaf", validateModelLane("models.build_by_confidence.high", "sonnet") === null);
  ok("validateModelLane rejects an invalid matcher leaf", validateModelLane("models.build_by_confidence.high", "gpt-5") !== null);
  ok("validateModelLane accepts the default leaf", validateModelLane("models.build_by_confidence.default", "opus") === null);
  ok("validateModelLane leaves models.build scalar unchanged", validateModelLane("models.build", "sonnet") === null && validateModelLane("models.build", "gpt-5") !== null);
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (models build-for resolver, ${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { DEFAULTS, EFFORT_LANE_VOCAB, ENGINE_CALL_LANES, ENGINE_PROVIDER_FAMILY, INIT_HEADER, MODEL_LANE_VOCAB, TRACKING_KEYS, VALID_APPETITES, cmdConfig, cmdConfigCheck, cmdConfigInit, cmdModels, computeConfigCheck, configCheckSelftest, configInitSelftest, emitScalar, emitTrackingBlock, fmt, loadConfig, mergeTrackingBlock, modelsSelftest, redactSecret, resolveAppetite, resolveBuildModel, resolveDocsPath, resolveEngineForLane, resolvePrdDocsPath, resolvePrdrDocsPath, resolveSpecDocsPath, scanDocForSecrets, secretScanLeaf, validateEffortLane, validateEngineRef, validateModelLane };
