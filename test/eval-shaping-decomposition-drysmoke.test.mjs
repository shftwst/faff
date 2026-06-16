// FAFF-161 — model-free dry-smoke for the `shaping` + `decomposition` generative judgement-eval kinds
// (the advisory rubric-coverage oracle FAFF-150 §7/§9 settled: a mechanical must_include/must_avoid
// coverage fraction + — for decomposition — three deterministic structural assertions over the tree).
//
// Runs under `node --test` (free, zero frontier calls): the grader is pure, the structural checker is
// pure, the orchestrator is driven by a MOCK driver emitting a fixed `faff-eval:judgement` block, and
// the prompt builders + live drivers run against a MOCK model through the REAL FAFF-93 harness (zero
// spawn). The real `claude -p` driver is never invoked — the recorded frontier baseline is the carved
// human-supervised follow-up, NOT done here.
//
// Covers the spec's SCENARIOS 1-7:
//   1. shaping coverage PASS;  2. decomposition DAG-cycle structural fail;  3. stop-rule fail;
//   4. parent-link fail;  5. malformed-envelope fail-safe (no throw);  6. advisory-judge isolation;
//   7. live dry-smoke (mock model -> live driver -> recorded bucket -> grade, no spawn).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  grade, gradeShaping, gradeDecomposition, structuralChecks, validateCase, KINDS, CLOSED_SET_KINDS, CaseError,
} from "../eval/grader.mjs";
import { parseJudgementEnvelope } from "../eval/envelope.mjs";
import { runEvals, loadCases } from "../eval/run-evals.mjs";
import {
  buildEvalPrompt, criteriaFor, loadShapingProse, loadDecompositionProse,
  SHAPING_MODE_INSTRUCTION, DECOMPOSITION_MODE_INSTRUCTION, EVAL_MODE_INSTRUCTION,
  loadJudgementCriteria, DEFAULT_PLUGIN_DIR,
} from "../eval/cli-driver.mjs";
import {
  buildShapingPrompt, buildDecompositionPrompt, shapingLiveDriver, decompositionLiveDriver,
} from "../eval/live-driver.mjs";
import { loadFixture } from "./helpers/mock-tracker.mjs";
import { seedRepo } from "./helpers/seed-repo.mjs";
import { runSkill } from "./helpers/skill-harness.mjs";

const envOf = (id, payload) => ({
  rawText: "```faff-eval:judgement\n" + JSON.stringify({ case_id: id, ...payload }) + "\n```",
  tokens: 3,
});

// --- registry: shaping + decomposition are known, NON-closed-set kinds (the gloss/splittable posture) ---
test("shaping + decomposition are in KINDS but NOT in CLOSED_SET_KINDS", () => {
  assert.ok(KINDS.includes("shaping"));
  assert.ok(KINDS.includes("decomposition"));
  assert.ok(!CLOSED_SET_KINDS.has("shaping"), "shaping is generative, not closed-set");
  assert.ok(!CLOSED_SET_KINDS.has("decomposition"), "decomposition is generative, not closed-set");
});

// --- validateCase: both kinds require the gloss_rubric oracle (exclusivity assertion reused) ---
test("validateCase requires gloss_rubric for shaping + decomposition; rejects the wrong field", () => {
  assert.doesNotThrow(() => validateCase({ id: "s", kind: "shaping", oracle: { gloss_rubric: { must_include: [["x"]] } } }));
  assert.doesNotThrow(() => validateCase({ id: "d", kind: "decomposition", oracle: { gloss_rubric: { must_include: [["x"]] } } }));
  assert.throws(() => validateCase({ id: "s", kind: "shaping", oracle: { closed_set: ["x"] } }), /must populate exactly `gloss_rubric`/);
  assert.throws(() => validateCase({ id: "d", kind: "decomposition", oracle: { ordering: ["x"] } }), /must populate exactly `gloss_rubric`/);
});

// ============================ SCENARIO 1 — shaping coverage (behavioural) ============================
test("SCENARIO 1: shaping covers both concept-sets and no must_avoid term -> score 1.0, PASS", () => {
  const c = { id: "shaping-x", kind: "shaping",
    oracle: { gloss_rubric: { must_include: [["auth", "login"], ["rate", "throttl"]], must_avoid: ["synergy"] } } };
  // a single gloss covering both must_include sets and avoiding the must_avoid term
  const env = { shaping: ["Throttle the login endpoint to rate-limit brute-force attempts"] };
  const r = grade(c, env);
  assert.equal(r.score, 1.0);
  assert.equal(r.graded, "PASS");
});

