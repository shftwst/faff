// FAFF-93 — Skill-run harness self-test.
//
// Exercises the harness with the DETERMINISTIC scripted driver only — no LLM, no
// network, no key, no clock — so it runs under bare `node --test` (auto-discovered;
// no validate.yml edit). Composes the real FAFF-89 mock-tracker and FAFF-90 seeded
// repo, and shells the real `faff` CLI against the seeded repo. The §7 integration
// smoke test is the backbone; the remaining cases cover the edge-case + provenance ACs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadFixture } from "./helpers/mock-tracker.mjs";
import { seedRepo } from "./helpers/seed-repo.mjs";
import {
  runSkill,
  scriptedDriver,
  makeRecorder,
  HarnessError,
} from "./helpers/skill-harness.mjs";

// A fixed two-issue fixture: ISS-A (Backlog, faff-automate, one spec comment) + ISS-B (Todo).
function fixtureModel() {
  return loadFixture({
    version: 1,
    labels: [{ name: "faff-automate", color: "#5e6ad2" }],
    issues: [
      {
        id: "ISS-A",
        title: "A",
        state: "Backlog",
        stateCategory: "backlog",
        labels: ["faff-automate"],
      },
      { id: "ISS-B", title: "B", state: "Todo", stateCategory: "unstarted" },
    ],
    comments: [
      {
        id: "C1",
        issueId: "ISS-A",
        body: "# spec\nconfidence: high\n",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ],
  });
}

// A seeded repo with a committed spec for ISS-A.
function seedFixtureRepo() {
  return seedRepo({
    commits: [{ message: "init", files: { "README.md": "x" } }],
    specs: [{ issue: "ISS-A", location: "committed", body: "# spec\nconfidence: high\n" }],
  });
}

// The §7 smoke script — one of each seam kind, in a fixed order.
function smokeScript() {
  return [
    { read: { method: "listIssues", args: { stateCategory: "backlog" } } },
    { read: { method: "listComments", args: { issueId: "ISS-A" } } },
    { cli: ["next", "--status", "backlog", "--spec", "high"] },
    { verdict: { issue: "ISS-A", token: "prep", source: "faff next" } },
    { bucket: { name: "ready", issues: ["ISS-A"] } },
    { mutate: { op: "setStatus", issue: "ISS-A", args: { status: "Todo" } } },
    { render: { surface: "tidy-report" } },
  ];
}

test("§7 smoke: scripted run captures every seam into the DecisionRecord", (t) => {
  const tracker = fixtureModel();
  const repo = seedFixtureRepo();
  t.after(() => repo.teardown());

  const rec = runSkill({
    skill: "faff-tidy",
    tracker,
    repo,
    driver: scriptedDriver(smokeScript()),
  });

  // provenance
  assert.equal(rec.skill, "faff-tidy");
  assert.equal(rec.driver, "scripted");

  // tracker reads served (method/args/resultCount, never bodies)
  assert.deepEqual(
    rec.trackerReads.map((r) => r.method),
    ["listIssues", "listComments"],
  );
  assert.deepEqual(rec.trackerReads[0].args, { stateCategory: "backlog" });
  assert.equal(rec.trackerReads[0].resultCount, 1); // only ISS-A is Backlog
  assert.equal(rec.trackerReads[1].resultCount, 1); // one comment on ISS-A

  // CLI seam — argv verbatim, real `faff` exit recorded (not the prose stdout asserted)
  assert.deepEqual(rec.cliCalls[0].argv, ["next", "--status", "backlog", "--spec", "high"]);
  assert.equal(rec.cliCalls[0].exit, 0);
  assert.equal(typeof rec.cliCalls[0].stdout, "string");

  // verdict / bucket / mutation(attempt) / rendering
  assert.deepEqual(rec.verdicts[0], {
    seq: rec.verdicts[0].seq,
    issue: "ISS-A",
    token: "prep",
    source: "faff next",
  });
  assert.deepEqual(rec.buckets.ready, ["ISS-A"]);
  assert.deepEqual(rec.mutations[0], {
    seq: rec.mutations[0].seq,
    op: "setStatus",
    issue: "ISS-A",
    args: { status: "Todo" },
  });
  assert.equal(rec.renderings[0].surface, "tidy-report");

  // seamLog is the source of truth: 7 seams, seq is 0..6 monotonic
  assert.equal(rec.seamLog.length, 7);
  assert.deepEqual(
    rec.seamLog.map((e) => e.seq),
    [0, 1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(
    rec.seamLog.map((e) => e.kind),
    ["trackerRead", "trackerRead", "cliCall", "verdict", "bucket", "mutation", "rendering"],
  );
});

test("typed lists are VIEWS over seamLog (same payloads, cross-seam order preserved)", (t) => {
  const tracker = fixtureModel();
  const repo = seedFixtureRepo();
  t.after(() => repo.teardown());

  const rec = runSkill({
    skill: "faff-tidy",
    tracker,
    repo,
    driver: scriptedDriver(smokeScript()),
  });

  // every typed-list entry is the very payload object in seamLog at that seq
  const byKind = { trackerRead: rec.trackerReads, mutation: rec.mutations, cliCall: rec.cliCalls, verdict: rec.verdicts, rendering: rec.renderings };
  for (const ev of rec.seamLog) {
    if (ev.kind === "bucket") {
      assert.deepEqual(rec.buckets[ev.payload.name], ev.payload.issues);
      continue;
    }
    const list = byKind[ev.kind];
    const found = list.find((p) => p.seq === ev.payload.seq);
    assert.strictEqual(found, ev.payload, `${ev.kind} payload must be the same reference as in seamLog`);
  }

  // cross-seam ordering recoverable: the CLI call precedes the verdict it informed
  assert.ok(rec.cliCalls[0].seq < rec.verdicts[0].seq);
  // and the reads precede the bucket assignment
  assert.ok(rec.trackerReads.every((r) => r.seq < rec.seamLog.find((e) => e.kind === "bucket").seq));
});

test("determinism: same fixture + repo + script yields a deep-equal record", (t) => {
  const tracker = fixtureModel();
  const repo = seedFixtureRepo();
  t.after(() => repo.teardown());

  const a = runSkill({ skill: "faff-tidy", tracker, repo, driver: scriptedDriver(smokeScript()) });
  const b = runSkill({ skill: "faff-tidy", tracker, repo, driver: scriptedDriver(smokeScript()) });
  assert.deepEqual(a, b);
});

test("mutations are recorded as ATTEMPTS, never applied to the read-only model", (t) => {
  const tracker = fixtureModel();
  const repo = seedFixtureRepo();
  t.after(() => repo.teardown());

  runSkill({ skill: "faff-tidy", tracker, repo, driver: scriptedDriver(smokeScript()) });

  // the model never saw the setStatus -> ISS-A is still Backlog
  assert.equal(tracker.getIssue("ISS-A").state, "Backlog");
  assert.equal(tracker.getIssue("ISS-A").stateCategory, "backlog");
});

test("fail-loud: an unknown tracker read method throws HarnessError", (t) => {
  const tracker = fixtureModel();
  const repo = seedFixtureRepo();
  t.after(() => repo.teardown());

  assert.throws(
    () =>
      runSkill({
        skill: "faff-tidy",
        tracker,
        repo,
        driver: scriptedDriver([{ read: { method: "noSuchMethod", args: {} } }]),
      }),
    HarnessError,
  );
});

test("a non-zero `faff` CLI exit is recorded, not thrown", (t) => {
  const tracker = fixtureModel();
  const repo = seedFixtureRepo();
  t.after(() => repo.teardown());

  // `config path` in a config-less seeded repo exits 3 — observational, not an error.
  const rec = runSkill({
    skill: "faff-tidy",
    tracker,
    repo,
    driver: scriptedDriver([{ cli: ["config", "path"] }]),
  });
  assert.equal(rec.cliCalls.length, 1);
  assert.notEqual(rec.cliCalls[0].exit, 0);
});

test("empty record: a driver that emits no seams yields a valid empty DecisionRecord", (t) => {
  const tracker = fixtureModel();
  const repo = seedFixtureRepo();
  t.after(() => repo.teardown());

  const rec = runSkill({ skill: "faff-tidy", tracker, repo, driver: scriptedDriver([]) });
  assert.deepEqual(rec.trackerReads, []);
  assert.deepEqual(rec.mutations, []);
  assert.deepEqual(rec.cliCalls, []);
  assert.deepEqual(rec.verdicts, []);
  assert.deepEqual(rec.renderings, []);
  assert.deepEqual(rec.buckets, {});
  assert.deepEqual(rec.seamLog, []);
  assert.equal(rec.driver, "scripted");
});

test("an async (live-shaped) driver makes runSkill return a Promise and stamps driver=live", async (t) => {
  const tracker = fixtureModel();
  const repo = seedFixtureRepo();
  t.after(() => repo.teardown());

  const liveDriver = {
    kind: "live",
    async drive(ctx) {
      await Promise.resolve();
      ctx.tracker.listIssues({ stateCategory: "backlog" });
      ctx.record.recordVerdict("ISS-A", "graft", "faff next");
      ctx.record.recordRendering("wtf-briefing");
    },
  };

  const pending = runSkill({ skill: "faff-wtf", tracker, repo, driver: liveDriver });
  assert.equal(typeof pending.then, "function"); // async driver -> Promise
  const rec = await pending;

  assert.equal(rec.driver, "live");
  assert.equal(rec.trackerReads.length, 1);
  assert.equal(rec.verdicts[0].token, "graft");
  assert.equal(rec.renderings[0].surface, "wtf-briefing");
});

test("makeRecorder is reusable standalone (FAFF-95 surface) with monotonic seq", () => {
  const rec = makeRecorder();
  rec.recordRead("listIssues", { stateCategory: "backlog" }, 2);
  rec.recordVerdict("ISS-A", "prep", "faff next");
  rec.recordBucket("ready", ["ISS-A", "ISS-B"]);
  const record = rec.assemble("faff-tidy", "scripted");

  assert.deepEqual(record.seamLog.map((e) => e.seq), [0, 1, 2]);
  assert.equal(record.trackerReads[0].resultCount, 2);
  assert.deepEqual(record.buckets.ready, ["ISS-A", "ISS-B"]);
  // publicApi exposes only the four direct-record methods a driver may call
  assert.deepEqual(Object.keys(rec.publicApi()).sort(), [
    "recordBucket",
    "recordMutation",
    "recordRendering",
    "recordVerdict",
  ]);
});

test("input validation: runSkill fails loud on a missing tracker or repo", () => {
  assert.throws(() => runSkill({ skill: "x", repo: { root: "/tmp" } }), HarnessError);
  assert.throws(() => runSkill({ skill: "x", tracker: fixtureModel() }), HarnessError);
});
