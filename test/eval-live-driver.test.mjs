// FAFF-135 — live-driver tests. Drives the REAL FAFF-93 harness (runSkill + mock-tracker + seeded
// repo) with a MOCK model (deterministic, zero spawn) and asserts the recorded DecisionRecord. The
// real `claude -p` model is never invoked here — eval/live-driver.mjs imports spawn lazily, only a
// real model fn would call it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadFixture } from "./helpers/mock-tracker.mjs";
import { seedRepo } from "./helpers/seed-repo.mjs";
import { runSkill } from "./helpers/skill-harness.mjs";
import { liveDriver, buildJudgementPrompt, makeLiveModel } from "../eval/live-driver.mjs";

// A fixture with a dupe pair (ISS-A / ISS-B) + an unrelated ISS-C.
function fixtureModel() {
  return loadFixture({
    version: 1,
    labels: [{ name: "faff-automate", color: "#5e6ad2" }],
    issues: [
      { id: "ISS-A", title: "Add login rate limiting", state: "Backlog", stateCategory: "backlog" },
      { id: "ISS-B", title: "Rate-limit the login endpoint", state: "Backlog", stateCategory: "backlog" },
      { id: "ISS-C", title: "Dark mode toggle", state: "Todo", stateCategory: "unstarted" },
    ],
  });
}
function seedFixtureRepo() {
  return seedRepo({ commits: [{ message: "init", files: { "README.md": "x" } }] });
}

// A mock model returning a fixed judgement envelope; captures the prompt it was handed.
function mockModel(payload, sink) {
  return async (prompt) => {
    if (sink) sink.prompt = prompt;
    return "```faff-eval:judgement\n" + JSON.stringify({ case_id: "live", ...payload }) + "\n```";
  };
}

// --- the live driver records the model's classifications as DecisionRecord buckets ---
test("liveDriver drives runSkill and records the judgement as buckets", async (t) => {
  const tracker = fixtureModel();
  const repo = seedFixtureRepo();
  t.after(() => repo.teardown());

  const driver = liveDriver({ model: mockModel({ classifications: { dupe: ["ISS-A", "ISS-B"] }, ordering: ["ISS-C"] }) });
  const rec = await runSkill({ skill: "faff-tidy", tracker, repo, driver });

  assert.equal(rec.driver, "live"); // provenance: the harness tagged it live
  assert.deepEqual(rec.buckets.dupe, ["ISS-A", "ISS-B"]); // classification recorded at the seam
  assert.deepEqual(rec.buckets.ordering, ["ISS-C"]);
  // the driver read the fixture through the harness tracker port
  assert.deepEqual(rec.trackerReads.map((r) => r.method), ["listIssues"]);
  assert.equal(rec.trackerReads[0].resultCount, 3);
});

// --- only the populated classification kinds become buckets (no empty noise) ---
test("liveDriver records only the kinds the model populated", async (t) => {
  const tracker = fixtureModel();
  const repo = seedFixtureRepo();
  t.after(() => repo.teardown());

  const rec = await runSkill({
    skill: "faff-tidy",
    tracker,
    repo,
    driver: liveDriver({ model: mockModel({ classifications: { vague: ["ISS-C"] } }) }),
  });
  assert.deepEqual(rec.buckets.vague, ["ISS-C"]);
  assert.ok(!("dupe" in rec.buckets), "no empty dupe bucket");
  assert.ok(!("ordering" in rec.buckets), "no ordering bucket when absent");
});

// --- the prompt handed to the model carries the real rubric + the issues + the envelope spec ---
test("buildJudgementPrompt (via the driver) injects the rubric, the issues, and the envelope instruction", async (t) => {
  const tracker = fixtureModel();
  const repo = seedFixtureRepo();
  t.after(() => repo.teardown());

  const sink = {};
  await runSkill({
    skill: "faff-tidy",
    tracker,
    repo,
    driver: liveDriver({ model: mockModel({ classifications: { dupe: ["ISS-A", "ISS-B"] } }, sink) }),
  });
  assert.match(sink.prompt, /Dupes:/); // faff-tidy's real rubric is present
  assert.match(sink.prompt, /ISS-A/); // the issues read from the fixture are present
  assert.match(sink.prompt, /faff-eval:judgement/); // the shared envelope contract
  assert.match(sink.prompt, /"case_id": "live"|case_id/); // caseId threaded into the instruction
});

// --- pluginDir:null is the rubric-less baseline ---
test("buildJudgementPrompt omits the rubric when pluginDir is null (baseline)", () => {
  const prompt = buildJudgementPrompt([{ id: "X" }], { pluginDir: null });
  assert.ok(!prompt.includes("Dupes:"), "no rubric in the baseline prompt");
  assert.match(prompt, /faff-eval:judgement/);
});

// --- contract guards ---
test("liveDriver requires a model function; makeLiveModel returns one", () => {
  assert.throws(() => liveDriver({}), /requires a model/);
  assert.equal(typeof makeLiveModel({ bin: "claude" }), "function"); // construction only — no spawn
});
