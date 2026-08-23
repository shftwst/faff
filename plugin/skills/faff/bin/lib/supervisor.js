// ===========================================================================
// === region:factory — supervisor — the shared bounded-operation supervisor (FAFF-877) ===
// ===========================================================================
// Fixes the detached-sentry-poller false-positive abort: a long producer/engine
// operation (a Codex spawn, an HTTP engine call) used to hold the run for many
// minutes with no tool ticking the parent heartbeat, so it aged past the stale
// window and the poller aborted a healthy run mid-work (run-20260818-192940).
//
// THE LOAD-BEARING MODEL (see the spec, FAFF-877 section 1): Sentry/the poller read
// ONLY heartbeat freshness — that predicate is UNCHANGED by this file. What changes
// is that every long operation now keeps that exact scalar fresh WHILE it is
// genuinely alive, via a RENEWAL timer that ticks the ordinary heartbeat write path
// (bin/lib/heartbeat.js's cmdHeartbeat — the same owner-"running"-guarded single-
// value write every other caller uses), and STOPS renewing the instant the
// operation completes, is cancelled, fails, or outlives its own policy deadline.
//
// The OPERATION LEASE is a local, in-process, NON-SELF-RENEWABLE bound on how long
// renewal is permitted to run (`expires_at = started_at + deadline_secs`, fixed at
// construction). Sentry never reads it — an expired or absent lease cannot suppress
// an abort; a dead supervisor (crashed process, killed renewal timer) simply stops
// ticking, the heartbeat ages, and the poller trips exactly as it does for an
// unsupervised hang. No new grace, no gameable proxy (the FAFF-553/FAFF-847
// build-start-proxy shape this design deliberately avoids).
//
// TWO ARMS, one shared renewal primitive (withHeartbeatRenewal):
//   - TRANSPORT arm (superviseOperation) — no process to kill; applies its OWN
//     total-deadline timer (there is nothing else that would stop a hung HTTP call).
//   - SUBPROCESS arm (superviseSubprocess) — delegates process-group control to the
//     relocated killable-spawn.mjs's `runKillable`, which already owns deadline+grace
//     hard-kill AND SIGINT/SIGTERM cancellation for a detached child; the supervisor
//     adds ONLY the renewal timer around it (no duplicate deadline/cancel logic).
//
// killable-spawn.mjs is ESM; this module is CJS (the rest of bin/lib), so the
// subprocess arm loads it via a lazy `await import(...)` — the one dynamic-import
// seam in this file, confined to superviseSubprocess.

const { cmdHeartbeat } = require("./heartbeat");

const DEFAULT_RENEWAL_SECS = 60; // MUST be << stall_window_secs (repo default 2400s here)
const DEFAULT_OPERATION_DEADLINE_SECS = 3600; // human decision, alec, 2026-08-22 (FAFF-877 section 6)

const SUPERVISED_OUTCOME = Object.freeze({
  COMPLETED: "COMPLETED",
  DEADLINE_KILLED: "DEADLINE_KILLED",
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
});

// PURE (aside from the injected nowFn): build an OperationLease. `expires_at` is fixed
// at construction — nothing in this module ever pushes it out, so a lease cannot renew
// itself past its own policy budget. Requires the EXACT parent run_dir; never resolves
// a latest-run fallback (the anti-pattern the spec calls out for producer dispatches
// applies equally here — a lease for the wrong run is worse than no lease).
function makeLease({ name, run_dir, deadline_secs, startedAt = null, nowFn = () => Date.now() } = {}) {
  if (!run_dir) throw new Error("makeLease requires the EXACT parent run_dir (never a latest-run fallback)");
  const started_at = startedAt != null ? startedAt : nowFn();
  const ds = Number.isFinite(deadline_secs) && deadline_secs > 0 ? deadline_secs : DEFAULT_OPERATION_DEADLINE_SECS;
  return { name: name || "operation", run_dir, started_at, deadline_secs: ds, expires_at: started_at + ds * 1000 };
}