test("shaping: a missed concept-set lowers coverage -> PARTIAL (score < 1)", () => {
  const c = { id: "shaping-x", kind: "shaping",
    oracle: { gloss_rubric: { must_include: [["auth", "login"], ["rate", "throttl"]] } } };
  const r = grade(c, { shaping: ["Add a login form"] }); // covers auth, misses rate
  assert.ok(r.score < 1);
  assert.equal(r.graded, "PARTIAL");
});

test("gradeShaping reads env.shaping as a flat array OR a {id:gloss} map (mirrors gradeGloss)", () => {
  const rubric = { must_include: [["rate", "throttl"]] };
  assert.equal(gradeShaping({ shaping: ["throttle it"] }, rubric).score, 1);          // flat array
  assert.equal(gradeShaping({ shaping: { T1: "throttle it" } }, rubric).score, 1);    // {id:gloss} map
});

// ===================== SCENARIOS 2-4 — decomposition STRUCTURAL assertions (mechanical) =====================
const validTree = {
  initiatives: [{ id: "I1", title: "Build the app" }],
  projects: [{ id: "P1", parent: "I1", title: "Accounts" }, { id: "P2", parent: "I1", title: "Task lists" }],
  epics: [
    { id: "E1", parent: "P1", slice: "first-slice", title: "Sign in with email and rate-limit it" },
    { id: "E2", parent: "P2", slice: "first-slice", title: "Create a task list and add tasks" },
  ],
  deps: [["E1", "E2"]],
};

test("structuralChecks: a fully valid tree passes all three [parentLink, stopRule, dag]", () => {
  assert.deepEqual(structuralChecks(validTree), [true, true, true]);
});

test("SCENARIO 2: a dep CYCLE (A->B->A) fails the DAG assertion; score < 1, PARTIAL regardless of coverage", () => {
  const cyclic = { ...validTree, deps: [["E1", "E2"], ["E2", "E1"]] };
  assert.deepEqual(structuralChecks(cyclic), [true, true, false]);
  // even with FULL rubric coverage, the structural fail drops it below 1.0 -> PARTIAL
  const c = { id: "decomposition-x", kind: "decomposition",
    oracle: { gloss_rubric: { must_include: [["sign in", "rate"], ["task list", "task"]] } } };
  const r = grade(c, { decomposition: cyclic });
  assert.ok(r.score < 1, "a DAG violation lowers score below 1 even with full coverage");
  assert.equal(r.graded, "PARTIAL");
  assert.ok(JSON.parse(r.signature).includes(false), "the false structural assertion is visible in the vector signature");
});

test("SCENARIO 3: an epic marked beyond first-slice fails the stop-rule assertion", () => {
  const deepTree = { ...validTree, epics: [...validTree.epics, { id: "E3", parent: "P1", slice: "second-slice", title: "later work" }] };
  assert.deepEqual(structuralChecks(deepTree), [true, false, true]);
  const c = { id: "decomposition-x", kind: "decomposition", oracle: { gloss_rubric: { must_include: [["sign in"]] } } };
  assert.ok(grade(c, { decomposition: deepTree }).score < 1);
});

test("SCENARIO 4: an epic whose parent is absent from projects[].id fails the parent-link assertion", () => {
  const orphan = { ...validTree, epics: [...validTree.epics, { id: "E9", parent: "P-NONEXISTENT", slice: "first-slice", title: "orphan" }] };
  assert.deepEqual(structuralChecks(orphan), [false, true, true]);
});

test("structuralChecks: empty deps -> DAG vacuously passes (no edges, no cycle)", () => {
  assert.deepEqual(structuralChecks({ ...validTree, deps: [] }), [true, true, true]);
});

test("gradeDecomposition: a valid tree with full rubric coverage -> score 1.0, PASS", () => {
  const c = { id: "decomposition-x", kind: "decomposition",
    oracle: { gloss_rubric: { must_include: [["sign in", "rate"], ["task list", "task"]] } } };
  const r = grade(c, { decomposition: validTree });
  assert.equal(r.score, 1.0);
  assert.equal(r.graded, "PASS");
});

