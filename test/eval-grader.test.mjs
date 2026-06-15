// FAFF-130 — deterministic tests for the judgement-eval harness.
// Runs under `node --test` (free, zero frontier calls): the grader is pure, and the
// orchestrator is driven by a MOCK driver. The real frontier-driver.mjs is never imported.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  grade, gradeGloss, rankCorrelation, aggregateCase, validateCase, hasDisagreement, erroredRep, CaseError,
} from "../eval/grader.mjs";
import { parseJudgementEnvelope, EnvelopeError } from "../eval/envelope.mjs";
import { runEvals, loadCases } from "../eval/run-evals.mjs";

// --- envelope: parse + fail-loud (spec: malformed envelope is never silently passed) ---
test("envelope parses a valid faff-eval:judgement block", () => {
  const raw = 'prose...\n```faff-eval:judgement\n{ "case_id": "x", "classifications": { "dupe": ["A"] } }\n```\nmore';
  assert.deepEqual(parseJudgementEnvelope(raw).classifications.dupe, ["A"]);
});
test("envelope fails loud on a missing block", () => {
  assert.throws(() => parseJudgementEnvelope("no block here"), EnvelopeError);
});
test("envelope fails loud on malformed JSON", () => {
  assert.throws(() => parseJudgementEnvelope("```faff-eval:judgement\n{ not json \n```"), EnvelopeError);
});

// --- FAFF-137: strict tag is `format: "compliant"` ---
test("envelope tags an exact faff-eval:judgement block compliant", () => {
  const env = parseJudgementEnvelope('```faff-eval:judgement\n{ "case_id": "x", "classifications": { "dupe": ["A"] } }\n```');
  assert.equal(env.format, "compliant");
});

// --- FAFF-137: classify fallback recovers a mis-tagged ```json block, flagged noncompliant ---
test("envelope recovers a mis-tagged ```json block as noncompliant", () => {
  const raw = 'thinking...\n```json\n{ "case_id": "x", "classifications": { "dupe": ["A", "B"] } }\n```';
  const env = parseJudgementEnvelope(raw, { expectedCaseId: "x" });
  assert.equal(env.format, "noncompliant");
  assert.deepEqual(env.classifications.dupe, ["A", "B"]); // judgement recovered, not lost to the quirk
});

test("classify fallback honours expectedCaseId and takes the last qualifying block", () => {
  // wrong case_id is not recovered
  assert.throws(
    () => parseJudgementEnvelope('```json\n{ "case_id": "y", "classifications": {} }\n```', { expectedCaseId: "x" }),
    EnvelopeError);
  // two candidates → the LAST matching one wins
  const raw = '```json\n{ "case_id": "x", "ordering": ["first"] }\n```\n```json\n{ "case_id": "x", "ordering": ["last"] }\n```';
  assert.deepEqual(parseJudgementEnvelope(raw, { expectedCaseId: "x" }).ordering, ["last"]);
});

test("a MALFORMED exact-tag block still fails loud (not silently recovered from a later json block)", () => {
  const raw = '```faff-eval:judgement\n{ broken\n```\n```json\n{ "case_id": "x" }\n```';
  assert.throws(() => parseJudgementEnvelope(raw, { expectedCaseId: "x" }), EnvelopeError);
});

// --- FAFF-137: format_adherence aggregation (compliant / parsed reps; errored excluded) ---
test("aggregateCase reports format_adherence over parsed reps, excluding errored", () => {
  const c = { id: "d", kind: "dupe", oracle: { closed_set: ["A"] } };
  const reps = [
    { ...grade(c, { classifications: { dupe: ["A"] } }), format: "compliant" },
    { ...grade(c, { classifications: { dupe: ["A"] } }), format: "noncompliant" },
    erroredRep("no block"), // no format → excluded from the denominator
  ];
  const agg = aggregateCase(c, reps);
  assert.equal(agg.format_adherence, 0.5); // 1 compliant of 2 parsed
});

test("aggregateCase format_adherence is null when no rep parsed", () => {
  const c = { id: "d", kind: "dupe", oracle: { closed_set: ["A"] } };
  assert.equal(aggregateCase(c, [erroredRep("x"), erroredRep("y")]).format_adherence, null);
});

