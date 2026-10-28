// ===========================================================================
// === region:factory — config-resolve — git host, label prefix, control labels, teams, isolation lanes, appetite, convergence, and `faff verification` ===
// ===========================================================================
// FAFF-1389: split out of config.js, which re-exports every name below that it exported before.

const { parseArgs, usageError } = require("./argv");
const { overlayHeartbeat, readHeartbeatFile } = require("./heartbeat");
const { runIsHeld } = require("./runcheck");
// FAFF-1061: reuse FAFF-717's attendedness READ half (declaredUnattendedFromConfig) and its
// fail-closed boolean coercion (literalTrue) so the interactive-verification resolver keys off the
// exact same unattended axis, never a parallel switch. factory→governance is a legal require edge
// (ADR-0042); the verification resolver deliberately does NOT call actsOnSentryAbort (running a
// verification leg is not acting on its floor — the spec anti-pattern).
const { declaredUnattendedFromConfig, literalTrue } = require("./sentry");
const { dig, findRoot, readLedger } = require("./shared-infra");
const { DEFAULTS, fmt, loadConfig } = require("./config-core");

const GIT_HOST_ALLOWLIST = ["github"];
function validateGitHostValue(key, value) {
  if (key !== "tracking.git_host") return null;
  if (GIT_HOST_ALLOWLIST.includes(value)) return null;
  return `config get ${key}: invalid host "${value}" — faff's merge floor is GitHub-only; legal set: ${GIT_HOST_ALLOWLIST.join(" | ")} (or leave it unset)`;
}

// FAFF-1044: `tracking.label_prefix` becomes part of every control-label's rendered
// tracker name, so it is constrained to a conservative charset — non-empty, no
// whitespace, no leading/trailing separator — and fails LOUD (never a silent
// half-valid label), mirroring validateGitHostValue's exact shape/chain-sites.
const LABEL_PREFIX_RE = /^[A-Za-z0-9]([A-Za-z0-9_-]*[A-Za-z0-9])?$/;
function validateLabelPrefix(key, value) {
  if (key !== "tracking.label_prefix") return null;
  if (LABEL_PREFIX_RE.test(value)) return null;
  return `config get ${key}: invalid label prefix "${value}" — must be non-empty, no whitespace, and match ${LABEL_PREFIX_RE} (or leave it unset)`;
}

// FAFF-1044: the single resolver every control-label read-site's command layer calls
// (labels.js's cmdLabels, label.js's cmdLabel, eligible.js's cmdEligible, next.js's
// cmdNext, intake-provenance.js's cmdIntakecheck) — never a hand-rolled `dig` + default
// per site. Returns { prefix } on a valid (or unset→default) value, or { error } on a
// malformed configured value (the caller surfaces it and exits 2, same as `config get`).
function resolveLabelPrefix(root, data) {
  const cfg = data || loadConfig(root)[0];
  const raw = dig(cfg, "tracking.label_prefix");
  const value = raw === null || raw === undefined ? DEFAULTS["tracking.label_prefix"] : fmt(raw);
  const err = validateLabelPrefix("tracking.label_prefix", value);
  if (err) return { error: err };
  return { prefix: value };
}

// FAFF-1091: a per-role control-label full name (`tracking.control_labels.<role>`) may look
// native to the tracker — `someprefix-some-value` or `Some group: name may contain-hyphens`
// (spaces, colons, hyphens, underscores, digits, mixed case all allowed). This is a single
// PERMISSIVE validator (operator decision 2026-09-24), deliberately NOT LABEL_PREFIX_RE (which
// forbids spaces/colons and would reject `State: Parked`, the exact grouped form the feature
// exists to allow). It rejects only the genuinely corrupting values — empty/whitespace-only and
// control characters / newlines (which could corrupt tracker state) — and fails LOUD at both read
// and write, never a silent fallback to `<prefix>-<role>`. Keyed on the dotted leaf shape and
// returns null for any other key, so it composes into the get/set chains exactly like
// validateLabelPrefix.
const CONTROL_LABEL_NAME_KEY_RE = /^tracking\.control_labels\.[^.]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;
function validateControlLabelName(key, value) {
  if (!CONTROL_LABEL_NAME_KEY_RE.test(key)) return null; // not this validator's key
  if (value === null || value === undefined || value.trim() === "") {
    return `config get ${key}: control-label name must be a non-empty string (spaces/colons/hyphens allowed, but not empty/whitespace-only)`;
  }
  if (CONTROL_CHAR_RE.test(value)) {
    return `config get ${key}: control-label name contains an illegal control character or newline`;
  }
  return null;
}

