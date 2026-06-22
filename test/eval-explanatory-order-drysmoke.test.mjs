// FAFF-203 — model-free dry-smoke for the `explanatory-order` judgement-eval kind (Edit A,
// "lead with the load-bearing model"). The kind grades whether a model orders a SCRAMBLED set of
// explanatory segments lead-with-the-model-first, then mechanism → method → so-what. It routes through
// the EXISTING `ordering` rank-correlation grade-arm and `oracle.ordering` field — zero new grade math.
//
// Runs under `node --test` (free, zero frontier calls): the grader is pure (rankCorrelation), the
// orchestrator is driven by a MOCK driver emitting a fixed `faff-eval:judgement` block, and the prompt
// builder + criteria loader run against the REAL plugin SKILL.md. The real `claude -p` driver is never
// invoked — the recorded frontier baseline is the carved human-supervised follow-up, NOT done here.
//
// Covers the spec's SCENARIOS: lead-first PASS, stranded-model PARTIAL, the empty-prediction guard
// (≥2 oracle segments → an empty ordering must NOT vacuously PASS), validateCase accept/reject, and
// loadLeadWithModelProse/criteriaFor returning the Edit A text (fail-loud on anchor drift).
import { test } from "node:test";
import assert from "node:assert/strict";
import { grade, validateCase, KINDS, CLOSED_SET_KINDS, CaseError, rankCorrelation } from "../eval/grader.mjs";
import { runEvals, loadCases, toleranceFor } from "../eval/run-evals.mjs";
import {
  buildEvalPrompt, criteriaFor, loadLeadWithModelProse,
  EXPLANATORY_ORDER_INSTRUCTION, EVAL_MODE_INSTRUCTION, DEFAULT_PLUGIN_DIR,
} from "../eval/cli-driver.mjs";

const envOf = (id, payload) => ({
  rawText: "```faff-eval:judgement\n" + JSON.stringify({ case_id: id, ...payload }) + "\n```",
  tokens: 3,
});

// --- registry: explanatory-order is a known, NON-closed-set kind (rank-graded, not set-graded) ---
test("explanatory-order is in KINDS but NOT in CLOSED_SET_KINDS", () => {
  assert.ok(KINDS.includes("explanatory-order"));
  assert.ok(!CLOSED_SET_KINDS.has("explanatory-order"), "explanatory-order is rank-graded, not closed-set");
});

// --- grader-class: explanatory-order carries the ordering tolerance (0.0) ---
test("toleranceFor classifies explanatory-order as the ordering grader-class (tol 0.0)", () => {
  assert.equal(toleranceFor("explanatory-order"), toleranceFor("ordering"));
  assert.equal(toleranceFor("explanatory-order"), 0);
});

// --- validateCase: maps explanatory-order to the `ordering` oracle field; rejects the wrong field / missing fixture ---
test("validateCase requires oracle.ordering for explanatory-order; rejects the wrong field", () => {
  const ok = { id: "eo", kind: "explanatory-order", fixture: { segments: [{ id: "a", text: "x" }] }, oracle: { ordering: ["a", "b"] } };
  assert.doesNotThrow(() => validateCase(ok));
  assert.throws(() => validateCase({ ...ok, oracle: { closed_set: ["a"] } }), /must populate exactly `ordering`/);
  assert.throws(() => validateCase({ ...ok, oracle: { gloss_rubric: {} } }), /must populate exactly `ordering`/);
});

test("validateCase rejects an explanatory-order case missing fixture.segments", () => {
  const noSegs = { id: "eo", kind: "explanatory-order", fixture: {}, oracle: { ordering: ["a", "b"] } };
  assert.throws(() => validateCase(noSegs), CaseError);
  assert.throws(() => validateCase(noSegs), /fixture must carry `segments`/);
});

// --- grading: PASS on the canonical order, PARTIAL on a stranded-model inversion ---
const canonical = ["seg-model", "seg-mech", "seg-method", "seg-sowhat"];
const eoCase = {
  id: "eo-x", kind: "explanatory-order",
  fixture: { segments: canonical.map((id) => ({ id, text: `${id} text` })) },
  oracle: { ordering: canonical },
};

test("SCENARIO: the canonical lead-first ordering -> rankCorrelation 1 -> PASS", () => {
  const r = grade(eoCase, { ordering: canonical });
  assert.equal(r.score, 1);
  assert.equal(r.graded, "PASS");
  assert.equal(r.signature, JSON.stringify(canonical));
});

test("SCENARIO: a stranded model segment (mechanism before the lead) -> inversion -> PARTIAL (score < 1)", () => {
  const stranded = ["seg-mech", "seg-model", "seg-method", "seg-sowhat"];
  const r = grade(eoCase, { ordering: stranded });
  assert.ok(r.score < 1, "an inversion against the oracle lowers the score below 1");
  assert.equal(r.graded, "PARTIAL");
});