// --- grader: closed-set is exact set-equality, no LLM in the path ---
test("closed-set grades by exact set-equality", () => {
  const c = { id: "d", kind: "dupe", oracle: { closed_set: ["A", "B"] } };
  assert.equal(grade(c, { classifications: { dupe: ["B", "A"] } }).score, 1); // order-independent
  assert.equal(grade(c, { classifications: { dupe: ["A"] } }).score, 0);
});
test("ordering grades by rank correlation over the judgement portion", () => {
  assert.equal(rankCorrelation(["A", "B", "C"], ["A", "B", "C"]), 1);
  assert.equal(rankCorrelation(["C", "B", "A"], ["A", "B", "C"]), 0);
  const c = { id: "o", kind: "ordering", oracle: { ordering: ["A", "B", "C"] } };
  assert.equal(grade(c, { ordering: ["A", "B", "C"] }).graded, "PASS");
  assert.equal(grade(c, { ordering: ["B", "A", "C"] }).graded, "PARTIAL");
});
test("gloss coverage is the deterministic rubric pass-rate (judge is advisory, not here)", () => {
  const rubric = { must_include: ["login", "rate"], must_avoid: ["synergy"] };
  const good = gradeGloss({ gloss: { Z: "rate-limit the login endpoint" } }, rubric);
  assert.equal(good.score, 1); // all 3 checks pass
  const bad = gradeGloss({ gloss: { Z: "leverage synergy" } }, rubric);
  assert.ok(bad.score < 1);
});

// --- FAFF-142: synonym-set entries — a correct synonym ("throttle" for "rate") isn't a false-negative ---
test("gloss rubric: an array entry passes when ANY synonym appears (string entry unchanged)", () => {
  const rubric = { must_include: [["login", "sign-in"], ["rate", "throttl", "limit"]], must_avoid: ["synergy"] };
  // "throttle the sign-in endpoint" — no literal "login"/"rate", but synonyms hit both sets
  assert.equal(gradeGloss({ gloss: { Z: "throttle the sign-in endpoint" } }, rubric).score, 1);
  // a genuine miss still fails: no rate-synonym present
  assert.ok(gradeGloss({ gloss: { Z: "log the sign-in attempts" } }, rubric).score < 1);
});

test("gloss rubric: must_avoid accepts a synonym set (any present → fail)", () => {
  const rubric = { must_avoid: [["leverage", "synergy", "seamless"]] };
  assert.equal(gradeGloss({ gloss: { Z: "a clear deliverable" } }, rubric).score, 1); // none present
  assert.ok(gradeGloss({ gloss: { Z: "a seamless experience" } }, rubric).score < 1); // synonym present
});

// --- validation: kind must match the populated oracle field ---
test("validateCase rejects an oracle that doesn't match the kind", () => {
  assert.throws(() => validateCase({ id: "x", kind: "dupe", oracle: { ordering: ["A"] } }), CaseError);
  assert.doesNotThrow(() => validateCase({ id: "x", kind: "dupe", oracle: { closed_set: ["A"] } }));
});

// --- aggregation: stability (signature) is DISTINCT from accuracy (oracle) ---
test("stability is distinct from accuracy", () => {
  const c = { id: "d", kind: "dupe", oracle: { closed_set: ["A", "B"] } };
  // always the SAME WRONG answer → perfectly stable, zero accuracy
  const reps = Array.from({ length: 4 }, () => grade(c, { classifications: { dupe: ["A"] } }));
  const cr = aggregateCase(c, reps);
  assert.equal(cr.stability, 1);
  assert.equal(cr.accuracy, 0);
});
test("hasDisagreement detects cross-rep signature variance", () => {
  const c = { id: "d", kind: "dupe", oracle: { closed_set: ["A"] } };
  const same = [grade(c, { classifications: { dupe: ["A"] } }), grade(c, { classifications: { dupe: ["A"] } })];
  const diff = [grade(c, { classifications: { dupe: ["A"] } }), grade(c, { classifications: { dupe: ["B"] } })];
  assert.equal(hasDisagreement(same), false);
  assert.equal(hasDisagreement(diff), true);
});

// --- orchestration via a MOCK driver (no frontier calls) ---
const envOf = (id, payload) => ({ rawText: '```faff-eval:judgement\n' + JSON.stringify({ case_id: id, ...payload }) + '\n```', tokens: 3 });
const dupeCase = { id: "d", kind: "dupe", oracle: { closed_set: ["A", "B"] } };

