// FAFF-155 — model-free dry-smoke for the `verdict-build` (faff-graft whole-change review verdict)
// judgement-eval kind.
//
// Runs under `node --test` (free, zero frontier calls): the grader is pure, the live-driver is driven
// through the REAL FAFF-93 harness (runSkill + mock-tracker + seeded repo) with a MOCK model emitting
// a fixed `faff-eval:judgement` block, and the prompt builder is PURE. The real `claude -p` model is
// never invoked — eval/live-driver.mjs imports spawn lazily, only a real model fn would call it. The
// recorded frontier baseline (human-supervised real reps over this case) is the carved
// faff-automation-hold follow-up, NOT done here.
//
// Mirrors test/eval-reconciliation-drysmoke.test.mjs. Proves the build's load-bearing properties:
//   1. The committed cases-live/verdict-build-*.json fixture loads + validates (kind verdict-build,
//      FIXTURE_SHAPE ["spec","diff"] present, single-element {pass,fail,needs-human} closed_set);
//   2. The case driven through runSkill + verdictBuildLiveDriver records the recorded bucket and grades
//      PASS against its single-author oracle (the live-driver seam end-to-end via the mock), with the
//      harness driving skill: "faff-graft" and a seam-faithful listIssues read;
//   3. A WRONG verdict → a clean FAIL with a distinct signature; a MISSING/OUT-OF-ENUM verdict → an empty
//      / verbatim bucket → a clean FAIL, no throw (the fail-safe — no eval-side coercion);
//   4. The verdict-build case lives OUTSIDE cases/ and is provably NOT picked up by the black-box
//      loadCases() sweep (lane separation, the FAFF-154 property);
//   5. verdictBuildLiveDriver is a thin wrapper over makeLiveDriver (reuse, not re-cut) — the runner
//      reuses the inherited driver, and the wrapper/runner guard their inputs.
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadFixture } from "./helpers/mock-tracker.mjs";
import { seedRepo } from "./helpers/seed-repo.mjs";
import { runSkill } from "./helpers/skill-harness.mjs";
import { verdictBuildLiveDriver, driveVerdictBuildCase } from "../eval/live-driver.mjs";
import { grade, validateCase, KINDS, CLOSED_SET_KINDS } from "../eval/grader.mjs";
import { loadCases, loadLiveCases } from "../eval/run-evals.mjs";

// A minimal harness substrate: the mock-tracker port (the seam-faithful listIssues read) + a seeded
// repo. The verdict-build judgement rides the injected fixture, not the tracker contents.
function substrate() {
  const tracker = loadFixture({
    version: 1,
    issues: [{ id: "ISS-A", title: "anything", state: "Todo", stateCategory: "unstarted" }],
  });
  const repo = seedRepo({ commits: [{ message: "init", files: { "README.md": "x" } }] });
  return { tracker, repo };
}

// A mock model returning a verdict-build envelope carrying a single `verdict`.
function verdictModel(verdict) {
  return async () => "```faff-eval:judgement\n" + JSON.stringify({ case_id: "live", verdict }) + "\n```";
}

// --- registry: verdict-build is a known, closed-set kind ---
test("verdict-build is registered in KINDS and CLOSED_SET_KINDS", () => {
  assert.ok(KINDS.includes("verdict-build"));
  assert.ok(CLOSED_SET_KINDS.has("verdict-build"));
});

// --- AC 1: the committed live case loads, validates, and carries the BuildFixture + single-verdict oracle ---
test("FAFF-155 the committed verdict-build cases-live fixture loads, validates, and carries a single-verdict oracle", () => {
  const cases = loadLiveCases().filter((c) => c.kind === "verdict-build");
  assert.ok(cases.length >= 1, "expected >=1 verdict-build cases-live fixture");
  for (const c of cases) {
    validateCase(c); // kind verdict-build + FIXTURE_SHAPE ["spec","diff"] + single-element closed_set
    assert.equal(c.oracle.closed_set.length, 1, `${c.id}: the whole-change oracle is a single verdict`);
    assert.ok(["pass", "fail", "needs-human"].includes(c.oracle.closed_set[0]),
      `${c.id}: the verdict is one of pass/fail/needs-human`);
    assert.ok(c.fixture.spec != null && c.fixture.diff != null, `${c.id}: BuildFixture carries spec + diff`);
  }
});

// --- AC: lane separation — the live case is NOT in the black-box loadCases() sweep (the FAFF-154 property) ---
test("FAFF-155 verdict-build cases are NOT picked up by the black-box loadCases() sweep", () => {
  const blackBoxKinds = loadCases().map((c) => c.kind);
  assert.ok(!blackBoxKinds.includes("verdict-build"),
    "a verdict-build case must never be loaded by the black-box cases/ sweep");
  assert.ok(loadLiveCases().some((c) => c.kind === "verdict-build"));
});

