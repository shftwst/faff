// ===========================================================================
// === region:governance — reconcile — FAFF-397: blocking run-end ground-truth reconcile ===
// ===========================================================================
// `faff reconcile` is the PURE run-end integrity gate that confronts every ledger `shipped`
// outcome — and every spec-referenced, non-admitted sibling's terminal-state — with LIVE
// evidence the ORCHESTRATOR already gathered (git/forge state via `gh`/`git`, tracker state
// via MCP). It never re-observes that evidence itself: the caller assembles a ReconcileInput
// (one entry per `shipped` ledger outcome + one per spec-referenced non-admitted sibling) and
// pipes it on stdin. This mirrors `merge-gate`'s decideFloor split — a pure core behind a thin
// impure shell — except here the "impure shell" is beep-boop Step 11's own prose, not this file:
// re-observing CI/merge/tracker state INSIDE this command would be the anti-pattern the spec
// names explicitly (the verb must stay pure so no model judgement decides the verdict).
//
// `runcheck` stays a pure no-I/O Stop-hook (FAFF-205/233/235) auditing ledger COMPLETENESS;
// this is the deliberately SEPARATE verb auditing ledger-vs-world GROUND-TRUTH — conflating the
// two would break runcheck's purity invariant. Fail-closed throughout: a `shipped` claim with no
// matching merge evidence is a divergence, never a silent pass; malformed input is exit 2.
// ===========================================================================

const fs = require("node:fs");

const DIVERGENCE_CLASSES = ["phantom-merge", "claimed-shipped-unmerged", "unowned-sibling-mutation"];
const LEVELS = ["L1", "L2", "L3", "L4"];

// PURE: classify one `shipped` ledger outcome against its recorded merge-record (written by
// `merge-gate` on the merge-ok path) + the orchestrator's live-observed forge state. A missing
// record OR an observed non-merge is `claimed-shipped-unmerged` (fail-closed: unprovable ⇒
// divergence, never pass); a recorded-vs-observed head-sha mismatch is the sharper `phantom-merge`
// (something else got merged instead) and carries a suggested (never-executed) revert.
function reconcileShipped(s) {
  const issue = s && s.issue;
  const recorded = s && s.recorded ? s.recorded : null;
  const observed = (s && s.observed) || {};
  if (!recorded || observed.pr_merged !== true) {
    return {
      class: "claimed-shipped-unmerged",
      issue,
      detail: "shipped claim with no merge on record/forge",
      rollback_proposal: null,
    };
  }
  if (observed.merged_head_sha !== recorded.head_sha) {
    return {
      class: "phantom-merge",
      issue,
      detail: `shipped on ${recorded.head_sha} but forge merged ${observed.merged_head_sha}`,
      rollback_proposal: observed.merged_head_sha ? `git revert ${observed.merged_head_sha}` : null,
    };
  }
  return null;
}

// PURE: a non-admitted, spec-referenced sibling that flipped INTO a terminal state during the
// run is out-of-mandate mutation — the run never claimed ownership of it, so nothing it did to
// that issue is accountable. A sibling admitted later in the same run (chain-unlock) is excluded
// by construction (admitted:true is never passed for it).
function reconcileSibling(sib) {
  if (sib && sib.end_state_terminal && !sib.start_state_terminal && !sib.admitted) {
    return {
      class: "unowned-sibling-mutation",
      issue: sib.issue,
      detail: "non-admitted spec-referenced sibling moved to a terminal state during the run",
      rollback_proposal: null,
    };
  }
  return null;
}

// PURE assertion core (FAFF-397 spec §4 `reconcile_core`). Deterministic; no model judgement —
// the caller gathers evidence, this only classifies it. Empty input (no shipped, no siblings) is
// vacuously consistent (a run that shipped/mutated nothing has nothing to diverge on).
function reconcileCore(input) {
  const divergences = [];
  for (const s of (Array.isArray(input.shipped) ? input.shipped : [])) {
    const d = reconcileShipped(s);
    if (d) divergences.push(d);
  }
  for (const sib of (Array.isArray(input.siblings) ? input.siblings : [])) {
    const d = reconcileSibling(sib);
    if (d) divergences.push(d);
  }
  const consistent = divergences.length === 0;
  // Level gating: L4 is the only level that runs truly unattended, so it is the only level a
  // false green is unrecoverable by a watching human — hard-block (needs-human). ≤L3 surfaces a
  // non-blocking warn (a human is still on the loop somewhere, even if not eyeballing this run).
  const disposition = consistent ? "pass" : (input.level === "L4" ? "needs-human" : "warn");
  return { divergences, consistent, disposition };
}