test("orchestrator: K reps, stability+accuracy reported for K>=2", async () => {
  const driver = async () => envOf("d", { classifications: { dupe: ["A", "B"] } });
  const s = await runEvals({ cases: [dupeCase], driver, baseReps: 3, maxReps: 6 });
  const cr = s.cases[0];
  assert.equal(cr.rep_results.length, 3);
  assert.equal(cr.stability, 1);
  assert.equal(cr.accuracy, 1);
  assert.equal(cr.escalated, false);
});

test("orchestrator: a wobbly case escalates; a stable case does not", async () => {
  // wobbly: alternate the predicted set per rep → disagreement at base K → escalate to maxReps
  const wobbly = async (c, i) => envOf("d", { classifications: { dupe: i % 2 ? ["A"] : ["A", "B"] } });
  const ws = await runEvals({ cases: [dupeCase], driver: wobbly, baseReps: 2, maxReps: 6 });
  assert.equal(ws.cases[0].escalated, true);
  assert.equal(ws.cases[0].rep_results.length, 6);

  const stable = async () => envOf("d", { classifications: { dupe: ["A", "B"] } });
  const ss = await runEvals({ cases: [dupeCase], driver: stable, baseReps: 2, maxReps: 6 });
  assert.equal(ss.cases[0].escalated, false);
  assert.equal(ss.cases[0].rep_results.length, 2);
});

test("orchestrator: a malformed envelope becomes an errored rep, never silently passed", async () => {
  const broken = async () => ({ rawText: "the model forgot the block", tokens: 0 });
  const s = await runEvals({ cases: [dupeCase], driver: broken, baseReps: 3, maxReps: 3 });
  const cr = s.cases[0];
  assert.equal(cr.errored, 3);
  assert.equal(cr.accuracy, 0);
  assert.ok(cr.rep_results.every((r) => r.graded === "ERRORED"));
  // FAFF-139: the diagnostic is the malformed-output snippet (the cfgDir is cleaned up, so no dead path)
  assert.match(cr.rep_results[0].transcript, /the model forgot the block/);
});

test("orchestrator: deadline ceiling yields a flagged partial, not a silent truncation", async () => {
  const driver = async () => envOf("d", { classifications: { dupe: ["A", "B"] } });
  const s = await runEvals({ cases: [dupeCase, { ...dupeCase, id: "d2" }], driver, baseReps: 1, maxReps: 1, deadlineMs: 0 });
  assert.equal(s.status, "incomplete (ceiling)");
});

// --- the disk cases are all well-formed (kind matches oracle; per-kind fixture shape present) ---
test("all eval/cases load and validate", () => {
  const cases = loadCases();
  // 12 tidy cases + FAFF-146: 3 confidence + 2 marker prep classification cases.
  assert.equal(cases.length, 17);
  const kinds = new Set(cases.map((c) => c.kind));
  for (const k of ["dupe", "vague", "stale", "superseded", "ordering", "gloss", "confidence", "marker"]) {
    assert.ok(kinds.has(k), `missing kind ${k}`);
  }
  // ≥2 cases each for the new prep classification kinds (the 2/kind convention).
  for (const k of ["confidence", "marker"]) {
    assert.ok(cases.filter((c) => c.kind === k).length >= 2, `kind ${k} has <2 cases`);
  }
});

// ============================= FAFF-146 — prep judgement-eval kinds =============================

// --- confidence: a single-element closed set over {high,medium,low}, graded by set-equality ---
test("FAFF-146 confidence grades the env.confidence level by exact set-equality", () => {
  const c = { id: "cf", kind: "confidence", oracle: { closed_set: ["medium"] } };
  assert.equal(grade(c, { confidence: "medium" }).graded, "PASS");
  assert.equal(grade(c, { confidence: "high" }).score, 0); // a near-miss boundary is a real miss
  // signature is the sorted predicted set, so a different level is a distinct signature (flakiness)
  assert.notEqual(grade(c, { confidence: "medium" }).signature, grade(c, { confidence: "low" }).signature);
});

// --- FAFF-146 fail-safe: a malformed/out-of-enum confidence token is a clean FAIL, NOT a crash ---
test("FAFF-146 confidence: a malformed token scores a clean FAIL with a distinct signature (no coerce)", () => {
  const c = { id: "cf", kind: "confidence", oracle: { closed_set: ["low"] } };
  const bad = grade(c, { confidence: "definitely-low" }); // not in {high,medium,low}
  assert.equal(bad.graded, "FAIL");
  assert.equal(bad.score, 0);
  assert.equal(bad.signature, JSON.stringify(["definitely-low"])); // observed, not coerced to a level
  // an ABSENT token is also a clean FAIL (empty predicted set), never a throw
  const missing = grade(c, {});
  assert.equal(missing.graded, "FAIL");
  assert.equal(missing.signature, JSON.stringify([]));
  // and the absent-token signature differs from the bad-token signature → it lowers stability
  assert.notEqual(bad.signature, missing.signature);
});

