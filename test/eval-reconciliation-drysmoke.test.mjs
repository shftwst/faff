// FAFF-154 — model-free dry-smoke for the `reconciliation` (faff-prep live-thread reconciliation)
// judgement-eval kind.
//
// Runs under `node --test` (free, zero frontier calls): the grader is pure, the live-driver is driven
// through the REAL FAFF-93 harness (runSkill + mock-tracker + seeded repo) with a MOCK model emitting
// a fixed `faff-eval:judgement` block, and the prompt builder is PURE. The real `claude -p` model is
// never invoked — eval/live-driver.mjs imports spawn lazily, only a real model fn would call it. The
// recorded frontier baseline (human-supervised real reps over these cases) is the carved
// faff-automation-hold follow-up, NOT done here.
//
// Proves the build's load-bearing properties (Decisions 4 + 5; ACs 1–5):
//   1. The committed cases-live/reconciliation-*.json fixtures load + validate (kind reconciliation,
//      FIXTURE_SHAPE fields present, per-comment id:label closed_set), and across the set all four
//      labels appear (incl. a Resolution-closes-Punt case + a noise-only negative control);
//   2. Each case driven through runSkill + reconciliationLiveDriver records the recorded bucket and
//      grades PASS against its single-author oracle (the live-driver seam end-to-end via the mock);
//   3. A WRONG or MISSING label → a clean FAIL with a distinct signature, no throw (fail-safe);
//   4. The reconciliation cases live OUTSIDE cases/ and are provably NOT picked up by the black-box
//      loadCases() sweep (Decision 4 option a — lane separation).
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadFixture } from "./helpers/mock-tracker.mjs";
import { seedRepo } from "./helpers/seed-repo.mjs";
import { runSkill } from "./helpers/skill-harness.mjs";
import { reconciliationLiveDriver, driveReconciliationCase } from "../eval/live-driver.mjs";
import { grade, validateCase, KINDS, CLOSED_SET_KINDS } from "../eval/grader.mjs";
import { loadCases, loadLiveCases } from "../eval/run-evals.mjs";

// A minimal harness substrate: the mock-tracker port (the seam-faithful listIssues read) + a seeded
// repo. The reconciliation classification rides the injected fixture, not the tracker contents.
function substrate() {
  const tracker = loadFixture({
    version: 1,
    issues: [{ id: "ISS-A", title: "anything", state: "Todo", stateCategory: "unstarted" }],
  });
  const repo = seedRepo({ commits: [{ message: "init", files: { "README.md": "x" } }] });
  return { tracker, repo };
}

// A mock model returning a reconciliation envelope built from a `{ id: label }` map.
function reconModel(labelMap) {
  return async () => "```faff-eval:judgement\n" + JSON.stringify({ case_id: "live", reconciliation: labelMap }) + "\n```";
}

