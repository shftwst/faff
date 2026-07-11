// ===========================================================================
// === region:factory — next — FAFF-63: the legal-next-step transition function. PURE: the caller ===
// passes the issue's resolved state (the CLI has no tracker/MCP access); it
// computes the step. It NEVER executes the step or enforces the gate (FAFF-57).
// ===========================================================================

const { runEligibleCases } = require("./eligible");

const NEXT_STATUSES = ["backlog", "todo", "in-progress", "in-review", "done", "cancelled", "duplicate"];
const NEXT_SPECS = ["none", "low", "medium", "high"];

function nextStep({ status, spec, eligible, parked, blocked, ifEligible }) {
  if (!NEXT_STATUSES.includes(status)) return ["error", `unknown --status '${status}'`];
  if (!NEXT_SPECS.includes(spec)) return ["error", `unknown --spec '${spec}'`];
  if (status === "cancelled" || status === "duplicate") return ["none", "cancelled/duplicate — ignored"];
  if (status === "done") return ["done", "complete"];
  // FAFF-83: --if-eligible is advisory — when a not-eligible item carries it, bypass the
  // skip-ineligible short-circuit and compute the hypothetical route it WOULD take if cranked up.
  // Terminal states (above) still win; the live skip-ineligible path is unchanged when the flag is absent.
  if (!eligible && !ifEligible) return ["skip-ineligible", "not automation-eligible — human cranks it up (faff-automate)"];
  if (parked) return ["needs-human", "parked — human decision"];
  if (spec === "none") return ["prep", "no spec — needs prep"];
  if (spec === "low") return ["needs-human", "low-confidence spec"];
  if (spec === "medium") return ["needs-human", "needs-decision-first (medium spec)"];
  if (blocked) return ["blocked", "external blocker unmet"];
  return ["graft", "build-eligible / resume"];
}

function nextSelftest() {
  // eligible defaults true; pass { eligible: false } to model a not-automation-eligible ticket.
  const C = (status, spec, x = {}) => ({ status, spec, eligible: x.eligible !== false, parked: !!x.parked, blocked: !!x.blocked, ifEligible: !!x.ifEligible });
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
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${cases.length} transition cases + eligibility table, ${fail} failed)`);
  return fail ? 1 : 0;
}

function cmdNext(args) {
  if (args.includes("--selftest")) return nextSelftest();
  const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  // FAFF-61: eligibility replaces the old --held flag. Default eligible (proceed);
  // --not-eligible marks a ticket the autonomous pipeline must skip. `--held` is kept
  // as a deprecated, fail-safe alias of --not-eligible (a held ticket is never eligible),
  // so an un-migrated caller still skips rather than silently proceeding.
  const state = {
    status: (get("--status") || "").toLowerCase(),
    spec: (get("--spec") || "none").toLowerCase(),
    eligible: !(args.includes("--not-eligible") || args.includes("--held")),
    parked: args.includes("--parked"),
    blocked: args.includes("--blocked"),
    ifEligible: args.includes("--if-eligible"),   // FAFF-83: advisory hypothetical
  };
  const [next, reason] = nextStep(state);
  if (next === "error") { process.stderr.write(`faff next: ${reason}\n`); return 2; }
  // would_be_eligible is set only when the hypothetical path was actually taken: the item is
  // not eligible, --if-eligible bypassed the short-circuit, and it wasn't a terminal short-circuit.
  const hypothetical = !state.eligible && state.ifEligible && !["cancelled", "duplicate", "done"].includes(state.status);
  console.log(JSON.stringify(hypothetical ? { next, reason, would_be_eligible: true } : { next, reason }));
  return 0;
}


module.exports = { NEXT_SPECS, NEXT_STATUSES, cmdNext, nextSelftest, nextStep };
