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
const { parseArgs, usageError } = require("./argv");

const DIVERGENCE_CLASSES = ["phantom-merge", "claimed-shipped-unmerged", "unowned-sibling-mutation", "superseded-unproven", "sibling-check-unproven"];
const LEVELS = ["L1", "L2", "L3", "L4"];

const RECONCILE_SPEC = {
  flags: {
    "--selftest": { arity: 0 },
    "--json": { arity: 0 },
    "--run-dir": { arity: 1 },
    "--level": { arity: 1, enum: LEVELS },
  },
};
const RECONCILE_USAGE = "usage: faff reconcile --run-dir DIR --level L1|L2|L3|L4 [--json]  (reads a ReconcileInput JSON on stdin)";

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

// PURE: classify one `superseded` ledger outcome (FAFF-571) against its recorded supersession
// evidence (supersession.json, written by a future producer — FAFF-573) + the orchestrator's
// live-observed delivery state of the named delivering tickets. Fail-closed, mirroring
// reconcileShipped: absence of proof is a divergence, never a silent pass. Consistent iff the
// evidence names >=1 delivering ticket AND the orchestrator observed all of them delivered.
function reconcileSuperseded(s) {
  const issue = s && s.issue;
  const recorded = s && s.recorded ? s.recorded : null;
  const observed = (s && s.observed) || {};
  if (!recorded || !Array.isArray(recorded.superseded_by) || recorded.superseded_by.length === 0
    || !recorded.superseded_by.every((t) => typeof t === "string" && t !== "")) {
    return {
      class: "superseded-unproven",
      issue,
      detail: "superseded claim with no/invalid supersession.json evidence",
      rollback_proposal: null,
    };
  }
  if (observed.all_delivered !== true) {
    return {
      class: "superseded-unproven",
      issue,
      detail: "named delivering tickets not verifiably delivered on main",
      rollback_proposal: null,
    };
  }
  return null;
}

// PURE: a non-admitted, spec-referenced sibling that flipped INTO a terminal state during the
// run's window. The run never admitted it, and no actor field exists on a tracker state
// transition to say who moved it — a parallel run's claimed-by-peer close and a human editing
// the board mid-run both look identical to this check. So this reports the fact of an
// unattributable terminal move, not a claim that the run caused it. A sibling admitted later in
// the same run (chain-unlock) is excluded by construction (admitted:true is never passed for it).
function reconcileSibling(sib) {
  if (sib && sib.end_state_terminal && !sib.start_state_terminal && !sib.admitted) {
    return {
      class: "unowned-sibling-mutation",
      issue: sib.issue,
      detail:
        "a spec-referenced non-admitted sibling moved terminal within the run's window; this run cannot attribute it to any actor",
      rollback_proposal: null,
    };
  }
  return null;
}

// PURE (FAFF-680): classify the run-level `sibling_baseline` attestation. Absence — the field is
// missing, or `captured` is anything other than the strict boolean `true` — reads as "the sibling
// check did not run", never as a vacuous pass. This catches OMISSION, not fabrication: with zero
// siblings the coherence check below is `entry_count(0) >= siblings.length(0)`, so a caller that
// asserts `captured: true` without ever reading the baseline file produces the same shape as a
// genuine empty run. It proves the assembler AFFIRMED it read the file, not that it actually did —
// no field on a self-reported input could prove the latter. The divergence carries `issue: null`
// (run-level, not tied to any one issue) — the first divergence class to do so.
function reconcileSiblingBaseline(input) {
  const baseline = input && input.sibling_baseline;
  if (baseline && typeof baseline === "object" && baseline.captured === true) return null;
  return {
    class: "sibling-check-unproven",
    issue: null,
    detail: "no sibling baseline attested — the unowned-sibling-mutation check did not run",
    rollback_proposal: null,
  };
}

