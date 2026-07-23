// ===========================================================================
// === region:factory — run-done — FAFF-38: the terminating-condition predicate. ===
// `faff run-done` is a PURE CLI (parity with `faff next` / `faff budget check` /
// `faff prdr coverage`): no tracker, no network, no disk beyond its args, and it
// NEVER calls the methodology — the orchestrator resolves the policy and hands it
// in via --policy. It COMPOSES faff's already-shipped run signals (queue state,
// `faff runcheck`'s .clean, `faff budget check`'s {breached,outcome}, `faff prdr
// coverage`'s prd-satisfied) into the one decision that ends a /faff-beep-boop
// run: run-complete | continue | escalate. Two layers — a FIXED safety floor no
// policy may weaken, and policy-weighted rungs whose precedence is the
// methodology's run-termination-policy named output (absent ⇒ the built-in
// structural-default ladder). Reimplements NO signal; each named CLI stays the
// sole producer of its own signal.
// ===========================================================================


const { schemaCheck } = require("./contract-engine");

const RUN_DONE_VERDICTS = ["run-complete", "continue", "escalate"];
const BUDGET_OUTCOMES = new Set(["stop", "narrow", "escalate", "none"]);

// The POLICY-WEIGHTED rung tests (the floor conjuncts are NOT here — they are
// fixed, applied before the ladder, and immune to any policy). A Rung names one
// of these tests; the policy supplies the ORDER (and may soften a non-floor
// rung's verdict). The reason each test yields is CANONICAL (the closed
// stop-reason vocabulary), derived from the test name — never free-form from the
// policy — so `reason` stays a closed set regardless of the supplied ladder.
const RUN_DONE_RUNG_TESTS = {
  "non-convergence": (s) => s.non_convergence === true,
  "budget-narrow": (s) => s.budget.breached.length > 0 && s.budget.outcome === "narrow",
  "budget-stop": (s) => s.budget.breached.length > 0 && s.budget.outcome === "stop",
  "value-inflection": (s) => s.inflection === "reached",
  "work-remaining": (s) => !(s.queue_empty || s.all_parked),
  "clean-complete": () => true, // terminal catch-all — the ladder always terminates here
};
const RUN_DONE_RUNG_CANON = {
  "non-convergence": { verdict: "escalate", reason: () => "non-convergence" },
  "budget-narrow": { verdict: "continue", reason: (s, dims) => `budget-narrow(${dims})` },
  "budget-stop": { verdict: "run-complete", reason: (s, dims) => `budget-hit(${dims})` },
  "value-inflection": { verdict: "run-complete", reason: () => "value-inflection" },
  "work-remaining": { verdict: "continue", reason: () => "work-remaining" },
  "clean-complete": { verdict: "run-complete", reason: (s) => (s.queue_empty ? "drained" : "all-parked") },
};
const RUN_DONE_STRUCTURAL_LADDER = [
  "non-convergence", "budget-narrow", "budget-stop", "value-inflection", "work-remaining", "clean-complete",
].map((test) => ({ test, verdict: RUN_DONE_RUNG_CANON[test].verdict }));

// Coerce a raw signal bundle onto the closed RunSignals vocabulary. Booleans are
// strict; budget defaults to the unbreached/none envelope; an unknown budget
// outcome coerces to "none" (the unbounded default, parity with budget check's
// at_ceiling coercion); prd_satisfied is the only tri-state (true|false|null,
// null ⇒ no PRD in scope); inflection defaults "none". Never throws.
function normalizeRunSignals(raw) {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
  const b = (r.budget && typeof r.budget === "object" && !Array.isArray(r.budget)) ? r.budget : {};
  let outcome = typeof b.outcome === "string" ? b.outcome : "none";
  if (!BUDGET_OUTCOMES.has(outcome)) outcome = "none";
  const breached = Array.isArray(b.breached) ? b.breached.filter((d) => typeof d === "string") : [];
  let prd = null;
  if (r.prd_satisfied === true) prd = true;
  else if (r.prd_satisfied === false) prd = false;
  return {
    queue_empty: r.queue_empty === true,
    all_parked: r.all_parked === true,
    ledger_clean: r.ledger_clean === true,
    budget: { breached, outcome },
    prd_satisfied: prd,
    inflection: r.inflection === "reached" ? "reached" : "none",
    non_convergence: r.non_convergence === true,
  };
}

