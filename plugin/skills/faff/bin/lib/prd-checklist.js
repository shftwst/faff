// ===========================================================================
// === region:factory — prd-checklist — FAFF-557: read a checklist-style PRD's ===
// GFM task-list stop-conditions into the EXISTING `prd-coverage` contract shape
// (no new schema — reuses plugin/skills/faff/contracts/prd-coverage.schema.json,
// the same shape `faff prdr coverage` / `faff run-done --prd-coverage` consume).
//
// This is slice 2/3 of FAFF-551's git-only PRD gate: in git-only mode the
// orchestrator has no machine-readable PRD gate, so `faff run-done` can only
// receive `--no-prd`. A checklist PRD is machine-parseable — reading it lets
// the orchestrator pass a real `--prd-coverage` block instead.
//
// Design decision (the two-face mapping, spec §3): a checkbox carries one bit;
// prd-coverage has two faces (coverage: is a goal tracked at all; completion:
// is it actually done). Every parsed task-list item maps onto the COMPLETION
// face — `covered` is always true, `uncovered_goals` always empty — and the
// checkbox drives `completion.all_met` / `unmet_or_unverified` / `satisfied`.
// A ticked box means *done* (completion), not merely *tracked* (coverage);
// every listed checkbox is trivially tracked, so the coverage face is
// complete by construction.
//
// Governing safety constraint: NEVER a false `covered`/`satisfied`. Any
// ambiguous or unparseable input (empty file, no task-list items, a malformed
// goal) degrades to a loud non-zero exit with NO stdout block — never a block
// asserting the PRD is satisfied.
//
// Pure CLI: filesystem read of the named PRD file only. No tracker, no
// network, no subprocess, no writes — mirrors `faff prdr coverage`'s purity.
// ===========================================================================

const fs = require("node:fs");
const { schemaCheck } = require("./contract-engine");

// A goal line: optional leading whitespace, a list marker (-, *, +), whitespace,
// a checkbox [ ]/[x]/[X], then optionally-whitespace-then-label. Requires >=1
// space between the marker and `[`, per the spec's malformed-checkbox edge
// cases (`-[ ] foo` and `- [] foo` must NOT match). The label half is
// deliberately permissive (`\s*(.*)$`, zero-or-more) rather than requiring a
// mandatory separating space + >=1 label char: a bare `- [ ]` (nothing after
// the checkbox) or a trailing-whitespace-only checkbox must still MATCH as a
// task-list item (so its empty label is caught as a loud parse_error below),
// never silently fall through as "not a task-list item at all" — the
// fail-safe reading the spec's edge cases require.
const TASK_ITEM_RE = /^\s*[-*+]\s+\[([ xX])\]\s*(.*)$/;

// Code-fence delimiter: ``` or ~~~ (optionally with a trailing info string),
// at any leading indentation. Both fence kinds are tracked independently by
// their opening character so a ``` fence isn't closed by a ~~~ line or vice
// versa (GFM allows mixing, though rare in practice).
const FENCE_RE = /^\s*(```|~~~)/;

class PrdChecklistParseError extends Error {}

// --- Pure core: parse -------------------------------------------------------
// Walk the text line by line, tracking fence state, and collect every
// task-list item outside a fence as { checked, label }. Throws
// PrdChecklistParseError on a malformed goal (empty label) or when the whole
// file yields zero goals (not a checklist PRD, or vacuously so) — both are
// the fail-safe "degrade loudly, never a false satisfied" cases.
function parseChecklist(text) {
  const goals = [];
  let fenceMarker = null; // "```" | "~~~" | null
  const lines = text.split(/\r\n|\r|\n/);
  for (const line of lines) {
    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fenceMarker === null) {
        fenceMarker = marker;
      } else if (fenceMarker === marker) {
        fenceMarker = null;
      }
      // A fence delimiter line is never itself a goal, whichever way it flips.
      continue;
    }
    if (fenceMarker !== null) continue;

    const m = line.match(TASK_ITEM_RE);
    if (!m) continue;
    const mark = m[1];
    const label = m[2].trim();
    if (label === "") throw new PrdChecklistParseError("task-list item with empty label");
    const checked = mark === "x" || mark === "X";
    goals.push({ checked, label });
  }
  if (goals.length === 0) {
    throw new PrdChecklistParseError("no GFM task-list stop-conditions found — not a checklist PRD");
  }
  return goals;
}

// --- Pure core: build the prd-coverage verdict ------------------------------
// Every parsed goal is covered by construction (a checklist item is always
// tracked); checkbox state drives the completion face and the `.satisfied`
// roll-up `run-done` reads. See the module header for the two-face mapping
// rationale.
function buildCoverage(goals) {
  const unchecked = goals.filter((g) => !g.checked).map((g) => g.label);
  const allMet = unchecked.length === 0;
  const satisfied = allMet;
  const reason = satisfied ? "" : `unchecked stop-conditions: ${unchecked.join("; ")}`;
  return {
    covered: true,
    uncovered_goals: [],
    satisfied,
    reason,
    completion: { all_met: allMet, unmet_or_unverified: unchecked },
    measure: { total_goals: goals.length, covered_goals: goals.length },
    conformant: true,
    violations: [],
  };
}