// FAFF-1091: the single per-role override resolver (a sibling of resolveLabelPrefix) every
// control-label command layer calls alongside it. Returns { names } (a `role -> full name` map,
// only overridden roles present; {} when unset) on a valid config, or { error } on a non-map
// value or a leaf that fails the permissive validator (the caller surfaces it and exits 2, same
// as a malformed prefix). Keeps resolveLabelPrefix's single-responsibility { prefix } | { error }
// contract untouched so a command layer that only needs the prefix stays unchanged.
function resolveControlLabels(root, data) {
  const cfg = data || loadConfig(root)[0];
  const raw = dig(cfg, "tracking.control_labels");
  if (raw === null || raw === undefined) return { names: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "config get tracking.control_labels: must be a map of role -> name (a nested map of scalars)" };
  }
  const names = {};
  for (const role of Object.keys(raw)) {
    const leaf = raw[role];
    // Per-leaf scalar-ness: the contract is a map of SCALARS. A nested map / sequence leaf would
    // fmt() to a bogus name ("[object Object]" / "a,b") that slips past the charset validator, so
    // reject it loud here rather than rendering a corrupt label name (fail-loud, never half-valid).
    if (leaf !== null && typeof leaf === "object") {
      return { error: `config get tracking.control_labels.${role}: control-label name must be a scalar, not a ${Array.isArray(leaf) ? "sequence" : "map"}` };
    }
    const value = fmt(leaf);
    const err = validateControlLabelName(`tracking.control_labels.${role}`, value);
    if (err) return { error: err };
    names[role] = value;
  }
  return { names };
}

// FAFF-1080: resolve the tracking team dimension into the ONE shape every consumer reads —
// a team-set (`tracking.teams` + `tracking.default_team` + optional `tracking.team_routing`),
// the legacy single `tracking.team_key` shimmed to a one-element set, or the zero-config empty
// set. Pure over the merged config document (no fs, no defaults registry — a per-repo team has
// no universal default, matching team_key). Precedence: an explicit non-empty `teams` array wins
// over legacy `team_key`; `team_key` in turn wins over zero-config. A `teams` array is trusted
// as given (validateTeams below is the cross-field fail-loud check `faff config check` runs —
// resolveTeams itself never rejects a malformed set, it just returns what's there).
function resolveTeams(data) {
  const teams = dig(data, "tracking.teams");
  if (Array.isArray(teams) && teams.length > 0) {
    const rawDefault = dig(data, "tracking.default_team");
    const default_team = rawDefault === null || rawDefault === undefined ? null : rawDefault;
    const rawRouting = dig(data, "tracking.team_routing");
    const routing = (rawRouting && typeof rawRouting === "object" && !Array.isArray(rawRouting)) ? rawRouting : {};
    return { teams, default_team, routing };
  }
  const teamKey = dig(data, "tracking.team_key");
  if (typeof teamKey === "string" && teamKey.trim() !== "") {
    const tk = teamKey.trim();
    return { teams: [tk], default_team: tk, routing: {} };   // legacy shim
  }
  return { teams: [], default_team: null, routing: {} };     // zero-config
}

// FAFF-1080: cross-field validation for the team-set schema, invoked by `faff config check`
// over the MERGED document (same posture as the git_host check below) — never by resolveTeams
// itself, which stays a pure passthrough. Returns `config check` finding objects naming the
// offending key/value and the member set; never silently drops a dangling reference.
function validateTeams(mergedDoc) {
  const findings = [];
  const teams = dig(mergedDoc, "tracking.teams");
  const defaultTeam = dig(mergedDoc, "tracking.default_team");
  const routing = dig(mergedDoc, "tracking.team_routing");
  const teamKey = dig(mergedDoc, "tracking.team_key");
  const teamsPresent = teams !== null && teams !== undefined;
  if (teamsPresent) {
    if (!Array.isArray(teams) || teams.length === 0) {
      findings.push({ severity: "error", surface: "tracking.teams", message: "tracking.teams is empty (or not a list) — must be a non-empty block-sequence of team keys." });
      return findings; // nothing else to cross-check against an empty/malformed set
    }
    if (defaultTeam === null || defaultTeam === undefined) {
      findings.push({ severity: "error", surface: "tracking.default_team", message: "tracking.default_team is required when tracking.teams is set." });
    } else if (!teams.includes(defaultTeam)) {
      findings.push({ severity: "error", surface: "tracking.default_team", message: `tracking.default_team "${defaultTeam}" is not a member of tracking.teams [${teams.join(", ")}].` });
    }
    const routingPresent = routing !== null && routing !== undefined;
    const routingIsMap = routingPresent && typeof routing === "object" && !Array.isArray(routing);
    if (routingPresent && !routingIsMap) {
      // Adversarial review finding: a scalar/array team_routing silently skipped the loop below
      // and passed `config check` clean, despite the schema declaring a map. Fail loud instead —
      // every other malformed-shape case in this validator (empty teams, above) does the same.
      findings.push({ severity: "error", surface: "tracking.team_routing", message: "tracking.team_routing is not a map — must be a nested map of type-token -> team-key (e.g. `spike: IDEAS`)." });
    } else if (routingIsMap) {
      for (const k of Object.keys(routing)) {
        const v = routing[k];
        if (!teams.includes(v)) {
          findings.push({ severity: "error", surface: `tracking.team_routing['${k}']`, message: `tracking.team_routing['${k}'] -> "${v}" is not a member of tracking.teams [${teams.join(", ")}].` });
        }
      }
    }
  } else if (defaultTeam !== null && defaultTeam !== undefined && (teamKey === null || teamKey === undefined)) {
    findings.push({ severity: "error", surface: "tracking.default_team", message: "tracking.default_team is set without tracking.teams." });
  }
  return findings;
}

