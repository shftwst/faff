// FAFF-135 — live-driver tests. Drives the REAL FAFF-93 harness (runSkill + mock-tracker + seeded
// repo) with a MOCK model (deterministic, zero spawn) and asserts the recorded DecisionRecord. The
// real `claude -p` model is never invoked here — eval/live-driver.mjs imports spawn lazily, only a
// real model fn would call it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadFixture } from "./helpers/mock-tracker.mjs";
import { seedRepo } from "./helpers/seed-repo.mjs";
import { runSkill } from "./helpers/skill-harness.mjs";
import { liveDriver, buildJudgementPrompt, makeLiveModel, buildReconciliationPrompt, reconciliationLiveDriver, makeLiveDriver, buildRoutingPrompt, routingLiveDriver } from "../eval/live-driver.mjs";
import { grade } from "../eval/grader.mjs";

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

// ===================== FAFF-146 — reconciliation live-driver (design wiring) =====================
// The live-driver is no longer faff-tidy-hardcoded: buildJudgementPrompt is one builder among
// several, and a prep reconciliation builder + driver exist. The end-to-end frontier RUN (real thread
// oracle + measured baseline) is the carved FAFF-145 follow-up; these tests prove the wiring composes
// through the real harness with a mock model (zero spawn).

const THREAD_FIXTURE = {
  version: 1,
  issue: { id: "ISS-7", title: "Add a webhook retry policy", description: "Retries on 5xx." },
  spec_comment: { id: "sc", posted_at: "2026-06-10T10:00:00Z", body: "# Spec\nChosen: exponential backoff, 5 attempts." },
  thread: [
    { id: "c1", posted_at: "2026-06-11T09:00:00Z", author: "dev", body: "This breaks the SLA — 5 attempts can take 30s, but the gateway times out at 10s." },
    { id: "c2", posted_at: "2026-06-11T10:00:00Z", author: "lead", body: "Decision: cap at 3 attempts with a 4s ceiling." },
    { id: "c3", posted_at: "2026-06-11T11:00:00Z", author: "dev", body: "FYI the gateway also strips custom headers on retry — worth knowing." },
    { id: "c4", posted_at: "2026-06-11T12:00:00Z", author: "pm", body: "+1, thanks" },
  ],
};

// A mock model returning a reconciliation envelope; captures the prompt it was handed.
function reconModel(payload, sink) {
  return async (prompt) => {
    if (sink) sink.prompt = prompt;
    return "```faff-eval:judgement\n" + JSON.stringify({ case_id: "live", ...payload }) + "\n```";
  };
}

// --- buildReconciliationPrompt folds in the verbatim Step-2a rubric, the thread, and the envelope ---
test("FAFF-146 buildReconciliationPrompt carries the prep rubric, the spec anchor, the thread, and the envelope", () => {
  const p = buildReconciliationPrompt(THREAD_FIXTURE, { caseId: "rc-x" });
  assert.match(p, /Challenge/); // prep's real Step-2a rubric is present
  assert.match(p, /Resolution/);
  assert.match(p, /the spec comment/i); // the anchor framing
  assert.match(p, /exponential backoff/); // the spec_comment body (anchor) is rendered
  assert.match(p, /c2/); // the thread comments are rendered by id
  assert.match(p, /"reconciliation"/); // the per-comment id:label envelope field
  assert.match(p, /faff-eval:judgement/);
  assert.match(p, /rc-x/); // caseId threaded into the instruction
});

test("FAFF-146 buildReconciliationPrompt omits the rubric when pluginDir is null (baseline)", () => {
  const p = buildReconciliationPrompt(THREAD_FIXTURE, { pluginDir: null });
  assert.ok(!p.includes("Challenge —"), "no rubric in the baseline prompt");
  assert.match(p, /faff-eval:judgement/);
});

// --- reconciliationLiveDriver drives runSkill({ skill: "faff-prep" }) and records the bucket ---
test("FAFF-146 reconciliationLiveDriver records per-comment id:label pairs via runSkill(faff-prep)", async (t) => {
  const tracker = fixtureModel(); // the harness tracker port (the seam-faithful read)
  const repo = seedFixtureRepo();
  t.after(() => repo.teardown());

  const driver = reconciliationLiveDriver({
    fixture: THREAD_FIXTURE,
    model: reconModel({ reconciliation: { c1: "challenge", c2: "resolution", c3: "context", c4: "noise" } }),
  });
  const rec = await runSkill({ skill: "faff-prep", tracker, repo, driver });

  assert.equal(rec.driver, "live");
  assert.equal(rec.skill, "faff-prep"); // the harness drove prep, not tidy (skill is opaque provenance)
  assert.deepEqual(rec.buckets.reconciliation, ["c1:challenge", "c2:resolution", "c3:context", "c4:noise"]);
  assert.deepEqual(rec.trackerReads.map((r) => r.method), ["listIssues"]); // read through the seam
});

