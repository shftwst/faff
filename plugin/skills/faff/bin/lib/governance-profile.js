// ===========================================================================
// === region:governance — profiles — FAFF-362: profile vocabulary tables (delivery profile = faff's dialect) ===
//
// Rung 3 of the governance extraction (design/governance-extraction-layers.md):
// the three governance engines (runcheck / events / sentry) are already generic
// MACHINERY — a completeness check, an envelope validator, a set of derailment
// predicates. What ties them to faff is not structure but the CLOSED WORD-LISTS
// they compare against (terminal states, event types, sentry trigger/outcome
// strings). This module single-sources every one of those word-lists into ONE
// `DELIVERY_PROFILE` constant the three engines read via a threaded, DEFAULTED
// `profile` parameter — never three separate lists, never a literal reappearing
// inside a predicate body.
//
// Byte-identical invariant: DELIVERY_PROFILE *is* today's exact vocabulary. Every
// existing runcheck/events/sentry selftest + external test file passes UNCHANGED
// when no override is set (the default path). A `SECOND_PROFILE` synthetic
// fixture (disjoint vocabulary, test-only) proves the engines actually READ the
// profile rather than staying hardcoded — see `profilesSelftest` below.
//
// Profiles are pure closed-vocab DATA — the design-doc guard: a leaf is a string,
// a finite number, an array of strings, or a flat object of those; no functions,
// no regexes, no conditional/nested-policy shape. `validateProfileShape` is the
// mechanical enforcement of that guard, checked against the ONE declared Profile
// record shape below (not a fully generic recursive JSON-shape check — the
// profile has one fixed schema, and anything deeper/other than it is refused).
//
// Override + no-silent-fallback: `activeProfile(env)` resolves `$FAFF_GOVERNANCE_
// PROFILE` (unset -> DELIVERY_PROFILE) and THROWS a `GovernanceProfileError` on a
// missing/malformed/shape-invalid override file — never a silent revert to
// delivery. bin/faff's main() dispatch catches that one error type and converts
// it to a loud stderr line + exit 2, uniformly for every governance command (see
// the try/catch around `handler(rest)` in bin/faff) — a misconfigured dialect
// must never masquerade as faff's.
// ===========================================================================

const fs = require("node:fs");
const { RUN_HEARTBEAT_STALE_SECS_DEFAULT } = require("./shared-infra");

// The delivery profile (profile #1) — today's exact literals, byte-for-byte.
// terminal_states (6, runcheck's outcome vocabulary) and ledger_outcomes (7,
// events' — adds "claimed-by-peer") are DELIBERATELY two distinct keys, not one
// unified list: unifying them would change what runcheck or events accepts,
// which is a behaviour change masquerading as cleanup (see the spec's design
// decision). issue_scoped_types / outcome_required_types are membership LISTS
// (data), replacing what used to be inline `type === "issue-outcome"`-shaped
// conditionals in events.js — the closed-vocab guard in data form.
//
// NOTE: EFFORT_LEVELS and QUALITY_GATE_CATCHES (events.js) are separate, later
// vocabularies (FAFF-415/418 reasoning-effort + quality-gate tags) — not part of
// the "terminal states / event types / sentry thresholds" this ticket rehomes,
// so they deliberately stay put, mirroring the ticket's budget/economics
// out-of-scope carve.
const DELIVERY_PROFILE = {
  terminal_states: ["shipped", "pr-open", "parked", "errored", "routed-out", "unreached-budget"],
  event_phases: ["run", "tidy", "prep", "build"],
  event_types: [
    "run-start", "run-end", "tidy-done", "issue-admitted", "prep-start", "prep-done",
    "build-start", "issue-outcome", "discovered-scope-filed", "budget-checkpoint", "park",
    "sentry-checkpoint",
    "corrective-authored", "corrective-consumed",
    "containment-check",
  ],
  issue_scoped_types: [
    "issue-admitted", "prep-start", "prep-done", "build-start", "issue-outcome", "park",
    "corrective-authored", "corrective-consumed", "containment-check",
  ],
  outcome_required_types: ["issue-outcome"],
  ledger_outcomes: ["shipped", "pr-open", "parked", "errored", "routed-out", "unreached-budget", "claimed-by-peer"],
  sentry: {
    // stall_window_secs REFERENCES runcheck's RUN_HEARTBEAT_STALE_SECS_DEFAULT
    // (now sourced from shared-infra to break the require cycle) rather than
    // restating 900 — one source for the number, byte-identical.
    thresholds: {
      thrash_n: 3,
      failure_k: 3,
      stall_window_secs: RUN_HEARTBEAT_STALE_SECS_DEFAULT,
      run_elapsed_ceiling_secs: 14400,
    },
    thrash: { start_type: "build-start", ship_type: "issue-outcome", ship_outcome: "shipped" },
    failure: { park_type: "park", outcome_type: "issue-outcome", errored_outcome: "errored" },
  },
};

