// FAFF-150 — model-free dry-smoke for the `modedetect` (jot/intake mode-detection) judgement-eval kind.
//
// Runs under `node --test` (free, zero frontier calls): the grader is pure, the orchestrator is driven
// by a MOCK driver emitting a fixed `faff-eval:judgement` block, and the prompt builder is PURE. The
// real `claude -p` driver is never invoked — eval/ stays out of the real-call path (the recorded
// frontier baseline is the carved human-supervised follow-up, NOT done here).
//
// Proves the three load-bearing properties of the build:
//   1. A modedetect rep grades PASS against its one-element oracle (the grade path + envelope parser
//      end-to-end via the mock model);
//   2. A missing OR out-of-enum `mode` → a clean FAIL with a distinct signature (flakiness preserved);
//   3. The six existing tidy kinds produce BYTE-IDENTICAL prompts + unchanged grades after the
//      additive family-selector de-coupling (the explicit regression guard).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  grade, validateCase, KINDS, CLOSED_SET_KINDS,
} from "../eval/grader.mjs";
import { parseJudgementEnvelope } from "../eval/envelope.mjs";
import { runEvals, loadCases } from "../eval/run-evals.mjs";
import {
  buildEvalPrompt, criteriaFor, loadModeDetectProse, MODE_EVAL_INSTRUCTION,
  EVAL_MODE_INSTRUCTION, loadJudgementCriteria, DEFAULT_PLUGIN_DIR,
} from "../eval/cli-driver.mjs";

// A mock driver: emits a fixed faff-eval:judgement block carrying whatever payload we give it.
const envOf = (id, payload) => ({
  rawText: "```faff-eval:judgement\n" + JSON.stringify({ case_id: id, ...payload }) + "\n```",
  tokens: 3,
});

const modeCase = (oracleMode) => ({
  id: "modedetect-x",
  kind: "modedetect",
  fixture: { version: 1, scenario: { user_request: "...", project_context: null, existing_workstreams: [] } },
  question: "Greenfield, single-item, or ambiguous?",
  oracle: { closed_set: [oracleMode] },
});

// --- registry: modedetect is a known, closed-set kind ---
test("modedetect is registered in KINDS and CLOSED_SET_KINDS", () => {
  assert.ok(KINDS.includes("modedetect"));
  assert.ok(CLOSED_SET_KINDS.has("modedetect"));
});

// --- validateCase: accepts modedetect with a one-element closed_set; rejects the wrong oracle field ---
test("validateCase accepts a modedetect case with a one-element closed_set oracle", () => {
  const c = modeCase("greenfield");
  assert.equal(validateCase(c), c);
});
test("validateCase rejects a modedetect case whose oracle uses gloss_rubric/ordering, not closed_set", () => {
  assert.throws(() => validateCase({ ...modeCase("greenfield"), oracle: { gloss_rubric: {} } }), /must populate exactly `closed_set`/);
  assert.throws(() => validateCase({ ...modeCase("greenfield"), oracle: { ordering: [] } }), /must populate exactly `closed_set`/);
});

// --- grade: a matching mode → PASS, sorted single-element signature ---
test("grade: a modedetect rep PASSES against its one-element oracle (each mode)", () => {
  for (const m of ["greenfield", "single-item", "ambiguous"]) {
    const env = parseJudgementEnvelope(envOf("modedetect-x", { mode: m }).rawText);
    const r = grade(modeCase(m), env);
    assert.equal(r.graded, "PASS");
    assert.equal(r.score, 1);
    assert.equal(r.signature, JSON.stringify([m]));
  }
});

// --- grade: a WRONG-but-in-enum mode → FAIL, distinct signature ---
test("grade: a modedetect rep with the wrong mode FAILS with a distinct signature", () => {
  const env = parseJudgementEnvelope(envOf("modedetect-x", { mode: "single-item" }).rawText);
  const r = grade(modeCase("greenfield"), env);
  assert.equal(r.graded, "FAIL");
  assert.equal(r.score, 0);
  assert.equal(r.signature, JSON.stringify(["single-item"]));
});

// --- grade: a MISSING mode → predicted [] → clean FAIL, distinct "[]" signature (flakiness preserved) ---
test("grade: a modedetect rep with NO mode field FAILS cleanly with the empty signature", () => {
  const env = parseJudgementEnvelope(envOf("modedetect-x", {}).rawText);
  const r = grade(modeCase("greenfield"), env);
  assert.equal(r.graded, "FAIL");
  assert.equal(r.signature, "[]");
});

// --- grade: an OUT-OF-ENUM mode → passed through verbatim → FAIL, distinct signature ---
test("grade: a modedetect rep with an out-of-enum mode FAILS with a verbatim distinct signature", () => {
  const env = parseJudgementEnvelope(envOf("modedetect-x", { mode: "feature" }).rawText);
  const r = grade(modeCase("greenfield"), env);
  assert.equal(r.graded, "FAIL");
  assert.equal(r.signature, JSON.stringify(["feature"]));
});