// PURE terminating-condition core — no I/O. Folds the RunSignals bundle (and an
// optional methodology TerminationPolicy) into the fixed RunDoneVerdict. The
// safety floor runs FIRST and is fixed: NO policy can reach past it (the
// adversarial-policy selftests pin this). The ladder (policy-supplied, else the
// structural default) decides only the non-floor verdict.
function computeRunDoneVerdict(rawSignals, policy) {
  const s = normalizeRunSignals(rawSignals);
  const violations = [];
  const breached = s.budget.breached.length > 0;
  const dims = s.budget.breached.join(",");
  const mk = (verdict, reason, policy_source, decided_by, floor) => ({
    verdict,
    reason,
    signals: {
      queue_empty: s.queue_empty, all_parked: s.all_parked, ledger_clean: s.ledger_clean,
      budget: { breached: s.budget.breached, outcome: s.budget.outcome },
      prd_satisfied: s.prd_satisfied, inflection: s.inflection, non_convergence: s.non_convergence,
      decided_by, floor,
    },
    policy_source,
    conformant: violations.length === 0,
    violations,
  });

  // --- SAFETY FLOOR (fixed; NO policy may weaken these) ---
  if (breached && s.budget.outcome === "escalate") return mk("escalate", `budget-escalated(${dims})`, "structural-default", "budget-escalated", true);
  if (!s.ledger_clean && (s.queue_empty || s.all_parked)) return mk("continue", "undispatched-ledger", "structural-default", "undispatched-ledger", true);
  if (s.prd_satisfied === false) return mk("escalate", "product-incomplete", "structural-default", "product-incomplete", true);

  // --- POLICY-WEIGHTED rungs ---
  let ladder, policy_source;
  if (policy && typeof policy === "object" && Array.isArray(policy.ladder) && policy.ladder.length) {
    ladder = policy.ladder; policy_source = "methodology";
  } else {
    ladder = RUN_DONE_STRUCTURAL_LADDER; policy_source = "structural-default";
  }
  for (const rung of ladder) {
    const test = rung && rung.test;
    const pred = RUN_DONE_RUNG_TESTS[test];
    if (!pred) { violations.push(`unknown rung test ${JSON.stringify(test)} — skipped`); continue; }
    if (!pred(s)) continue;
    const canon = RUN_DONE_RUNG_CANON[test];
    let verdict = canon.verdict;
    if (rung.verdict !== undefined) {
      if (RUN_DONE_VERDICTS.includes(rung.verdict)) verdict = rung.verdict; // the soften knob (non-floor only)
      else violations.push(`rung ${test} verdict ${JSON.stringify(rung.verdict)} not in enum — using canonical ${canon.verdict}`);
    }
    return mk(verdict, canon.reason(s, dims), policy_source, test, false);
  }
  // Ladder exhausted with no hit (a methodology ladder omitting the terminal rung):
  // fall to the canonical clean-complete so the predicate ALWAYS terminates.
  return mk("run-complete", s.queue_empty ? "drained" : "all-parked", policy_source, "clean-complete", false);
}

const { parseArgs, usageError } = require("./argv");
const RUN_DONE_SPEC = { flags: (() => {
  const f = {
    "--selftest": { arity: 0 }, "--no-prd": { arity: 0 }, "--non-convergence": { arity: 0 },
    "--budget": { arity: 1 }, "--prd-coverage": { arity: 1 }, "--policy": { arity: 1 }, "--inflection": { arity: 1 },
  };
  for (const n of ["queue-empty", "all-parked", "ledger-clean"]) { f[`--${n}`] = { arity: 0 }; f[`--no-${n}`] = { arity: 0 }; }
  return f;
})() };

