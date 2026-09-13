// ===========================================================================
// === region:factory — next — FAFF-63: the legal-next-step transition function. PURE: the caller ===
// passes the issue's resolved state (the CLI has no tracker/MCP access); it
// computes the step. It NEVER executes the step or enforces the gate (FAFF-57).
// ===========================================================================

const { runEligibleCases } = require("./eligible");
const { parseArgs, usageError } = require("./argv");
const { captureDecision } = require("./decision-capture");

const NEXT_SPEC = {
  flags: {
    "--selftest": { arity: 0 },
    "--status": { arity: 1 }, // value validated by nextStep (case-insensitive), not an enum here
    "--spec": { arity: 1 },   // value validated by nextStep
    "--not-eligible": { arity: 0 },
    "--held": { arity: 0 },   // deprecated fail-safe alias of --not-eligible
    "--parked": { arity: 0 },
    "--blocked": { arity: 0 },
    "--if-eligible": { arity: 0 },
    "--awaiting-spec-review": { arity: 0 },
    "--root": { arity: 1 },
  },
};
const NEXT_USAGE = "usage: faff next --status STATUS --spec none|low|medium|high [--not-eligible] [--parked] [--blocked] [--if-eligible] [--awaiting-spec-review] [--root DIR]";

const NEXT_STATUSES = ["backlog", "todo", "in-progress", "in-review", "done", "cancelled", "duplicate"];
// FAFF-484: the single terminal-state set (the one definition of "terminal" in the normalised-status
// layer). WORKABLE_STATUSES is derived from it, so the two never drift. The gateway's "Workable vs
// terminal states" prose owns the agent-facing per-tracker mapping that resolves TO these statuses.
const TERMINAL_STATUSES = ["done", "cancelled", "duplicate"];
const WORKABLE_STATUSES = NEXT_STATUSES.filter((s) => !TERMINAL_STATUSES.includes(s));
const NEXT_SPECS = ["none", "low", "medium", "high"];

// UNCHANGED signature (FAFF-1044): this options-object shape + its exact seven
// destructured keys is decision-capture's KERNEL_REGISTRY "next" contract —
// shadow-fidelity's `declaredInputKeys`/`optionalInputs` structurally introspects this
// exact function, so adding an eighth key here would break its "optionalInputs empty
// for every in-scope kernel" invariant (FAFF-826/956). The skip-ineligible reason still
// names the literal default "faff-automate" here; `renderNextReason` below (called by
// cmdNext, OUTSIDE the kernel) substitutes in the configured prefix as presentation only
// — it changes no gating decision, just the string a human reads.
function nextStep({ status, spec, eligible, parked, blocked, ifEligible, awaitingSpecReview }) {
  if (!NEXT_STATUSES.includes(status)) return ["error", `unknown --status '${status}'`];
  if (!NEXT_SPECS.includes(spec)) return ["error", `unknown --spec '${spec}'`];
  // FAFF-484: membership via TERMINAL_STATUSES; the two branches keep their distinct returns
  // (done → done; cancelled/duplicate → none). Not one collapsed literal — two semantics.
  if (TERMINAL_STATUSES.includes(status)) {
    return status === "done" ? ["done", "complete"] : ["none", "cancelled/duplicate — ignored"];
  }
  // FAFF-83: --if-eligible is advisory — when a not-eligible item carries it, bypass the
  // skip-ineligible short-circuit and compute the hypothetical route it WOULD take if cranked up.
  // Terminal states (above) still win; the live skip-ineligible path is unchanged when the flag is absent.
  if (!eligible && !ifEligible) return ["skip-ineligible", "not automation-eligible — human cranks it up (faff-automate)"];
  if (parked) return ["needs-human", "parked — human decision"];
  // FAFF-900: a spec-review-outage hold (Backlog + attached spec + faff-awaiting-spec-review,
  // NOT faff-parked) routes back to prep regardless of the spec's retained confidence rating — the
  // spec itself may be high-confidence, but review has not concluded, so it is not build-ready.
  // Checked before the spec-confidence branches below (and before --blocked, which is a build-side
  // concern) so the hold always wins over whatever the confidence rating alone would have returned.
  if (awaitingSpecReview) return ["prep", "awaiting spec-review resume — outage hold, auto-resumes at review next drain"];
  if (spec === "none") return ["prep", "no spec — needs prep"];
  if (spec === "low") return ["needs-human", "low-confidence spec"];
  if (spec === "medium") return ["needs-human", "needs-decision-first (medium spec)"];
  if (blocked) return ["blocked", "external blocker unmet"];
  return ["graft", "build-eligible / resume"];
}

