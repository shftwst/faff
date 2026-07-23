// ===========================================================================
// === region:factory — run-start — FAFF-496: the run-start trigger predicate. ===
// `faff run-start` is a PURE CLI (parity with `faff run-done` / `faff next` /
// `faff prdr coverage`): no tracker, no network, no disk beyond its args. It is
// the MIRROR of `faff run-done` — where run-done is the *terminating* predicate
// (fails toward `escalate`), run-start is the *starting* predicate (fails toward
// `refuse`). It COMPOSES faff's already-shipped run-start signals — target
// resolution, the ADR-0069 outward-only read (FAFF-521's `signals.outward`), the
// `prd` slot → `faff contract prd-readiness` admissibility verdict, and `faff prdr
// coverage`'s `.covered` — into the one decision that opens a /faff-beep-boop run:
// plan | drain | refuse. Reimplements NO signal; each named CLI stays the sole
// producer of its own signal, consumed here (in this spike) as passed-in booleans.
//
// The ladder is a FIXED refusal-biased floor (spec §4, first-failing-check-wins):
//   1. target empty                          -> refuse / no-target
//   2. inward (outward==false, ADR-0069)     -> refuse / self-directed   (BEFORE PRD checks)
//   3a. multiple Active/Frozen PRDs          -> refuse / prd-ambiguous
//   3b. no PRD present                       -> drain  / no-prd-nothing-to-plan
//   4. prd-readiness not admissible          -> refuse / prd-inadmissible   (fail-safe)
//   5a. coverage unmeasurable / malformed    -> refuse / coverage-unmeasurable (fail-safe)
//   5b. coverage.covered == false            -> plan   / coverage-thin
//   5c. coverage.covered == true             -> drain  / prd-covered
// Ordering is load-bearing: the outward floor (2) precedes PRD checks so inward+
// no-PRD is `self-directed` while outward+no-PRD is a benign `drain` (ADR-0069).
// ===========================================================================


const { schemaCheck } = require("./contract-engine");

const RUN_TRIGGER_VERDICTS = ["plan", "drain", "refuse"];
// The closed verdict x reason enum (spec §3b), bound 1:1 to the ladder rungs below.
const RUN_TRIGGER_REASONS = [
  "coverage-thin", "prd-covered", "no-prd-nothing-to-plan",
  "no-target", "self-directed", "prd-ambiguous", "prd-inadmissible", "coverage-unmeasurable",
];

// Coerce a raw signal bundle onto the closed RunTriggerSignals vocabulary. Every
// signal is STRICT-boolean (=== true); anything else (missing, null, string,
// non-object bundle) coerces to `false` — the refusal-biased default. This is the
// fail-safe: a malformed bundle degrades to all-false, which the ladder resolves to
// `refuse / no-target` (the most privileged output `plan` is thereby unreachable
// unless every affirmative signal is explicitly true). Never throws.
function normalizeRunTriggerSignals(raw) {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
  return {
    target_resolved: r.target_resolved === true,
    outward: r.outward === true,
    prd_present: r.prd_present === true,
    prd_ambiguous: r.prd_ambiguous === true,
    prd_admissible: r.prd_admissible === true,
    coverage_measurable: r.coverage_measurable === true,
    coverage_covered: r.coverage_covered === true,
  };
}

// PURE run-start decision core — the fixed refusal-biased ladder (spec §4). Folds
// the normalized RunTriggerSignals bundle into a closed {verdict, reason} pair.
// First-failing-check-wins; the derivation is the SINGLE source both the producer
// (`faff run-start`) and the consumer-side validator (`faff contract run-trigger`,
// Pattern-B) call, so they can never disagree (mirrors deriveHoldoutAggregate).
function deriveRunTrigger(s) {
  if (!s.target_resolved) return { verdict: "refuse", reason: "no-target" };
  if (!s.outward) return { verdict: "refuse", reason: "self-directed" };       // ADR-0069, BEFORE PRD checks
  if (s.prd_ambiguous) return { verdict: "refuse", reason: "prd-ambiguous" };
  if (!s.prd_present) return { verdict: "drain", reason: "no-prd-nothing-to-plan" };
  if (!s.prd_admissible) return { verdict: "refuse", reason: "prd-inadmissible" };       // fail-safe
  if (!s.coverage_measurable) return { verdict: "refuse", reason: "coverage-unmeasurable" }; // fail-safe
  if (!s.coverage_covered) return { verdict: "plan", reason: "coverage-thin" };
  return { verdict: "drain", reason: "prd-covered" };
}