// FAFF-859: closed value vocabulary for the two lane-isolation DECLARED-field axes. The two axes
// are ORTHOGONAL (container = containment, host = locality); each is its own closed-vocab scalar,
// keyed on the full dotted path — the models.<lane> / effort.<lane> shape, not a co-constrained
// record. A configured off-vocabulary value fails LOUD at read (config get exit 2) AND at write
// (config set exit 2), naming the value + legal set — never a silent fallback (the FAFF-315
// models/effort discipline). Chained into the same validator chain (config get ~2019, config set
// ~1008) validateDispatchKey runs through.
const ISOLATION_LANE_VOCAB = {
  "lanes.evaluator.isolation.container": ["shared", "own"],
  "lanes.evaluator.isolation.host": ["local", "remote"],
  // FAFF-894: the build lane shares the same two-axis vocab — an off-vocabulary build-lane
  // isolation value fails LOUD (config get/set exit 2) exactly as the evaluator lane's does.
  "lanes.build.isolation.container": ["shared", "own"],
  "lanes.build.isolation.host": ["local", "remote"],
};
function validateIsolationLane(key, value) {
  const vocab = ISOLATION_LANE_VOCAB[key];
  if (!vocab) return null; // not this validator's key
  if (vocab.includes(value)) return null;
  return `config get ${key}: "${value}" not legal — legal set: ${vocab.join(" | ")} (fail-loud, no silent fallback)`;
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

// FAFF-624: convergence is level-forced, mirroring resolveAppetite's shape (FAFF-308) — the
// read chokepoint behind `faff config get convergence.enabled`. Under a live L4 lights-out run
// convergence resolves to "true" unconditionally and config `convergence.enabled` is ignored;
// config stays authoritative for L1–L3. This is the brace half of the FAFF-624 guarantee — the
// mint-time stamp (lights-out.js's dial_profile.convergence: "forced") is the other half. The
// value is INERT at L4 by design (FAFF-534's named anti-pattern): this function never refuses,
// never warns — it only forces the answer for any occupant that consults the knob.
// Precedence: LIVE-L4 ledger (FAFF_RUN_DIR, level:"L4" AND runIsHeld) > config
// `convergence.enabled` > baked default. Deliberately NO env-var channel (unlike appetite's
// FAFF_APPETITE belt) — see the FAFF-624 spec's Decision B: an env override here could only add
// a way to disable forcing, the exact door this guarantee closes.
function resolveConvergence(cfg, env = process.env) {
  const runDir = env.FAFF_RUN_DIR;
  if (runDir) {
    try {
      const ledger = readLedger(runDir);
      if (ledger) overlayHeartbeat(ledger, readHeartbeatFile(runDir));
      if (ledger && ledger.level === "L4" && runIsHeld(ledger, Date.now(), env)) return "true";
    }
    catch { /* unreadable / absent ledger → fall through (never fabricate `true`) */ }
  }
  const v = dig(cfg, "convergence.enabled");
  return (v === null || v === undefined) ? DEFAULTS["convergence.enabled"] : fmt(v);
}

// FAFF-1061: the SINGLE interactive-verification resolver — "which high-assurance verification legs
// run at this ATTENDED session?" It mirrors FAFF-717's read half (declaredUnattendedFromConfig +
// literalTrue) but carries NO acting disjunct: an opted-in leg computes and SURFACES the floor, it
// never auto-merges, auto-parks, or refuses. It is consulted at all three call sites (the holdout
// gate, the spec-review lens-pin, the adversarial code-review) via `faff verification resolve`, so
// the three surfaces cannot drift independently.
//   1. UNATTENDED run (per verificationUnattended below) → all-false: the unattended path
//      runs/gates its OWN floor (the merge-gate auto-merge interlock, the L4 mandatory refuse) —
//      never this resolver.
//   2. no ledger / no attended run → all-false: an attended posture needs a minted run to attach to.
//   3. otherwise (an attended, non-unattended ledger) → per-leg literalTrue(verification.<leg>), fail-closed.
// Reads config only; never sets/escalates level, never flips autonomous/lights_out.
//
// FAFF-1133: the verification-axis attendedness resolver. An L4 mint is always unattended and
// short-circuits BEFORE any config read (lazy OR). Below L4, ONLY an automated L3 run consults
// declared-unattended config — an interactive L1/L2 run (and a no-ledger call) is attended by
// construction, so the config-declared-unattended signal (autonomous.unattended, or its retained
// sentry_acting alias) is never read there. This mirrors merge-gate.js's resolveIntegrity
// (`level === "L4" || (level === "L3" && declaredUnattendedFromConfig(cfg))`) so the verification
// axis and the merge floor compute attendedness the same way. The abort axis (actsOnSentryAbort,
// which keeps reading declaredUnattendedFromConfig at every level) is untouched.
function verificationUnattended(ledger, cfg) {
  return (
    (!!ledger && ledger.level === "L4") ||
    (!!ledger && ledger.level === "L3" && declaredUnattendedFromConfig(cfg))
  );
}
function resolveInteractiveVerification(ledger, cfg) {
  const allFalse = { holdout: false, spec_review: false, code_review: false };
  if (verificationUnattended(ledger, cfg)) return { ...allFalse };
  if (!ledger) return { ...allFalse };
  return {
    holdout: literalTrue(dig(cfg, "verification.holdout")),
    spec_review: literalTrue(dig(cfg, "verification.spec_review")),
    code_review: literalTrue(dig(cfg, "verification.code_review")),
  };
}

const VERIFICATION_SPEC = {
  flags: {
    "--json": { arity: 0 }, "--selftest": { arity: 0 }, "--root": { arity: 1 },
    "--holdout": { arity: 0 }, "--spec-review": { arity: 0 }, "--code-review": { arity: 0 },
  },
  positionals: { min: 0, max: 1, name: "subcommand" },
};

// FAFF-1061: the mechanical consult surface for the SKILL.md call sites (faff-graft's holdout gate,
// spec-review lens-pin, and adversarial code-review). Prose never hand-reads .faffrc (CLI-only config
// access), so it shells `faff verification resolve --json` and branches on the per-leg booleans.
// The standing posture comes from the `verification.*` config leaves; the per-invocation opt-in
// (graft's --verify / --verify-<leg>) is the optional `--holdout` / `--spec-review` / `--code-review`
// flags, OR-ed over the config posture — but ONLY on an attended run, so a flag can never confer
// verification on an unattended run (the acting axis stays unchanged).
function cmdVerification(args) {
  if (args.includes("--selftest")) return verificationSelftest();
  const { values, positionals, errors } = parseArgs(args, VERIFICATION_SPEC);
  const usage = "usage: faff verification resolve [--json] [--holdout] [--spec-review] [--code-review]";
  if (errors.length) return usageError(errors, usage);
  const sub = positionals[0] || "resolve";
  if (sub !== "resolve") return usageError([`unknown subcommand '${sub}'`], usage);

  const root = values["--root"] || findRoot();
  const [cfg] = loadConfig(root);
  const runDir = process.env.FAFF_RUN_DIR;
  let ledger = null;
  if (runDir) { try { ledger = readLedger(runDir); } catch { ledger = null; } }

  const unattended = verificationUnattended(ledger, cfg);
  const attended = !!ledger && !unattended;
  const base = resolveInteractiveVerification(ledger, cfg);
  const legs = {
    holdout: base.holdout || (attended && !!values["--holdout"]),
    spec_review: base.spec_review || (attended && !!values["--spec-review"]),
    code_review: base.code_review || (attended && !!values["--code-review"]),
  };
  const out = {
    attended,
    unattended,
    level: ledger ? (ledger.level || null) : null,
    legs,
    any: legs.holdout || legs.spec_review || legs.code_review,
  };
  if (values["--json"]) { console.log(JSON.stringify(out)); return 0; }
  if (unattended) {
    console.log("verification: unattended run — interactive verification legs do not apply (the unattended floor runs its own gate)");
    return 0;
  }
  if (!attended) {
    console.log("verification: no attended run (no ledger) — interactive verification legs off");
    return 0;
  }
  const on = Object.entries(legs).filter(([, v]) => v).map(([k]) => k);
  console.log(`verification (attended ${out.level || "?"}): ${on.length ? on.join(", ") + " ON (advisory — computes + surfaces the floor, never acts)" : "all legs off"}`);
  return 0;
}

function verificationSelftest() {
  let failed = 0;
  const check = (label, got, want) => {
    if (got !== want) { process.stderr.write(`verification --selftest FAIL: ${label} (want ${want}, got ${got})\n`); failed++; }
  };
  const L2 = { level: "L2" }, L3 = { level: "L3" }, L4 = { level: "L4" };
  // Config fixtures are NESTED maps (what dig traverses + what parseYamlSubset produces).
  const allOn = { verification: { holdout: "true", spec_review: "true", code_review: "true" } };

  // Attended L2, all legs opted in → all three true.
  let r = resolveInteractiveVerification(L2, allOn);
  check("attended L2 all-on → holdout", r.holdout, true);
  check("attended L2 all-on → spec_review", r.spec_review, true);
  check("attended L2 all-on → code_review", r.code_review, true);

  // Attended L3 (standing posture) is level-independent within attended.
  r = resolveInteractiveVerification(L3, { verification: { holdout: "true" } });
  check("attended L3 holdout-only → holdout", r.holdout, true);
  check("attended L3 holdout-only → spec_review off", r.spec_review, false);

  // Typo / non-boolean resolves false (fail-closed literalTrue).
  r = resolveInteractiveVerification(L2, { verification: { holdout: "yes", spec_review: "1", code_review: "TRUE" } });
  check("typo 'yes' → false", r.holdout, false);
  check("'1' → false", r.spec_review, false);
  check("case-insensitive 'TRUE' → true", r.code_review, true);

  // Unattended: an L4 ledger short-circuits to all-false regardless of config.
  r = resolveInteractiveVerification(L4, allOn);
  check("L4 ledger → holdout all-false", r.holdout, false);
  check("L4 ledger → spec_review all-false", r.spec_review, false);
  check("L4 ledger → code_review all-false", r.code_review, false);

  // FAFF-1133: declared-unattended config (FAFF-717 axis) short-circuits to all-false at L3 (an
  // automated run) — the level where the config posture applies.
  r = resolveInteractiveVerification(L3, { verification: allOn.verification, autonomous: { unattended: "true" } });
  check("L3 declared-unattended → all-false (holdout)", r.holdout, false);
  check("L3 declared-unattended → all-false (code_review)", r.code_review, false);
  // The retained FAFF-717 alias (autonomous.sentry_acting) also short-circuits at L3.
  r = resolveInteractiveVerification(L3, { verification: allOn.verification, autonomous: { sentry_acting: "true" } });
  check("L3 sentry_acting alias → all-false", r.holdout || r.spec_review || r.code_review, false);
  // FAFF-1133: at L1/L2 (interactive, attended by construction) the declared-unattended config is
  // NOT read — both config keys leave an interactive run attended, so the opted-in legs resolve.
  r = resolveInteractiveVerification(L2, { verification: allOn.verification, autonomous: { unattended: "true" } });
  check("L2 + declared-unattended → attended, holdout on", r.holdout, true);
  r = resolveInteractiveVerification(L2, { verification: allOn.verification, autonomous: { sentry_acting: "true" } });
  check("L2 + sentry_acting alias → attended, holdout on", r.holdout, true);

  // No ledger → all-false (no attended run to attach the posture to).
  r = resolveInteractiveVerification(null, allOn);
  check("no ledger → holdout false", r.holdout, false);
  check("no ledger → code_review false", r.code_review, false);

  // Absent leaves → false (default fail-closed).
  r = resolveInteractiveVerification(L2, {});
  check("absent leaves → holdout false", r.holdout, false);
  check("absent leaves → spec_review false", r.spec_review, false);
  check("absent leaves → code_review false", r.code_review, false);

  if (failed) return 1;
  console.log("verification --selftest: ok");
  return 0;
}


module.exports = { cmdVerification, GIT_HOST_ALLOWLIST, ISOLATION_LANE_VOCAB, resolveAppetite, resolveControlLabels, resolveConvergence, resolveInteractiveVerification, resolveLabelPrefix, resolveTeams, VALID_APPETITES, validateControlLabelName, validateGitHostValue, validateIsolationLane, validateLabelPrefix, validateTeams };