test("FAFF-146 reconciliationLiveDriver guards its inputs", () => {
  assert.throws(() => reconciliationLiveDriver({ fixture: THREAD_FIXTURE }), /requires a model/);
  assert.throws(() => reconciliationLiveDriver({ model: async () => "" }), /ThreadFixture/);
});

// ===================== FAFF-158 — routing live-driver + the shared makeLiveDriver core =====================
// FAFF-158 completes the execution-entangled half of the routing judgement-eval FAFF-149 carved, and
// generalises the faff-tidy-hardcoded live-driver into ONE shared makeLiveDriver core that liveDriver
// (tidy), reconciliationLiveDriver (prep), and routingLiveDriver (routing) all configure. The frontier
// RUN (real claude -p reps) is the carved human-supervised follow-up; these tests are the standing
// model-free wiring proof (zero spawn).

// An assembled routing fixture-of-findings (the same shape as eval/cases/routing-*.json) whose inputs
// imply fire-and-forget: confidence:high, no open markers, no diagnostics, independent, empty park-history.
const ROUTING_FIXTURE = {
  version: 1,
  issue: { id: "PROJ-201", title: "Add a per-IP rate-limit middleware on the auth routes", status: "Todo" },
  spec: { confidence: "high", markers: [] },
  diagnostics: { in_cycle: false, ghost_project_or_missing_dep: null },
  conflict: { independent: true, collision_group: [] },
  park_history: [],
};

// A mock model returning a routing (verdict-assign) envelope; captures the prompt it was handed.
function routingModel(payload, sink) {
  return async (prompt) => {
    if (sink) sink.prompt = prompt;
    return "```faff-eval:judgement\n" + JSON.stringify({ case_id: "live", ...payload }) + "\n```";
  };
}

// --- buildRoutingPrompt folds in the verbatim routing rubric, the rendered fixture, and the envelope ---
test("FAFF-158 buildRoutingPrompt carries the routing rubric, the assembled findings, and the envelope", () => {
  const p = buildRoutingPrompt(ROUTING_FIXTURE, { caseId: "rt-x" });
  assert.match(p, /fire-and-forget/); // the closed-six verdict vocabulary from the rubric / instruction
  assert.match(p, /automation-routing/i); // the routing assignment framing
  assert.match(p, /PROJ-201/); // the issue is rendered
  assert.match(p, /"confidence": "high"/); // the spec confidence input is rendered
  assert.match(p, /park[_ ]history/i); // the park-history input is rendered
  assert.match(p, /"verdict"/); // the single-verdict envelope field
  assert.match(p, /faff-eval:judgement/);
  assert.match(p, /rt-x/); // caseId threaded into the instruction
});

test("FAFF-158 buildRoutingPrompt omits the rubric when pluginDir is null (baseline)", () => {
  const p = buildRoutingPrompt(ROUTING_FIXTURE, { pluginDir: null });
  // the rubric framing line is absent; the rendered fixture + instruction remain
  assert.ok(!p.includes("these are the gateway + adaptor rules, verbatim"), "no rubric in the baseline prompt");
  assert.match(p, /faff-eval:judgement/);
  assert.match(p, /PROJ-201/);
});

// --- Scenario 1: routingLiveDriver drives runSkill and records a single-element routing bucket ---
test("FAFF-158 routingLiveDriver records the assigned verdict as a single-element routing bucket", async (t) => {
  const tracker = fixtureModel();
  const repo = seedFixtureRepo();
  t.after(() => repo.teardown());

  const driver = routingLiveDriver({ fixture: ROUTING_FIXTURE, model: routingModel({ verdict: "fire-and-forget" }) });
  const rec = await runSkill({ skill: "faff-tidy", tracker, repo, driver });

  assert.equal(rec.driver, "live");
  assert.deepEqual(rec.buckets.routing, ["fire-and-forget"]); // single assigned verdict recorded at the seam
  assert.deepEqual(rec.trackerReads.map((r) => r.method), ["listIssues"]); // a trackerRead seam is present
});

// --- the routing rubric is actually injected into the driver's prompt ---
test("FAFF-158 routingLiveDriver injects the routing rubric + the fixture into the model prompt", async (t) => {
  const tracker = fixtureModel();
  const repo = seedFixtureRepo();
  t.after(() => repo.teardown());

  const sink = {};
  await runSkill({
    skill: "faff-tidy",
    tracker,
    repo,
    driver: routingLiveDriver({ fixture: ROUTING_FIXTURE, model: routingModel({ verdict: "fire-and-forget" }, sink) }),
  });
  assert.match(sink.prompt, /PROJ-201/);
  assert.match(sink.prompt, /circular-blocked/); // closed-six vocabulary present (rubric / instruction)
  assert.match(sink.prompt, /faff-eval:judgement/);
});