// --- AC (PASS half): the committed case driven end-to-end through the live-driver grades PASS ---
test("FAFF-155 the committed case driven through runSkill + verdictBuildLiveDriver grades PASS", async (t) => {
  for (const c of loadLiveCases().filter((x) => x.kind === "verdict-build")) {
    const { tracker, repo } = substrate();
    t.after(() => repo.teardown());

    const verdict = c.oracle.closed_set[0];
    const { record, bucket } = await driveVerdictBuildCase(c, {
      runSkill, tracker, repo, model: verdictModel(verdict),
    });
    assert.equal(record.driver, "live");
    assert.equal(record.skill, "faff-graft"); // review is faff-graft's Step-9 phase (the provenance tag)
    assert.deepEqual(record.trackerReads.map((r) => r.method), ["listIssues"]); // seam-faithful read

    const res = grade(c, { verdict });
    assert.equal(res.graded, "PASS", `${c.id} should grade PASS against its own oracle`);
    assert.equal(res.score, 1);
    assert.deepEqual([...bucket], [verdict]); // the recorded bucket is the single assigned verdict
  }
});

// --- AC (FAIL half): a WRONG verdict → clean FAIL with a distinct signature, no throw ---
test("FAFF-155 a wrong verdict drives a clean FAIL with a distinct signature (no throw)", async (t) => {
  const c = loadLiveCases().find((x) => x.kind === "verdict-build");
  const { tracker, repo } = substrate();
  t.after(() => repo.teardown());

  const right = c.oracle.closed_set[0];
  const wrong = right === "pass" ? "fail" : "pass";
  const { bucket } = await driveVerdictBuildCase(c, { runSkill, tracker, repo, model: verdictModel(wrong) });
  const pass = grade(c, { verdict: right });
  const fail = grade(c, { verdict: wrong });
  assert.equal(pass.graded, "PASS");
  assert.equal(fail.graded, "FAIL");
  assert.notEqual(fail.signature, pass.signature); // distinct signature
  assert.deepEqual([...bucket], [wrong]); // the wrong verdict is what got recorded
});

// --- AC (fail-safe): a MISSING verdict field → empty bucket → clean FAIL, no throw ---
test("FAFF-155 a missing verdict envelope field yields an empty bucket and a clean FAIL", async (t) => {
  const c = loadLiveCases().find((x) => x.kind === "verdict-build");
  const { tracker, repo } = substrate();
  t.after(() => repo.teardown());

  const driver = verdictBuildLiveDriver({ fixture: c.fixture, model: async () => "```faff-eval:judgement\n{\"case_id\":\"live\"}\n```" });
  const rec = await runSkill({ skill: "faff-graft", tracker, repo, driver });
  assert.deepEqual(rec.buckets["verdict-build"], []); // empty bucket, no throw
  const res = grade(c, {}); // predictedSet verdict-build arm → empty predicted set
  assert.equal(res.graded, "FAIL");
  assert.equal(res.signature, "[]");
});

// --- AC (fail-safe): an OUT-OF-ENUM verdict is passed through verbatim → clean FAIL, distinct sig ---
test("FAFF-155 an out-of-enum verdict fails cleanly with a verbatim distinct signature (no throw)", () => {
  const c = loadLiveCases().find((x) => x.kind === "verdict-build");
  const res = grade(c, { verdict: "merge-it" }); // "merge-it" is out-of-enum, no eval-side coercion
  assert.equal(res.graded, "FAIL");
  assert.match(res.signature, /merge-it/);
});

// --- the wrapper is reused, not re-cut: the runner reuses verdictBuildLiveDriver + both guard inputs ---
test("FAFF-155 driveVerdictBuildCase guards its inputs + reuses the inherited verdictBuildLiveDriver", async () => {
  // async runner → guards surface as rejected promises, not synchronous throws
  await assert.rejects(driveVerdictBuildCase({ kind: "routing" }, {}), /verdict-build EvalCase/);
  await assert.rejects(driveVerdictBuildCase({ kind: "verdict-build", fixture: { spec: "s", diff: "d" } }, {}), /runSkill/);
  // the wrapper guards a missing model + a malformed fixture (no spec/diff)
  assert.throws(() => verdictBuildLiveDriver({ fixture: { spec: "s", diff: "d" } }), /model\(prompt\)/);
  assert.throws(() => verdictBuildLiveDriver({ model: () => {}, fixture: { spec: "s" } }), /BuildFixture/);
});