// The renewal tick: the SAME owner-"running"-guarded single-value write every other
// caller uses (bin/lib/heartbeat.js's cmdHeartbeat, argv-shaped: [runDir]) — never a
// bespoke write. Its write path touches only the heartbeat file (or, outside a live
// run, nothing at all — a soft no-op) and NEVER emits a workflow-progress event, which
// is what keeps FAFF-847's heartbeat-progress-mismatch evaluation reachable: a fresh
// heartbeat with no durable progress record still reads as fresh-without-progress.
// Errors are swallowed — a failed tick must never crash the supervised operation; it
// just means this tick didn't happen, exactly as if the operation had gone briefly
// quiet on its own.
function defaultHeartbeatTick(runDir) {
  try { cmdHeartbeat([runDir]); } catch { /* a failed tick is never fatal to the supervised op */ }
}

// withHeartbeatRenewal: arm a renewal interval around `workFn()`, clear it in a
// `finally` regardless of how work settles (resolve, reject, or a caller-thrown
// error) — the ONE place "stop renewing on completion/cancel/failure" is guaranteed,
// shared by both arms below. `workFn` receives no arguments; it is whatever async
// operation (an HTTP call, an `await runKillable(...)`) the caller is wrapping.
async function withHeartbeatRenewal(lease, workFn, {
  heartbeatTick = defaultHeartbeatTick,
  renewalSecs = DEFAULT_RENEWAL_SECS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  if (!lease || !lease.run_dir) throw new Error("withHeartbeatRenewal requires a lease with the exact parent run_dir");
  if (typeof workFn !== "function") throw new Error("withHeartbeatRenewal requires a workFn()");
  let timer = setIntervalFn(() => heartbeatTick(lease.run_dir), renewalSecs * 1000);
  if (timer && typeof timer.unref === "function") timer.unref();
  try {
    return await workFn();
  } finally {
    clearIntervalFn(timer);
    timer = null;
  }
}

// TRANSPORT arm: no process to kill, so the supervisor owns BOTH the renewal timer
// (via withHeartbeatRenewal) AND the total-deadline timer (Promise.race against the
// lease's own expiry) — there is nothing else that would stop a hung HTTP call. Also
// arms SIGINT/SIGTERM cancellation for parity with the subprocess arm's CANCELLED
// outcome, though a transport op has no child process to signal — cancellation here
// just means "stop waiting", the in-flight request itself is abandoned to the runtime.
//
// `work()` returns a Promise resolving the inner result on completion; its rejection
// maps to FAILED. Single-settle discipline (mirrors killable-spawn.mjs) — whichever of
// {work settles, deadline fires, a cancel signal fires} happens FIRST wins; every
// later event is a documented no-op.
async function superviseOperation({
  lease,
  work,
  heartbeatTick = defaultHeartbeatTick,
  renewalSecs = DEFAULT_RENEWAL_SECS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  onSignal = (sig, handler) => process.on(sig, handler),
  offSignal = (sig, handler) => process.removeListener(sig, handler),
  nowFn = () => Date.now(),
} = {}) {
  if (!lease || !lease.run_dir) throw new Error("superviseOperation requires a lease with the exact parent run_dir");
  if (typeof work !== "function") throw new Error("superviseOperation requires a work() function");

  let settled = false;
  let deadlineTimer = null;
  let sigintHandler = null;
  let sigtermHandler = null;

  const clearGuards = () => {
    if (deadlineTimer) { clearTimeoutFn(deadlineTimer); deadlineTimer = null; }
    if (sigintHandler) { offSignal("SIGINT", sigintHandler); sigintHandler = null; }
    if (sigtermHandler) { offSignal("SIGTERM", sigtermHandler); sigtermHandler = null; }
  };

  return withHeartbeatRenewal(lease, () => new Promise((resolve) => {
    const settle = (outcome) => {
      if (settled) return; // single-settle: the first event wins, later ones are no-ops
      settled = true;
      clearGuards();
      resolve(outcome);
    };

    const deadlineMs = Math.max(0, lease.expires_at - nowFn());
    deadlineTimer = setTimeoutFn(() => {
      settle({ outcome: SUPERVISED_OUTCOME.DEADLINE_KILLED, result: null, error: null, lease });
    }, deadlineMs);
    if (deadlineTimer && typeof deadlineTimer.unref === "function") deadlineTimer.unref();

    const cancel = (sig) => () => settle({ outcome: SUPERVISED_OUTCOME.CANCELLED, result: null, error: null, lease, signal: sig });
    sigintHandler = cancel("SIGINT");
    sigtermHandler = cancel("SIGTERM");
    onSignal("SIGINT", sigintHandler);
    onSignal("SIGTERM", sigtermHandler);

    Promise.resolve()
      .then(() => work())
      .then((result) => settle({ outcome: SUPERVISED_OUTCOME.COMPLETED, result, error: null, lease }))
      .catch((error) => settle({ outcome: SUPERVISED_OUTCOME.FAILED, result: null, error, lease }));
  }), { heartbeatTick, renewalSecs, setIntervalFn, clearIntervalFn });
}

// SUBPROCESS arm: delegates ALL deadline/grace/cancel/process-group discipline to
// killable-spawn.mjs's runKillable (relocated to this same directory, FAFF-877) — this
// function adds ONLY the renewal timer around it, per the spec's "the supervisor adds
// only the heartbeat-renewal timer around it" API note. `spawnFn`/`killFn`/timers/
// `onSignal` are threaded straight through to runKillable, so a caller that wants
// captured (piped) stdio instead of runKillable's default `stdio:"inherit"` supplies
// its own `spawnFn` that spawns with pipes and captures output in its own closure —
// runKillable never inspects `opts.stdio` itself, it only builds and hands it to the
// injected `spawnFn` (killable-spawn.mjs's own contract).
//
// deadlineSec/graceSec: killable-spawn's own hard-kill fires at (deadlineSec+graceSec).
// Here deadlineSec is the lease's OWN deadline_secs — the policy budget IS the kill
// deadline for a subprocess op, there is no separate/looser supervisor-level timer.
async function superviseSubprocess({
  lease,
  target,
  graceSec,
  spawnFn,
  killFn,
  setTimeoutFn,
  clearTimeoutFn,
  onSignal,
  log,
  heartbeatTick = defaultHeartbeatTick,
  renewalSecs = DEFAULT_RENEWAL_SECS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  importKillableSpawn = () => import("./killable-spawn.mjs"),
} = {}) {
  if (!lease || !lease.run_dir) throw new Error("superviseSubprocess requires a lease with the exact parent run_dir");
  const { runKillable, DEFAULT_GRACE_SECONDS } = await importKillableSpawn();
  const killableOpts = {};
  if (spawnFn) killableOpts.spawnFn = spawnFn;
  if (killFn) killableOpts.killFn = killFn;
  if (setTimeoutFn) killableOpts.setTimeoutFn = setTimeoutFn;
  if (clearTimeoutFn) killableOpts.clearTimeoutFn = clearTimeoutFn;
  if (onSignal) killableOpts.onSignal = onSignal;
  if (log) killableOpts.log = log;

  return withHeartbeatRenewal(lease, async () => {
    const killed = await runKillable(
      { deadlineSec: lease.deadline_secs, graceSec: graceSec != null ? graceSec : DEFAULT_GRACE_SECONDS, target },
      killableOpts,
    );
    return mapKillableOutcome(killed);
  }, { heartbeatTick, renewalSecs, setIntervalFn, clearIntervalFn });
}

// PURE: killable-spawn.mjs's {status,innerExit,signal} -> this module's SupervisedOutcome
// shape, so both arms return the same four-way enum to their callers.
function mapKillableOutcome(killed) {
  if (!killed || typeof killed !== "object") return { outcome: SUPERVISED_OUTCOME.FAILED, result: null, error: new Error("malformed killable-spawn outcome") };
  switch (killed.status) {
    case "exited": return { outcome: SUPERVISED_OUTCOME.COMPLETED, result: killed, error: null };
    case "killed-deadline": return { outcome: SUPERVISED_OUTCOME.DEADLINE_KILLED, result: killed, error: null };
    case "killed-abort": return { outcome: SUPERVISED_OUTCOME.CANCELLED, result: killed, error: null, signal: killed.signal };
    default: return { outcome: SUPERVISED_OUTCOME.FAILED, result: killed, error: null };
  }
}

// ── Selftest — folded into `faff engine --selftest` (engineSelftest requires this
// module), mirroring how engine-codex.js's codexSelftest is folded in today. Fully
// injected: fake timers (no real waits), a fake heartbeatTick spy, and — for the
// subprocess arm — a fake runKillable via `importKillableSpawn` (zero real processes).
async function supervisorSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { console.log(`FAIL supervisor: ${name}`); fail++; } else console.log(`ok   supervisor: ${name}`); };

  // -- makeLease --
  {
    const lease = makeLease({ name: "engine:codex", run_dir: "/r", deadline_secs: 120, startedAt: 1000, nowFn: () => 1000 });
    ok("makeLease: expires_at = started_at + deadline_secs*1000", lease.expires_at === 1000 + 120000);
    ok("makeLease: name/run_dir carried", lease.name === "engine:codex" && lease.run_dir === "/r");
    const defaulted = makeLease({ run_dir: "/r", startedAt: 0, nowFn: () => 0 });
    ok("makeLease: absent/invalid deadline_secs -> DEFAULT_OPERATION_DEADLINE_SECS (3600)", defaulted.deadline_secs === DEFAULT_OPERATION_DEADLINE_SECS && defaulted.expires_at === 3600000);
    let threw = false;
    try { makeLease({ deadline_secs: 60 }); } catch { threw = true; }
    ok("makeLease: no run_dir -> throws (never a latest-run fallback)", threw);
  }

  // -- withHeartbeatRenewal: ticks on interval, stops in finally on both success and throw --
  {
    const ticks = [];
    const fakeTimer = { id: "t" };
    let cleared = 0;
    let tickFn = null;
    const lease = makeLease({ run_dir: "/r", deadline_secs: 60, startedAt: 0, nowFn: () => 0 });
    const result = await withHeartbeatRenewal(lease, async () => "done", {
      heartbeatTick: (rd) => ticks.push(rd),
      setIntervalFn: (fn, ms) => { tickFn = fn; ok("withHeartbeatRenewal: interval armed at renewalSecs*1000 (default 60s)", ms === 60000); return fakeTimer; },
      clearIntervalFn: (t) => { if (t === fakeTimer) cleared++; },
    });
    ok("withHeartbeatRenewal: returns the work fn's result verbatim", result === "done");
    ok("withHeartbeatRenewal: clears the interval in finally", cleared === 1);
    tickFn();
    ok("withHeartbeatRenewal: a manual tick invocation calls heartbeatTick with the lease's run_dir", ticks[0] === "/r");
  }
  {
    // a thrown workFn still clears the timer (finally, not only the happy path)
    let cleared = 0;
    const fakeTimer = { id: "t2" };
    const lease = makeLease({ run_dir: "/r", deadline_secs: 60, startedAt: 0, nowFn: () => 0 });
    let threw = false;
    try {
      await withHeartbeatRenewal(lease, async () => { throw new Error("boom"); }, {
        setIntervalFn: () => fakeTimer,
        clearIntervalFn: (t) => { if (t === fakeTimer) cleared++; },
      });
    } catch { threw = true; }
    ok("withHeartbeatRenewal: a thrown work fn still clears the renewal timer (finally)", threw && cleared === 1);
  }

  // -- superviseOperation (transport arm): COMPLETED / DEADLINE_KILLED / FAILED / CANCELLED --
  {
    const lease = makeLease({ run_dir: "/r", deadline_secs: 3600, startedAt: 0, nowFn: () => 0 });
    const r = await superviseOperation({
      lease, work: async () => "ok",
      setIntervalFn: () => ({}), clearIntervalFn: () => {},
      setTimeoutFn: () => ({}), clearTimeoutFn: () => {},
      onSignal: () => {}, offSignal: () => {},
    });
    ok("superviseOperation: healthy work -> COMPLETED with the verbatim result", r.outcome === SUPERVISED_OUTCOME.COMPLETED && r.result === "ok");
  }
  {
    // work() never resolves — only the deadline timer settles this. Capture the deadline
    // callback via the injected setTimeoutFn, fire it BEFORE awaiting the pending promise.
    const lease = makeLease({ run_dir: "/r", deadline_secs: 60, startedAt: 0, nowFn: () => 0 });
    let deadlineCb = null;
    const pending = superviseOperation({
      lease, work: () => new Promise(() => {}),
      setIntervalFn: () => ({}), clearIntervalFn: () => {},
      setTimeoutFn: (fn) => { deadlineCb = fn; return {}; }, clearTimeoutFn: () => {},
      onSignal: () => {}, offSignal: () => {},
      nowFn: () => 0,
    });
    deadlineCb();
    const r = await pending;
    ok("superviseOperation: a never-resolving work fn is settled by the deadline timer -> DEADLINE_KILLED", r.outcome === SUPERVISED_OUTCOME.DEADLINE_KILLED);
  }
  {
    const lease = makeLease({ run_dir: "/r", deadline_secs: 3600, startedAt: 0, nowFn: () => 0 });
    const r = await superviseOperation({
      lease, work: async () => { throw new Error("transport down"); },
      setIntervalFn: () => ({}), clearIntervalFn: () => {},
      setTimeoutFn: () => ({}), clearTimeoutFn: () => {},
      onSignal: () => {}, offSignal: () => {},
    });
    ok("superviseOperation: a rejecting work fn -> FAILED, error carried", r.outcome === SUPERVISED_OUTCOME.FAILED && /transport down/.test(r.error.message));
  }
  {
    const lease = makeLease({ run_dir: "/r", deadline_secs: 3600, startedAt: 0, nowFn: () => 0 });
    let sigtermHandler = null;
    const pending = superviseOperation({
      lease, work: () => new Promise(() => {}),
      setIntervalFn: () => ({}), clearIntervalFn: () => {},
      setTimeoutFn: () => ({}), clearTimeoutFn: () => {},
      onSignal: (sig, h) => { if (sig === "SIGTERM") sigtermHandler = h; }, offSignal: () => {},
    });
    sigtermHandler();
    const r = await pending;
    ok("superviseOperation: SIGTERM -> CANCELLED", r.outcome === SUPERVISED_OUTCOME.CANCELLED && r.signal === "SIGTERM");
  }
  {
    // single-settle: a late work-resolution after the deadline already fired is a no-op
    // (the DEADLINE_KILLED outcome, not a second COMPLETED).
    const lease = makeLease({ run_dir: "/r", deadline_secs: 60, startedAt: 0, nowFn: () => 0 });
    let deadlineCb = null;
    let resolveWork = null;
    const pending = superviseOperation({
      lease, work: () => new Promise((res) => { resolveWork = res; }),
      setIntervalFn: () => ({}), clearIntervalFn: () => {},
      setTimeoutFn: (fn) => { deadlineCb = fn; return {}; }, clearTimeoutFn: () => {},
      onSignal: () => {}, offSignal: () => {},
      nowFn: () => 0,
    });
    deadlineCb();
    const r = await pending;
    resolveWork("too-late"); // late resolution after settle — must be a documented no-op
    ok("superviseOperation: single-settle — deadline wins over a late work resolution", r.outcome === SUPERVISED_OUTCOME.DEADLINE_KILLED);
  }

  // -- superviseSubprocess: renewal wraps runKillable; deadline/kill delegated to it --
  {
    const ticks = [];
    let tickFn = null;
    const fakeChild = { pid: 4242, on: () => {} };
    const lease = makeLease({ run_dir: "/r", deadline_secs: 480, startedAt: 0, nowFn: () => 0 });
    const fakeKillableModule = {
      DEFAULT_GRACE_SECONDS: 30,
      runKillable: async (opts, io) => {
        ok("superviseSubprocess: passes the lease's OWN deadline_secs straight through as deadlineSec (no separate supervisor-level timer)", opts.deadlineSec === 480);
        io.spawnFn("codex", ["exec"], { detached: true, stdio: "inherit" });
        return { status: "exited", innerExit: 0, signal: null };
      },
    };
    const r = await superviseSubprocess({
      lease, target: ["codex", "exec"],
      spawnFn: (cmd, args) => { void cmd; void args; return fakeChild; },
      heartbeatTick: (rd) => ticks.push(rd),
      setIntervalFn: (fn) => { tickFn = fn; return {}; },
      clearIntervalFn: () => {},
      importKillableSpawn: async () => fakeKillableModule,
    });
    ok("superviseSubprocess: a clean exit -> COMPLETED", r.outcome === SUPERVISED_OUTCOME.COMPLETED);
    tickFn();
    ok("superviseSubprocess: the renewal timer is armed and ticks the lease's run_dir", ticks[0] === "/r");
  }
  {
    const lease = makeLease({ run_dir: "/r", deadline_secs: 1, startedAt: 0, nowFn: () => 0 });
    const fakeKillableModule = { DEFAULT_GRACE_SECONDS: 30, runKillable: async () => ({ status: "killed-deadline", innerExit: null, signal: "SIGKILL" }) };
    const r = await superviseSubprocess({
      lease, target: ["codex", "exec"],
      setIntervalFn: () => ({}), clearIntervalFn: () => {},
      importKillableSpawn: async () => fakeKillableModule,
    });
    ok("superviseSubprocess: killable-spawn's killed-deadline -> DEADLINE_KILLED", r.outcome === SUPERVISED_OUTCOME.DEADLINE_KILLED);
  }
  {
    const lease = makeLease({ run_dir: "/r", deadline_secs: 480, startedAt: 0, nowFn: () => 0 });
    const fakeKillableModule = { DEFAULT_GRACE_SECONDS: 30, runKillable: async () => ({ status: "killed-abort", innerExit: null, signal: "SIGTERM" }) };
    const r = await superviseSubprocess({
      lease, target: ["codex", "exec"],
      setIntervalFn: () => ({}), clearIntervalFn: () => {},
      importKillableSpawn: async () => fakeKillableModule,
    });
    ok("superviseSubprocess: killable-spawn's killed-abort -> CANCELLED", r.outcome === SUPERVISED_OUTCOME.CANCELLED && r.signal === "SIGTERM");
  }
  {
    const lease = makeLease({ run_dir: "/r", deadline_secs: 480, startedAt: 0, nowFn: () => 0 });
    const fakeKillableModule = { DEFAULT_GRACE_SECONDS: 30, runKillable: async () => ({ status: "spawn-failed", innerExit: null, signal: null }) };
    const r = await superviseSubprocess({
      lease, target: ["codex", "exec"],
      setIntervalFn: () => ({}), clearIntervalFn: () => {},
      importKillableSpawn: async () => fakeKillableModule,
    });
    ok("superviseSubprocess: killable-spawn's spawn-failed -> FAILED", r.outcome === SUPERVISED_OUTCOME.FAILED);
  }
  {
    let threw = false;
    try { await superviseSubprocess({ lease: null, target: ["x"] }); } catch { threw = true; }
    ok("superviseSubprocess: no lease -> throws (never a silent no-op)", threw);
  }

  // -- defaultHeartbeatTick: a real cmdHeartbeat call outside any run is a silent no-op,
  // never a throw (mirrors heartbeat.js's own "ambient resolution found no run" contract) --
  {
    let threw = false;
    try { defaultHeartbeatTick("/definitely/not/a/run/dir"); } catch { threw = true; }
    ok("defaultHeartbeatTick: never throws, even on a bogus run_dir (cmdHeartbeat's own soft no-op)", !threw);
  }

  // -- mapKillableOutcome: pure mapping table, incl. fail-safe on malformed input --
  ok("mapKillableOutcome: exited -> COMPLETED", mapKillableOutcome({ status: "exited" }).outcome === SUPERVISED_OUTCOME.COMPLETED);
  ok("mapKillableOutcome: killed-deadline -> DEADLINE_KILLED", mapKillableOutcome({ status: "killed-deadline" }).outcome === SUPERVISED_OUTCOME.DEADLINE_KILLED);
  ok("mapKillableOutcome: killed-abort -> CANCELLED", mapKillableOutcome({ status: "killed-abort" }).outcome === SUPERVISED_OUTCOME.CANCELLED);
  ok("mapKillableOutcome: spawn-failed -> FAILED", mapKillableOutcome({ status: "spawn-failed" }).outcome === SUPERVISED_OUTCOME.FAILED);
  ok("mapKillableOutcome: malformed/null -> FAILED, never a silent COMPLETED", mapKillableOutcome(null).outcome === SUPERVISED_OUTCOME.FAILED && mapKillableOutcome({}).outcome === SUPERVISED_OUTCOME.FAILED);

  return fail;
}

module.exports = {
  DEFAULT_OPERATION_DEADLINE_SECS,
  DEFAULT_RENEWAL_SECS,
  SUPERVISED_OUTCOME,
  defaultHeartbeatTick,
  makeLease,
  mapKillableOutcome,
  superviseOperation,
  superviseSubprocess,
  supervisorSelftest,
  withHeartbeatRenewal,
};