// PURE assertion core (FAFF-397 spec §4 `reconcile_core`). Deterministic; no model judgement —
// the caller gathers evidence, this only classifies it. Empty `shipped`/`superseded` input is
// vacuously consistent for THOSE arrays (a run that shipped/superseded nothing has nothing to
// diverge on there) — but the sibling half is NOT vacuous under a merely-empty `siblings[]`
// (FAFF-680): that array's emptiness is indistinguishable from "the check never ran" unless the
// caller also attests capture via `sibling_baseline`, so an absent/non-true attestation always
// contributes a `sibling-check-unproven` divergence, even with zero shipped/superseded/siblings.
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
  const siblingBaselineDivergence = reconcileSiblingBaseline(input);
  if (siblingBaselineDivergence) divergences.push(siblingBaselineDivergence);
  for (const s of (Array.isArray(input.superseded) ? input.superseded : [])) {
    const d = reconcileSuperseded(s);
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
// stdin (not an object, bad/missing level, non-array shipped/siblings, or an ELEMENT that isn't an
// object carrying a non-empty string `issue`) is exit-2 fail-loud — never silently coerced into a
// wrongly-shaped input that reaches the core anyway, and never a degenerate `issue: undefined`
// divergence (FAFF-397 review; an empty-but-well-formed input is NOT vacuously consistent post
// FAFF-680 — see `reconcileSiblingBaseline`). Deliberately does NOT require `recorded`/`observed`/state flags on the
// elements: a missing `recorded` is the spec's fail-CLOSED path (→ claimed-shipped-unmerged
// divergence, HOW edge case), so it must reach the core, not be rejected here.
function validateReconcileInput(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return "input must be a JSON object";
  if (!LEVELS.includes(input.level)) return `level ${JSON.stringify(input.level)} not in {${LEVELS.join(",")}}`;
  if (input.shipped !== undefined && !Array.isArray(input.shipped)) return "shipped must be an array";
  if (input.siblings !== undefined && !Array.isArray(input.siblings)) return "siblings must be an array";
  if (input.superseded !== undefined && !Array.isArray(input.superseded)) return "superseded must be an array";
  const isNamedEntry = (e) => e !== null && typeof e === "object" && !Array.isArray(e) && typeof e.issue === "string" && e.issue !== "";
  for (const [i, s] of (Array.isArray(input.shipped) ? input.shipped : []).entries()) {
    if (!isNamedEntry(s)) return `shipped[${i}] must be an object with a non-empty string "issue"`;
  }
  for (const [i, sib] of (Array.isArray(input.siblings) ? input.siblings : []).entries()) {
    if (!isNamedEntry(sib)) return `siblings[${i}] must be an object with a non-empty string "issue"`;
  }
  // FAFF-571: element-shape validation mirrors `shipped[...]` exactly — only `issue` is
  // required (non-empty string); `recorded`/`observed` are deliberately NOT required, since
  // a missing `recorded` is the fail-closed path (-> superseded-unproven) and must reach
  // the core, exactly as a missing `shipped[].recorded` does.
  for (const [i, s] of (Array.isArray(input.superseded) ? input.superseded : []).entries()) {
    if (!isNamedEntry(s)) return `superseded[${i}] must be an object with a non-empty string "issue"`;
  }
  // FAFF-680: `sibling_baseline` shape validation — only fires on a CLAIMED capture
  // (`captured === true`); anything else (absent, `false`, `null`, a stray string) is the
  // degraded not-captured reading `reconcileSiblingBaseline` decides, never a shape fault here.
  // A claim of capture that is internally incoherent — `entry_count` not a non-negative integer,
  // or fewer entries than the `siblings[]` the same input carries — is exit-2 malformed input:
  // the file already draws this line elsewhere (shape faults here, missing evidence in the core).
  if (input.sibling_baseline !== undefined && input.sibling_baseline !== null) {
    const baseline = input.sibling_baseline;
    if (typeof baseline !== "object" || Array.isArray(baseline)) return "sibling_baseline must be an object";
    if (baseline.captured === true) {
      const count = baseline.entry_count;
      const siblingsLen = Array.isArray(input.siblings) ? input.siblings.length : 0;
      if (!Number.isInteger(count) || count < 0) return "sibling_baseline.entry_count must be a non-negative integer when captured is true";
      if (count < siblingsLen) return `sibling_baseline.entry_count (${count}) is less than siblings.length (${siblingsLen})`;
    }
  }
  return null;
}

function cmdReconcile(args) {
  if (args.includes("--selftest")) return reconcileSelftest();
  const { values, errors } = parseArgs(args, RECONCILE_SPEC);
  if (errors.length) return usageError(errors, RECONCILE_USAGE);
  const json = !!values["--json"];
  const runDir = values["--run-dir"] || null;
  const flagLevel = values["--level"] || null;

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
  // --level governs the run's level (parity with merge-gate's --level). When stdin omits `level`,
  // the flag supplies it. When stdin CARRIES a `level` that CONTRADICTS the flag, that is a caller
  // bug → fail-loud (exit 2), never a silent overwrite — a looser stdin level silently winning
  // would flip the level-gating (needs-human vs warn) fail-OPEN, the exact direction the spec's
  // "fail-closed, never a silent green" principle forbids (mirrors merge-gate's resolveGateLevel
  // mismatch refusal, FAFF-397 review). A stdin level that AGREES, or is absent, is fine.
  if (input && typeof input === "object" && !Array.isArray(input)) {
    if (input.level !== undefined && input.level !== flagLevel) {
      process.stderr.write(`faff reconcile: stdin level ${JSON.stringify(input.level)} contradicts --level ${JSON.stringify(flagLevel)} — drop the stdin level or pass --level ${JSON.stringify(input.level)}\n`);
      return 2;
    }
    input.level = flagLevel;
  }

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
    // FAFF-680: a run-level divergence (e.g. sibling-check-unproven) carries `issue: null` —
    // render "run" rather than the literal "null" so the line reads as run-level, not a
    // malformed issue id.
    for (const d of result.divergences) console.log(`  ✗ [${d.class}] ${d.issue === null ? "run" : d.issue}: ${d.detail}`);
    console.log(block);
  }
  return reconcileExitFor(result);
}