// A synthetic, TEST-ONLY second profile with vocabulary DISJOINT from delivery's
// — the dialect-independence proof. A delivery fixture (type "build-start",
// outcome "shipped") must be REJECTED under this profile; this profile's own
// fixtures must be ACCEPTED; sentry's thrash predicate must trip at ITS thrash_n
// (5), not delivery's (3). See profilesSelftest / test/profiles.test.mjs.
const SECOND_PROFILE = {
  terminal_states: ["done", "open", "dropped"],
  event_phases: ["job"],
  event_types: ["job-start", "job-end", "job-outcome"],
  issue_scoped_types: ["job-start", "job-end", "job-outcome"],
  outcome_required_types: ["job-outcome"],
  ledger_outcomes: ["done", "open", "dropped", "aborted"],
  sentry: {
    thresholds: { thrash_n: 5, failure_k: 5, stall_window_secs: 600, run_elapsed_ceiling_secs: 7200 },
    thrash: { start_type: "job-start", ship_type: "job-outcome", ship_outcome: "done" },
    failure: { park_type: "job-outcome", outcome_type: "job-outcome", errored_outcome: "aborted" },
  },
};

function isFiniteNum(v) { return typeof v === "number" && Number.isFinite(v); }
function isArrOfStrings(v) { return Array.isArray(v) && v.every((x) => typeof x === "string"); }

// The one declared Profile record shape (§3 of the spec) — a FIXED schema, not a
// generic recursive JSON-shape check. Each field has a known expected primitive
// position; anything else there (an object where a number/string was wanted, an
// array containing non-strings, an unknown key) is the conditional/nested-policy
// smell the design-doc guard refuses. Returns an array of violation strings
// naming the offending leaf path (empty ⇒ shape-valid).
const PROFILE_TOP_ARRAY_KEYS = [
  "terminal_states", "event_phases", "event_types",
  "issue_scoped_types", "outcome_required_types", "ledger_outcomes",
];
const PROFILE_SENTRY_THRESHOLD_KEYS = ["thrash_n", "failure_k", "stall_window_secs", "run_elapsed_ceiling_secs"];
const PROFILE_SENTRY_THRASH_KEYS = ["start_type", "ship_type", "ship_outcome"];
const PROFILE_SENTRY_FAILURE_KEYS = ["park_type", "outcome_type", "errored_outcome"];