const { parseArgs, usageError } = require("./argv");
const RUN_START_SIGNAL_NAMES = ["target-resolved", "outward", "prd-present", "prd-ambiguous", "prd-admissible", "coverage-measurable", "coverage-covered"];
const RUN_START_SPEC = { flags: (() => {
  const f = { "--selftest": { arity: 0 }, "--signals": { arity: 1 } };
  for (const n of RUN_START_SIGNAL_NAMES) { f[`--${n}`] = { arity: 0 }; f[`--no-${n}`] = { arity: 0 }; }
  return f;
})() };

function cmdRunStart(args) {
  if (args.includes("--selftest")) return runStartSelftest();
  const { values, errors } = parseArgs(args, RUN_START_SPEC);
  if (errors.length) return usageError(errors, "usage: faff run-start [--signals JSON] [--<signal>|--no-<signal>]... [--selftest]");

  // Signals may arrive as a whole bundle (--signals JSON) and/or as individual
  // flags; a flag OVERRIDES the bundle for that signal. A malformed --signals is a
  // usage error (exit 2), parity with run-done's --budget/--policy handling.
  let raw = {};
  const sigRaw = values["--signals"] === undefined ? null : values["--signals"];
  if (sigRaw != null) {
    try { const p = JSON.parse(sigRaw); if (p && typeof p === "object" && !Array.isArray(p)) raw = p; else { process.stderr.write("faff run-start: --signals must be a JSON object\n"); return 2; } }
    catch (e) { process.stderr.write(`faff run-start: --signals is not valid JSON: ${e.message}\n`); return 2; }
  }
  // Per-signal flag overrides: --<name> sets true, --no-<name> sets false.
  for (const name of RUN_START_SIGNAL_NAMES) {
    const key = name.replace(/-/g, "_");
    if (values[`--no-${name}`]) raw[key] = false;
    else if (values[`--${name}`]) raw[key] = true;
  }

  const signals = normalizeRunTriggerSignals(raw);
  const { verdict, reason } = deriveRunTrigger(signals);
  const out = { verdict, reason, signals, conformant: true, violations: [] };
  // Belt-and-braces: the produced verdict must itself conform to the run-trigger schema.
  const schemaErr = schemaCheck(out, "run-trigger");
  if (schemaErr) { process.stderr.write(`faff run-start: ${schemaErr}\n`); return 2; }
  process.stdout.write(JSON.stringify(out) + "\n");
  return 0; // report-only (parity with run-done / budget check / prdr coverage): the verdict is in the payload
}