// --- the recorded bucket grades through the EXISTING routing grade path (no grader change) ---
test("FAFF-158 the recorded routing bucket grades PASS/FAIL via the existing routing grade path", async (t) => {
  const tracker = fixtureModel();
  const repo = seedFixtureRepo();
  t.after(() => repo.teardown());

  const oracleCase = { id: "rt-live", kind: "routing", oracle: { closed_set: ["fire-and-forget"] } };

  // correct verdict -> PASS
  const recOk = await runSkill({
    skill: "faff-tidy", tracker, repo,
    driver: routingLiveDriver({ fixture: ROUTING_FIXTURE, model: routingModel({ verdict: "fire-and-forget" }) }),
  });
  const pass = grade(oracleCase, { verdict: recOk.buckets.routing[0] });
  assert.equal(pass.graded, "PASS");

  // Scenario 3: a wrong-but-in-enum verdict -> a clean FAIL with a distinct signature, no crash
  const recWrong = await runSkill({
    skill: "faff-tidy", tracker, repo,
    driver: routingLiveDriver({ fixture: ROUTING_FIXTURE, model: routingModel({ verdict: "gap-blocked" }) }),
  });
  const fail = grade(oracleCase, { verdict: recWrong.buckets.routing[0] });
  assert.equal(fail.graded, "FAIL");
  assert.notEqual(fail.signature, pass.signature); // distinct signature
});

// --- a missing verdict yields an empty bucket -> clean grader FAIL, never a throw ---
test("FAFF-158 a missing verdict yields an empty routing bucket and a clean FAIL", async (t) => {
  const tracker = fixtureModel();
  const repo = seedFixtureRepo();
  t.after(() => repo.teardown());

  const rec = await runSkill({
    skill: "faff-tidy", tracker, repo,
    driver: routingLiveDriver({ fixture: ROUTING_FIXTURE, model: routingModel({}) }), // no verdict field
  });
  assert.deepEqual(rec.buckets.routing, []); // empty bucket, no throw
  const res = grade({ id: "rt", kind: "routing", oracle: { closed_set: ["fire-and-forget"] } }, { verdict: rec.buckets.routing[0] });
  assert.equal(res.graded, "FAIL");
});

// --- contract guards ---
test("FAFF-158 routingLiveDriver guards a missing model and a malformed fixture", () => {
  assert.throws(() => routingLiveDriver({ fixture: ROUTING_FIXTURE }), /requires a model/);
  assert.throws(() => routingLiveDriver({ model: async () => "" }), /routing fixture/); // no fixture
  assert.throws(() => routingLiveDriver({ model: async () => "", fixture: { spec: {} } }), /routing fixture/); // no issue
  assert.throws(() => routingLiveDriver({ model: async () => "", fixture: { issue: {} } }), /routing fixture/); // no spec
});

// --- the generic core: makeLiveDriver guards + the pairs reducer records multiple buckets ---
test("FAFF-158 makeLiveDriver guards model / buildPrompt / readEnvelope", () => {
  assert.throws(() => makeLiveDriver({}), /requires a model/);
  assert.throws(() => makeLiveDriver({ model: async () => "" }), /buildPrompt/);
  assert.throws(() => makeLiveDriver({ model: async () => "", buildPrompt: () => "" }), /readEnvelope/);
});

test("FAFF-158 makeLiveDriver records every {name, items} pair its reducer returns (multi-bucket)", async (t) => {
  const tracker = fixtureModel();
  const repo = seedFixtureRepo();
  t.after(() => repo.teardown());

  // a custom reducer returning TWO pairs proves the core absorbs the multi-bucket case generically
  const driver = makeLiveDriver({
    model: async () => "```faff-eval:judgement\n" + JSON.stringify({ case_id: "live", classifications: { dupe: ["A", "B"] }, ordering: ["C"] }) + "\n```",
    skill: "faff-tidy",
    buildPrompt: () => "x",
    readEnvelope: (env) => [
      { name: "dupe", items: env.classifications.dupe },
      { name: "ordering", items: env.ordering },
    ],
  });
  const rec = await runSkill({ skill: "faff-tidy", tracker, repo, driver });
  assert.deepEqual(rec.buckets.dupe, ["A", "B"]);
  assert.deepEqual(rec.buckets.ordering, ["C"]);
});

// --- Scenario 2 (behaviour-preservation) is covered by the unchanged FAFF-135/146 tests above passing. ---