function validateProfileShape(p) {
  if (p === null || typeof p !== "object" || Array.isArray(p)) return ["profile must be a JSON object"];
  const v = [];
  const allowedTop = new Set([...PROFILE_TOP_ARRAY_KEYS, "sentry"]);
  for (const k of Object.keys(p)) {
    if (!allowedTop.has(k)) v.push(`unknown top-level key '${k}' (closed vocabulary — not a declared profile field)`);
  }
  for (const k of PROFILE_TOP_ARRAY_KEYS) {
    if (!(k in p)) { v.push(`missing required key: ${k}`); continue; }
    if (!isArrOfStrings(p[k])) v.push(`${k}: must be an array of strings`);
  }
  if (!("sentry" in p)) { v.push("missing required key: sentry"); return v; }
  const s = p.sentry;
  if (s === null || typeof s !== "object" || Array.isArray(s)) { v.push("sentry: must be a flat object"); return v; }
  const allowedSentry = new Set(["thresholds", "thrash", "failure"]);
  for (const k of Object.keys(s)) if (!allowedSentry.has(k)) v.push(`unknown key: sentry.${k}`);

  const thresholds = s.thresholds;
  if (!("thresholds" in s)) v.push("missing required key: sentry.thresholds");
  else if (thresholds === null || typeof thresholds !== "object" || Array.isArray(thresholds)) v.push("sentry.thresholds: must be a flat object");
  else {
    for (const k of Object.keys(thresholds)) if (!PROFILE_SENTRY_THRESHOLD_KEYS.includes(k)) v.push(`unknown key: sentry.thresholds.${k}`);
    for (const k of PROFILE_SENTRY_THRESHOLD_KEYS) {
      if (!(k in thresholds)) v.push(`missing required key: sentry.thresholds.${k}`);
      else if (!isFiniteNum(thresholds[k])) v.push(`sentry.thresholds.${k}: must be a finite number`);
    }
  }

  const thrash = s.thrash;
  if (!("thrash" in s)) v.push("missing required key: sentry.thrash");
  else if (thrash === null || typeof thrash !== "object" || Array.isArray(thrash)) v.push("sentry.thrash: must be a flat object");
  else {
    for (const k of Object.keys(thrash)) if (!PROFILE_SENTRY_THRASH_KEYS.includes(k)) v.push(`unknown key: sentry.thrash.${k}`);
    for (const k of PROFILE_SENTRY_THRASH_KEYS) {
      if (!(k in thrash)) v.push(`missing required key: sentry.thrash.${k}`);
      else if (typeof thrash[k] !== "string") v.push(`sentry.thrash.${k}: must be a string`);
    }
  }

  const failure = s.failure;
  if (!("failure" in s)) v.push("missing required key: sentry.failure");
  else if (failure === null || typeof failure !== "object" || Array.isArray(failure)) v.push("sentry.failure: must be a flat object");
  else {
    for (const k of Object.keys(failure)) if (!PROFILE_SENTRY_FAILURE_KEYS.includes(k)) v.push(`unknown key: sentry.failure.${k}`);
    for (const k of PROFILE_SENTRY_FAILURE_KEYS) {
      if (!(k in failure)) v.push(`missing required key: sentry.failure.${k}`);
      else if (typeof failure[k] !== "string") v.push(`sentry.failure.${k}: must be a string`);
    }
  }
  return v;
}

// The one marker bin/faff's main() dispatch recognises to convert a bad-override
// resolution into a loud, uniform exit 2 — never a silent fallback to delivery,
// and never a bare process.exit() call buried inside a pure function (which would
// abort the WHOLE process mid in-memory --selftest run). See bin/faff's
// try/catch around `handler(rest)`.
class GovernanceProfileError extends Error {
  constructor(message) {
    super(message);
    this.name = "GovernanceProfileError";
    this.faffGovernanceProfileError = true;
  }
}