// --- end-to-end orchestration via the MOCK driver (no frontier calls) ---
test("runEvals end-to-end: a fixed-mode mock driver grades a modedetect case PASS + stable", async () => {
  const c = modeCase("greenfield");
  const driver = async () => envOf(c.id, { mode: "greenfield" });
  const s = await runEvals({ cases: [c], driver, baseReps: 3, maxReps: 6 });
  assert.equal(s.cases[0].accuracy, 1);
  assert.equal(s.cases[0].stability, 1);
});
test("runEvals end-to-end: a missing-mode mock driver grades a modedetect case FAIL", async () => {
  const c = modeCase("greenfield");
  const driver = async () => envOf(c.id, {}); // no mode field
  const s = await runEvals({ cases: [c], driver, baseReps: 2, maxReps: 2 });
  assert.equal(s.cases[0].accuracy, 0);
});

// --- the shipped modedetect cases load, validate, and cover all three modes ---
test("the shipped modedetect cases are valid and cover greenfield + single-item + ambiguous", () => {
  const cases = loadCases().filter((c) => c.kind === "modedetect");
  assert.ok(cases.length >= 2, "expected >=2 modedetect cases");
  for (const c of cases) {
    validateCase(c);
    assert.equal(c.oracle.closed_set.length, 1, `${c.id}: oracle must be a one-element set`);
  }
  const covered = new Set(cases.map((c) => c.oracle.closed_set[0]));
  for (const m of ["greenfield", "single-item", "ambiguous"]) {
    assert.ok(covered.has(m), `expected >=1 case covering ${m}`);
  }
});

// --- prompt builder: a modedetect prompt carries jot's verbatim rule + the mode envelope instruction ---
test("buildEvalPrompt for modedetect carries the verbatim mode rule + MODE_EVAL_INSTRUCTION", () => {
  const c = modeCase("greenfield");
  const prompt = buildEvalPrompt(c, criteriaFor("modedetect", DEFAULT_PLUGIN_DIR));
  assert.ok(prompt.includes("### 1. Detect the mode"), "verbatim jot rule must be present");
  assert.ok(prompt.includes(MODE_EVAL_INSTRUCTION.replace("<ID>", c.id)));
  assert.ok(prompt.includes('"mode": "greenfield|single-item|ambiguous"'));
});

// --- REGRESSION GUARD: the six tidy kinds produce BYTE-IDENTICAL prompts after the de-coupling ---
// criteriaFor for a tidy kind resolves to loadJudgementCriteria (unchanged), and buildEvalPrompt
// appends EVAL_MODE_INSTRUCTION (unchanged) — so a tidy prompt is exactly what it was pre-FAFF-150.
test("regression: the six tidy kinds resolve the UNCHANGED tidy criteria + instruction (byte-identical)", () => {
  const tidyCriteria = loadJudgementCriteria(DEFAULT_PLUGIN_DIR);
  for (const kind of ["dupe", "vague", "stale", "superseded", "ordering", "gloss"]) {
    // the tidy family still resolves the combined tidy criteria, NOT the mode rubric
    assert.equal(criteriaFor(kind, DEFAULT_PLUGIN_DIR), tidyCriteria, `${kind} must resolve the unchanged tidy criteria`);
    const c = { id: `${kind}-x`, kind, fixture: { version: 1, issues: [] }, question: "Q?", oracle: { closed_set: [] } };
    const prompt = buildEvalPrompt(c, tidyCriteria);
    // the tidy instruction (not the mode one) is appended verbatim
    assert.ok(prompt.endsWith(EVAL_MODE_INSTRUCTION.replace("<ID>", c.id)), `${kind} must end with EVAL_MODE_INSTRUCTION`);
    assert.ok(!prompt.includes(MODE_EVAL_INSTRUCTION.replace("<ID>", c.id)), `${kind} must NOT carry MODE_EVAL_INSTRUCTION`);
    assert.ok(prompt.includes("Run faff-tidy's judgement pass"), `${kind} keeps the tidy framing`);
  }
});

// --- REGRESSION GUARD: the six tidy kinds grade unchanged (modedetect did not perturb the grade path) ---
test("regression: a tidy `dupe` rep still grades PASS via the unchanged closed-set path", () => {
  const dupeCase = { id: "dupe-x", kind: "dupe", fixture: { version: 1, issues: [] }, question: "Q?", oracle: { closed_set: ["A", "B"] } };
  const env = parseJudgementEnvelope(envOf("dupe-x", { classifications: { dupe: ["A", "B"] } }).rawText);
  const r = grade(dupeCase, env);
  assert.equal(r.graded, "PASS");
  assert.equal(r.score, 1);
});
