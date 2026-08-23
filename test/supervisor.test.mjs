// FAFF-877 — supervisor.js: the shared bounded-operation supervisor. The pure/injected
// core (makeLease / withHeartbeatRenewal / superviseOperation / superviseSubprocess /
// mapKillableOutcome) is exercised by the in-process `supervisorSelftest()` — this file
// just drives it through node:test so it is part of the ordinary `node --test` sweep
// and CI's coverage capture, mirroring how killable-spawn.test.mjs drives its own
// module's --selftest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { supervisorSelftest, makeLease, superviseOperation, superviseSubprocess, SUPERVISED_OUTCOME } = require("../plugin/skills/faff/bin/lib/supervisor.js");

test("supervisor --selftest passes (fully injected: fake timers, fake heartbeatTick, fake killable-spawn — zero real waits or processes)", async () => {
  const fail = await supervisorSelftest();
  assert.equal(fail, 0);
});

// The spec's own "Integration smoke test" (FAFF-877 section 8) — REAL heartbeat-file
// writes on a REAL temp run dir, and the REAL relocated killable-spawn.mjs (not a
// stubbed importKillableSpawn) — only the child process itself and the deadline/renewal
// timings are faked/shortened, per the spec's own "injected fake child" wording. This is
// the one test that proves supervisor.js and killable-spawn.mjs genuinely wire together,
// beyond either module's own independently-injected unit coverage.
function mintRunDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "faff877-smoke-"));
  writeFileSync(path.join(dir, "run-ledger.json"), JSON.stringify({ run_id: path.basename(dir), owner: { status: "running" } }, null, 2) + "\n");
  return dir;
}