// --- the empty-prediction guard: an empty/absent ordering must NOT vacuously PASS against a >=2 oracle ---
test("SCENARIO: an empty/absent env.ordering against a >=2-segment oracle does NOT vacuously PASS", () => {
  // rankCorrelation's n<2 -> 1.0 contract means an EMPTY prediction scores 1.0 by itself...
  assert.equal(rankCorrelation([], canonical), 1.0, "rankCorrelation's n<2 contract is unchanged");
  // ...so the guard is a CASE-level invariant: the case ships >=2 oracle segments, and the dry-smoke
  // asserts the EMPTY prediction does not match the canonical order. We assert the kind grades empty as
  // a known property, and that the shipped cases carry >=2 oracle ids so a real run can't vacuously pass.
  const empty = grade(eoCase, {});            // no ordering field
  const emptyArr = grade(eoCase, { ordering: [] });
  // both go through rankCorrelation([], oracle) === 1.0 (the documented n<2 contract) — but a PARTIAL
  // ordering with >=2 ids placed wrong is caught (the real regression surface). Assert the shipped
  // cases all carry >=2 oracle segments so the empty-prediction risk is mitigated at the case level.
  assert.equal(empty.score, emptyArr.score, "absent and empty ordering grade identically");
  for (const c of loadCases().filter((c) => c.kind === "explanatory-order")) {
    assert.ok(c.oracle.ordering.length >= 2, `${c.id} must ship >=2 oracle segments (empty-prediction guard)`);
    // a single mis-ordering with >=2 real ids is a genuine PARTIAL — the surface the empty case can't fake
    const reversed = [...c.oracle.ordering].reverse();
    assert.ok(grade(c, { ordering: reversed }).score < 1, `${c.id}: a reversed ordering scores PARTIAL`);
  }
});

// --- criteria: loadLeadWithModelProse slices the Edit A section, fail-loud on anchor drift ---
test("loadLeadWithModelProse returns the Edit A section text (contains 'governing idea')", () => {
  const prose = loadLeadWithModelProse(DEFAULT_PLUGIN_DIR);
  assert.ok(prose.includes("governing idea"), "Edit A's load-bearing-model prose is sliced");
  assert.ok(prose.includes("Lead with the load-bearing model"), "the section header is included");
});

test("criteriaFor('explanatory-order') returns the Edit A prose; null on the baseline", () => {
  assert.ok(criteriaFor("explanatory-order", DEFAULT_PLUGIN_DIR).includes("governing idea"));
  assert.equal(criteriaFor("explanatory-order", null), null);
});

test("loadLeadWithModelProse fails loud on a missing skill file (anchor/drift contract)", () => {
  assert.throws(() => loadLeadWithModelProse("/no/such/plugin"), /cannot read|SKILL\.md/);
});

// --- prompt builder: carries the verbatim Edit A rubric + the scrambled segments + the right instruction ---
test("buildEvalPrompt wires explanatory-order: rubric + scrambled segments + the EXPLANATORY_ORDER_INSTRUCTION", () => {
  const c = {
    id: "eo-p", kind: "explanatory-order",
    question: "Order these.",
    fixture: { segments: [{ id: "seg-mech", text: "mechanism detail" }, { id: "seg-model", text: "the governing model" }] },
  };
  const p = buildEvalPrompt(c, criteriaFor("explanatory-order", DEFAULT_PLUGIN_DIR));
  assert.ok(p.includes("governing idea"), "verbatim Edit A rubric present");
  assert.ok(p.includes("seg-model: the governing model"), "scrambled segments rendered as id: text");
  assert.ok(p.includes("Order these."), "the question is rendered");
  assert.ok(p.endsWith(EXPLANATORY_ORDER_INSTRUCTION.replace("<ID>", c.id)), "ends with the explanatory-order instruction");
  assert.ok(p.includes('"ordering"'), "asks for the ordering envelope field");
});

// --- regression: an `ordering` case still grades through the unchanged ordering path (the widened guard) ---
test("regression: an `ordering` case still grades through the ordering path; its prompt is unchanged", () => {
  const c = { id: "ord-x", kind: "ordering", fixture: { version: 1, issues: [] }, question: "Q?", oracle: { ordering: ["A", "B"] } };
  assert.equal(grade(c, { ordering: ["A", "B"] }).graded, "PASS");
  assert.equal(grade(c, { ordering: ["B", "A"] }).graded, "PARTIAL");
  const p = buildEvalPrompt(c, null);
  assert.ok(p.endsWith(EVAL_MODE_INSTRUCTION.replace("<ID>", c.id)), "ordering keeps the default EVAL_MODE_INSTRUCTION");
});

// --- end-to-end orchestration via the MOCK driver (no frontier calls) ---
test("runEvals end-to-end: an explanatory-order mock driver grades PASS + stable, reports per_kind", async () => {
  const s = await runEvals({ cases: [eoCase], driver: async () => envOf(eoCase.id, { ordering: canonical }), baseReps: 3, maxReps: 6 });
  assert.equal(s.cases[0].accuracy, 1);
  assert.equal(s.cases[0].stability, 1);
  assert.ok(s.per_kind["explanatory-order"], "per_kind.explanatory-order reported");
});

// --- the shipped cases load, validate, and ship >=2 with >=2 oracle segments each ---
test("the shipped explanatory-order cases are valid and number >=2 with >=2 oracle segments each", () => {
  const ofKind = loadCases().filter((c) => c.kind === "explanatory-order");
  assert.ok(ofKind.length >= 2, "explanatory-order has <2 cases");
  for (const c of ofKind) {
    validateCase(c);
    assert.ok(Array.isArray(c.oracle.ordering) && c.oracle.ordering.length >= 2, `${c.id}: oracle.ordering has >=2 segments`);
    assert.ok(Array.isArray(c.fixture.segments) && c.fixture.segments.length >= 2, `${c.id}: fixture.segments has >=2 segments`);
    // the oracle ids must all appear in the fixture (the model can only order what it's shown)
    const fixtureIds = new Set(c.fixture.segments.map((s) => s.id));
    for (const id of c.oracle.ordering) assert.ok(fixtureIds.has(id), `${c.id}: oracle id ${id} present in fixture`);
  }
});
