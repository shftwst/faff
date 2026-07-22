// FAFF-130 — deterministic tests for the judgement-eval harness.
// Runs under `node --test` (free, zero frontier calls): the grader is pure, and the
// orchestrator is driven by a MOCK driver. The real frontier-driver.mjs is never imported.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  grade, gradeGloss, gradeSplittable, gradeChainGap, rankCorrelation, aggregateCase, validateCase, hasDisagreement, erroredRep, CaseError,
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
// --- FAFF-148: verdict-revert grades the per-finding revert-test classification as a closed-set ---
test("verdict-revert maps env.verdicts to a key:verdict closed-set and grades by set-equality", () => {
  const c = { id: "vr", kind: "verdict-revert",
    oracle: { closed_set: ["debug-print:fail", "perm-migration:needs-human"] } };
  // exact match (order-independent on the object) → PASS
  const ok = grade(c, { verdicts: { "perm-migration": "needs-human", "debug-print": "fail" } });
  assert.equal(ok.score, 1);
  assert.equal(ok.graded, "PASS");
  // one finding mislabelled → the whole set fails (per-finding signal is not thrown away)
  const wrong = grade(c, { verdicts: { "debug-print": "needs-human", "perm-migration": "needs-human" } });
  assert.equal(wrong.score, 0);
  assert.equal(wrong.graded, "FAIL");
});