// Parse a case's oracle closed_set (["c1:challenge", …]) back into the { id: label } map a model emits.
function oracleMap(c) {
  const m = {};
  for (const pair of c.oracle.closed_set) {
    const i = pair.indexOf(":");
    m[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return m;
}

// --- registry: reconciliation is a known, closed-set kind ---
test("reconciliation is registered in KINDS and CLOSED_SET_KINDS", () => {
  assert.ok(KINDS.includes("reconciliation"));
  assert.ok(CLOSED_SET_KINDS.has("reconciliation"));
});

// --- AC 1 + 2: the committed live cases load, validate, and cover all four labels ---
test("FAFF-154 the committed reconciliation cases-live fixtures load, validate, and cover all four labels", () => {
  const cases = loadLiveCases().filter((c) => c.kind === "reconciliation");
  assert.ok(cases.length >= 2, "expected >=2 reconciliation cases-live fixtures");

  const labels = new Set();
  let hasPuntResolution = false;
  let hasNoiseOnly = false;
  for (const c of cases) {
    validateCase(c); // kind reconciliation + FIXTURE_SHAPE ["issue","spec_comment","thread"] + closed_set
    // every post-spec comment has an oracle label; the set is single-author per-comment id:label
    assert.equal(c.oracle.closed_set.length, c.fixture.thread.length,
      `${c.id}: oracle must label every post-spec comment exactly once`);
    const caseLabels = c.oracle.closed_set.map((p) => p.split(":")[1]);
    caseLabels.forEach((l) => labels.add(l));
    // Scenario 2: the spec_comment carries an open Punt AND a comment resolves it
    if (/\*\*Punt:\*\*/.test(c.fixture.spec_comment.body) && caseLabels.includes("resolution")) hasPuntResolution = true;
    // Scenario 3: a noise-only negative control
    if (caseLabels.every((l) => l === "noise")) hasNoiseOnly = true;
  }
  for (const l of ["challenge", "resolution", "context", "noise"]) {
    assert.ok(labels.has(l), `expected >=1 comment labelled ${l} across the case set`);
  }
  assert.ok(hasPuntResolution, "expected a Resolution-closes-Punt case (Scenario 2)");
  assert.ok(hasNoiseOnly, "expected a noise-only negative control (Scenario 3)");
});

// --- AC 4: the live cases are NOT in the black-box loadCases() sweep (Decision 4 option a) ---
test("FAFF-154 reconciliation cases are NOT picked up by the black-box loadCases() sweep", () => {
  const blackBoxKinds = loadCases().map((c) => c.kind);
  assert.ok(!blackBoxKinds.includes("reconciliation"),
    "a reconciliation case must never be loaded by the black-box cases/ sweep");
  // and they DO live in the separate live-fixture dir
  assert.ok(loadLiveCases().some((c) => c.kind === "reconciliation"));
});

// --- AC 5 (PASS half): each committed case driven end-to-end through the live-driver grades PASS ---
test("FAFF-154 each committed case driven through runSkill + reconciliationLiveDriver grades PASS", async (t) => {
  for (const c of loadLiveCases().filter((x) => x.kind === "reconciliation")) {
    const { tracker, repo } = substrate();
    t.after(() => repo.teardown());

    const { record, bucket } = await driveReconciliationCase(c, {
      runSkill, tracker, repo, model: reconModel(oracleMap(c)),
    });
    assert.equal(record.driver, "live");
    assert.equal(record.skill, "faff-prep"); // the harness drove prep, not tidy
    assert.deepEqual(record.trackerReads.map((r) => r.method), ["listIssues"]); // seam-faithful read

    const res = grade(c, { reconciliation: oracleMap(c) });
    assert.equal(res.graded, "PASS", `${c.id} should grade PASS against its own oracle`);
    assert.equal(res.score, 1);
    // the recorded bucket is the same id:label set the oracle holds
    assert.deepEqual([...bucket].sort(), [...c.oracle.closed_set].sort());
  }
});

// --- AC 5 (FAIL half): one WRONG label → clean FAIL with a distinct signature, no throw ---
test("FAFF-154 a wrong label drives a clean FAIL with a distinct signature (no throw)", async (t) => {
  const c = loadLiveCases().find((x) => x.kind === "reconciliation");
  const { tracker, repo } = substrate();
  t.after(() => repo.teardown());

  // flip the first comment's label to a different in-enum label
  const m = oracleMap(c);
  const firstId = Object.keys(m)[0];
  const wrong = m[firstId] === "noise" ? "challenge" : "noise";
  const wrongMap = { ...m, [firstId]: wrong };

  const { bucket } = await driveReconciliationCase(c, { runSkill, tracker, repo, model: reconModel(wrongMap) });
  const pass = grade(c, { reconciliation: m });
  const fail = grade(c, { reconciliation: wrongMap });
  assert.equal(pass.graded, "PASS");
  assert.equal(fail.graded, "FAIL");
  assert.notEqual(fail.signature, pass.signature); // distinct signature
  assert.ok(bucket.includes(`${firstId}:${wrong}`)); // the wrong label is what got recorded
});

// --- AC 5 (fail-safe): a MISSING reconciliation field → empty set → clean FAIL, no throw ---
test("FAFF-154 a missing reconciliation envelope field yields an empty bucket and a clean FAIL", async (t) => {
  const c = loadLiveCases().find((x) => x.kind === "reconciliation");
  const { tracker, repo } = substrate();
  t.after(() => repo.teardown());

  // a model that emits NO reconciliation field at all
  const driver = reconciliationLiveDriver({ fixture: c.fixture, model: async () => "```faff-eval:judgement\n{\"case_id\":\"live\"}\n```" });
  const rec = await runSkill({ skill: "faff-prep", tracker, repo, driver });
  assert.deepEqual(rec.buckets.reconciliation, []); // empty bucket, no throw
  const res = grade(c, {}); // grader's pairsOf guard → empty predicted set
  assert.equal(res.graded, "FAIL");
  assert.equal(res.signature, "[]");
});

// --- AC 5 (fail-safe): an OUT-OF-ENUM label is passed through verbatim → clean FAIL, distinct sig ---
test("FAFF-154 an out-of-enum label fails cleanly with a verbatim distinct signature (no throw)", () => {
  const c = loadLiveCases().find((x) => x.kind === "reconciliation");
  const m = oracleMap(c);
  const firstId = Object.keys(m)[0];
  const res = grade(c, { reconciliation: { ...m, [firstId]: "steer" } }); // "steer" is out-of-enum
  assert.equal(res.graded, "FAIL");
  assert.match(res.signature, new RegExp(`${firstId}:steer`));
});

// --- AC 4 (driver inherited, not re-cut): the runner uses reconciliationLiveDriver unchanged ---
test("FAFF-154 driveReconciliationCase guards its inputs + reuses the inherited reconciliationLiveDriver", async () => {
  // async runner → guards surface as rejected promises, not synchronous throws
  await assert.rejects(driveReconciliationCase({ kind: "routing" }, {}), /reconciliation EvalCase/);
  await assert.rejects(driveReconciliationCase({ kind: "reconciliation", fixture: {} }, {}), /runSkill/);
});