test("integration smoke: a supervised operation under its deadline keeps the parent heartbeat file advancing (renewal-keeps-alive)", async () => {
  const runDir = mintRunDir();
  try {
    const before = statSync(path.join(runDir, "heartbeat"), { throwIfNoEntry: false });
    assert.equal(before, undefined, "no heartbeat file exists yet — the op's own renewal ticks are what create it");
    const lease = makeLease({ name: "smoke:transport", run_dir: runDir, deadline_secs: 5 });
    const outcome = await superviseOperation({
      lease,
      // A real 150ms "slow" op, well under the 5s lease deadline — long enough for at
      // least one real renewal tick at the shortened 30ms cadence below.
      work: () => new Promise((resolve) => setTimeout(() => resolve("done"), 150)),
      renewalSecs: 0.03,
    });
    assert.equal(outcome.outcome, SUPERVISED_OUTCOME.COMPLETED);
    assert.equal(outcome.result, "done");
    const raw = readFileSync(path.join(runDir, "heartbeat"), "utf8").trim();
    assert.ok(raw.length > 0, "the renewal timer's real tick created the heartbeat file");
    assert.ok(Number.isFinite(Date.parse(raw)), "the heartbeat file carries a real parseable ISO timestamp");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("integration smoke: a hung child past its operation deadline is stopped via the REAL relocated killable-spawn.mjs (deadline-kills-the-tree)", async () => {
  const runDir = mintRunDir();
  try {
    const lease = makeLease({ name: "smoke:subprocess", run_dir: runDir, deadline_secs: 0.05 }); // 50ms — deliberately tiny
    const killed = [];
    // A dedicated, REFERENCED (non-unref'd) real timer so the event loop has something
    // keeping it alive independent of killable-spawn.mjs's own unref'd deadline timer —
    // real-runKillable integration is exercised via `importKillableSpawn` defaulting to
    // the real dynamic `import("./killable-spawn.mjs")`; only spawnFn/killFn are faked
    // (per the spec's own "injected fake child" wording).
    const keepAlive = setInterval(() => {}, 10);
    try {
      const outcome = await superviseSubprocess({
        lease,
        target: ["fake-hung-binary"],
        graceSec: 0.02, // hard-kill fires at (deadlineSec+graceSec)*1000 = 70ms
        renewalSecs: 1000, // renewal irrelevant to this assertion; keep it inert
        // A fake child that never emits 'exit' — the real runKillable's own deadline+grace
        // timer (unfaked) is what settles this, proving the REAL relocated module's kill
        // discipline fires end-to-end through superviseSubprocess's dynamic import.
        spawnFn: () => ({ pid: 54321, on: () => {} }),
        killFn: (pid, sig) => killed.push([pid, sig]),
      });
      assert.equal(outcome.outcome, SUPERVISED_OUTCOME.DEADLINE_KILLED);
      assert.ok(killed.length >= 1, "the real killable-spawn.mjs hard-kill fired");
      assert.equal(killed[0][0], -54321, "signals the NEGATIVE pgid — the whole process group, never the bare pid");
      assert.equal(killed[0][1], "SIGKILL");
    } finally { clearInterval(keepAlive); }
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

// From HOW (behaviour): "STOPS renewing in a finally on COMPLETED / CANCELLED / FAILED /
// lease expiry" — explicit per-outcome coverage that the renewal interval is cleared,
// not just the deadline timer (the exact failure mode the spec's own Failure modes
// section names: "the renewal timer keeps ticking after the operation is really dead").
test("renewal timer is cleared on every one of the four SupervisedOutcome branches", async () => {
  const outcomes = [];
  const cases = [
    { label: "COMPLETED", work: async () => "ok" },
    { label: "FAILED", work: async () => { throw new Error("boom"); } },
  ];
  for (const { label, work } of cases) {
    let cleared = 0;
    const fakeTimer = { id: label };
    const lease = makeLease({ run_dir: "/r", deadline_secs: 3600, startedAt: 0, nowFn: () => 0 });
    const r = await superviseOperation({
      lease, work,
      setIntervalFn: () => fakeTimer, clearIntervalFn: (t) => { if (t === fakeTimer) cleared++; },
      setTimeoutFn: () => ({}), clearTimeoutFn: () => {},
      onSignal: () => {}, offSignal: () => {},
    });
    outcomes.push([label, r.outcome, cleared]);
  }
  for (const [label, outcome, cleared] of outcomes) {
    assert.equal(cleared, 1, `${label}: the renewal interval was cleared exactly once`);
  }

  // DEADLINE_KILLED and CANCELLED — the never-resolving-work branches.
  {
    let cleared = 0;
    const fakeTimer = { id: "deadline" };
    let deadlineCb = null;
    const lease = makeLease({ run_dir: "/r", deadline_secs: 60, startedAt: 0, nowFn: () => 0 });
    const pending = superviseOperation({
      lease, work: () => new Promise(() => {}),
      setIntervalFn: () => fakeTimer, clearIntervalFn: (t) => { if (t === fakeTimer) cleared++; },
      setTimeoutFn: (fn) => { deadlineCb = fn; return {}; }, clearTimeoutFn: () => {},
      onSignal: () => {}, offSignal: () => {},
      nowFn: () => 0,
    });
    deadlineCb();
    const r = await pending;
    assert.equal(r.outcome, SUPERVISED_OUTCOME.DEADLINE_KILLED);
    assert.equal(cleared, 1, "DEADLINE_KILLED: the renewal interval was cleared exactly once");
  }
  {
    let cleared = 0;
    const fakeTimer = { id: "cancel" };
    let sigtermHandler = null;
    const lease = makeLease({ run_dir: "/r", deadline_secs: 3600, startedAt: 0, nowFn: () => 0 });
    const pending = superviseOperation({
      lease, work: () => new Promise(() => {}),
      setIntervalFn: () => fakeTimer, clearIntervalFn: (t) => { if (t === fakeTimer) cleared++; },
      setTimeoutFn: () => ({}), clearTimeoutFn: () => {},
      onSignal: (sig, h) => { if (sig === "SIGTERM") sigtermHandler = h; }, offSignal: () => {},
    });
    sigtermHandler();
    const r = await pending;
    assert.equal(r.outcome, SUPERVISED_OUTCOME.CANCELLED);
    assert.equal(cleared, 1, "CANCELLED: the renewal interval was cleared exactly once");
  }
});

// From WHY: "Heartbeat renewal, token chunks, and process existence emit no
// workflow-progress event" — structural: the renewal tick's write path (heartbeat.js's
// cmdHeartbeat -> writeHeartbeatFile) touches ONLY the dedicated heartbeat file, never
// events.jsonl, so FAFF-847's fresh-heartbeat-without-progress condition stays reachable.
test("a real renewal tick writes ONLY the heartbeat file — never events.jsonl (no manufactured workflow-progress event)", async () => {
  const runDir = mintRunDir();
  try {
    const lease = makeLease({ name: "smoke:no-progress", run_dir: runDir, deadline_secs: 5 });
    await superviseOperation({
      lease,
      work: () => new Promise((resolve) => setTimeout(() => resolve("done"), 100)),
      renewalSecs: 0.03,
      setTimeoutFn: (fn, ms) => setTimeout(fn, ms), clearTimeoutFn: clearTimeout,
      onSignal: () => {}, offSignal: () => {},
    });
    const { existsSync } = require("node:fs");
    assert.ok(existsSync(path.join(runDir, "heartbeat")), "the heartbeat file was written");
    assert.ok(!existsSync(path.join(runDir, "events.jsonl")), "no events.jsonl was ever created by a renewal tick");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});