// --- FAFF-148: eval-side fail-safe — a malformed / out-of-enum verdict token is a clean FAIL, not a
// crash and not a coercion (the deterministic malformed→needs-human coercion lives in computeReviewVerdict). ---
test("verdict-revert: an out-of-enum token scores a clean FAIL with a distinct signature, no crash", () => {
  const c = { id: "vr", kind: "verdict-revert", oracle: { closed_set: ["f1:fail"] } };
  // model emits a token outside {fail, needs-human} — graded against the oracle, fails cleanly
  const bad = grade(c, { verdicts: { f1: "pass" } });
  assert.equal(bad.score, 0);
  assert.equal(bad.graded, "FAIL");
  assert.equal(bad.signature, JSON.stringify(["f1:pass"])); // the bad token is visible in the signature (lowers stability), NOT coerced
  // a missing/garbled verdicts object does not throw — empty predicted set fails the non-empty oracle
  assert.equal(grade(c, {}).score, 0);
  assert.equal(grade(c, { verdicts: null }).score, 0);
  assert.equal(grade(c, { verdicts: ["not", "an", "object"] }).score, 0);
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

// --- FAFF-147: splittable — synonym-tolerant set-equality over independent-concern labels ---
test("splittable PASS: both concerns identified, synonym-tolerant (set-equality)", () => {
  const oracle = [["url routing", "routing"], ["ci pipeline", "continuous integration", "ci"]];
  // model uses a synonym for each concern — still a PASS
  assert.equal(gradeSplittable(["routing", "continuous integration"], oracle).graded, "PASS");
  assert.equal(gradeSplittable(["routing", "continuous integration"], oracle).score, 1);
});
test("splittable FAIL: a missed concern (only one of two)", () => {
  const oracle = [["url routing", "routing"], ["ci pipeline", "ci"]];
  assert.equal(gradeSplittable(["routing"], oracle).graded, "FAIL");
});
test("splittable FAIL: a phantom/extra concern not in the oracle", () => {
  const oracle = [["url routing", "routing"], ["ci pipeline", "ci"]];
  assert.equal(gradeSplittable(["routing", "ci", "logging refactor"], oracle).graded, "FAIL");
});
test("splittable negative case: empty oracle + empty prediction = PASS (correctly not-flagged)", () => {
  assert.equal(gradeSplittable([], []).graded, "PASS");
  // a model that over-flags a cohesive spec FAILs
  assert.equal(gradeSplittable(["backoff schedule", "retry predicate"], []).graded, "FAIL");
});
test("splittable signature is deterministic and order-independent (for stability)", () => {
  const oracle = [["a"], ["b"]];
  const s1 = gradeSplittable(["a", "b"], oracle).signature;
  const s2 = gradeSplittable(["b", "a"], oracle).signature; // different label order
  assert.equal(s1, s2);
});
test("splittable wired through grade() on a splittable case", () => {
  const c = { id: "sp", kind: "splittable", oracle: { closed_set: [["routing"], ["ci"]] } };
  assert.equal(grade(c, { splittable: ["routing", "ci"] }).graded, "PASS");
  assert.equal(grade(c, { splittable: ["routing"] }).graded, "FAIL");
  // absent splittable field on a splittable case → no concerns → FAIL (oracle expected 2)
  assert.equal(grade(c, {}).graded, "FAIL");
});

// --- FAFF-153: chain-gap — synonym-tolerant reference + EXACT sub_type set-equality over {ref, sub} pairs ---
test("chain-gap PASS: one upstream ref identified, synonym-tolerant reference (set-equality)", () => {
  const oracle = [{ reference: ["search-index ingestion", "ingestion pipeline"], sub_type: "upstream" }];
  // model uses a synonym for the reference + the exact sub_type → PASS
  const r = gradeChainGap([{ reference: "ingestion pipeline", sub_type: "upstream" }], oracle);
  assert.equal(r.graded, "PASS");
  assert.equal(r.score, 1);
});
test("chain-gap PASS: conservative-skip empty case (empty oracle + empty prediction)", () => {
  assert.equal(gradeChainGap([], []).graded, "PASS");
  // a model that over-flags a skip-only spec FAILs
  assert.equal(gradeChainGap([{ reference: "a dashboard", sub_type: "downstream" }], []).graded, "FAIL");
});
test("chain-gap FAIL: right reference but WRONG sub_type (misclassified gap is a real miss)", () => {
  const oracle = [{ reference: ["ingestion pipeline"], sub_type: "upstream" }];
  assert.equal(gradeChainGap([{ reference: "ingestion pipeline", sub_type: "downstream" }], oracle).graded, "FAIL");
});
test("chain-gap FAIL: a phantom/extra reference not in the oracle", () => {
  const oracle = [{ reference: ["ingestion pipeline"], sub_type: "upstream" }];
  const pred = [
    { reference: "ingestion pipeline", sub_type: "upstream" },
    { reference: "a logging refactor", sub_type: "peer" },
  ];
  assert.equal(gradeChainGap(pred, oracle).graded, "FAIL");
});
test("chain-gap missing/malformed field → clean FAIL, no throw, distinct signature", () => {
  const oracle = [{ reference: ["ingestion pipeline"], sub_type: "upstream" }];
  // absent / non-array → empty predicted set → clean FAIL (oracle expected 1), never a throw
  const missing = gradeChainGap(undefined, oracle);
  assert.equal(missing.graded, "FAIL");
  assert.equal(missing.signature, JSON.stringify([]));
  assert.equal(gradeChainGap("garbage", oracle).graded, "FAIL");
  // a malformed pair (null / out-of-enum sub_type) canonicalises verbatim → distinct sig, clean FAIL
  const outOfEnum = gradeChainGap([{ reference: "ingestion pipeline", sub_type: "sideways" }], oracle);
  assert.equal(outOfEnum.graded, "FAIL");
  assert.notEqual(outOfEnum.signature, missing.signature);
});
test("chain-gap signature is deterministic and order-independent (for stability)", () => {
  const oracle = [{ reference: ["a"], sub_type: "upstream" }, { reference: ["b"], sub_type: "peer" }];
  const s1 = gradeChainGap([{ reference: "a", sub_type: "upstream" }, { reference: "b", sub_type: "peer" }], oracle).signature;
  const s2 = gradeChainGap([{ reference: "b", sub_type: "peer" }, { reference: "a", sub_type: "upstream" }], oracle).signature;
  assert.equal(s1, s2);
});
test("chain-gap wired through grade() on a chain-gap case", () => {
  const c = { id: "cg", kind: "chain-gap",
    oracle: { closed_set: [{ reference: ["ingestion pipeline"], sub_type: "upstream" }] } };
  assert.equal(grade(c, { chain_gap: [{ reference: "ingestion pipeline", sub_type: "upstream" }] }).graded, "PASS");
  assert.equal(grade(c, { chain_gap: [{ reference: "ingestion pipeline", sub_type: "peer" }] }).graded, "FAIL");
  // absent chain_gap field on a chain-gap case → no gaps → FAIL (oracle expected 1)
  assert.equal(grade(c, {}).graded, "FAIL");
});

// --- FAFF-285: architecture — collection-level rubric coverage over the proposal's key claims ---
test("architecture PASS: a build-biased proposal covering the rubric scores 1.0", () => {
  const c = { id: "arch", kind: "architecture",
    oracle: { gloss_rubric: {
      must_include: [["postgres", "rdbms"], ["docker", "container"]],
      must_avoid: [["hand-wave", "some datastore"], ["microservice"]] } } };
  // proposal names Postgres-in-a-container, no hand-waving, no microservice → all checks pass
  const good = grade(c, { architecture: {
    store: "Postgres for the relational data",
    runtime: "runs in a docker container via compose" } });
  assert.equal(good.graded, "PASS");
  assert.equal(good.score, 1);
  // a hand-wavy "some datastore" proposal misses must_include AND trips a must_avoid → PARTIAL
  const wavy = grade(c, { architecture: { store: "some datastore, TBD", runtime: "we could maybe use a microservice" } });
  assert.equal(wavy.graded, "PARTIAL");
  assert.ok(wavy.score < 1);
});
test("architecture PARTIAL: a hallucinated assumption is penalised", () => {
  const c = { id: "arch2", kind: "architecture",
    oracle: { gloss_rubric: {
      must_include: [["batch", "scheduled"]],
      must_avoid: [["kafka", "event-sourcing"]] } } };
  // a proposal that invents an event-sourcing backbone the brief never warranted drops below 1.0
  const halluc = grade(c, { architecture: ["a scheduled batch job backed by an event-sourcing kafka backbone"] });
  assert.equal(halluc.graded, "PARTIAL");
  assert.ok(halluc.score < 1);
  // the honest scheduled-query proposal covers must_include and trips no must_avoid → PASS
  const honest = grade(c, { architecture: ["a nightly scheduled batch query"] });
  assert.equal(honest.graded, "PASS");
});
test("architecture: missing/garbage env.architecture is a clean low score, never a crash", () => {
  const c = { id: "arch3", kind: "architecture",
    oracle: { gloss_rubric: { must_include: [["postgres"]], must_avoid: [] } } };
  assert.ok(grade(c, {}).score < 1);          // absent field → empty collection → must_include misses
  assert.ok(grade(c, { architecture: null }).score < 1);
  assert.doesNotThrow(() => grade(c, { architecture: "not-a-collection" }));
});
test("validateCase routes architecture to the gloss_rubric oracle field", () => {
  assert.doesNotThrow(() => validateCase({ id: "a", kind: "architecture", oracle: { gloss_rubric: { must_include: [["x"]] } } }));
  assert.throws(() => validateCase({ id: "a", kind: "architecture", oracle: { closed_set: ["x"] } }), CaseError);
});

// --- FAFF-283: refutation-spec — the objecting-lens closed-set over the adversarial spec-review lenses ---
test("refutation-spec: the above-minor objecting-lens set grades by set-equality", () => {
  const c = { id: "rs", kind: "refutation-spec", oracle: { closed_set: ["architectural"] } };
  // exactly the architectural lens objects at blocker → PASS
  const ok = grade(c, { objections: [{ lens: "architectural", severity: "blocker" }] });
  assert.equal(ok.graded, "PASS");
  assert.equal(ok.score, 1);
  // an EXTRA lens objecting (cry-wolf on a clean lens) → the whole set fails
  const extra = grade(c, { objections: [
    { lens: "architectural", severity: "blocker" }, { lens: "infosec", severity: "major" }] });
  assert.equal(extra.score, 0);
  assert.equal(extra.graded, "FAIL");
});
test("refutation-spec: only above-minor objections count (a minor-only objection does not add its lens)", () => {
  const c = { id: "rs", kind: "refutation-spec", oracle: { closed_set: ["QA"] } };
  // QA objects at major (counts); a minor architectural nit does NOT contribute its lens → PASS
  const ok = grade(c, { objections: [
    { lens: "QA", severity: "major" }, { lens: "architectural", severity: "minor" }] });
  assert.equal(ok.graded, "PASS");
  // dedup: the same lens objecting twice above minor collapses to one entry
  assert.equal(grade({ id: "r2", kind: "refutation-spec", oracle: { closed_set: ["QA"] } },
    { objections: [{ lens: "QA", severity: "blocker" }, { lens: "QA", severity: "major" }] }).graded, "PASS");
});
test("refutation-spec: a CLEAN spec (empty oracle) PASSes iff no lens objects above minor (no cry-wolf)", () => {
  const clean = { id: "rs", kind: "refutation-spec", oracle: { closed_set: [] } };
  // approve (no objections) → PASS
  assert.equal(grade(clean, { objections: [] }).graded, "PASS");
  // a minor-only nit still reads as clean (below the floor) → PASS
  assert.equal(grade(clean, { objections: [{ lens: "infosec", severity: "minor" }] }).graded, "PASS");
  // a false blocker on a clean spec → FAIL (the false-positive the near-miss fixtures catch)
  assert.equal(grade(clean, { objections: [{ lens: "infosec", severity: "blocker" }] }).graded, "FAIL");
});
test("refutation-spec: a missing/garbage objections field is a clean grade, never a throw", () => {
  const clean = { id: "rs", kind: "refutation-spec", oracle: { closed_set: [] } };
  const flawed = { id: "rs", kind: "refutation-spec", oracle: { closed_set: ["architectural"] } };
  assert.equal(grade(clean, {}).graded, "PASS");           // absent field + empty oracle → correct clean
  assert.equal(grade(flawed, {}).graded, "FAIL");          // absent field + non-empty oracle → missed catch
  assert.doesNotThrow(() => grade(flawed, { objections: "garbage" }));
  assert.equal(grade(flawed, { objections: null }).graded, "FAIL");
});
test("refutation-spec: an out-of-enum lens rides through verbatim (distinct signature, clean FAIL, no coerce)", () => {
  const c = { id: "rs", kind: "refutation-spec", oracle: { closed_set: ["architectural"] } };
  const bad = grade(c, { objections: [{ lens: "vibes", severity: "blocker" }] });
  assert.equal(bad.graded, "FAIL");
  assert.equal(bad.signature, JSON.stringify(["vibes"])); // observed, not coerced/dropped
});

// --- FAFF-283: refutation-code — the binary flagged/[] closed-set over the adversarial code review ---
test("refutation-code: flags iff a finding is above minor severity (binary, set-equality)", () => {
  const flag = { id: "rc", kind: "refutation-code", oracle: { closed_set: ["flagged"] } };
  const clean = { id: "rc", kind: "refutation-code", oracle: { closed_set: [] } };
  // a blocker finding on a should-flag fixture → PASS
  assert.equal(grade(flag, { findings: [{ severity: "blocker" }] }).graded, "PASS");
  // multiple findings still collapse to the single ["flagged"] token
  assert.equal(grade(flag, { findings: [{ severity: "major" }, { severity: "blocker" }] }).score, 1);
  // clean review (no findings) on a should-stay-clean fixture → PASS
  assert.equal(grade(clean, { findings: [] }).graded, "PASS");
  // a minor-only nit is below the flag floor → stays clean → PASS on the clean oracle
  assert.equal(grade(clean, { findings: [{ severity: "minor" }] }).graded, "PASS");
});
test("refutation-code: a false-positive and a missed catch both FAIL (both directions of the binary)", () => {
  const flag = { id: "rc", kind: "refutation-code", oracle: { closed_set: ["flagged"] } };
  const clean = { id: "rc", kind: "refutation-code", oracle: { closed_set: [] } };
  // missed catch: no above-minor finding on a should-flag fixture → [] ≠ ["flagged"] → FAIL
  assert.equal(grade(flag, { findings: [{ severity: "minor" }] }).graded, "FAIL");
  // cry-wolf: a blocker on a clean fixture → ["flagged"] ≠ [] → FAIL (the near-miss false-positive)
  assert.equal(grade(clean, { findings: [{ severity: "blocker" }] }).graded, "FAIL");
});
test("refutation-code: a missing/garbage findings field is a clean grade, never a throw", () => {
  const flag = { id: "rc", kind: "refutation-code", oracle: { closed_set: ["flagged"] } };
  const clean = { id: "rc", kind: "refutation-code", oracle: { closed_set: [] } };
  assert.equal(grade(clean, {}).graded, "PASS");   // absent field → [] → correct on the clean oracle
  assert.equal(grade(flag, {}).graded, "FAIL");    // absent field → [] → missed catch on a flag oracle
  assert.doesNotThrow(() => grade(flag, { findings: "garbage" }));
  assert.equal(grade(flag, { findings: null }).graded, "FAIL");
});
test("validateCase routes the refutation kinds to the closed_set oracle + enforces the fixture shape", () => {
  // refutation-spec: closed_set oracle + a `spec` fixture
  assert.doesNotThrow(() => validateCase({ id: "rs", kind: "refutation-spec",
    fixture: { spec: "..." }, oracle: { closed_set: ["architectural"] } }));
  assert.throws(() => validateCase({ id: "rs", kind: "refutation-spec",
    fixture: { spec: "..." }, oracle: { gloss_rubric: {} } }), CaseError);
  assert.throws(() => validateCase({ id: "rs", kind: "refutation-spec",
    fixture: {}, oracle: { closed_set: [] } }), CaseError); // missing `spec`
  // refutation-code: closed_set oracle + a `diff` + `spec_summary` fixture
  assert.doesNotThrow(() => validateCase({ id: "rc", kind: "refutation-code",
    fixture: { diff: "...", spec_summary: "..." }, oracle: { closed_set: ["flagged"] } }));
  assert.throws(() => validateCase({ id: "rc", kind: "refutation-code",
    fixture: { diff: "..." }, oracle: { closed_set: [] } }), CaseError); // missing `spec_summary`
});

// --- FAFF-241: specqual — collection-level rubric coverage over the GENERATED spec's body sections ---
test("specqual PASS: a spec covering the WHY/WHAT/HOW/DONE arc with testable ACs scores 1.0", () => {
  const c = { id: "sq", kind: "specqual",
    oracle: { gloss_rubric: {
      must_include: [["why"], ["what"], ["how"], ["done", "acceptance"]],
      must_avoid: [["as appropriate", "handle it"], ["tbd"]] } } };
  // a spec whose sections carry all four arc anchors, a concrete AC, and no vagueness → all checks pass
  const good = grade(c, { specqual: {
    why: "WHY: the config reader has no single-key accessor, so callers grep the whole dump",
    what: "WHAT: a `get <key>` subcommand; returns the resolved value on stdout",
    how: "HOW: read resolveConfig(), dig the key, exit 0 on hit / 1 on miss",
    done: "DONE / acceptance: `faff get missing.key` exits 1; `faff get a.b` prints the value" } });
  assert.equal(good.graded, "PASS");
  assert.equal(good.score, 1);
  // a spec that drops the HOW section AND hand-waves the AC misses must_include and trips must_avoid → PARTIAL
  const wavy = grade(c, { specqual: {
    why: "WHY: it's broken",
    what: "WHAT: fix it",
    done: "acceptance: it works, TBD — handle it as appropriate" } });
  assert.equal(wavy.graded, "PARTIAL");
  assert.ok(wavy.score < 1);
});
test("specqual PARTIAL: vagueness anti-patterns are penalised", () => {
  const c = { id: "sq2", kind: "specqual",
    oracle: { gloss_rubric: {
      must_include: [["idempoten", "unique constraint"]],
      must_avoid: [["as appropriate", "handle it"], ["some way", "somehow"]] } } };
  // a hand-wavy spec that names no concrete mechanism and leans on "handle it as appropriate" drops below 1.0
  const wavy = grade(c, { specqual: ["HOW: dedupe the sends in some way — handle it as appropriate at send time"] });
  assert.equal(wavy.graded, "PARTIAL");
  assert.ok(wavy.score < 1);
  // the concrete "add a unique constraint" spec covers must_include and trips no must_avoid → PASS
  const concrete = grade(c, { specqual: ["HOW: add a unique constraint on (recipient, digest_date) so sends are idempotent"] });
  assert.equal(concrete.graded, "PASS");
});
test("specqual: missing/garbage env.specqual is a clean low score, never a crash", () => {
  const c = { id: "sq3", kind: "specqual",
    oracle: { gloss_rubric: { must_include: [["why"]], must_avoid: [] } } };
  assert.ok(grade(c, {}).score < 1);          // absent field → empty collection → must_include misses
  assert.ok(grade(c, { specqual: null }).score < 1);
  assert.doesNotThrow(() => grade(c, { specqual: "not-a-collection" }));
});
test("validateCase routes specqual to the gloss_rubric oracle field + requires the issue fixture", () => {
  assert.doesNotThrow(() => validateCase({ id: "s", kind: "specqual", fixture: { issue: "x" }, oracle: { gloss_rubric: { must_include: [["x"]] } } }));
  assert.throws(() => validateCase({ id: "s", kind: "specqual", fixture: { issue: "x" }, oracle: { closed_set: ["x"] } }), CaseError);
  // FIXTURE_SHAPE requires `issue` — a specqual case without it is rejected
  assert.throws(() => validateCase({ id: "s", kind: "specqual", oracle: { gloss_rubric: { must_include: [["x"]] } } }), CaseError);
});

// --- FAFF-240: roadmap — collection-level rubric coverage over faff-map's synthesis (chains + gates) ---
test("roadmap PASS: a synthesis naming the chain and reading the gate as un-fireable scores 1.0", () => {
  const c = { id: "rm", kind: "roadmap",
    oracle: { gloss_rubric: {
      must_include: [["a", "auth"], ["chain", "spine", "dependency"], ["cannot fire", "un-fireable"]],
      must_avoid: [["ready to fire", "fireable now"], ["no dependencies", "flat backlog"]] } } };
  // a synthesis naming the A-headed dependency spine and reading the blocked gate as un-fireable → all pass
  const good = grade(c, { roadmap: {
    chain: "Auth (A) heads the dependency spine: A blocks B blocks C",
    gate: "the launch gate cannot fire — its upstream is un-fireable until payments land" } });
  assert.equal(good.graded, "PASS");
  assert.equal(good.score, 1);
  // a synthesis that misses the chain and calls the gate fireable-now trips must_include + must_avoid → PARTIAL
  const wrong = grade(c, { roadmap: ["everything is a flat backlog with no dependencies; the launch gate is fireable now"] });
  assert.equal(wrong.graded, "PARTIAL");
  assert.ok(wrong.score < 1);
});
test("roadmap PARTIAL: declaring an un-buildable gate fireable is penalised", () => {
  const c = { id: "rm2", kind: "roadmap",
    oracle: { gloss_rubric: {
      must_include: [["cannot fire", "blocked", "un-fireable"]],
      must_avoid: [["ready to fire", "fireable now", "gate is ready"]] } } };
  // a synthesis that declares the gate ready despite an unbuilt upstream drops below 1.0
  const optimistic = grade(c, { roadmap: ["the launch gate is ready to fire"] });
  assert.equal(optimistic.graded, "PARTIAL");
  assert.ok(optimistic.score < 1);
  // the honest reading covers must_include and trips no must_avoid → PASS
  const honest = grade(c, { roadmap: ["the launch gate cannot fire — its upstream is still blocked"] });
  assert.equal(honest.graded, "PASS");
});
test("roadmap: missing/garbage env.roadmap is a clean low score, never a crash", () => {
  const c = { id: "rm3", kind: "roadmap",
    oracle: { gloss_rubric: { must_include: [["chain"]], must_avoid: [] } } };
  assert.ok(grade(c, {}).score < 1);          // absent field → empty collection → must_include misses
  assert.ok(grade(c, { roadmap: null }).score < 1);
  assert.doesNotThrow(() => grade(c, { roadmap: "not-a-collection" }));
});
test("validateCase routes roadmap to the gloss_rubric oracle field + requires the issues fixture", () => {
  assert.doesNotThrow(() => validateCase({ id: "r", kind: "roadmap", fixture: { issues: [] }, oracle: { gloss_rubric: { must_include: [["x"]] } } }));
  assert.throws(() => validateCase({ id: "r", kind: "roadmap", fixture: { issues: [] }, oracle: { closed_set: ["x"] } }), CaseError);
  // FIXTURE_SHAPE requires `issues` — a roadmap case without it is rejected
  assert.throws(() => validateCase({ id: "r", kind: "roadmap", oracle: { gloss_rubric: { must_include: [["x"]] } } }), CaseError);
});

// --- FAFF-286: adr-gloss — collection-level rubric coverage over the authored ADR body sections ---
test("adr-gloss PASS: a body naming decision + rejected alternative + real consequence scores 1.0", () => {
  const c = { id: "adr", kind: "adr-gloss",
    oracle: { gloss_rubric: {
      must_include: [["postgres"], ["sqlite"], ["rejected", "ruled out"], ["concurren", "row-level"]],
      must_avoid: [["it depends", "best practice"], ["nosql", "sharding"]] } } };
  // a sound body names Postgres, the rejected SQLite, and the real concurrency consequence → all checks pass
  const good = grade(c, { adr: {
    context: "The service takes concurrent writes from multiple workers.",
    decision: "Use PostgreSQL; SQLite was rejected because its single-writer lock serialises concurrent writes.",
    consequences: "We gain row-level concurrency and carry a Postgres container." } });
  assert.equal(good.graded, "PASS");
  assert.equal(good.score, 1);
  // a body that omits the rejected alternative misses a must_include → PARTIAL
  const partial = grade(c, { adr: { decision: "Use Postgres for row-level concurrency." } });
  assert.equal(partial.graded, "PARTIAL");
  assert.ok(partial.score < 1);
});
test("adr-gloss PARTIAL: boilerplate / fabricated rationale is penalised", () => {
  const c = { id: "adr2", kind: "adr-gloss",
    oracle: { gloss_rubric: {
      must_include: [["json", "structured"]],
      must_avoid: [["best practice", "it depends"], ["tbd", "for future consideration"]] } } };
  // padded boilerplate trips the must_avoid checks → drops below 1.0
  const boiler = grade(c, { adr: ["We adopt structured JSON logging as a best practice; the rest is TBD."] });
  assert.equal(boiler.graded, "PARTIAL");
  assert.ok(boiler.score < 1);
  // the honest body covers must_include and trips no must_avoid → PASS
  const honest = grade(c, { adr: ["We emit structured JSON logs to stdout."] });
  assert.equal(honest.graded, "PASS");
});
test("adr-gloss: missing/garbage env.adr is a clean low score, never a crash", () => {
  const c = { id: "adr3", kind: "adr-gloss",
    oracle: { gloss_rubric: { must_include: [["postgres"]], must_avoid: [] } } };
  assert.ok(grade(c, {}).score < 1);          // absent field → empty collection → must_include misses
  assert.ok(grade(c, { adr: null }).score < 1);
  assert.doesNotThrow(() => grade(c, { adr: "not-a-collection" }));
});
test("validateCase routes adr-gloss to the gloss_rubric oracle field", () => {
  assert.doesNotThrow(() => validateCase({ id: "a", kind: "adr-gloss", oracle: { gloss_rubric: { must_include: [["x"]] } } }));
  assert.throws(() => validateCase({ id: "a", kind: "adr-gloss", oracle: { closed_set: ["x"] } }), CaseError);
});

// --- FAFF-284: holdout — per-criterion `key:class` closed set (the marker shape); prose→needs-human ---
test("FAFF-284 holdout grades per-criterion key:class pairs by set-equality", () => {
  const c = { id: "hd", kind: "holdout",
    oracle: { closed_set: ["health-endpoint:met", "error-schema:met", "readable-output:needs-human"] } };
  assert.equal(grade(c, { holdout: { "health-endpoint": "met", "error-schema": "met", "readable-output": "needs-human" } }).graded, "PASS");
  // a born-verifiable criterion the exercise shows failing must be caught unmet
  const c2 = { id: "hd2", kind: "holdout", oracle: { closed_set: ["health-200:unmet", "idempotent-send:met"] } };
  assert.equal(grade(c2, { holdout: { "health-200": "unmet", "idempotent-send": "met" } }).graded, "PASS");
  assert.equal(grade(c2, { holdout: { "health-200": "met", "idempotent-send": "met" } }).score, 0); // missed the failure
});

test("FAFF-284 holdout: the green-washing guard — a judge grading a prose criterion itself FAILS", () => {
  // oracle pins the prose criterion to needs-human; classing it met (or unmet) is a real miss
  const c = { id: "hd3", kind: "holdout", oracle: { closed_set: ["scenario-ok:met", "readable-output:needs-human"] } };
  assert.equal(grade(c, { holdout: { "scenario-ok": "met", "readable-output": "met" } }).score, 0);   // self-graded prose → FAIL
  assert.equal(grade(c, { holdout: { "scenario-ok": "met", "readable-output": "unmet" } }).score, 0); // still self-graded → FAIL
  assert.equal(grade(c, { holdout: { "scenario-ok": "met", "readable-output": "needs-human" } }).graded, "PASS");
});

test("FAFF-284 holdout: a missing/garbage env.holdout map is a clean FAIL, never a crash", () => {
  const c = { id: "hd4", kind: "holdout", oracle: { closed_set: ["k:met"] } };
  assert.equal(grade(c, {}).graded, "FAIL");                       // absent field → empty set
  assert.equal(grade(c, {}).signature, JSON.stringify([]));
  assert.doesNotThrow(() => grade(c, { holdout: "not-a-map" }));   // garbage → pairsOf fail-safe → []
  assert.equal(grade(c, { holdout: "not-a-map" }).graded, "FAIL");
});

test("FAFF-284 validateCase routes holdout to closed_set + requires the spec_dod + exercise fixture", () => {
  const ok = { spec_dod: [], exercise: "…" };
  assert.doesNotThrow(() => validateCase({ id: "h", kind: "holdout", fixture: ok, oracle: { closed_set: ["k:met"] } }));
  // wrong oracle field
  assert.throws(() => validateCase({ id: "h", kind: "holdout", fixture: ok, oracle: { gloss_rubric: { must_include: [["x"]] } } }), CaseError);
  // FIXTURE_SHAPE requires both spec_dod and exercise
  assert.throws(() => validateCase({ id: "h", kind: "holdout", fixture: { spec_dod: [] }, oracle: { closed_set: ["k:met"] } }), CaseError);
  assert.throws(() => validateCase({ id: "h", kind: "holdout", fixture: { exercise: "…" }, oracle: { closed_set: ["k:met"] } }), CaseError);
});

// --- FAFF-317: holdout-exercise — the RAW-EXERCISE half. Same per-criterion key:class closed set as
// `holdout` (pairsOf(env["holdout-exercise"])), but the fixture carries raw/unaligned recordings rather
// than a pre-digested narrative — see eval/grader.mjs's FAFF-317 doc comment for the full rationale. ---
test("FAFF-317 holdout-exercise grades per-criterion key:class pairs by set-equality", () => {
  const c = { id: "he", kind: "holdout-exercise",
    oracle: { closed_set: ["criterion-alpha:met", "criterion-epsilon:unmet", "criterion-delta:needs-human"] } };
  assert.equal(grade(c, { "holdout-exercise": { "criterion-alpha": "met", "criterion-epsilon": "unmet", "criterion-delta": "needs-human" } }).graded, "PASS");
  // a born-verifiable criterion the raw recordings show failing must be caught unmet, not smoothed to met
  assert.equal(grade(c, { "holdout-exercise": { "criterion-alpha": "met", "criterion-epsilon": "met", "criterion-delta": "needs-human" } }).score, 0);
});

test("FAFF-317 holdout-exercise: the TRAP recording — a believed claim-of-success over a raw failure FAILS", () => {
  // oracle pins the trap criterion to unmet (raw observation — e.g. a 500 status — contradicts the
  // response body's claim of success); a judge that believes the claim classes it met and must FAIL.
  const c = { id: "he-trap", kind: "holdout-exercise",
    oracle: { closed_set: ["criterion-one:unmet", "criterion-three:needs-human"] } };
  assert.equal(grade(c, { "holdout-exercise": { "criterion-one": "met", "criterion-three": "needs-human" } }).score, 0);
  assert.equal(grade(c, { "holdout-exercise": { "criterion-one": "unmet", "criterion-three": "needs-human" } }).graded, "PASS");
});

test("FAFF-317 holdout-exercise: fail-closed — a criterion with NO bearing recording must be needs-human", () => {
  // oracle pins a born-verifiable criterion with no bearing recording to needs-human (the fail-closed
  // rule); a judge that guesses met (or unmet) instead of admitting no surface bears is a real miss.
  const c = { id: "he-nosurf", kind: "holdout-exercise", oracle: { closed_set: ["criterion-two:needs-human"] } };
  assert.equal(grade(c, { "holdout-exercise": { "criterion-two": "met" } }).score, 0);
  assert.equal(grade(c, { "holdout-exercise": { "criterion-two": "unmet" } }).score, 0);
  assert.equal(grade(c, { "holdout-exercise": { "criterion-two": "needs-human" } }).graded, "PASS");
});

test("FAFF-317 holdout-exercise: the green-washing guard — a judge grading a prose criterion itself FAILS", () => {
  const c = { id: "he-prose", kind: "holdout-exercise", oracle: { closed_set: ["scenario-ok:met", "readable-output:needs-human"] } };
  assert.equal(grade(c, { "holdout-exercise": { "scenario-ok": "met", "readable-output": "met" } }).score, 0);
  assert.equal(grade(c, { "holdout-exercise": { "scenario-ok": "met", "readable-output": "needs-human" } }).graded, "PASS");
});

test("FAFF-317 holdout-exercise: a missing/garbage env map is a clean FAIL, never a crash", () => {
  const c = { id: "he-bad", kind: "holdout-exercise", oracle: { closed_set: ["k:met"] } };
  assert.equal(grade(c, {}).graded, "FAIL");
  assert.equal(grade(c, {}).signature, JSON.stringify([]));
  assert.doesNotThrow(() => grade(c, { "holdout-exercise": "not-a-map" }));
  assert.equal(grade(c, { "holdout-exercise": "not-a-map" }).graded, "FAIL");
});

test("FAFF-317 validateCase routes holdout-exercise to closed_set + requires the spec_dod + recordings fixture", () => {
  const ok = { spec_dod: [], recordings: [] };
  assert.doesNotThrow(() => validateCase({ id: "he", kind: "holdout-exercise", fixture: ok, oracle: { closed_set: ["k:met"] } }));
  // wrong oracle field
  assert.throws(() => validateCase({ id: "he", kind: "holdout-exercise", fixture: ok, oracle: { gloss_rubric: { must_include: [["x"]] } } }), CaseError);
  // FIXTURE_SHAPE requires both spec_dod and recordings
  assert.throws(() => validateCase({ id: "he", kind: "holdout-exercise", fixture: { spec_dod: [] }, oracle: { closed_set: ["k:met"] } }), CaseError);
  assert.throws(() => validateCase({ id: "he", kind: "holdout-exercise", fixture: { recordings: [] }, oracle: { closed_set: ["k:met"] } }), CaseError);
});

// --- FAFF-282: spec-verdict — the single spec-review admission verdict, closed-set over the contract enum ---
test("FAFF-282 spec-verdict grades env.verdict by exact set-equality against the contract enum", () => {
  const c = { id: "sv", kind: "spec-verdict", fixture: { spec_body: "…" }, oracle: { closed_set: ["approve"] } };
  assert.equal(grade(c, { verdict: "approve" }).graded, "PASS");
  // a wrong (but in-enum) verdict is a real miss with a distinct signature
  const rej = grade(c, { verdict: "reject-approach" });
  assert.equal(rej.graded, "FAIL");
  assert.equal(rej.score, 0);
  assert.notEqual(rej.signature, grade(c, { verdict: "approve" }).signature);
  // a broken-spec case: approve on a spec that should be rejected FAILs; the correct verdict PASSes
  const c2 = { id: "sv2", kind: "spec-verdict", fixture: { spec_body: "…" }, oracle: { closed_set: ["reject-approach"] } };
  assert.equal(grade(c2, { verdict: "approve" }).graded, "FAIL");
  assert.equal(grade(c2, { verdict: "reject-approach" }).graded, "PASS");
  // missing / out-of-enum verdict → clean FAIL, never a crash (the routing/verdict-build fail-safe)
  assert.equal(grade(c, { }).graded, "FAIL");
  assert.equal(grade(c, { verdict: "definitely-yes" }).graded, "FAIL");
  assert.doesNotThrow(() => grade(c, { verdict: null }));
});

test("FAFF-282 validateCase routes spec-verdict to closed_set + requires the spec_body fixture", () => {
  assert.doesNotThrow(() => validateCase({ id: "sv", kind: "spec-verdict", fixture: { spec_body: "…" }, oracle: { closed_set: ["approve"] } }));
  // wrong oracle field
  assert.throws(() => validateCase({ id: "sv", kind: "spec-verdict", fixture: { spec_body: "…" }, oracle: { gloss_rubric: { must_include: [["x"]] } } }), CaseError);
  // FIXTURE_SHAPE requires spec_body
  assert.throws(() => validateCase({ id: "sv", kind: "spec-verdict", fixture: { version: 1 }, oracle: { closed_set: ["approve"] } }), CaseError);
});

// --- validation: kind must match the populated oracle field ---
test("validateCase rejects an oracle that doesn't match the kind", () => {
  assert.throws(() => validateCase({ id: "x", kind: "dupe", oracle: { ordering: ["A"] } }), CaseError);
  assert.doesNotThrow(() => validateCase({ id: "x", kind: "dupe", oracle: { closed_set: ["A"] } }));
  // FAFF-147: splittable uses the closed_set oracle field
  assert.doesNotThrow(() => validateCase({ id: "sp", kind: "splittable", oracle: { closed_set: [["a"], ["b"]] } }));
  assert.throws(() => validateCase({ id: "sp", kind: "splittable", oracle: { gloss_rubric: {} } }), CaseError);
  // FAFF-153: chain-gap uses the closed_set oracle field (default `want`, no validateCase change)
  assert.doesNotThrow(() => validateCase({ id: "cg", kind: "chain-gap", oracle: { closed_set: [{ reference: ["a"], sub_type: "upstream" }] } }));
  assert.throws(() => validateCase({ id: "cg", kind: "chain-gap", oracle: { gloss_rubric: {} } }), CaseError);
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
  // 12 tidy + FAFF-146: 3 confidence + 2 marker; FAFF-147: +2 splittable; FAFF-148: +2 verdict-revert;
  // FAFF-149: +6 routing (one per verdict); FAFF-150: +3 modedetect (greenfield/single-item/ambiguous).
  // FAFF-157: +3 confidence high/medium boundary-fuzz (confidence-004/005/006, single-author medium oracle).
  // FAFF-161: +2 shaping + 2 decomposition (the generative advisory rubric-coverage surfaces).
  // FAFF-153: +2 chain-gap (one positive upstream gap + one conservative-skip empty-oracle case).
  // FAFF-193: +1 gloss (gloss-003, "surface the concrete" rubric).
  // FAFF-203: +2 explanatory-order (Edit A lead-with-the-model ordering, two domains).
  // FAFF-285: +2 architecture (the generative architecture-proposal rubric-coverage surface).
  // FAFF-241: +2 specqual (the generated lite-nlspec body-quality rubric-coverage surface).
  // FAFF-284: +2 holdout (the code-blind evaluator's offline DoD-classification + prose→needs-human seam).
  // FAFF-282: +3 spec-verdict (the spec-review admission-gate verdict — approve + reject-approach + needs-human).
  // FAFF-240: +2 roadmap (the faff-map roadmap-synthesis rubric-coverage surface — chain-id + gate-fireability).
  // FAFF-286: +2 adr-gloss (the ADR-body writer rubric-coverage surface; env-compose is declared-deterministic, no case).
  // FAFF-283: +6 refutation-spec (4 planted-lens + 2 clean/near-miss) + 5 refutation-code (3 planted + 2 clean/near-miss).
  // FAFF-346: +2 prep-architecture-trigger (the prep-time new-runnable-surface fire/skip seam — one per verdict).
  // FAFF-269: +4 refutation-spec (007-009 faff-specific infosec catches on the forge / stale-ledger / self-attestation surfaces; 010 same-surface clean near-miss) — the primed-vs-generic threat-prior corpus.
  // FAFF-275: +1 specqual (specqual-003 — the holdout-selection judgement: mark a minority, never all,
  // and every holdout scenario verifies behaviour the body already requires).
  // FAFF-317: +2 holdout-exercise (the raw-exercise derive+interpret half: distractor + a two-recording
  // criterion + a trap + a no-bearing-recording criterion, both cases carrying a prose criterion too).
  // FAFF-436: +1 grouping (the agile lens's rehome-set proposal — two outcome clusters + a deliberately-loose
  // ticket; must_avoid catches thematic-bucket phrasing).
  // FAFF-199: +2 adr-drift (the per-move ADR drift challenge — one argument that should survive, one
  // that should be overturned).
  // FAFF-569: +1 resolved-elsewhere (tidy's symptom-similarity layer — match a finding-ticket's
  // symptom to the one merged fix with the same defect mechanism, skipping same-topic distractors).
  assert.equal(cases.length, 79);
  const kinds = new Set(cases.map((c) => c.kind));
  for (const k of ["dupe", "vague", "stale", "superseded", "ordering", "gloss", "confidence", "marker", "splittable", "verdict-revert", "routing", "modedetect", "shaping", "decomposition", "chain-gap", "explanatory-order", "architecture", "specqual", "holdout", "holdout-exercise", "spec-verdict", "roadmap", "adr-gloss", "refutation-spec", "refutation-code", "prep-architecture-trigger", "grouping"]) {
    assert.ok(kinds.has(k), `missing kind ${k}`);
  }
  // ≥2 cases each for the new classification kinds (the 2/kind convention); routing ships ≥6 (one per verdict).
  for (const k of ["confidence", "marker", "splittable", "verdict-revert", "modedetect", "shaping", "decomposition", "chain-gap", "explanatory-order", "architecture", "specqual", "holdout", "holdout-exercise", "spec-verdict", "roadmap", "adr-gloss", "refutation-spec", "refutation-code", "prep-architecture-trigger"]) {
    assert.ok(cases.filter((c) => c.kind === k).length >= 2, `kind ${k} has <2 cases`);
  }
  assert.ok(cases.filter((c) => c.kind === "routing").length >= 6, "routing has <6 cases");
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

// --- FAFF-148: validateCase accepts the new kinds (closed-set oracle) and rejects a mismatched oracle ---
test("validateCase accepts verdict-revert / verdict-build closed-set oracles", () => {
  assert.doesNotThrow(() => validateCase({ id: "vr", kind: "verdict-revert", oracle: { closed_set: ["k:fail"] } }));
  assert.doesNotThrow(() => validateCase({ id: "vb", kind: "verdict-build", oracle: { closed_set: ["pass"] } }));
  assert.throws(() => validateCase({ id: "vr", kind: "verdict-revert", oracle: { ordering: ["k"] } }), CaseError);
});