// =================== SCENARIO 5 — malformed envelope / tree fail-safe (never a throw) ===================
test("SCENARIO 5: a missing decomposition field -> clean low score, distinct signature, no throw", () => {
  const c = { id: "decomposition-x", kind: "decomposition", oracle: { gloss_rubric: { must_include: [["x"]] } } };
  let r;
  assert.doesNotThrow(() => { r = grade(c, {}); }); // no decomposition field
  assert.ok(r.score < 1);
  // empty coverage (the must_include misses) + structural checks fail defensively (no epics/projects/deps)
  assert.deepEqual(JSON.parse(r.signature).slice(-3), [false, false, false], "malformed tree -> all three structural assertions fail defensively");
});

test("malformed tree: non-array epics/projects/deps fail defensively, never throw", () => {
  assert.doesNotThrow(() => structuralChecks({ epics: "nope", projects: 7, deps: {} }));
  assert.deepEqual(structuralChecks({ epics: "nope", projects: 7, deps: {} }), [false, false, false]);
  // a garbage env on a shaping case -> empty glosses -> coverage 0, no throw
  const sc = { id: "shaping-x", kind: "shaping", oracle: { gloss_rubric: { must_include: [["x"]] } } };
  assert.doesNotThrow(() => grade(sc, { shaping: 12345 }));
  assert.equal(grade(sc, { shaping: 12345 }).score, 0);
});

// =================== SCENARIO 6 — advisory-judge isolation (ADR-0004) ===================
test("SCENARIO 6: an advisory LLM opinion field never alters the mechanical score", () => {
  const c = { id: "shaping-x", kind: "shaping",
    oracle: { gloss_rubric: { must_include: [["rate", "throttl"]] } } };
  const without = grade(c, { shaping: ["throttle the endpoint"] });
  const withAdvisory = grade(c, { shaping: ["throttle the endpoint"], judge_opinion: "looks great!", advisory_score: 0.2 });
  assert.equal(without.score, withAdvisory.score, "an advisory field does not change the reported coverage");
  assert.equal(withAdvisory.score, 1);
  assert.equal(without.signature, withAdvisory.signature, "the signature is computed solely from the mechanical rubric");
});

// =================== SCENARIO 7 — live dry-smoke (mock model -> live driver -> bucket -> grade) ===================
function harness() {
  const tracker = loadFixture({ version: 1, labels: [], issues: [{ id: "ISS-A", title: "x", state: "Backlog", stateCategory: "backlog" }] });
  const repo = seedRepo({ commits: [{ message: "init", files: { "README.md": "x" } }] });
  return { tracker, repo };
}
const mockModel = (payload, sink) => async (prompt) => {
  if (sink) sink.prompt = prompt;
  return "```faff-eval:judgement\n" + JSON.stringify({ case_id: "live", ...payload }) + "\n```";
};

test("SCENARIO 7a: shapingLiveDriver drives runSkill and records the shaping bucket; grades via gradeShaping", async (t) => {
  const { tracker, repo } = harness();
  t.after(() => repo.teardown());
  const fixture = { brief: "Add rate limiting to login and email on new device." };
  const driver = shapingLiveDriver({ fixture, model: mockModel({ shaping: ["Throttle the login endpoint", "Email on new-device sign-in"] }) });
  const rec = await runSkill({ skill: "faff-jot", tracker, repo, driver });
  assert.equal(rec.driver, "live");
  assert.deepEqual(rec.buckets.shaping, ["Throttle the login endpoint", "Email on new-device sign-in"]);
  assert.deepEqual(rec.trackerReads.map((r) => r.method), ["listIssues"]); // seam-faithful
  // the recorded bucket grades through gradeShaping with NO real model call
  const oracle = { id: "s", kind: "shaping", oracle: { gloss_rubric: { must_include: [["throttl"], ["email"]] } } };
  assert.equal(grade(oracle, { shaping: rec.buckets.shaping }).score, 1);
});