function cmdRunDone(args) {
  if (args.includes("--selftest")) return runDoneSelftest();
  const { values, errors } = parseArgs(args, RUN_DONE_SPEC);
  if (errors.length) return usageError(errors, "usage: faff run-done [--budget JSON] [--prd-coverage JSON] [--policy JSON] [--inflection reached|none] [--<signal>|--no-<signal>]...");
  const getFlag = (f) => (values[f] === undefined ? null : values[f]);
  const boolSig = (name) => {
    if (values[`--no-${name}`]) return false;
    if (values[`--${name}`]) return true;
    return false;
  };
  // --budget / --prd-coverage / --policy carry JSON; a malformed value is a usage error (exit 2).
  const parseJson = (raw, label) => {
    try { return { ok: true, value: JSON.parse(raw) }; }
    catch (e) { process.stderr.write(`faff run-done: ${label} is not valid JSON: ${e.message}\n`); return { ok: false }; }
  };

  let budget = { breached: [], outcome: "none" };
  const budgetRaw = getFlag("--budget");
  if (budgetRaw != null) {
    const p = parseJson(budgetRaw, "--budget"); if (!p.ok) return 2; budget = p.value;
  }

  // prd_satisfied: --prd-coverage JSON (read .satisfied) | --no-prd (null) | absent (null, no PRD in scope).
  let prd_satisfied = null;
  const covRaw = getFlag("--prd-coverage");
  if (covRaw != null && !values["--no-prd"]) {
    const p = parseJson(covRaw, "--prd-coverage"); if (!p.ok) return 2;
    const cov = p.value;
    if (cov === null || typeof cov !== "object" || Array.isArray(cov) || typeof cov.satisfied !== "boolean") {
      process.stderr.write("faff run-done: --prd-coverage must be a prd-coverage object with a boolean .satisfied\n"); return 2;
    }
    prd_satisfied = cov.satisfied;
  }

  let policy = null;
  const policyRaw = getFlag("--policy");
  if (policyRaw != null) {
    const p = parseJson(policyRaw, "--policy"); if (!p.ok) return 2; policy = p.value;
  }

  let inflection = "none";
  const inflRaw = getFlag("--inflection");
  if (inflRaw != null) {
    if (inflRaw !== "reached" && inflRaw !== "none") { process.stderr.write("faff run-done: --inflection must be reached|none\n"); return 2; }
    inflection = inflRaw;
  }

  const signals = {
    queue_empty: boolSig("queue-empty"),
    all_parked: boolSig("all-parked"),
    ledger_clean: boolSig("ledger-clean"),
    budget,
    prd_satisfied,
    inflection,
    non_convergence: !!values["--non-convergence"],
  };

  const verdict = computeRunDoneVerdict(signals, policy);
  // Belt-and-braces: the produced verdict must itself conform to the run-termination schema.
  const schemaErr = schemaCheck(verdict, "run-termination");
  if (schemaErr) { process.stderr.write(`faff run-done: ${schemaErr}\n`); return 2; }
  process.stdout.write(JSON.stringify(verdict) + "\n");
  return 0; // report-only (parity with budget check / prdr coverage): the verdict is in the payload, not the exit code
}

