// FAFF-149 — deterministic tests for the `routing` (verdict-assign) judgement-eval kind.
// Runs under `node --test` (free, zero frontier calls): the grader is pure, the orchestrator is
// driven by a MOCK driver, and the loaders/prompt builders are PURE (read the repo plugin SKILL.md,
// no spawn). The real `claude -p` driver is never imported — eval/ stays out of the real-call path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  grade, validateCase, aggregateCase, CaseError,
  KINDS, CLOSED_SET_KINDS, ROUTING_VERDICTS, admits,
} from "../eval/grader.mjs";
import {
  loadRoutingVerdictProse, criteriaFor, buildEvalPrompt, ROUTING_MODE_INSTRUCTION, DEFAULT_PLUGIN_DIR,
} from "../eval/cli-driver.mjs";
import { runEvals, loadCases } from "../eval/run-evals.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, "..", "eval", "cases");

// --- registration: routing is a known closed-set kind ---
test("routing is registered in KINDS and CLOSED_SET_KINDS", () => {
  assert.ok(KINDS.includes("routing"), "KINDS includes routing");
  assert.ok(CLOSED_SET_KINDS.has("routing"), "CLOSED_SET_KINDS includes routing");
});

// --- the closed six verdicts + the admission rule are the gateway's, verbatim ---
test("ROUTING_VERDICTS is exactly the closed six; admits() is the fixed admission rule", () => {
  assert.deepEqual(
    [...ROUTING_VERDICTS].sort(),
    ["circular-blocked", "fire-and-forget", "gap-blocked", "likely-fire", "needs-decision-first", "repeat-parked"].sort());
  // only fire-and-forget + likely-fire admit; the other four route out — a PURE function of the verdict
  assert.equal(admits("fire-and-forget"), true);
  assert.equal(admits("likely-fire"), true);
  for (const v of ["needs-decision-first", "gap-blocked", "circular-blocked", "repeat-parked"]) {
    assert.equal(admits(v), false, `${v} routes out`);
  }
  // an out-of-enum token never spuriously admits
  assert.equal(admits("definitely-fire"), false);
  assert.equal(admits(undefined), false);
});

// --- grader: routing grades the single assigned verdict by set-equality (the confidence analogue) ---
test("routing grades env.verdict by exact single-element set-equality", () => {
  const c = { id: "rt", kind: "routing", oracle: { closed_set: ["gap-blocked"] } };
  assert.equal(grade(c, { verdict: "gap-blocked" }).graded, "PASS");
  assert.equal(grade(c, { verdict: "gap-blocked" }).score, 1);
  // a wrong (but in-enum) verdict is a real miss
  const wrong = grade(c, { verdict: "fire-and-forget" });
  assert.equal(wrong.graded, "FAIL");
  assert.equal(wrong.score, 0);
  // signature is the sorted predicted set, so a different verdict is a distinct signature (flakiness)
  assert.notEqual(grade(c, { verdict: "gap-blocked" }).signature, grade(c, { verdict: "circular-blocked" }).signature);
});

// --- eval-side fail-safe: an out-of-enum / missing verdict is a clean FAIL, never a crash, never a coerce ---
test("routing: an out-of-enum / missing verdict scores a clean FAIL with a distinct signature, no crash", () => {
  const c = { id: "rt", kind: "routing", oracle: { closed_set: ["fire-and-forget"] } };
  // a token outside the closed six — graded against the oracle, fails cleanly, visible in the signature
  const bad = grade(c, { verdict: "send-it" });
  assert.equal(bad.graded, "FAIL");
  assert.equal(bad.score, 0);
  assert.equal(bad.signature, JSON.stringify(["send-it"])); // observed, NOT coerced (deterministic coercion lives in faff contract automation-routing)
  // a missing verdict field → empty predicted set → clean FAIL, never a throw
  const missing = grade(c, {});
  assert.equal(missing.graded, "FAIL");
  assert.equal(missing.signature, JSON.stringify([]));
  assert.notEqual(bad.signature, missing.signature); // distinct → it lowers stability
  // a null verdict is also a clean FAIL, no throw
  assert.equal(grade(c, { verdict: null }).score, 0);
});