// PURE: exit-code mapping (0 consistent, 1 divergence(s)) — the malformed/fail-loud exit (2) is
// decided by validateReconcileInput before this ever runs, so this fn only sees well-formed input.
function reconcileExitFor(result) {
  return result.consistent ? 0 : 1;
}

// PURE: validate a ReconcileInput's SHAPE before it is trusted. A caller-supplied malformed
// stdin (not an object, bad/missing level, non-array shipped/siblings) is exit-2 fail-loud —
// never silently coerced into an empty (vacuously-consistent) input.
function validateReconcileInput(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return "input must be a JSON object";
  if (!LEVELS.includes(input.level)) return `level ${JSON.stringify(input.level)} not in {${LEVELS.join(",")}}`;
  if (input.shipped !== undefined && !Array.isArray(input.shipped)) return "shipped must be an array";
  if (input.siblings !== undefined && !Array.isArray(input.siblings)) return "siblings must be an array";
  return null;
}

function cmdReconcile(args) {
  if (args.includes("--selftest")) return reconcileSelftest();
  const json = args.includes("--json");
  const runDirIdx = args.indexOf("--run-dir");
  const runDir = runDirIdx !== -1 ? args[runDirIdx + 1] : null;
  const levelIdx = args.indexOf("--level");
  const flagLevel = levelIdx !== -1 ? args[levelIdx + 1] : null;

  if (!runDir) { process.stderr.write("faff reconcile: --run-dir is required\n"); return 2; }
  if (!flagLevel || !LEVELS.includes(flagLevel)) {
    process.stderr.write(`faff reconcile: --level is required and must be one of {${LEVELS.join(",")}}\n`);
    return 2;
  }

  let raw;
  try { raw = fs.readFileSync(0, "utf8"); }
  catch (e) { process.stderr.write(`faff reconcile: cannot read stdin: ${e.message}\n`); return 2; }
  let input;
  try { input = JSON.parse(raw); }
  catch (e) { process.stderr.write(`faff reconcile: stdin is not valid JSON: ${e.message}\n`); return 2; }
  // --level governs when the input omits its own `level` — the CLI flag is the single source of
  // truth for the run's level (parity with merge-gate's --level), never re-derived from stdin alone.
  if (input && typeof input === "object" && !Array.isArray(input)) input.level = flagLevel;

  const err = validateReconcileInput(input);
  if (err) { process.stderr.write(`faff reconcile: malformed ReconcileInput: ${err}\n`); return 2; }

  const result = reconcileCore(input);
  // Emit the contract block in the SAME fenced-code-block form every faff producer uses
  // (```faff-contract:<name> … ```) — matches quality-gates/review-verdict's locate-by-marker
  // convention exactly, not a divergent envelope.
  const block = "```faff-contract:run-reconcile\n" + JSON.stringify(result) + "\n```";
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`reconcile: run-dir=${runDir} level=${input.level} consistent=${result.consistent} disposition=${result.disposition}`);
    for (const d of result.divergences) console.log(`  ✗ [${d.class}] ${d.issue}: ${d.detail}`);
    console.log(block);
  }
  return reconcileExitFor(result);
}