// --- marker: per-section `key:class` closed set; one mislabelled section fails the whole set ---
test("FAFF-146 marker grades per-section key:class pairs by set-equality", () => {
  const c = { id: "mk", kind: "marker",
    oracle: { closed_set: ["storage:chosen", "retention:punt", "metrics:assumes"] } };
  assert.equal(grade(c, { markers: { storage: "chosen", retention: "punt", metrics: "assumes" } }).graded, "PASS");
  // one section wrong → the set fails (the per-section signal is not discarded)
  assert.equal(grade(c, { markers: { storage: "chosen", retention: "assumes", metrics: "assumes" } }).score, 0);
});

test("FAFF-146 marker: the missing-marker judgement encodes as key:none", () => {
  const c = { id: "mk", kind: "marker", oracle: { closed_set: ["queue:none", "idem:chosen"] } };
  assert.equal(grade(c, { markers: { queue: "none", idem: "chosen" } }).graded, "PASS");
  // a model that invents a marker for the unmarked section fails
  assert.equal(grade(c, { markers: { queue: "chosen", idem: "chosen" } }).score, 0);
});

// --- reconciliation: per-comment `id:label` closed set (mirrors the marker encoding) ---
test("FAFF-146 reconciliation grades per-comment id:label pairs by set-equality", () => {
  const c = { id: "rc", kind: "reconciliation",
    oracle: { closed_set: ["c1:challenge", "c2:resolution", "c3:context", "c4:noise"] } };
  const env = { reconciliation: { c1: "challenge", c2: "resolution", c3: "context", c4: "noise" } };
  assert.equal(grade(c, env).graded, "PASS");
  assert.equal(grade(c, { reconciliation: { c1: "noise" } }).score, 0);
});

// --- validateCase: the per-kind fixture-shape check (alongside the existing oracle check) ---
test("FAFF-146 validateCase enforces the per-kind prep fixture shapes", () => {
  // confidence needs spec_body
  assert.throws(() => validateCase({ id: "x", kind: "confidence", fixture: { version: 1 }, oracle: { closed_set: ["high"] } }), CaseError);
  assert.doesNotThrow(() => validateCase({ id: "x", kind: "confidence", fixture: { spec_body: "..." }, oracle: { closed_set: ["high"] } }));
  // marker needs sections
  assert.throws(() => validateCase({ id: "x", kind: "marker", fixture: { spec_body: "..." }, oracle: { closed_set: ["k:chosen"] } }), CaseError);
  assert.doesNotThrow(() => validateCase({ id: "x", kind: "marker", fixture: { sections: [] }, oracle: { closed_set: ["k:chosen"] } }));
  // reconciliation needs issue + spec_comment + thread
  assert.throws(() => validateCase({ id: "x", kind: "reconciliation", fixture: { issue: {}, thread: [] }, oracle: { closed_set: ["c:noise"] } }), CaseError);
  assert.doesNotThrow(() => validateCase({ id: "x", kind: "reconciliation",
    fixture: { issue: {}, spec_comment: {}, thread: [] }, oracle: { closed_set: ["c:noise"] } }));
  // a prep kind still must populate exactly the closed_set oracle field
  assert.throws(() => validateCase({ id: "x", kind: "confidence", fixture: { spec_body: "..." }, oracle: { ordering: ["a"] } }), CaseError);
});

// --- orchestration end-to-end for a prep kind via the MOCK driver (no frontier calls) ---
test("FAFF-146 orchestrator grades a confidence case through the closed-set path", async () => {
  const cfCase = { id: "cf", kind: "confidence", fixture: { spec_body: "..." }, oracle: { closed_set: ["medium"] } };
  const driver = async () => envOf("cf", { confidence: "medium" });
  const s = await runEvals({ cases: [cfCase], driver, baseReps: 2, maxReps: 4 });
  assert.equal(s.cases[0].accuracy, 1);
  assert.equal(s.cases[0].stability, 1);
  assert.ok(s.per_kind.confidence, "per_kind.confidence is reported");
});