// --- validateCase: the per-kind fixture-shape check (issue + spec) + the closed_set oracle field ---
test("validateCase enforces the routing fixture shape (issue + spec) and the closed_set oracle", () => {
  // a routing fixture missing `spec` is rejected
  assert.throws(() => validateCase({ id: "x", kind: "routing", fixture: { issue: {} }, oracle: { closed_set: ["fire-and-forget"] } }), CaseError);
  // a routing fixture missing `issue` is rejected
  assert.throws(() => validateCase({ id: "x", kind: "routing", fixture: { spec: {} }, oracle: { closed_set: ["fire-and-forget"] } }), CaseError);
  // a well-formed routing case validates
  assert.doesNotThrow(() => validateCase({ id: "x", kind: "routing", fixture: { issue: {}, spec: {} }, oracle: { closed_set: ["fire-and-forget"] } }));
  // a routing case must populate exactly the closed_set oracle field
  assert.throws(() => validateCase({ id: "x", kind: "routing", fixture: { issue: {}, spec: {} }, oracle: { ordering: ["a"] } }), CaseError);
});

// --- loader: the routing rubric is extracted verbatim from BOTH shipped sources (gateway + adaptor) ---
test("loadRoutingVerdictProse folds the gateway's fixed contract and the adaptor's assignment conditions verbatim", () => {
  const prose = loadRoutingVerdictProse(DEFAULT_PLUGIN_DIR);
  // gateway "Automation-routing verdict (fixed)" — closed-six vocab + admission rule + root-cause enum
  assert.ok(prose.includes("### Automation-routing verdict (fixed)"), "carries the gateway's fixed contract section");
  assert.ok(prose.includes("build-queue admission rule"), "carries the admission rule statement");
  for (const v of ROUTING_VERDICTS) assert.ok(prose.includes(v), `carries the verdict name ${v}`);
  // adaptor "The six verdicts" recap — the per-verdict assignment conditions + the collision-group rule
  assert.ok(prose.includes("## The six verdicts (non-normative recap for assignment)"), "carries the adaptor's assignment recap");
  assert.ok(prose.includes("collision group"), "carries the likely-fire collision-group condition");
  // ...and stops before each END anchor (no bleed into adjacent sections)
  assert.ok(!prose.includes("### Spec readiness (fixed)"), "stops before the gateway END anchor");
  assert.ok(!prose.includes("## Validate — wired to the contract script"), "stops before the adaptor END anchor");
});

test("loadRoutingVerdictProse fails loud on a missing skill file", () => {
  assert.throws(() => loadRoutingVerdictProse("/no/such/plugin"), /cannot read|SKILL\.md/);
});

// --- criteriaFor resolves the routing rubric for the routing kind; null is the improvise baseline ---
test("criteriaFor picks the routing rubric for the routing kind", () => {
  assert.ok(criteriaFor("routing", DEFAULT_PLUGIN_DIR).includes("### Automation-routing verdict (fixed)"));
  assert.equal(criteriaFor("routing", null), null); // --no-plugin baseline → improvise (control)
});

// --- buildEvalPrompt renders the routing surface over an assembled fixture with the verdict envelope ---
test("buildEvalPrompt(routing) carries the assembled fixture, the rubric, and the verdict envelope shape", () => {
  const c = { id: "rt-x", kind: "routing", question: "Assign the verdict.",
    fixture: { version: 1, issue: { id: "I-1", title: "A thing" }, spec: { confidence: "high", markers: [] } } };
  const p = buildEvalPrompt(c, criteriaFor("routing", DEFAULT_PLUGIN_DIR));
  assert.ok(p.includes("I-1"), "includes the fixture issue id");
  assert.ok(p.includes("### Automation-routing verdict (fixed)"), "folds in the verbatim routing rubric");
  assert.ok(p.includes('"verdict": "<one of the six>"'), "asks for the verdict envelope field");
  assert.ok(p.includes("rt-x"), "interpolates the case id");
  assert.ok(!p.includes("Run faff-tidy"), "does NOT use the tidy framing");
  assert.ok(!p.includes('"classifications"'), "does NOT use the tidy classification envelope");
});

test("ROUTING_MODE_INSTRUCTION names the closed six and asks for exactly one verdict", () => {
  for (const v of ROUTING_VERDICTS) assert.ok(ROUTING_MODE_INSTRUCTION.includes(v), `names ${v}`);
  assert.ok(/exactly one/i.test(ROUTING_MODE_INSTRUCTION), "asks for exactly one verdict");
  assert.ok(ROUTING_MODE_INSTRUCTION.includes('"verdict"'), "specifies the verdict envelope field");
});