// FAFF-1044: presentation-only prefix substitution on nextStep's reason string, kept
// OUTSIDE the kernel (see nextStep's comment above for why) — a pure, no-config-read
// string transform cmdNext applies to its own already-decided output. A no-op for any
// reason that doesn't mention the default automate label, and for the default prefix.
function renderNextReason(reason, prefix = "faff") {
  return prefix === "faff" ? reason : reason.replace("faff-automate", `${prefix}-automate`);
}

function nextSelftest() {
  // eligible defaults true; pass { eligible: false } to model a not-automation-eligible ticket.
  const C = (status, spec, x = {}) => ({ status, spec, eligible: x.eligible !== false, parked: !!x.parked, blocked: !!x.blocked, ifEligible: !!x.ifEligible, awaitingSpecReview: !!x.awaitingSpecReview });
  const cases = [
    [C("cancelled", "high"), "none"],
    [C("duplicate", "none"), "none"],
    [C("done", "high"), "done"],
    [C("done", "none", { eligible: false }), "done"],      // terminal beats ineligible
    [C("todo", "high", { eligible: false }), "skip-ineligible"],
    [C("backlog", "none", { eligible: false }), "skip-ineligible"],
    [C("todo", "high", { parked: true }), "needs-human"],
    [C("backlog", "none"), "prep"],
    [C("todo", "none"), "prep"],
    [C("backlog", "none", { blocked: true }), "prep"], // blocked never blocks prep
    [C("todo", "low"), "needs-human"],
    [C("todo", "medium"), "needs-human"],
    [C("todo", "high"), "graft"],
    [C("backlog", "high"), "graft"],
    [C("in-progress", "high"), "graft"],
    [C("in-review", "high"), "graft"],
    [C("todo", "high", { blocked: true }), "blocked"], // blocked gates graft
    // FAFF-83: --if-eligible bypasses the skip-ineligible short-circuit (advisory hypothetical)
    [C("backlog", "none", { eligible: false, ifEligible: true }), "prep"],          // would-prep if cranked up
    [C("todo", "high", { eligible: false, ifEligible: true }), "graft"],            // would-graft if cranked up
    [C("todo", "medium", { eligible: false, ifEligible: true }), "needs-human"],    // would-need-human (medium)
    [C("todo", "high", { eligible: false, ifEligible: true, blocked: true }), "blocked"], // would-be-blocked
    [C("todo", "high", { ifEligible: true }), "graft"],                             // no-op when already eligible
    [C("done", "none", { eligible: false, ifEligible: true }), "done"],             // terminal still wins
    // FAFF-900: a spec-review-outage hold routes back to prep regardless of the spec's retained
    // confidence — review has not concluded, so it is never build-ready.
    [C("backlog", "high", { awaitingSpecReview: true }), "prep"],
    [C("backlog", "medium", { awaitingSpecReview: true }), "prep"],
    [C("backlog", "none", { awaitingSpecReview: true }), "prep"],               // same as plain no-spec, just a different reason
    [C("todo", "high", { awaitingSpecReview: true, parked: true }), "needs-human"], // faff-parked always wins over the hold
    [C("todo", "high", { awaitingSpecReview: true, eligible: false }), "skip-ineligible"], // eligibility still gates first
    [C("backlog", "high", { awaitingSpecReview: true, blocked: true }), "prep"], // blocked never blocks prep, same as the plain no-spec case
  ];
  let fail = 0;
  for (const [inp, want] of cases) {
    const [got] = nextStep(inp);
    const ok = got === want;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${JSON.stringify(inp)} → ${got} (want ${want})`);
  }
  // FAFF-61: the automation-eligibility truth table (hold > automate > default) feeding the --not-eligible flag.
  console.log("\n-- automation_eligible(labels, default) --");
  fail += runEligibleCases();
  // FAFF-1044: `renderNextReason` (applied by cmdNext, OUTSIDE the kernel) is PRESENTATION
  // — it renders the resolved prefix into the reason string, gating nothing (the `next`
  // token above is already computed by nextStep from `eligible`). Default-prefix
  // byte-identical; a custom prefix renders into the reason, not "faff-".
  {
    const [, rawReason] = nextStep(C("todo", "high", { eligible: false }));
    const defaultReason = renderNextReason(rawReason, "faff");
    const customReason = renderNextReason(rawReason, "sd");
    const okDefault = defaultReason === "not automation-eligible — human cranks it up (faff-automate)";
    const okCustom = customReason === "not automation-eligible — human cranks it up (sd-automate)";
    if (!okDefault) fail++;
    if (!okCustom) fail++;
    console.log(`${okDefault ? "ok  " : "FAIL"} skip-ineligible reason (default prefix) → ${JSON.stringify(defaultReason)}`);
    console.log(`${okCustom ? "ok  " : "FAIL"} skip-ineligible reason (prefix=sd) → ${JSON.stringify(customReason)}`);
  }
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${cases.length} transition cases + eligibility table + 2 prefix-reason checks, ${fail} failed)`);
  return fail ? 1 : 0;
}