// In-memory selftest (no filesystem/network — parity with merge-gate's pure-core-only selftest):
// drives reconcileCore + validateReconcileInput across every divergence class, the consistent
// case, and both level-gating branches.
// FAFF-680: default-degraded MIGRATION, not an addition. No fixture below carried
// `sibling_baseline` before this change, so under default-degraded every one of them gains a
// `sibling-check-unproven` divergence — pushed after any `siblings[]` classification and before
// any `superseded[]` classification (`reconcileCore`'s push order). Five fixtures that asserted
// `consistent: true` flip to a divergence; the rest get an extra, positionally-correct entry in
// `divergenceClasses`. New fixtures covering the attested-good path, and the absent/malformed
// `sibling_baseline` shapes, are appended after the migrated table.
const RECONCILE_SELFTEST_CASES = [
  ["empty input, no sibling_baseline attestation → sibling-check-unproven (L4 needs-human)",
    { level: "L4" },
    { consistent: false, disposition: "needs-human", divergenceClasses: ["sibling-check-unproven"] }],
  ["shipped matches recorded+observed, no attestation → sibling-check-unproven (L4 needs-human)",
    { level: "L4", shipped: [{ issue: "FAFF-A", recorded: { pr: 1, head_sha: "abc123", merged: true, merged_at: "2026-07-11T00:00:00Z" }, observed: { pr_merged: true, merged_head_sha: "abc123" } }] },
    { consistent: false, disposition: "needs-human", divergenceClasses: ["sibling-check-unproven"] }],
  ["shipped, no merge-record → claimed-shipped-unmerged + sibling-check-unproven (L4 needs-human)",
    { level: "L4", shipped: [{ issue: "FAFF-A", recorded: null, observed: { pr_merged: false, merged_head_sha: null } }] },
    { consistent: false, disposition: "needs-human", divergenceClasses: ["claimed-shipped-unmerged", "sibling-check-unproven"] }],
  ["shipped, PR not merged (record present, observed false) → claimed-shipped-unmerged + sibling-check-unproven",
    { level: "L4", shipped: [{ issue: "FAFF-A", recorded: { pr: 1, head_sha: "abc123", merged: true, merged_at: "2026-07-11T00:00:00Z" }, observed: { pr_merged: false, merged_head_sha: null } }] },
    { consistent: false, disposition: "needs-human", divergenceClasses: ["claimed-shipped-unmerged", "sibling-check-unproven"] }],
  ["shipped, head-sha mismatch → phantom-merge + sibling-check-unproven (L4 needs-human)",
    { level: "L4", shipped: [{ issue: "FAFF-A", recorded: { pr: 1, head_sha: "abc123", merged: true, merged_at: "2026-07-11T00:00:00Z" }, observed: { pr_merged: true, merged_head_sha: "def456" } }] },
    { consistent: false, disposition: "needs-human", divergenceClasses: ["phantom-merge", "sibling-check-unproven"] }],
  ["non-admitted sibling flips terminal, no attestation → unowned-sibling-mutation + sibling-check-unproven",
    { level: "L4", siblings: [{ issue: "FAFF-B", start_state_terminal: false, end_state_terminal: true, admitted: false }] },
    { consistent: false, disposition: "needs-human", divergenceClasses: ["unowned-sibling-mutation", "sibling-check-unproven"] }],
  ["sibling already terminal at start, no attestation → sibling-check-unproven (L4 needs-human)",
    { level: "L4", siblings: [{ issue: "FAFF-B", start_state_terminal: true, end_state_terminal: true, admitted: false }] },
    { consistent: false, disposition: "needs-human", divergenceClasses: ["sibling-check-unproven"] }],
  ["sibling admitted later (chain-unlock), no attestation → excluded from unowned-mutation, still sibling-check-unproven",
    { level: "L4", siblings: [{ issue: "FAFF-B", start_state_terminal: false, end_state_terminal: true, admitted: true }] },
    { consistent: false, disposition: "needs-human", divergenceClasses: ["sibling-check-unproven"] }],
  ["L3 divergence → disposition warn, not needs-human",
    { level: "L3", shipped: [{ issue: "FAFF-A", recorded: null, observed: { pr_merged: false, merged_head_sha: null } }] },
    { consistent: false, disposition: "warn", divergenceClasses: ["claimed-shipped-unmerged", "sibling-check-unproven"] }],
  ["L1 divergence → disposition warn",
    { level: "L1", siblings: [{ issue: "FAFF-B", start_state_terminal: false, end_state_terminal: true, admitted: false }] },
    { consistent: false, disposition: "warn", divergenceClasses: ["unowned-sibling-mutation", "sibling-check-unproven"] }],
  ["multiple divergences fold together",
    {
      level: "L4",
      shipped: [{ issue: "FAFF-A", recorded: null, observed: { pr_merged: false, merged_head_sha: null } }],
      siblings: [{ issue: "FAFF-B", start_state_terminal: false, end_state_terminal: true, admitted: false }],
    },
    { consistent: false, disposition: "needs-human", divergenceClasses: ["claimed-shipped-unmerged", "unowned-sibling-mutation", "sibling-check-unproven"] }],
  // FAFF-571 — superseded (premise-supersession terminal outcome).
  ["superseded, evidence + all delivered, no attestation → sibling-check-unproven (L4 needs-human)",
    { level: "L4", superseded: [{ issue: "FAFF-551", recorded: { issue: "FAFF-551", superseded_by: ["FAFF-556", "FAFF-557", "FAFF-559"] }, observed: { all_delivered: true } }] },
    { consistent: false, disposition: "needs-human", divergenceClasses: ["sibling-check-unproven"] }],
  ["superseded, no supersession.json (recorded null) → sibling-check-unproven + superseded-unproven (L4 needs-human)",
    { level: "L4", superseded: [{ issue: "FAFF-551", recorded: null, observed: { all_delivered: false } }] },
    { consistent: false, disposition: "needs-human", divergenceClasses: ["sibling-check-unproven", "superseded-unproven"] }],
  ["superseded, empty superseded_by → sibling-check-unproven + superseded-unproven",
    { level: "L4", superseded: [{ issue: "FAFF-551", recorded: { issue: "FAFF-551", superseded_by: [] }, observed: { all_delivered: true } }] },
    { consistent: false, disposition: "needs-human", divergenceClasses: ["sibling-check-unproven", "superseded-unproven"] }],
  ["superseded, observed.all_delivered false → sibling-check-unproven + superseded-unproven",
    { level: "L4", superseded: [{ issue: "FAFF-551", recorded: { issue: "FAFF-551", superseded_by: ["FAFF-556"] }, observed: { all_delivered: false } }] },
    { consistent: false, disposition: "needs-human", divergenceClasses: ["sibling-check-unproven", "superseded-unproven"] }],
  ["L3 superseded-unproven → disposition warn, not needs-human",
    { level: "L3", superseded: [{ issue: "FAFF-551", recorded: null, observed: { all_delivered: false } }] },
    { consistent: false, disposition: "warn", divergenceClasses: ["sibling-check-unproven", "superseded-unproven"] }],
  // FAFF-680 — the attested-good path, and the absent/malformed sibling_baseline shapes.
  ["attested capture, zero siblings → genuinely consistent (the honest clean shape)",
    { level: "L4", siblings: [], sibling_baseline: { captured: true, entry_count: 0 } },
    { consistent: true, disposition: "pass", divergenceClasses: [] }],
  ["attestation absent at L3 → sibling-check-unproven, warn (not needs-human)",
    { level: "L3" },
    { consistent: false, disposition: "warn", divergenceClasses: ["sibling-check-unproven"] }],
  ["captured:true with populated siblings[], one flips terminal → exactly one unowned-sibling-mutation, no sibling-check-unproven",
    {
      level: "L4",
      siblings: [{ issue: "FAFF-B", start_state_terminal: false, end_state_terminal: true, admitted: false }],
      sibling_baseline: { captured: true, entry_count: 1 },
    },
    { consistent: false, disposition: "needs-human", divergenceClasses: ["unowned-sibling-mutation"] }],
  ["captured: \"true\" (string, not boolean) → not-captured, sibling-check-unproven",
    { level: "L4", siblings: [], sibling_baseline: { captured: "true", entry_count: 0 } },
    { consistent: false, disposition: "needs-human", divergenceClasses: ["sibling-check-unproven"] }],
  ["captured:true does not suppress a genuine divergence → both classes fold together, no sibling-check-unproven",
    {
      level: "L4",
      shipped: [{ issue: "FAFF-A", recorded: null, observed: { pr_merged: false, merged_head_sha: null } }],
      siblings: [{ issue: "FAFF-B", start_state_terminal: false, end_state_terminal: true, admitted: false }],
      sibling_baseline: { captured: true, entry_count: 1 },
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
  check("validate: superseded not an array → error (FAFF-571)", !!validateReconcileInput({ level: "L3", superseded: "nope" }));
  check("validate: well-formed → no error", validateReconcileInput({ level: "L3", shipped: [], siblings: [] }) === null);
  check("validate: level-only well-formed (shipped/siblings optional) → no error", validateReconcileInput({ level: "L3" }) === null);
  // Element-shape validation (FAFF-397 review — no degenerate issue:undefined divergence).
  check("validate: shipped[null] → error", !!validateReconcileInput({ level: "L3", shipped: [null] }));
  check("validate: shipped entry with no issue → error", !!validateReconcileInput({ level: "L3", shipped: [{ recorded: null, observed: {} }] }));
  check("validate: shipped entry with empty issue → error", !!validateReconcileInput({ level: "L3", shipped: [{ issue: "" }] }));
  check("validate: shipped entry that is a string → error", !!validateReconcileInput({ level: "L3", shipped: ["FAFF-A"] }));
  check("validate: sibling entry with no issue → error", !!validateReconcileInput({ level: "L3", siblings: [{ start_state_terminal: false, end_state_terminal: true, admitted: false }] }));
  // A well-formed shipped entry missing `recorded` is NOT rejected — it is the spec's fail-closed
  // path (→ claimed-shipped-unmerged divergence), so validation must let it reach the core.
  check("validate: shipped entry missing recorded (fail-closed path) → no error", validateReconcileInput({ level: "L3", shipped: [{ issue: "FAFF-A", observed: { pr_merged: false } }] }) === null);
  // FAFF-571: superseded[] element-shape validation mirrors shipped[] exactly.
  check("validate: superseded[null] → error", !!validateReconcileInput({ level: "L3", superseded: [null] }));
  check("validate: superseded entry with no issue → error", !!validateReconcileInput({ level: "L3", superseded: [{ recorded: null, observed: {} }] }));
  check("validate: superseded entry with empty issue → error", !!validateReconcileInput({ level: "L3", superseded: [{ issue: "" }] }));
  check("validate: superseded entry that is a string → error", !!validateReconcileInput({ level: "L3", superseded: ["FAFF-551"] }));
  // A well-formed superseded entry missing `recorded` is NOT rejected — it is the fail-closed
  // path (→ superseded-unproven divergence), so validation must let it reach the core.
  check("validate: superseded entry missing recorded (fail-closed path) → no error", validateReconcileInput({ level: "L3", superseded: [{ issue: "FAFF-551", observed: { all_delivered: false } }] }) === null);

  // FAFF-680: sibling_baseline shape validation — a claimed capture (`captured: true`) whose
  // entry_count is incoherent with siblings.length is exit-2 malformed input, not a divergence.
  check("validate: captured:true, entry_count 0 with two siblings entries → error",
    !!validateReconcileInput({ level: "L3", siblings: [{ issue: "FAFF-A" }, { issue: "FAFF-B" }], sibling_baseline: { captured: true, entry_count: 0 } }));
  check("validate: captured:true, entry_count -1 → error",
    !!validateReconcileInput({ level: "L3", sibling_baseline: { captured: true, entry_count: -1 } }));
  check("validate: captured:true, entry_count \"3\" (string) → error",
    !!validateReconcileInput({ level: "L3", sibling_baseline: { captured: true, entry_count: "3" } }));
  check("validate: captured:true, entry_count 3 with two siblings entries → no error (chain-unlock drop-out is legal)",
    validateReconcileInput({ level: "L3", siblings: [{ issue: "FAFF-A" }, { issue: "FAFF-B" }], sibling_baseline: { captured: true, entry_count: 3 } }) === null);
  check("validate: sibling_baseline absent → no error (a degraded verdict, not a shape fault)",
    validateReconcileInput({ level: "L3" }) === null);

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${RECONCILE_SELFTEST_CASES.length + 27} cases, ${fail} failed)`);
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
  reconcileSiblingBaseline,
  reconcileShipped,
  reconcileSuperseded,
  validateReconcileInput,
};
