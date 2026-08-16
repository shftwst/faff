// FAFF-793 — killable-spawn.mjs: the shared OS-level process-group spawn+kill primitive
// backing review-spawn.mjs's bounded, killable single-shot wrapper around the adversarial-
// review invocation. Unit tests exercise the pure core (parseArgs/mapOutcomeExit/killGroup)
// and a fully-injected runKillable (fake spawn/kill/timer/signal — zero real processes);
// review-spawn.test.mjs covers the end-to-end CLI with REAL child processes, including the
// FAFF-465 reparent-to-init repro this ticket exists to close.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseArgs, mapOutcomeExit, killGroup, runKillable, WRAPPER_EXIT, DEFAULT_GRACE_SECONDS,
} from "../plugin/skills/faffter-dark-adversarial-review/killable-spawn.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = join(HERE, "..", "plugin", "skills", "faffter-dark-adversarial-review", "killable-spawn.mjs");

test("killable-spawn --selftest passes (in-process pure-core + injected-runKillable exercise)", () => {
  const r = spawnSync(process.execPath, [MODULE_PATH, "--selftest"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /killable-spawn --selftest: ok/);
});

test("killable-spawn.mjs run directly without --selftest refuses (library, not a CLI)", () => {
  const r = spawnSync(process.execPath, [MODULE_PATH], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /library module/);
});

// ── parseArgs (pure) ──

test("parseArgs: happy path defaults --grace", () => {
  const p = parseArgs(["--deadline", "480", "--", "node", "review-call.mjs", "--foo"]);
  assert.equal(p.ok, true);
  assert.equal(p.deadlineSec, 480);
  assert.equal(p.graceSec, DEFAULT_GRACE_SECONDS);
  assert.deepEqual(p.target, ["node", "review-call.mjs", "--foo"]);
});

test("parseArgs: explicit --grace overrides the default", () => {
  const p = parseArgs(["--deadline", "10", "--grace", "5", "--", "node", "x.mjs"]);
  assert.equal(p.ok, true);
  assert.equal(p.graceSec, 5);
});

test("parseArgs: refuses missing `--` separator (USAGE)", () => {
  assert.equal(parseArgs(["--deadline", "10", "node", "x.mjs"]).ok, false);
});

test("parseArgs: refuses an empty target after `--`", () => {
  assert.equal(parseArgs(["--deadline", "10", "--"]).ok, false);
});

test("parseArgs: refuses a missing --deadline", () => {
  assert.equal(parseArgs(["--", "node", "x.mjs"]).ok, false);
});

test("parseArgs: refuses a non-numeric --deadline", () => {
  assert.equal(parseArgs(["--deadline", "soon", "--", "node", "x.mjs"]).ok, false);
});

test("parseArgs: refuses a non-positive --deadline", () => {
  assert.equal(parseArgs(["--deadline", "0", "--", "node", "x.mjs"]).ok, false);
  assert.equal(parseArgs(["--deadline", "-1", "--", "node", "x.mjs"]).ok, false);
});

test("parseArgs: refuses a negative --grace", () => {
  assert.equal(parseArgs(["--deadline", "10", "--grace", "-1", "--", "node", "x.mjs"]).ok, false);
});

// ── mapOutcomeExit (pure) — the "no change to disposition" contract ──

test("mapOutcomeExit: a normal inner exit passes through VERBATIM, including the target's own graceful deadline(8)", () => {
  for (const code of [0, 2, 4, 5, 6, 7, 8, 9, 10]) {
    assert.equal(mapOutcomeExit({ status: "exited", innerExit: code }), code, `inner exit ${code} must pass through unchanged`);
  }
});

test("mapOutcomeExit: killed-deadline (the wrapper's OWN hard-kill firing) maps to 8 — the existing exit-8 disposition, no new verdict", () => {
  assert.equal(mapOutcomeExit({ status: "killed-deadline" }), WRAPPER_EXIT.DEADLINE);
  assert.equal(mapOutcomeExit({ status: "killed-deadline" }), 8);
});

test("mapOutcomeExit: killed-abort maps to 130 (128+SIGTERM/SIGINT convention)", () => {
  assert.equal(mapOutcomeExit({ status: "killed-abort" }), 130);
});

test("mapOutcomeExit: spawn-failed maps to 1; a malformed/unrecognised outcome fails SAFE to 1, never a silent success", () => {
  assert.equal(mapOutcomeExit({ status: "spawn-failed" }), 1);
  assert.equal(mapOutcomeExit(null), 1);
  assert.equal(mapOutcomeExit({}), 1);
  assert.equal(mapOutcomeExit({ status: "unknown-status" }), 1);
});

// ── killGroup (pure-ish: injected killFn) ──

test("killGroup: signals the NEGATIVE pgid — the whole group, never the bare child pid", () => {
  const calls = [];
  killGroup((pid, sig) => calls.push([pid, sig]), 4242, "SIGKILL");
  assert.deepEqual(calls, [[-4242, "SIGKILL"]]);
});

test("killGroup: swallows ESRCH (group already gone) — never throws", () => {
  assert.doesNotThrow(() => {
    killGroup(() => { const e = new Error("no such process"); e.code = "ESRCH"; throw e; }, 1, "SIGKILL");
  });
});

test("killGroup: logs-and-swallows a non-ESRCH kill fault — never throws (a reaper must not fault)", () => {
  const logged = [];
  assert.doesNotThrow(() => {
    killGroup(() => { throw new Error("EPERM"); }, 1, "SIGKILL", (m) => logged.push(m));
  });
  assert.equal(logged.length, 1);
});

// ── runKillable — fully injected (fake spawn/kill/timer/signal), zero real processes ──

function fakeChildOn() {
  const handlers = {};
  return { child: { pid: 555, on: (ev, cb) => { handlers[ev] = cb; } }, handlers };
}

test("runKillable: healthy child exit(0) before the timer -> status exited/0; timer armed at (deadline+grace)*1000 then cleared", async () => {
  const { child, handlers } = fakeChildOn();
  let armedMs = null;
  let cleared = false;
  const killed = [];
  const p = runKillable(
    { deadlineSec: 480, graceSec: 30, target: ["node", "x.mjs"] },
    {
      spawnFn: () => child,
      killFn: (pid, sig) => { killed.push([pid, sig]); const e = new Error("ESRCH"); e.code = "ESRCH"; throw e; },
      setTimeoutFn: (fn, ms) => { armedMs = ms; return { unref() {} }; },
      clearTimeoutFn: () => { cleared = true; },
      onSignal: () => {},
    },
  );
  handlers.exit(0, null);
  const res = await p;
  assert.equal(res.status, "exited");
  assert.equal(res.innerExit, 0);
  assert.equal(armedMs, (480 + 30) * 1000, "timer must be armed at deadline+grace, in ms");
  assert.equal(cleared, true, "the deadline timer must be cleared once the child exits normally");
  assert.deepEqual(killed, [[-555, "SIGKILL"]], "the defensive post-exit sweep still attempts a group kill (swallowed via ESRCH on the healthy path)");
});

test("runKillable: deadline+grace elapses with the child still alive -> status killed-deadline, group SIGKILLed; a LATE exit event after settle is a no-op", async () => {
  const { child, handlers } = fakeChildOn();
  let timerCb = null;
  const killed = [];
  const p = runKillable(
    { deadlineSec: 1, graceSec: 1, target: ["node", "x.mjs"] },
    {
      spawnFn: () => child,
      killFn: (pid, sig) => killed.push([pid, sig]),
      setTimeoutFn: (fn) => { timerCb = fn; return { unref() {} }; },
      clearTimeoutFn: () => {},
      onSignal: () => {},
    },
  );
  timerCb();
  handlers.exit(0, null);   // late — must not override the already-settled outcome
  const res = await p;
  assert.equal(res.status, "killed-deadline");
  assert.equal(mapOutcomeExit(res), 8, "the deadline backstop's own exit maps to 8, same as review-call.mjs's graceful deadline — no new disposition");
  assert.deepEqual(killed, [[-555, "SIGKILL"]], "exactly one kill call — the late exit event must be a no-op, not a second kill");
});

test("runKillable: SIGTERM to the wrapper -> status killed-abort, group SIGKILLed, maps to exit 130", async () => {
  const { child } = fakeChildOn();
  const sigHandlers = {};
  const killed = [];
  const p = runKillable(
    { deadlineSec: 480, graceSec: 30, target: ["node", "x.mjs"] },
    {
      spawnFn: () => child,
      killFn: (pid, sig) => killed.push([pid, sig]),
      setTimeoutFn: () => ({ unref() {} }),
      clearTimeoutFn: () => {},
      onSignal: (sig, cb) => { sigHandlers[sig] = cb; },
    },
  );
  sigHandlers.SIGTERM();
  const res = await p;
  assert.equal(res.status, "killed-abort");
  assert.equal(mapOutcomeExit(res), 130);
  assert.deepEqual(killed, [[-555, "SIGKILL"]]);
});

test("runKillable: a synchronous spawn() throw -> status spawn-failed, exit 1, no deadline timer armed", async () => {
  let timerArmed = false;
  const res = await runKillable(
    { deadlineSec: 480, graceSec: 30, target: ["node", "x.mjs"] },
    {
      spawnFn: () => { throw new Error("ENOENT"); },
      killFn: () => {},
      setTimeoutFn: () => { timerArmed = true; return { unref() {} }; },
      clearTimeoutFn: () => {},
      onSignal: () => {},
    },
  );
  assert.equal(res.status, "spawn-failed");
  assert.equal(mapOutcomeExit(res), 1);
  assert.equal(timerArmed, false);
});

test("runKillable: an async child 'error' event (e.g. ENOENT with no synchronous throw) -> status spawn-failed, never an unhandled exception", async () => {
  const handlers = {};
  const child = { pid: undefined, on: (ev, cb) => { handlers[ev] = cb; } };
  const p = runKillable(
    { deadlineSec: 480, graceSec: 30, target: ["/nonexistent/binary", "x"] },
    {
      spawnFn: () => child,
      killFn: () => {},
      setTimeoutFn: () => ({ unref() {} }),
      clearTimeoutFn: () => {},
      onSignal: () => {},
    },
  );
  handlers.error(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
  const res = await p;
  assert.equal(res.status, "spawn-failed");
  assert.equal(mapOutcomeExit(res), 1);
});