test("SCENARIO 7b: decompositionLiveDriver drives runSkill and records the tree; grades via gradeDecomposition (no spawn)", async (t) => {
  const { tracker, repo } = harness();
  t.after(() => repo.teardown());
  const fixture = { brief: "A team todo app: accounts, task lists, sharing." };
  const driver = decompositionLiveDriver({ fixture, model: mockModel({ decomposition: validTree }) });
  const rec = await runSkill({ skill: "faff-plot", tracker, repo, driver });
  assert.equal(rec.driver, "live");
  assert.equal(rec.skill, "faff-plot");
  // the bucket wraps the whole tree in a one-element array; unwrap items[0] for the grade
  const tree = rec.buckets.decomposition[0];
  const oracle = { id: "d", kind: "decomposition", oracle: { gloss_rubric: { must_include: [["sign in", "rate"], ["task list"]] } } };
  assert.equal(grade(oracle, { decomposition: tree }).graded, "PASS");
  // a structural-violation tree drives a PARTIAL through the same path
  const cyclic = { ...validTree, deps: [["E1", "E2"], ["E2", "E1"]] };
  const recBad = await runSkill({ skill: "faff-plot", tracker, repo, driver: decompositionLiveDriver({ fixture, model: mockModel({ decomposition: cyclic }) }) });
  assert.equal(grade(oracle, { decomposition: recBad.buckets.decomposition[0] }).graded, "PARTIAL");
});

test("SCENARIO 7c: a missing field yields an empty/low grade through the live driver, never a throw", async (t) => {
  const { tracker, repo } = harness();
  t.after(() => repo.teardown());
  const recS = await runSkill({ skill: "faff-jot", tracker, repo, driver: shapingLiveDriver({ fixture: { brief: "x" }, model: mockModel({}) }) });
  assert.deepEqual(recS.buckets.shaping, []); // empty bucket, no throw
  const recD = await runSkill({ skill: "faff-plot", tracker, repo, driver: decompositionLiveDriver({ fixture: { brief: "x" }, model: mockModel({}) }) });
  assert.deepEqual(recD.buckets.decomposition, [{}]); // empty tree wrapped, no throw
  const r = grade({ id: "d", kind: "decomposition", oracle: { gloss_rubric: { must_include: [["x"]] } } }, { decomposition: recD.buckets.decomposition[0] });
  assert.ok(r.score < 1);
});

// --- prompt builders: carry the verbatim rubric + the brief + the right envelope instruction ---
test("buildShapingPrompt carries jot's verbatim shaping rubric, the brief, and the shaping envelope", () => {
  const p = buildShapingPrompt({ brief: "Add rate limiting to login." }, { caseId: "s-x" });
  assert.ok(p.includes("### 3. Shape into tickets"), "verbatim jot shaping rubric present");
  assert.ok(p.includes("Add rate limiting to login."), "the brief is rendered");
  assert.ok(p.includes('"shaping"'), "asks for the shaping envelope field");
  assert.ok(p.includes("s-x"), "caseId threaded into the instruction");
});

test("buildDecompositionPrompt carries plot's verbatim decomposition rule, the brief, and the tree envelope", () => {
  const p = buildDecompositionPrompt({ brief: "A team todo app." }, { caseId: "d-x" });
  assert.ok(p.includes("### 2. Recurse top-down"), "verbatim plot decomposition rule present");
  assert.ok(p.includes("The stop rule"), "the stop rule prose is folded in");
  assert.ok(p.includes("A team todo app."), "the brief is rendered");
  assert.ok(p.includes('"decomposition"'), "asks for the decomposition envelope field");
  assert.ok(p.includes("d-x"));
});

test("buildShapingPrompt / buildDecompositionPrompt omit the rubric when pluginDir is null (baseline)", () => {
  assert.ok(!buildShapingPrompt({ brief: "x" }, { pluginDir: null }).includes("### 3. Shape into tickets"));
  assert.ok(!buildDecompositionPrompt({ brief: "x" }, { pluginDir: null }).includes("### 2. Recurse top-down"));
  assert.match(buildShapingPrompt({ brief: "x" }, { pluginDir: null }), /faff-eval:judgement/);
});