function cmdNext(args) {
  if (args.includes("--selftest")) return nextSelftest();
  const { values, errors } = parseArgs(args, NEXT_SPEC);
  if (errors.length) return usageError(errors, NEXT_USAGE);
  // FAFF-61: eligibility replaces the old --held flag. Default eligible (proceed);
  // --not-eligible marks a ticket the autonomous pipeline must skip. `--held` is kept
  // as a deprecated, fail-safe alias of --not-eligible (a held ticket is never eligible),
  // so an un-migrated caller still skips rather than silently proceeding.
  const state = {
    status: String(values["--status"] || "").toLowerCase(),
    spec: String(values["--spec"] || "none").toLowerCase(),
    eligible: !(values["--not-eligible"] || values["--held"]),
    parked: !!values["--parked"],
    blocked: !!values["--blocked"],
    ifEligible: !!values["--if-eligible"],   // FAFF-83: advisory hypothetical
    awaitingSpecReview: !!values["--awaiting-spec-review"],   // FAFF-900: spec-review-outage hold
  };
  const [next, rawReason] = nextStep(state);
  if (next === "error") { process.stderr.write(`faff next: ${rawReason}\n`); return 2; }
  // FAFF-1044: cmdNext is the command layer — resolve the configured prefix once (fail
  // loud on a malformed value) and render it into the ALREADY-DECIDED reason string via
  // renderNextReason (presentation-only, applied OUTSIDE nextStep — see that function's
  // comment for why: decision-capture's fixed seven-key "next" contract, FAFF-826/956).
  // `state` (below, captureDecision's normalised_inputs) stays the unmodified seven keys.
  const { resolveLabelPrefix } = require("./config");
  const { findRoot } = require("./shared-infra");
  const root = values["--root"] || findRoot();
  const resolvedPrefix = resolveLabelPrefix(root);
  if (resolvedPrefix.error) { process.stderr.write(resolvedPrefix.error + "\n"); return 2; }
  const reason = renderNextReason(rawReason, resolvedPrefix.prefix);
  // would_be_eligible is set only when the hypothetical path was actually taken: the item is
  // not eligible, --if-eligible bypassed the short-circuit, and it wasn't a terminal short-circuit.
  const hypothetical = !state.eligible && state.ifEligible && !TERMINAL_STATUSES.includes(state.status);
  console.log(JSON.stringify(hypothetical ? { next, reason, would_be_eligible: true } : { next, reason }));
  // FAFF-956: deterministic in-kernel decision-capture — best-effort, flag-guarded,
  // authority-inert (never changes the stdout above or the exit below). `state` carries all
  // seven canonical `nextStep` keys by construction, so the record is always input-complete.
  captureDecision({ kernel: "next", normalised_inputs: state, verdict: next, issue: process.env.FAFF_DECISION_ISSUE || "" });
  return 0;
}


module.exports = { NEXT_SPECS, NEXT_STATUSES, TERMINAL_STATUSES, WORKABLE_STATUSES, cmdNext, nextSelftest, nextStep, renderNextReason };