// Resolve the active profile for THIS process invocation. Unset/empty override
// -> DELIVERY_PROFILE (the byte-identical default). A set override is read +
// JSON-parsed + shape-validated; any failure THROWS (caught at the CLI dispatch
// boundary, never swallowed here) — no silent revert to delivery on a bad
// override. Deliberately NOT memoized: env is a parameter (tests drive it with
// synthetic envs in the same process), so caching across calls would leak state
// between test cases — the extra file-read cost is negligible next to a
// governance CLI invocation's own I/O.
function activeProfile(env = process.env) {
  const override = env.FAFF_GOVERNANCE_PROFILE;
  if (!override) return DELIVERY_PROFILE;
  let raw;
  try {
    raw = fs.readFileSync(override, "utf8");
  } catch (e) {
    throw new GovernanceProfileError(`$FAFF_GOVERNANCE_PROFILE override '${override}' is unreadable: ${e.message}`);
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    throw new GovernanceProfileError(`$FAFF_GOVERNANCE_PROFILE override '${override}' is not valid JSON: ${e.message}`);
  }
  const violations = validateProfileShape(obj);
  if (violations.length) {
    throw new GovernanceProfileError(
      `$FAFF_GOVERNANCE_PROFILE override '${override}' failed shape validation:\n` +
      violations.map((x) => `  - ${x}`).join("\n"));
  }
  return obj;
}

function cmdProfiles(args) {
  if (args.includes("--selftest")) return profilesSelftest();
  const sub = args.find((a) => !a.startsWith("-"));
  const asJson = args.includes("--json");

  if (sub === "list") {
    const profile = activeProfile(); // may throw GovernanceProfileError -> caught by main()
    console.log(asJson ? JSON.stringify(profile) : JSON.stringify(profile, null, 2));
    return 0;
  }

  if (sub === "validate") {
    const fi = args.indexOf("--file");
    let obj;
    if (fi !== -1) {
      let raw;
      try { raw = fs.readFileSync(args[fi + 1], "utf8"); }
      catch (e) { process.stderr.write(`faff profiles validate: cannot read --file: ${e.message}\n`); return 2; }
      try { obj = JSON.parse(raw); }
      catch { process.stderr.write("faff profiles validate: malformed profile input (invalid JSON)\n"); return 2; }
    } else {
      obj = activeProfile(); // no --file -> validate the active profile; a bad override throws (exit 2 at main())
    }
    const violations = validateProfileShape(obj);
    if (violations.length) {
      for (const x of violations) process.stderr.write(`- ${x}\n`);
      return 1;
    }
    console.log("OK — governance profile valid (shape-conformant).");
    return 0;
  }

  process.stderr.write("faff profiles: expected one of list | validate [--file F] (or --selftest)\n");
  return 2;
}