// --- criteriaFor + buildEvalPrompt (black-box lane) for the two kinds ---
test("criteriaFor + buildEvalPrompt wire shaping/decomposition on the black-box lane", () => {
  assert.ok(criteriaFor("shaping", DEFAULT_PLUGIN_DIR).includes("### 3. Shape into tickets"));
  assert.ok(criteriaFor("decomposition", DEFAULT_PLUGIN_DIR).includes("### 2. Recurse top-down"));
  assert.equal(criteriaFor("shaping", null), null); // baseline
  const sc = { id: "shaping-x", kind: "shaping", question: "Shape it.", fixture: { brief: "Add login rate limiting." } };
  const sp = buildEvalPrompt(sc, criteriaFor("shaping", DEFAULT_PLUGIN_DIR));
  assert.ok(sp.includes("Add login rate limiting."));
  assert.ok(sp.endsWith(SHAPING_MODE_INSTRUCTION.replace("<ID>", sc.id)));
  const dc = { id: "decomposition-x", kind: "decomposition", question: "Decompose it.", fixture: { brief: "A todo app." } };
  const dp = buildEvalPrompt(dc, criteriaFor("decomposition", DEFAULT_PLUGIN_DIR));
  assert.ok(dp.includes("A todo app."));
  assert.ok(dp.endsWith(DECOMPOSITION_MODE_INSTRUCTION.replace("<ID>", dc.id)));
});

test("loaders fail loud on a missing skill file", () => {
  assert.throws(() => loadShapingProse("/no/such/plugin"), /cannot read|SKILL\.md/);
  assert.throws(() => loadDecompositionProse("/no/such/plugin"), /cannot read|SKILL\.md/);
});

// --- end-to-end orchestration via the MOCK driver (no frontier calls) ---
test("runEvals end-to-end: a shaping mock driver grades PASS + stable", async () => {
  const c = { id: "shaping-x", kind: "shaping", fixture: { brief: "x" },
    oracle: { gloss_rubric: { must_include: [["rate", "throttl"]] } } };
  const s = await runEvals({ cases: [c], driver: async () => envOf(c.id, { shaping: ["throttle it"] }), baseReps: 3, maxReps: 6 });
  assert.equal(s.cases[0].accuracy, 1);
  assert.equal(s.cases[0].stability, 1);
  assert.ok(s.per_kind.shaping, "per_kind.shaping reported");
});

test("runEvals end-to-end: a decomposition mock driver with a valid tree grades PASS", async () => {
  const c = { id: "decomposition-x", kind: "decomposition", fixture: { brief: "x" },
    oracle: { gloss_rubric: { must_include: [["sign in", "rate"], ["task list"]] } } };
  const s = await runEvals({ cases: [c], driver: async () => envOf(c.id, { decomposition: validTree }), baseReps: 2, maxReps: 2 });
  assert.equal(s.cases[0].accuracy, 1);
});

// --- the shipped cases load, validate, and ship >=2 of each kind ---
test("the shipped shaping + decomposition cases are valid and number >=2 each", () => {
  const cases = loadCases();
  for (const k of ["shaping", "decomposition"]) {
    const ofKind = cases.filter((c) => c.kind === k);
    assert.ok(ofKind.length >= 2, `kind ${k} has <2 cases`);
    for (const c of ofKind) {
      validateCase(c);
      assert.ok(c.oracle.gloss_rubric && Array.isArray(c.oracle.gloss_rubric.must_include), `${c.id}: gloss_rubric.must_include present`);
    }
  }
});

// --- REGRESSION GUARD: the gloss kind is byte-identical (gradeShaping reuses gradeGloss but does not perturb it) ---
test("regression: a gloss case still grades through the unchanged gloss path", () => {
  const c = { id: "gloss-x", kind: "gloss", oracle: { gloss_rubric: { must_include: [["rate"]], must_avoid: ["synergy"] } } };
  assert.equal(grade(c, { gloss: { Z: "rate-limit the endpoint" } }).graded, "PASS");
  assert.ok(grade(c, { gloss: { Z: "leverage synergy" } }).score < 1);
});

// --- REGRESSION GUARD: a tidy kind's black-box prompt is unchanged (the family selector still routes it) ---
test("regression: a tidy `dupe` prompt still ends with EVAL_MODE_INSTRUCTION, not a shaping one", () => {
  const tidyCriteria = loadJudgementCriteria(DEFAULT_PLUGIN_DIR);
  const c = { id: "dupe-x", kind: "dupe", fixture: { version: 1, issues: [] }, question: "Q?", oracle: { closed_set: [] } };
  const p = buildEvalPrompt(c, tidyCriteria);
  assert.ok(p.endsWith(EVAL_MODE_INSTRUCTION.replace("<ID>", c.id)));
  assert.ok(!p.includes(SHAPING_MODE_INSTRUCTION.replace("<ID>", c.id)));
});