// In-memory selftest (no filesystem/network — parity with merge-gate's pure-core-only selftest):
// drives reconcileCore + validateReconcileInput across every divergence class, the consistent
// case, and both level-gating branches.
const RECONCILE_SELFTEST_CASES = [
  ["empty input → consistent, pass", { level: "L4" }, { consistent: true, disposition: "pass", divergenceClasses: [] }],
  ["shipped matches recorded+observed → consistent",
    { level: "L4", shipped: [{ issue: "FAFF-A", recorded: { pr: 1, head_sha: "abc123", merged: true, merged_at: "2026-07-11T00:00:00Z" }, observed: { pr_merged: true, merged_head_sha: "abc123" } }] },
    { consistent: true, disposition: "pass", divergenceClasses: [] }],
  ["shipped, no merge-record → claimed-shipped-unmerged (L4 needs-human)",
    { level: "L4", shipped: [{ issue: "FAFF-A", recorded: null, observed: { pr_merged: false, merged_head_sha: null } }] },
    { consistent: false, disposition: "needs-human", divergenceClasses: ["claimed-shipped-unmerged"] }],
  ["shipped, PR not merged (record present, observed false) → claimed-shipped-unmerged",
    { level: "L4", shipped: [{ issue: "FAFF-A", recorded: { pr: 1, head_sha: "abc123", merged: true, merged_at: "2026-07-11T00:00:00Z" }, observed: { pr_merged: false, merged_head_sha: null } }] },
    { consistent: false, disposition: "needs-human", divergenceClasses: ["claimed-shipped-unmerged"] }],
  ["shipped, head-sha mismatch → phantom-merge (L4 needs-human)",
    { level: "L4", shipped: [{ issue: "FAFF-A", recorded: { pr: 1, head_sha: "abc123", merged: true, merged_at: "2026-07-11T00:00:00Z" }, observed: { pr_merged: true, merged_head_sha: "def456" } }] },
    { consistent: false, disposition: "needs-human", divergenceClasses: ["phantom-merge"] }],
  ["non-admitted sibling flips terminal → unowned-sibling-mutation",
    { level: "L4", siblings: [{ issue: "FAFF-B", start_state_terminal: false, end_state_terminal: true, admitted: false }] },
    { consistent: false, disposition: "needs-human", divergenceClasses: ["unowned-sibling-mutation"] }],
  ["sibling already terminal at start → no divergence",
    { level: "L4", siblings: [{ issue: "FAFF-B", start_state_terminal: true, end_state_terminal: true, admitted: false }] },
    { consistent: true, disposition: "pass", divergenceClasses: [] }],
  ["sibling admitted later (chain-unlock) → excluded even if terminal",
    { level: "L4", siblings: [{ issue: "FAFF-B", start_state_terminal: false, end_state_terminal: true, admitted: true }] },
    { consistent: true, disposition: "pass", divergenceClasses: [] }],
  ["L3 divergence → disposition warn, not needs-human",
    { level: "L3", shipped: [{ issue: "FAFF-A", recorded: null, observed: { pr_merged: false, merged_head_sha: null } }] },
    { consistent: false, disposition: "warn", divergenceClasses: ["claimed-shipped-unmerged"] }],
  ["L1 divergence → disposition warn",
    { level: "L1", siblings: [{ issue: "FAFF-B", start_state_terminal: false, end_state_terminal: true, admitted: false }] },
    { consistent: false, disposition: "warn", divergenceClasses: ["unowned-sibling-mutation"] }],
  ["multiple divergences fold together",
    {
      level: "L4",
      shipped: [{ issue: "FAFF-A", recorded: null, observed: { pr_merged: false, merged_head_sha: null } }],
      siblings: [{ issue: "FAFF-B", start_state_terminal: false, end_state_terminal: true, admitted: false }],
    },
    { consistent: false, disposition: "needs-human", divergenceClasses: ["claimed-shipped-unmerged", "unowned-sibling-mutation"] }],
];

function reconcileSelftest() {
  let fail = 0;
  const check = (label, cond) => { if (!cond) { console.log(`FAIL ${label}`); fail++; } else console.log(`ok   ${label}`); };

  for (const [label, input, want] of RECONCILE_SELFTEST_CASES) {
    const result = reconcileCore(input);
    const gotClasses = result.divergences.map((d) => d.class);
    const ok = result.consistent === want.consistent
      && result.disposition === want.disposition
      && gotClasses.length === want.divergenceClasses.length
      && want.divergenceClasses.every((c, i) => gotClasses[i] === c)
      && reconcileExitFor(result) === (want.consistent ? 0 : 1);
    check(label, ok);
  }

  // Every divergence class is reachable (belt-and-braces over the fixture table above).
  const allClassesSeen = new Set(RECONCILE_SELFTEST_CASES.flatMap(([, , want]) => want.divergenceClasses));
  check("every DivergenceClass is exercised by the fixture table", DIVERGENCE_CLASSES.every((c) => allClassesSeen.has(c)));

  // validateReconcileInput — malformed-input classification (feeds the CLI's exit-2 fail-loud path).
  check("validate: non-object → error", !!validateReconcileInput("not an object"));
  check("validate: array → error", !!validateReconcileInput([]));
  check("validate: null → error", !!validateReconcileInput(null));
  check("validate: missing level → error", !!validateReconcileInput({}));
  check("validate: bad level → error", !!validateReconcileInput({ level: "L9" }));
  check("validate: shipped not an array → error", !!validateReconcileInput({ level: "L3", shipped: "nope" }));
  check("validate: siblings not an array → error", !!validateReconcileInput({ level: "L3", siblings: "nope" }));
  check("validate: well-formed → no error", validateReconcileInput({ level: "L3", shipped: [], siblings: [] }) === null);
  check("validate: level-only well-formed (shipped/siblings optional) → no error", validateReconcileInput({ level: "L3" }) === null);

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${RECONCILE_SELFTEST_CASES.length + 10} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  DIVERGENCE_CLASSES,
  LEVELS,
  RECONCILE_SELFTEST_CASES,
  cmdReconcile,
  reconcileCore,
  reconcileExitFor,
  reconcileSelftest,
  reconcileSibling,
  reconcileShipped,
  validateReconcileInput,
};
