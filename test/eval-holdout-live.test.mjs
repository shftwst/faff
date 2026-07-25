// FAFF-474 — mocked unit tests for the live holdout-live LIVE_KINDS adapter.
//
// Runs under `node --test` (free, ZERO spawn): the loader, the driveCase normalisation, the LIVE_KINDS
// registration, and the host-mediated agentic loop are all exercised with an injected STUB agentic-drive
// fn + a STUB container lifecycle (never a real `docker run`) and, for the loop mechanics, a scripted mock
// model + a mock fetch — mirroring how reconciliation/routing/verdict-build inject a mock model today.
// Only the CLI main() path (human-supervised) touches a real container or a real model.

import { test } from "node:test";
import assert from "node:assert/strict";

import { LIVE_KINDS, runLiveEvals } from "../eval/run-live-evals.mjs";
import { loadLiveCases } from "../eval/run-evals.mjs";
import { grade, KINDS, CLOSED_SET_KINDS } from "../eval/grader.mjs";
import {
  driveHoldoutLiveRep,
  hostMediatedDrive,
  fixtureContainers,
  parseExec,
} from "../eval/live-agent-driver.mjs";

// Parse a case's oracle closed_set (["c1:met", …]) into the { key: class } map the drive returns.
function oracleMap(c) {
  const m = {};
  for (const pair of c.oracle.closed_set) {
    const i = pair.indexOf(":");
    m[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return m;
}

// A stub container lifecycle: records up/down/waitReady calls, spawns no docker. `upOk:false` simulates a
// failed container launch so the teardown-on-error path is testable.
function stubLifecycle({ upOk = true, ready = true } = {}) {
  const calls = { up: [], down: [], waitReady: [] };
  return {
    calls,
    up(o) { calls.up.push(o.name); return upOk; },
    down(name) { calls.down.push(name); },
    dangling() { return ""; },
    async waitReady(ep) { calls.waitReady.push(ep); return ready; },
  };
}

// A stub agentic-drive fn: returns a fixed classification map + token tally, never calls a model or fetch.
function stubDrive(map, tokens = 7) {
  return async () => ({ classifications: map, tokens });
}

const cases = () => LIVE_KINDS["holdout-live"].loader();
const holdoutCtx = (overrides) => ({ runSkill: async () => ({}), model: async () => "", ...overrides });

// --- registration: the adapter joins the open registry with the documented { loader, driveCase } shape ---
test("LIVE_KINDS registers holdout-live with a { loader, driveCase } adapter", () => {
  assert.ok(LIVE_KINDS["holdout-live"], "holdout-live adapter is registered");
  assert.equal(typeof LIVE_KINDS["holdout-live"].loader, "function");
  assert.equal(typeof LIVE_KINDS["holdout-live"].driveCase, "function");
  // the sibling adapters are untouched (additive append)
  assert.ok(LIVE_KINDS.reconciliation && LIVE_KINDS.routing && LIVE_KINDS["verdict-build"]);
});

test("holdout-live is a known closed-set kind (grades through the existing holdout-exercise arm)", () => {
  assert.ok(KINDS.includes("holdout-live"), "holdout-live is a registered KIND");
  assert.ok(CLOSED_SET_KINDS.has("holdout-live"), "holdout-live grades via the closed-set path");
});

// --- loader: both committed cases load, validate, and carry the documented HoldoutLiveCase shape ---
test("the loader loads and validates both holdout-live cases", () => {
  const cs = cases();
  assert.ok(cs.length >= 2, "loader returns the committed holdout-live cases");
  assert.ok(cs.every((c) => c.kind === "holdout-live"));
  for (const c of cs) {
    assert.ok(c.fixture && c.fixture.image && c.fixture.port != null && c.fixture.health_path, `${c.id} carries a fixture descriptor`);
    assert.ok(Array.isArray(c.spec_dod) && c.spec_dod.length >= 1, `${c.id} carries a spec_dod`);
    assert.ok(Array.isArray(c.oracle.closed_set) && c.oracle.closed_set.length >= 1, `${c.id} carries a closed-set oracle`);
  }
  // at least one case expresses a distractor + a trap live (multiple containers)
  const withExtra = cs.find((c) => Array.isArray(c.fixture.extra) && c.fixture.extra.length >= 1);
  assert.ok(withExtra, "at least one case composes multiple containers (distractor + trap)");
  // a prose criterion is pinned needs-human in the oracle of every case
  for (const c of cs) {
    assert.ok(c.oracle.closed_set.some((p) => p.endsWith(":needs-human")), `${c.id} pins a criterion needs-human`);
  }
});

// --- driveCase normalisation: the drive's map becomes { env: { "holdout-exercise": {...} }, tokens } ---
test("driveCase normalises the agentic drive into the existing holdout-exercise grading field", async () => {
  const c = cases().find((x) => x.id === "holdout-live-001");
  const life = stubLifecycle();
  const { env, tokens } = await LIVE_KINDS["holdout-live"].driveCase(
    c,
    holdoutCtx({ agenticDrive: stubDrive(oracleMap(c)), lifecycle: life, repIndex: 0 }),
  );
  assert.deepEqual(env["holdout-exercise"], oracleMap(c), "the drive's classifications ride the holdout-exercise field");
  assert.equal(typeof tokens, "number");
  // teardown ran for every container that was stood up (success path)
  const nContainers = fixtureContainers(c.fixture).length;
  assert.equal(life.calls.up.length, nContainers, "one up() per container");
  assert.deepEqual([...life.calls.down].sort(), [...life.calls.up].sort(), "every container torn down");
});

// --- grade: the oracle map PASSES; the trap flipped to "met" FAILS (believing the live claim) ---
test("grade runs the existing holdout-exercise arm — oracle PASSES, trap-flip FAILS", () => {
  const c = cases().find((x) => x.id === "holdout-live-002");
  const oracle = oracleMap(c);
  assert.equal(grade(c, { "holdout-exercise": oracle }).graded, "PASS", "the correct live classification passes");
  // c1 is the trap: the status endpoint claims healthy, readiness shows the migration failed → unmet.
  // Believing the claim (met) over the counter-signal is the measured miss.
  const flipped = { ...oracle, c1: "met" };
  assert.equal(grade(c, { "holdout-exercise": flipped }).graded, "FAIL", "believing the claim over the counter-signal fails");
});

// --- a born-verifiable criterion classed anything but needs-human when it should be needs-human FAILs ---
test("a missing/garbage classification map yields a clean FAIL, never a throw", () => {
  const c = cases().find((x) => x.id === "holdout-live-001");
  assert.equal(grade(c, { "holdout-exercise": null }).graded, "FAIL", "a null map fails cleanly");
  assert.equal(grade(c, {}).graded, "FAIL", "a missing field fails cleanly");
});

// --- runLiveEvals drives every case via the runner + a stub drive/lifecycle and grades PASS ---
test("runLiveEvals drives every holdout-live case via a stub drive + lifecycle and grades PASS", async () => {
  for (const c of loadLiveCases().filter((x) => x.kind === "holdout-live")) {
    const life = stubLifecycle();
    const s = await runLiveEvals({
      kind: "holdout-live",
      only: c.id,
      ctx: holdoutCtx({ agenticDrive: stubDrive(oracleMap(c)), lifecycle: life }),
      baseReps: 3,
    });
    assert.equal(s.cases.length, 1, `${c.id} drove exactly one case`);
    const cr = s.cases[0];
    assert.equal(cr.accuracy, 1, `${c.id} grades PASS against its own oracle`);
    assert.equal(cr.stability, 1, `${c.id} is stable (deterministic stub)`);
    assert.equal(cr.escalated, false);
    // teardown ran on every rep (up count == down count over all reps)
    assert.equal(life.calls.down.length, life.calls.up.length, "every container torn down across every rep");
  }
});

// --- teardown runs on EVERY exit path: a failed container launch still tears the started container down ---
test("teardown runs even when a container fails to start (finally on the error path)", async () => {
  const c = cases().find((x) => x.id === "holdout-live-001");
  const life = stubLifecycle({ upOk: false });
  await assert.rejects(
    driveHoldoutLiveRep(c, holdoutCtx({ agenticDrive: stubDrive({}), lifecycle: life })),
    /failed to start/,
    "a failed launch surfaces as a loud, named error",
  );
  assert.equal(life.calls.down.length, 1, "the started container was torn down despite the error");
});

test("teardown runs even when the container never reaches health", async () => {
  const c = cases().find((x) => x.id === "holdout-live-001");
  const life = stubLifecycle({ ready: false });
  await assert.rejects(
    driveHoldoutLiveRep(c, holdoutCtx({ agenticDrive: stubDrive({}), lifecycle: life })),
    /never reached health/,
  );
  assert.equal(life.calls.down.length, 1, "the container was torn down after the health timeout");
});

// --- the host-mediated loop: the model DERIVES a command, the HOST executes it, the model then answers ---
test("hostMediatedDrive runs a host-executed command then returns the model's classification", async () => {
  const c = cases().find((x) => x.id === "holdout-live-001");
  const executed = [];
  // mock fetch: the host executes the derived command against the (mocked) live endpoint
  const fetchImpl = async (url) => {
    executed.push(url);
    return { ok: true, status: 200, text: async () => "ORDER_SUBMITTED" };
  };
  // a scripted mock model: turn 1 derives an exec; turn 2 (after seeing the host result) emits the verdict
  let turn = 0;
  const model = async (prompt) => {
    turn++;
    if (turn === 1) {
      assert.match(prompt, /How it evaluates/, "the first prompt carries the verbatim rubric prose");
      return "```faff-live:exec\n{ \"method\": \"GET\", \"url\": \"http://localhost:18781/\" }\n```";
    }
    assert.match(prompt, /HOST EXECUTED GET http:\/\/localhost:18781\//, "the host fed the raw response back");
    assert.match(prompt, /ORDER_SUBMITTED/, "the fed-back turn carries the real response body");
    return "```faff-eval:judgement\n" + JSON.stringify({ case_id: c.id, "holdout-exercise": { c1: "met", c2: "needs-human" } }) + "\n```";
  };
  const { classifications, tokens } = await hostMediatedDrive({
    model,
    endpoints: [{ label: "primary", url: "http://localhost:18781/" }],
    spec_dod: c.spec_dod,
    rubricProse: "## How it evaluates\n(rubric)\n",
    caseId: c.id,
    fetchImpl,
  });
  assert.deepEqual(executed, ["http://localhost:18781/"], "the host executed the model's derived command once");
  assert.deepEqual(classifications, { c1: "met", c2: "needs-human" });
  assert.ok(tokens > 0, "tokens accrue over the loop's turns");
});

// --- fail-closed: the model never answering within the turn budget → every criterion needs-human ---
test("hostMediatedDrive fails closed to needs-human when no final answer lands", async () => {
  const c = cases().find((x) => x.id === "holdout-live-001");
  const model = async () => "I have no idea and will not answer."; // no exec, no judgement
  const { classifications } = await hostMediatedDrive({
    model,
    endpoints: [{ label: "primary", url: "http://localhost:18781/" }],
    spec_dod: c.spec_dod,
    rubricProse: "## How it evaluates\n",
    caseId: c.id,
    maxTurns: 3,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "" }),
  });
  assert.deepEqual(classifications, { c1: "needs-human", c2: "needs-human" }, "no answer → fail-closed needs-human");
});

// --- parseExec: a well-formed block parses; a malformed/absent block is null (never a throw) ---
test("parseExec parses a command block and is null-safe on garbage", () => {
  assert.deepEqual(
    parseExec("```faff-live:exec\n{ \"method\": \"GET\", \"url\": \"http://x/\" }\n```"),
    { method: "GET", url: "http://x/" },
  );
  assert.equal(parseExec("no block here"), null);
  assert.equal(parseExec("```faff-live:exec\n{ not json }\n```"), null);
  assert.equal(parseExec("```faff-live:exec\n{ \"method\": \"GET\" }\n```"), null, "no url → null");
});