// Selftest — drives the pure core over in-memory cases; no filesystem, no tracker.
// Covers each FLOOR rung (incl. an adversarial policy pinned to fail to override
// it), each policy-weighted rung under the structural default, a methodology
// reorder/soften, and the A2 degradable no-PRD/no-policy default. Mirrors the
// budget/next selftest shape: per-case ok/FAIL + a RESULT line, non-zero on fail.
function runDoneSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { fail++; console.log(`FAIL ${name}`); } else console.log(`ok   ${name}`); };
  const v = (sig, pol) => computeRunDoneVerdict(sig, pol);
  // An adversarial policy that tries to make EVERYTHING complete immediately.
  const ADVERSARIAL = { ladder: [{ test: "work-remaining", verdict: "run-complete" }, { test: "clean-complete", verdict: "run-complete" }] };

  // --- SAFETY FLOOR rungs (fixed; pinned against the adversarial policy) ---
  const esc = { budget: { breached: ["tokens"], outcome: "escalate" }, queue_empty: true, ledger_clean: true };
  ok("floor: budget-escalate → escalate", v(esc).verdict === "escalate" && v(esc).reason === "budget-escalated(tokens)");
  ok("floor: budget-escalate immune to adversarial policy", v(esc, ADVERSARIAL).verdict === "escalate" && v(esc, ADVERSARIAL).reason === "budget-escalated(tokens)");

  const undi = { queue_empty: true, ledger_clean: false };
  ok("floor: unclean ledger at drain → continue/undispatched-ledger", v(undi).verdict === "continue" && v(undi).reason === "undispatched-ledger");
  ok("floor: undispatched-ledger immune to adversarial policy", v(undi, ADVERSARIAL).verdict === "continue" && v(undi, ADVERSARIAL).reason === "undispatched-ledger");
  // all_parked is the other drain face
  ok("floor: unclean ledger at all-parked → continue", v({ all_parked: true, ledger_clean: false }).reason === "undispatched-ledger");

  const prodInc = { queue_empty: true, ledger_clean: true, prd_satisfied: false };
  ok("floor: prd_satisfied==false (PRD in scope) → escalate/product-incomplete", v(prodInc).verdict === "escalate" && v(prodInc).reason === "product-incomplete");
  ok("floor: product-incomplete immune to adversarial policy", v(prodInc, ADVERSARIAL).verdict === "escalate" && v(prodInc, ADVERSARIAL).reason === "product-incomplete");
  // no PRD in scope (null) skips the product floor entirely
  ok("no PRD (null) skips the product floor → drained", v({ queue_empty: true, ledger_clean: true, prd_satisfied: null }).reason === "drained");

  // floor precedence: budget-escalate beats a non-convergence ladder rung
  ok("floor beats policy rung (escalate before non-convergence)", v({ budget: { breached: ["cost"], outcome: "escalate" }, non_convergence: true, queue_empty: true, ledger_clean: true }).reason === "budget-escalated(cost)");

  // --- POLICY-WEIGHTED rungs (structural default ladder) ---
  ok("rung: non-convergence → escalate", (() => { const r = v({ non_convergence: true, queue_empty: false, ledger_clean: true }); return r.verdict === "escalate" && r.reason === "non-convergence"; })());
  ok("rung: budget-narrow → continue (not terminal)", (() => { const r = v({ budget: { breached: ["tokens"], outcome: "narrow" }, ledger_clean: true, queue_empty: true }); return r.verdict === "continue" && r.reason === "budget-narrow(tokens)"; })());
  ok("rung: budget-stop → run-complete (clean ceiling)", (() => { const r = v({ budget: { breached: ["tokens"], outcome: "stop" }, ledger_clean: true, queue_empty: true }); return r.verdict === "run-complete" && r.reason === "budget-hit(tokens)"; })());
  ok("rung: value-inflection → run-complete (early stop)", (() => { const r = v({ inflection: "reached", ledger_clean: true, queue_empty: false }); return r.verdict === "run-complete" && r.reason === "value-inflection"; })());
  ok("rung: work-remaining → continue", (() => { const r = v({ queue_empty: false, all_parked: false, ledger_clean: true }); return r.verdict === "continue" && r.reason === "work-remaining"; })());
  ok("rung: queue drained + clean → run-complete/drained", (() => { const r = v({ queue_empty: true, ledger_clean: true }); return r.verdict === "run-complete" && r.reason === "drained"; })());
  ok("rung: all parked + clean → run-complete/all-parked", (() => { const r = v({ queue_empty: false, all_parked: true, ledger_clean: true }); return r.verdict === "run-complete" && r.reason === "all-parked"; })());

  // narrow precedes stop precedes inflection (precedence within the ladder)
  ok("ladder precedence: narrow wins over a would-be drained", v({ budget: { breached: ["tokens"], outcome: "narrow" }, queue_empty: true, ledger_clean: true }).reason === "budget-narrow(tokens)");

  // --- policy_source provenance ---
  ok("no --policy → policy_source structural-default", v({ queue_empty: true, ledger_clean: true }).policy_source === "structural-default");
  // methodology reorder/soften: value-inflection softened to continue
  const soft = v({ inflection: "reached", queue_empty: false, ledger_clean: true }, { ladder: [{ test: "value-inflection", verdict: "continue" }, { test: "clean-complete" }] });
  ok("methodology softens value-inflection → continue, policy_source methodology", soft.verdict === "continue" && soft.reason === "value-inflection" && soft.policy_source === "methodology" && soft.conformant);
  // an unknown rung test is a violation, not a crash; the ladder still terminates
  const bad = v({ queue_empty: true, ledger_clean: true }, { ladder: [{ test: "bogus" }] });
  ok("unknown rung test → violation + still terminates", bad.conformant === false && bad.verdict === "run-complete" && bad.reason === "drained");

  // --- A2 degradable default: no PRD, no inflection, no policy reproduces drain semantics ---
  ok("A2: bare drained run reproduces today's behaviour", (() => { const r = v({ queue_empty: true, ledger_clean: true }); return r.verdict === "run-complete" && r.reason === "drained" && r.policy_source === "structural-default" && r.conformant; })());

  // --- shape: every verdict carries a non-empty reason in the enum ---
  ok("verdict ∈ enum AND reason != '' (work-remaining default case)", (() => { const r = v({}); return RUN_DONE_VERDICTS.includes(r.verdict) && r.reason !== "" && r.reason === "work-remaining"; })());

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { BUDGET_OUTCOMES, RUN_DONE_RUNG_CANON, RUN_DONE_RUNG_TESTS, RUN_DONE_STRUCTURAL_LADDER, RUN_DONE_VERDICTS, cmdRunDone, computeRunDoneVerdict, normalizeRunSignals, runDoneSelftest };