// Selftest — the decision-table fixture set (spec §8): one row per §3b verdict x
// reason, driven through the pure ladder. No filesystem, no tracker. Mirrors the
// run-done / budget / next selftest shape: per-case ok/FAIL + a RESULT line.
function runStartSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { fail++; console.log(`FAIL ${name}`); } else console.log(`ok   ${name}`); };
  const d = (raw) => deriveRunTrigger(normalizeRunTriggerSignals(raw));
  // The fully-affirmative base bundle — every check passes down to the coverage split.
  const base = { target_resolved: true, outward: true, prd_present: true, prd_ambiguous: false, prd_admissible: true, coverage_measurable: true, coverage_covered: true };
  const hit = (raw, verdict, reason) => { const r = d(raw); return r.verdict === verdict && r.reason === reason; };

  // --- one row per §3b verdict x reason ---
  ok("plan/coverage-thin: outward+admissible+measurable+uncovered", hit({ ...base, coverage_covered: false }, "plan", "coverage-thin"));
  ok("drain/prd-covered: outward+admissible+measurable+covered", hit({ ...base }, "drain", "prd-covered"));
  ok("drain/no-prd-nothing-to-plan: outward, no PRD present", hit({ ...base, prd_present: false }, "drain", "no-prd-nothing-to-plan"));
  ok("refuse/no-target: no target resolvable", hit({ ...base, target_resolved: false }, "refuse", "no-target"));
  ok("refuse/self-directed: inward (outward==false)", hit({ ...base, outward: false }, "refuse", "self-directed"));
  ok("refuse/prd-ambiguous: multiple Active/Frozen PRDs", hit({ ...base, prd_ambiguous: true }, "refuse", "prd-ambiguous"));
  ok("refuse/prd-inadmissible: prd-readiness not admissible", hit({ ...base, prd_admissible: false }, "refuse", "prd-inadmissible"));
  ok("refuse/coverage-unmeasurable: admissible PRD but coverage malformed", hit({ ...base, coverage_measurable: false }, "refuse", "coverage-unmeasurable"));

  // --- ordering is load-bearing (spec §4) ---
  // inward + no-PRD => self-directed (the outward floor pre-empts the PRD checks),
  // distinct from outward + no-PRD => benign drain. The exact ADR-0069 discriminator.
  ok("ordering: inward+no-PRD => self-directed (outward floor BEFORE PRD checks)", hit({ ...base, outward: false, prd_present: false }, "refuse", "self-directed"));
  ok("ordering: outward+no-PRD => drain/no-prd-nothing-to-plan (distinct from inward)", hit({ ...base, prd_present: false }, "drain", "no-prd-nothing-to-plan"));
  // no-target pre-empts everything, even an otherwise-inward bundle.
  ok("ordering: no-target wins over inward", hit({ ...base, target_resolved: false, outward: false }, "refuse", "no-target"));
  // prd-ambiguous pre-empts admissibility + coverage.
  ok("ordering: prd-ambiguous wins over an inadmissible+uncovered tail", hit({ ...base, prd_ambiguous: true, prd_admissible: false, coverage_covered: false }, "refuse", "prd-ambiguous"));

  // --- fail-safe: a fully-malformed / empty bundle => refuse (never plan) ---
  ok("fail-safe: empty bundle => refuse/no-target", hit({}, "refuse", "no-target"));
  ok("fail-safe: non-object bundle => refuse/no-target", hit("not-an-object", "refuse", "no-target"));
  ok("fail-safe: non-boolean signals coerce false => refuse (plan unreachable without affirmative true)", (() => {
    const r = d({ target_resolved: "yes", outward: 1, prd_present: "x", prd_admissible: "x", coverage_measurable: "x", coverage_covered: "x" });
    return r.verdict === "refuse" && r.reason === "no-target";
  })());
  // plan is the most privileged: it requires EVERY affirmative signal explicitly true.
  ok("refusal-bias: plan requires every affirmative signal true (drop any => not plan)", (() => {
    const drops = ["target_resolved", "outward", "prd_present", "prd_admissible", "coverage_measurable"];
    return drops.every((k) => d({ ...base, coverage_covered: false, [k]: false }).verdict !== "plan");
  })());

  // --- shape: every verdict is in the enum with a paired closed reason ---
  ok("shape: every produced verdict/reason is in the closed enums", (() => {
    const bundles = [base, { ...base, coverage_covered: false }, { ...base, prd_present: false }, {}, { ...base, outward: false }];
    return bundles.every((b) => { const r = d(b); return RUN_TRIGGER_VERDICTS.includes(r.verdict) && RUN_TRIGGER_REASONS.includes(r.reason); });
  })());

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { RUN_TRIGGER_REASONS, RUN_TRIGGER_VERDICTS, cmdRunStart, deriveRunTrigger, normalizeRunTriggerSignals, runStartSelftest };