// --- orchestration end-to-end for the routing kind via the MOCK driver (no frontier calls) ---
test("orchestrator grades a routing case through the closed-set path", async () => {
  const rtCase = { id: "rt", kind: "routing",
    fixture: { issue: {}, spec: {} }, oracle: { closed_set: ["circular-blocked"] } };
  const envOf = (id, payload) => ({ rawText: '```faff-eval:judgement\n' + JSON.stringify({ case_id: id, ...payload }) + '\n```', tokens: 3 });
  const driver = async () => envOf("rt", { verdict: "circular-blocked" });
  const s = await runEvals({ cases: [rtCase], driver, baseReps: 2, maxReps: 4 });
  assert.equal(s.cases[0].accuracy, 1);
  assert.equal(s.cases[0].stability, 1);
  assert.ok(s.per_kind.routing, "per_kind.routing is reported");
});

// ===================== the shipped routing cases: well-formed + the admission-rule assertion =====================

function loadRoutingCaseFiles() {
  return readdirSync(CASES_DIR)
    .filter((f) => f.startsWith("routing-") && f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(CASES_DIR, f), "utf8")));
}

test("the shipped routing cases cover all six verdicts, one per verdict, each validating", () => {
  const cases = loadRoutingCaseFiles();
  assert.ok(cases.length >= 6, `expected >=6 routing cases, found ${cases.length}`);
  for (const c of cases) {
    assert.doesNotThrow(() => validateCase(c), `case ${c.id} validates`);
    // each oracle is a single-element closed-set of one of the closed six
    assert.equal(c.oracle.closed_set.length, 1, `case ${c.id} oracle is single-element`);
    assert.ok(ROUTING_VERDICTS.includes(c.oracle.closed_set[0]), `case ${c.id} oracle is one of the closed six`);
  }
  // all six verdicts are exercised exactly
  const covered = new Set(cases.map((c) => c.oracle.closed_set[0]));
  for (const v of ROUTING_VERDICTS) assert.ok(covered.has(v), `a case covers ${v}`);
});

// --- the ADMISSION-RULE ASSERTION: a deterministic derived check over every shipped oracle verdict,
//     no second LLM judgement (spec §6.B). admits(verdict) iff verdict in {fire-and-forget, likely-fire}. ---
test("admission-rule assertion: admits(verdict) holds over every shipped routing case oracle", () => {
  for (const c of loadRoutingCaseFiles()) {
    const verdict = c.oracle.closed_set[0];
    const expectedAdmit = verdict === "fire-and-forget" || verdict === "likely-fire";
    assert.equal(admits(verdict), expectedAdmit,
      `case ${c.id}: verdict ${verdict} admission must be ${expectedAdmit}`);
  }
});

// --- DRY SMOKE (model-free): the spec's smoke test, but with a MOCK envelope instead of a real
//     `claude -p` run (the frontier baseline is human-supervised, FAFF-156-class — never faked here).
//     Proves the envelope→grade wiring for routing-001 end-to-end with zero spawned processes. ---
test("dry smoke: routing-001 grades PASS on the correct verdict, clean FAIL on a wrong one (no spawn)", async () => {
  const cases = loadRoutingCaseFiles().filter((c) => c.id === "routing-001");
  assert.equal(cases.length, 1, "routing-001 exists");
  const c = cases[0];
  const envOf = (payload) => ({ rawText: '```faff-eval:judgement\n' + JSON.stringify({ case_id: c.id, ...payload }) + '\n```', tokens: 3 });
  // correct verdict → PASS
  const ok = await runEvals({ cases: [c], driver: async () => envOf({ verdict: c.oracle.closed_set[0] }), baseReps: 2, maxReps: 2 });
  assert.equal(ok.cases[0].accuracy, 1);
  // a wrong verdict → clean FAIL, stable signature, no crash
  const wrong = await runEvals({ cases: [c], driver: async () => envOf({ verdict: "circular-blocked" }), baseReps: 2, maxReps: 2 });
  assert.equal(wrong.cases[0].accuracy, 0);
  assert.equal(wrong.cases[0].stability, 1); // same wrong answer twice → stable (a real flakiness signal would differ)
});