// --- Command entry -----------------------------------------------------------
function cmdPrdChecklist(args) {
  if (args.includes("--selftest")) return prdChecklistSelftest();

  const path = args.find((a) => !a.startsWith("-"));
  if (!path) {
    process.stderr.write("usage: faff prd-checklist <path>\n");
    return 2;
  }

  let text;
  try {
    text = fs.readFileSync(path, "utf8");
  } catch (e) {
    process.stderr.write(`cannot read ${path}: ${e.message}\n`);
    return 2;
  }

  let goals;
  try {
    goals = parseChecklist(text);
  } catch (e) {
    if (e instanceof PrdChecklistParseError) {
      process.stderr.write(`faff prd-checklist: ${e.message}\n`);
      return 2;
    }
    throw e;
  }

  const verdict = buildCoverage(goals);

  // Belt-and-braces: the produced verdict must itself conform to the EXISTING
  // prd-coverage contract schema (no new schema introduced by this command).
  const schemaErr = schemaCheck(verdict, "prd-coverage");
  if (schemaErr) {
    process.stderr.write(`faff prd-checklist: ${schemaErr}\n`);
    return 2;
  }

  process.stdout.write(JSON.stringify(verdict) + "\n");
  return 0;
}

// --- Selftest: pure parse/build-core table (no FS beyond a readFileSync path) ---
function prdChecklistSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { fail++; console.log(`FAIL ${name}`); } else console.log(`ok   ${name}`); };

  // parseChecklist: grammar
  ok("all checked -> 3 goals, none unchecked", (() => {
    const g = parseChecklist("- [x] a\n- [X] b\n* [x] c\n");
    return g.length === 3 && g.every((x) => x.checked);
  })());
  ok("mixed checked/unchecked labels preserved in order", (() => {
    const g = parseChecklist("- [x] a\n- [ ] b\n- [ ] c\n");
    return g.map((x) => x.label).join(",") === "a,b,c" && g[0].checked && !g[1].checked && !g[2].checked;
  })());
  ok("nested task-list items are goals too (flattened)", (() => {
    const g = parseChecklist("- [x] top\n  - [ ] nested\n");
    return g.length === 2 && g[1].label === "nested" && !g[1].checked;
  })());
  ok("headers and plain bullets are not goals", (() => {
    const g = parseChecklist("# h\n- plain bullet\n- [x] real\n");
    return g.length === 1 && g[0].label === "real";
  })());
  ok("fenced (```) task-list examples are ignored", (() => {
    const g = parseChecklist("```\n- [ ] example\n```\n- [x] real\n");
    return g.length === 1 && g[0].label === "real";
  })());
  ok("fenced (~~~) task-list examples are ignored", (() => {
    const g = parseChecklist("~~~\n- [ ] example\n~~~\n- [x] real\n");
    return g.length === 1 && g[0].label === "real";
  })());
  ok("malformed checkbox tokens are not goals", (() => {
    const g = parseChecklist("- [y] no\n- [] no\n-[ ] no\n- [x] real\n");
    return g.length === 1 && g[0].label === "real";
  })());
  ok("duplicate labels kept as distinct entries", (() => {
    const g = parseChecklist("- [ ] dup\n- [ ] dup\n");
    return g.length === 2 && g[0].label === "dup" && g[1].label === "dup";
  })());
  ok("empty label raises a parse error", (() => {
    try { parseChecklist("- [ ]\n"); return false; } catch (e) { return e instanceof PrdChecklistParseError; }
  })());
  ok("whitespace-only label raises a parse error", (() => {
    try { parseChecklist("- [ ]   \n"); return false; } catch (e) { return e instanceof PrdChecklistParseError; }
  })());
  ok("zero goals raises a parse error (empty file)", (() => {
    try { parseChecklist(""); return false; } catch (e) { return e instanceof PrdChecklistParseError; }
  })());
  ok("zero goals raises a parse error (prose only)", (() => {
    try { parseChecklist("# h\nprose\n- plain\n"); return false; } catch (e) { return e instanceof PrdChecklistParseError; }
  })());

  // buildCoverage: the verdict shape
  ok("all-checked -> satisfied true, empty reason, schema-conformant", (() => {
    const v = buildCoverage([{ checked: true, label: "a" }, { checked: true, label: "b" }]);
    return v.covered === true && v.uncovered_goals.length === 0 && v.satisfied === true
      && v.completion.all_met === true && v.completion.unmet_or_unverified.length === 0
      && v.reason === "" && v.measure.total_goals === 2 && v.measure.covered_goals === 2
      && schemaCheck(v, "prd-coverage") === null;
  })());
  ok("mixed -> satisfied false, non-empty reason naming unchecked, schema-conformant", (() => {
    const v = buildCoverage([{ checked: true, label: "a" }, { checked: false, label: "b" }]);
    return v.satisfied === false && v.completion.all_met === false
      && v.completion.unmet_or_unverified.length === 1 && v.completion.unmet_or_unverified[0] === "b"
      && v.reason.includes("b") && schemaCheck(v, "prd-coverage") === null;
  })());

  const failed = fail > 0;
  console.log(failed ? `prd-checklist --selftest: FAILED (${fail})` : "prd-checklist --selftest: ok");
  return failed ? 1 : 0;
}

module.exports = { cmdPrdChecklist, parseChecklist, buildCoverage, PrdChecklistParseError };