// In-memory selftest: the shape validator, PLUS the dialect-independence
// behavioural proof — each engine's pure core driven directly under both
// DELIVERY_PROFILE and SECOND_PROFILE (mirrors the profile/events/sentry
// --selftest style). runcheck/events/sentry are required LAZILY (inside this
// function, not at module top-level) — they require THIS module for
// activeProfile/DELIVERY_PROFILE, so a top-level require here would recreate the
// exact require cycle the shared-infra move was designed to avoid; a lazy,
// call-time require is safe because by the time any CLI command runs, the whole
// module graph is already fully loaded (the same pattern heartbeat.js already
// uses for runIsHeld).
function profilesSelftest() {
  let failed = 0;
  const ok = (name, cond) => { if (!cond) { failed++; console.log(`FAIL ${name}`); } else console.log(`ok   ${name}`); };

  ok("DELIVERY_PROFILE is shape-valid", validateProfileShape(DELIVERY_PROFILE).length === 0);
  ok("SECOND_PROFILE is shape-valid", validateProfileShape(SECOND_PROFILE).length === 0);
  ok("object-of-objects at a scalar leaf is rejected, naming the leaf", (() => {
    const bad = JSON.parse(JSON.stringify(DELIVERY_PROFILE));
    bad.sentry.thresholds.thrash_n = { nested: "policy" };
    const v = validateProfileShape(bad);
    return v.length > 0 && v.some((x) => x.includes("sentry.thresholds.thrash_n"));
  })());
  ok("unknown top-level key rejected (closed vocabulary)",
    validateProfileShape({ ...DELIVERY_PROFILE, extra_policy: {} }).some((x) => x.includes("extra_policy")));
  ok("array-of-non-strings rejected", (() => {
    const bad = JSON.parse(JSON.stringify(DELIVERY_PROFILE));
    bad.terminal_states = [{ not: "a string" }];
    return validateProfileShape(bad).some((x) => x.includes("terminal_states"));
  })());

  const { auditLedger } = require("./runcheck");
  const { eventViolations } = require("./events");
  const { evalThrash } = require("./sentry");

  // runcheck — a delivery outcome is accepted under delivery, rejected under
  // SECOND_PROFILE (disjoint vocab), and SECOND_PROFILE's own state is accepted.
  ok("runcheck: 'shipped' valid under DELIVERY_PROFILE",
    auditLedger({ admitted: ["X"], outcomes: { X: "shipped" } }, "r", DELIVERY_PROFILE).invalid_outcomes.length === 0);
  ok("runcheck: 'shipped' REJECTED under SECOND_PROFILE (dialect-independence proof)",
    auditLedger({ admitted: ["X"], outcomes: { X: "shipped" } }, "r", SECOND_PROFILE).invalid_outcomes.length === 1);
  ok("runcheck: SECOND_PROFILE's own terminal state ('done') accepted under SECOND_PROFILE",
    auditLedger({ admitted: ["X"], outcomes: { X: "done" } }, "r", SECOND_PROFILE).invalid_outcomes.length === 0);

  // events — a delivery type is accepted under delivery, rejected under
  // SECOND_PROFILE, and SECOND_PROFILE's own type is accepted under SECOND_PROFILE.
  ok("events: delivery 'build-start' valid under DELIVERY_PROFILE",
    eventViolations({ phase: "build", type: "build-start", issue: "X" }, false, DELIVERY_PROFILE).length === 0);
  ok("events: delivery 'build-start' REJECTED under SECOND_PROFILE (dialect-independence proof)",
    eventViolations({ phase: "build", type: "build-start", issue: "X" }, false, SECOND_PROFILE).length > 0);
  ok("events: SECOND_PROFILE's own type accepted under SECOND_PROFILE",
    eventViolations({ phase: "job", type: "job-start", issue: "X" }, false, SECOND_PROFILE).length === 0);

  // sentry — thrash trips at SECOND_PROFILE's OWN thrash_n (5), not delivery's (3).
  const secondTh = SECOND_PROFILE.sentry.thresholds;
  const startType = SECOND_PROFILE.sentry.thrash.start_type;
  const below = Array.from({ length: secondTh.thrash_n - 1 }, (_, i) => ({ type: startType, issue: "A", seq: i }));
  const atN = Array.from({ length: secondTh.thrash_n }, (_, i) => ({ type: startType, issue: "A", seq: i }));
  ok(`sentry: ${secondTh.thrash_n - 1} starts under SECOND_PROFILE's thrash_n (${secondTh.thrash_n}) → no trip`,
    evalThrash(below, secondTh, SECOND_PROFILE) === null);
  ok(`sentry: thrash trips exactly at SECOND_PROFILE's thrash_n (${secondTh.thrash_n}), not delivery's 3`,
    (() => { const t = evalThrash(atN, secondTh, SECOND_PROFILE); return t && t.signal === "fix-review-thrash"; })());
  ok("sentry: delivery's own build-start type does not drive SECOND_PROFILE's thrash predicate",
    evalThrash(atN.map((e) => ({ ...e, type: "build-start" })), secondTh, SECOND_PROFILE) === null);

  console.log(`\nRESULT: ${failed ? "FAIL" : "PASS"} (profiles --selftest, ${failed} failed)`);
  return failed ? 1 : 0;
}


module.exports = {
  DELIVERY_PROFILE, GovernanceProfileError, PROFILE_SENTRY_FAILURE_KEYS, PROFILE_SENTRY_THRASH_KEYS,
  PROFILE_SENTRY_THRESHOLD_KEYS, PROFILE_TOP_ARRAY_KEYS, SECOND_PROFILE,
  activeProfile, cmdProfiles, isArrOfStrings, isFiniteNum, profilesSelftest, validateProfileShape,
};
