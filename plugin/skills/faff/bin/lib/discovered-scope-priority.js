// ===========================================================================
// === region:factory — discovered-scope-priority — FAFF-1399: the discovered-scope ===
// priority function. PURE: a total lookup over two closed enums (relationship, source)
// plus one boolean (gate_defect) — the SAME table every autonomous/interactive filing
// chokepoint consults, so a `blocker`-relationship item lands "high" whether beep-boop,
// interactive graft, or tidy's chain-gap filing created the ticket. Mirrors `eligible`/
// `contain`: a small single-purpose pure function wired as a `faff` subcommand, directly
// unit-testable, no tracker/network call. The caller judges `relationship`/`source`/
// `gate_defect` once at capture time (unchanged); this is table lookup over that
// judgement, never a second independent judgement.
//
// First-match-wins table (spec §3 "Where is the Medium/Low split drawn, and is it
// mechanical?"), checked top to bottom:
//   gate_defect == true                        -> high   (a faff gate/evidence check
//                                                  produced a wrong result — FAFF-1397)
//   relationship == "blocker"                   -> high   (blocks other work)
//   source in {post-merge, ci-triage}           -> high   (a regression on main)
//   relationship in {blocked-by, parent}        -> medium (known to follow immediately,
//                                                  or a deliverable the active ticket's
//                                                  own spec already committed to)
//   source == "review"                          -> medium (human-judgement-shaped review
//                                                  flagged it, not an opportunistic note)
//   (none of the above)                         -> low    (relationship in {peer, none}
//                                                  and source in {build, orchestrator,
//                                                  chain-gap} — an opportunistic peer item)
//
// Every combination the two closed enums + one boolean can produce has a defined
// answer — there is no "unknown" result and no non-zero exit for a valid input.
// ===========================================================================

"use strict";

const RELATIONSHIPS = ["blocker", "blocked-by", "peer", "parent", "none"];
const SOURCES = ["build", "review", "post-merge", "ci-triage", "orchestrator", "chain-gap"];
const PRIORITIES = ["high", "medium", "low"];

// discoveredScopePriority({ relationship, source, gateDefect }) -> "high" | "medium" | "low"
// PURE. Callers must pass a relationship from RELATIONSHIPS and a source from SOURCES —
// this function does not validate (the CLI layer below owns enum validation via argv's
// closed-enum flag spec); an out-of-table combination is a programming error upstream,
// not a runtime "unknown" the function itself produces.
function discoveredScopePriority({ relationship, source, gateDefect }) {
  if (gateDefect) return "high";
  if (relationship === "blocker") return "high";
  if (source === "post-merge" || source === "ci-triage") return "high";
  if (relationship === "blocked-by" || relationship === "parent") return "medium";
  if (source === "review") return "medium";
  return "low";
}

// Exhaustive case table — one row per distinct table condition, plus the FAFF-1399 DONE's
// explicitly-named edge cases: the gate_defect short-circuit over relationship:"none", and
// the chain-gap --source chain-gap / --relationship parent combination.
const DISCOVERED_SCOPE_PRIORITY_CASES = [
  // [{relationship, source, gateDefect}], want
  [{ relationship: "none", source: "build", gateDefect: true }, "high"],       // gate_defect short-circuit over a relationship:"none" input
  [{ relationship: "blocker", source: "build", gateDefect: false }, "high"],   // relationship == blocker
  [{ relationship: "blocker", source: "chain-gap", gateDefect: false }, "high"], // upstream chain-gap -> blocker -> high
  [{ relationship: "peer", source: "post-merge", gateDefect: false }, "high"],  // source == post-merge (regression on main)
  [{ relationship: "none", source: "ci-triage", gateDefect: false }, "high"],   // source == ci-triage (regression on main)
  [{ relationship: "blocked-by", source: "build", gateDefect: false }, "medium"], // relationship == blocked-by
  [{ relationship: "blocked-by", source: "chain-gap", gateDefect: false }, "medium"], // downstream chain-gap -> blocked-by -> medium
  [{ relationship: "parent", source: "chain-gap", gateDefect: false }, "medium"], // sub-ticket chain-gap -> parent -> medium
  [{ relationship: "peer", source: "review", gateDefect: false }, "medium"],    // source == review
  [{ relationship: "none", source: "review", gateDefect: false }, "medium"],    // source == review, relationship none
  [{ relationship: "peer", source: "build", gateDefect: false }, "low"],        // default row: peer + build
  [{ relationship: "none", source: "build", gateDefect: false }, "low"],        // default row: none + build
  [{ relationship: "none", source: "orchestrator", gateDefect: false }, "low"], // default row: orchestrator-lane entry
  [{ relationship: "peer", source: "chain-gap", gateDefect: false }, "low"],    // peer chain-gap -> peer -> low
  // gate_defect wins over every other condition, including ones that would otherwise be lower:
  [{ relationship: "peer", source: "build", gateDefect: true }, "high"],
  [{ relationship: "blocked-by", source: "review", gateDefect: true }, "high"],
];

function runDiscoveredScopePriorityCases() {
  let fail = 0;
  for (const [input, want] of DISCOVERED_SCOPE_PRIORITY_CASES) {
    const got = discoveredScopePriority(input);
    const ok = got === want;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} relationship=${input.relationship} source=${input.source} gateDefect=${input.gateDefect} → ${got} (want ${want})`);
  }
  return fail;
}

function discoveredScopePrioritySelftest() {
  const fail = runDiscoveredScopePriorityCases();
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${DISCOVERED_SCOPE_PRIORITY_CASES.length} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

const { parseArgs, usageError } = require("./argv");

const DISCOVERED_SCOPE_PRIORITY_SPEC = {
  flags: {
    "--selftest": { arity: 0 },
    "--relationship": { arity: 1, enum: RELATIONSHIPS },
    "--source": { arity: 1, enum: SOURCES },
    "--gate-defect": { arity: 0 },
  },
};
const DISCOVERED_SCOPE_PRIORITY_USAGE =
  "usage: faff discovered-scope-priority --relationship <blocker|blocked-by|peer|parent|none> --source <build|review|post-merge|ci-triage|orchestrator|chain-gap> [--gate-defect]";

function cmdDiscoveredScopePriority(args) {
  if (args.includes("--selftest")) return discoveredScopePrioritySelftest();
  const { values, errors } = parseArgs(args, DISCOVERED_SCOPE_PRIORITY_SPEC);
  if (errors.length) return usageError(errors, DISCOVERED_SCOPE_PRIORITY_USAGE);
  if (!values["--relationship"] || !values["--source"]) {
    return usageError(
      [{ code: "missing-value", detail: "both --relationship and --source are required" }],
      DISCOVERED_SCOPE_PRIORITY_USAGE
    );
  }
  const relationship = values["--relationship"];
  const source = values["--source"];
  const gateDefect = Boolean(values["--gate-defect"]);
  const verdict = discoveredScopePriority({ relationship, source, gateDefect });
  console.log(verdict);
  return 0;
}

module.exports = {
  RELATIONSHIPS,
  SOURCES,
  PRIORITIES,
  DISCOVERED_SCOPE_PRIORITY_CASES,
  discoveredScopePriority,
  cmdDiscoveredScopePriority,
  discoveredScopePrioritySelftest,
  runDiscoveredScopePriorityCases,
};
