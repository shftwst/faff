#!/usr/bin/env node
// killable-spawn.mjs — shared OS-level process-group spawn+kill primitive (FAFF-793).
//
// Mirrors evaluate-call.mjs's process pattern: pure core (parse/map/kill) + injectable
// I/O (spawnFn/killFn/timer/signal) + a stable outcome→exit mapping + --selftest. This is
// a LIBRARY module, not a CLI of its own — review-spawn.mjs is the CLI that consumes it.
// It exists so the kill discipline is defined once and can be adopted by a future
// consumer (fan-out.mjs's `runOne`, per the spec's OUT OF SCOPE extension point) without
// duplicating it.
//
// FAFF-877: relocated here (was plugin/skills/faffter-dark-adversarial-review/
// killable-spawn.mjs) so it is importable OUTSIDE the adversarial-review skill under
// link-skills.sh's whole-skill-dir symlink model. The shared operation supervisor
// (./supervisor.js) imports `killGroup` from this module for its subprocess arm
// (engine-codex.js's async codex spawn); review-spawn.mjs keeps consuming the full
// `runKillable` export unchanged, just from its new relative path.
//
// THE LOAD-BEARING MODEL: a child launched `detached:true` (Node calls `setsid`) becomes
// its own process-group LEADER — pgid === pid. Reparenting-to-init on parent death changes
// the child's PPID, never its PGID, so `process.kill(-pgid, "SIGKILL")` still reaches a
// self-backgrounded orphan that slipped the foreground fence (FAFF-491/530) and reparented
// to init (PPid 1) — the exact FAFF-465 repro signature, which is otherwise unkillable by
// the orchestrator (permission denied). This is a defence-in-depth BACKSTOP, not a
// sandbox: a child that deliberately `setsid`s into its OWN session escapes any
// process-group signal — that class stays the fence's remit, out of scope here.

// The extra margin after --deadline before the hard group-kill fires, when the caller
// doesn't pass --grace explicitly. Exists so the wrapper's own backstop is strictly LATER
// than review-call.mjs's own graceful --deadline self-exit(8) — see runKillable below.
export const DEFAULT_GRACE_SECONDS = 30;

// Mirrors review-call.mjs's exit family. On a normal inner exit the wrapper is
// TRANSPARENT — it returns the target's own exit code verbatim (see mapOutcomeExit) — so
// only the wrapper's OWN paths (hard-kill / abort / usage / spawn-failure) get a code from
// this table.
export const WRAPPER_EXIT = { DEADLINE: 8, ABORTED: 130, USAGE: 2, SPAWN_FAILED: 1 };

// PURE: parse `[--deadline S] [--grace S] -- <command> [args...]`.
// Returns { ok:true, deadlineSec, graceSec, target:[cmd,...args] } or { ok:false, reason }.
export function parseArgs(argv) {
  const sepIdx = argv.indexOf("--");
  if (sepIdx === -1) return { ok: false, reason: "missing `--` separator before the target command" };
  const before = argv.slice(0, sepIdx);
  const target = argv.slice(sepIdx + 1);
  if (target.length === 0) return { ok: false, reason: "empty target command after `--`" };

  let deadlineSec = null;
  let graceSec = DEFAULT_GRACE_SECONDS;
  for (let i = 0; i < before.length; i++) {
    const k = before[i];
    if (k === "--deadline") deadlineSec = Number(before[++i]);
    else if (k === "--grace") graceSec = Number(before[++i]);
  }
  if (deadlineSec === null || !Number.isFinite(deadlineSec) || deadlineSec <= 0) {
    return { ok: false, reason: "--deadline must be a positive number of seconds" };
  }
  if (!Number.isFinite(graceSec) || graceSec < 0) {
    return { ok: false, reason: "--grace must be a non-negative number of seconds" };
  }
  return { ok: true, deadlineSec, graceSec, target };
}

// PURE: map a resolved SpawnOutcome ({status, innerExit?, signal?}) to the wrapper's own
// exit code. `exited` is the pass-through case — every code review-call.mjs (or any
// target) can emit (0/2/4/5/6/7/8/9/10, or any other) rides through unchanged, INCLUDING a
// target's own graceful exit 8 — this function never re-maps that to the wrapper's
// DEADLINE constant, which is reserved for a wrapper-FIRED hard kill (status:
// "killed-deadline"). A malformed/unrecognised outcome fails safe to SPAWN_FAILED(1)
// rather than silently reporting success.
export function mapOutcomeExit(outcome) {
  if (!outcome || typeof outcome !== "object") return WRAPPER_EXIT.SPAWN_FAILED;
  switch (outcome.status) {
    case "exited": return typeof outcome.innerExit === "number" ? outcome.innerExit : WRAPPER_EXIT.SPAWN_FAILED;
    case "killed-deadline": return WRAPPER_EXIT.DEADLINE;
    case "killed-abort": return WRAPPER_EXIT.ABORTED;
    case "spawn-failed": return WRAPPER_EXIT.SPAWN_FAILED;
    default: return WRAPPER_EXIT.SPAWN_FAILED;
  }
}

// killGroup: signal the WHOLE process group via the negative pgid — never the bare child
// pid (that would only reach the group leader itself, not a reparented-to-init descendant
// that stayed in the group). Swallows ESRCH (group already gone — the common defensive
// post-exit sweep case); logs-and-swallows any other error. A reaper must never throw.
export function killGroup(killFn, pgid, signal, log = () => {}) {
  try {
    killFn(-pgid, signal);
  } catch (e) {
    if (e && e.code === "ESRCH") return;
    log(`killable-spawn: killGroup(${pgid}, ${signal}) failed: ${e && e.message}`);
  }
}

// runKillable: launch `target` detached (its own process group; pgid === pid), arm a
// single hard-kill timer at (deadlineSec+graceSec), install SIGINT/SIGTERM handlers, and
// settle EXACTLY ONCE under any race between child-exit / the timer / a signal — every
// event after the first is a documented no-op (mirrors fan-out.mjs's `settled` single-
// settle discipline). Every I/O side-effect (spawn, kill, timer, signal registration) is
// injected so the decision logic itself is exercised by --selftest with zero real
// processes; the CLI (review-spawn.mjs) supplies the real implementations.
//
// options:
//   spawnFn(cmd, args, opts) -> ChildProcess-like { pid, on(event, cb) }  — REQUIRED
//   killFn(pid, signal) -> void                                          — default process.kill
//   setTimeoutFn/clearTimeoutFn                                          — default globals
//   onSignal(signal, handler) -> void                                    — default process.on
//   log(msg)                                                             — default no-op
export function runKillable({ deadlineSec, graceSec, target }, {
  spawnFn,
  killFn = (pid, sig) => process.kill(pid, sig),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  onSignal = (sig, handler) => process.on(sig, handler),
  log = () => {},
} = {}) {
  return new Promise((resolve) => {
    if (typeof spawnFn !== "function") {
      resolve({ status: "spawn-failed", innerExit: null, signal: null });
      return;
    }
    const [cmd, ...args] = target;
    let child;
    try {
      // detached:true -> setsid -> the child becomes its own process-group leader
      // (pgid === child.pid), which is the single fact this whole net rests on.
      // stdio:"inherit" -> the target's stdout/stderr flow through unmodified; the
      // wrapper is invisible in the output stream.
      child = spawnFn(cmd, args, { detached: true, stdio: "inherit" });
    } catch (e) {
      log(`killable-spawn: spawn threw: ${e && e.message}`);
      resolve({ status: "spawn-failed", innerExit: null, signal: null });
      return;
    }
    if (!child || typeof child.on !== "function") {
      resolve({ status: "spawn-failed", innerExit: null, signal: null });
      return;
    }

    // A spawn() ENOENT (bad command) does NOT throw synchronously and does NOT set
    // child.pid — the fault only arrives later as an async 'error' event. Register the
    // handlers FIRST, before doing anything else with child.pid, so that async error
    // always has a listener attached — an unlistened 'error' event is a Node fatal
    // (uncaught exception), which would crash the wrapper instead of returning
    // SPAWN_FAILED(1) as documented.
    const pgid = child.pid;
    let settled = false;
    let timer = null;

    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeoutFn(timer);
      resolve(outcome);
    };

    child.on("error", (e) => {
      if (settled) return;   // the deadline/abort timer already fired first — this is a no-op
      log(`killable-spawn: child error: ${e && e.message}`);
      settle({ status: "spawn-failed", innerExit: null, signal: null });
    });
    child.on("exit", (code, signal) => {
      if (settled) return;   // the deadline/abort timer already fired first — this is a no-op
      // Defensive straggler sweep: on the common healthy path the group is already
      // gone (ESRCH, swallowed by killGroup) — this only reaps a genuine straggler
      // sibling the exited leader left behind.
      killGroup(killFn, pgid, "SIGKILL", log);
      settle({ status: "exited", innerExit: code, signal });
    });

    // The hard-kill backstop. Strictly LATER than the target's own graceful --deadline
    // (review-call.mjs self-exits 8 well before this fires on the healthy path) — this
    // only fires when the target is still alive at deadline+grace, the pathological
    // wedged / slipped-fence case. (In the rare ENOENT race window before the 'error'
    // event above has fired, pgid may still be undefined; killGroup tolerates a bad pgid
    // exactly like any other kill fault — logged and swallowed, never thrown.)
    timer = setTimeoutFn(() => {
      log(`killable-spawn: HARD-KILL BACKSTOP firing — group ${pgid} still alive at deadline(${deadlineSec}s)+grace(${graceSec}s); killing the whole process group`);
      killGroup(killFn, pgid, "SIGKILL", log);
      settle({ status: "killed-deadline", innerExit: null, signal: "SIGKILL" });
    }, (deadlineSec + graceSec) * 1000);
    if (timer && typeof timer.unref === "function") timer.unref();

    const abort = (sig) => () => {
      log(`killable-spawn: received ${sig} — killing process group ${pgid}`);
      killGroup(killFn, pgid, "SIGKILL", log);
      settle({ status: "killed-abort", innerExit: null, signal: sig });
    };
    onSignal("SIGINT", abort("SIGINT"));
    onSignal("SIGTERM", abort("SIGTERM"));
  });
}

// In-process selftest of the pure core (parseArgs / mapOutcomeExit / killGroup) plus a
// fully-injected async exercise of runKillable (fake spawn/kill/timer/signal — zero real
// processes, zero real timers). Mirrors evaluate-call.mjs's --selftest shape.
export async function selftest() {
  let fail = 0;
  const check = (label, cond) => { if (!cond) { process.stderr.write(`killable-spawn --selftest FAIL: ${label}\n`); fail++; } };

  // -- parseArgs --
  const p1 = parseArgs(["--deadline", "480", "--", "node", "x.mjs", "--foo"]);
  check("parseArgs: happy path (default grace)", p1.ok && p1.deadlineSec === 480 && p1.graceSec === DEFAULT_GRACE_SECONDS && p1.target[0] === "node" && p1.target[1] === "x.mjs");
  const p2 = parseArgs(["--deadline", "10", "--grace", "5", "--", "node", "x.mjs"]);
  check("parseArgs: explicit --grace", p2.ok && p2.deadlineSec === 10 && p2.graceSec === 5);
  const p3 = parseArgs(["--deadline", "10", "node", "x.mjs"]);
  check("parseArgs: missing `--` separator -> refused (USAGE)", p3.ok === false);
  const p4 = parseArgs(["--deadline", "10", "--"]);
  check("parseArgs: empty target after `--` -> refused", p4.ok === false);
  const p5 = parseArgs(["--", "node", "x.mjs"]);
  check("parseArgs: missing --deadline -> refused", p5.ok === false);
  const p6 = parseArgs(["--deadline", "notanumber", "--", "node", "x.mjs"]);
  check("parseArgs: non-numeric --deadline -> refused", p6.ok === false);
  const p7 = parseArgs(["--deadline", "-5", "--", "node", "x.mjs"]);
  check("parseArgs: non-positive --deadline -> refused", p7.ok === false);
  const p8 = parseArgs(["--deadline", "10", "--grace", "-1", "--", "node", "x.mjs"]);
  check("parseArgs: negative --grace -> refused", p8.ok === false);

  // -- mapOutcomeExit --
  check("exit: exited(0) passes through unchanged", mapOutcomeExit({ status: "exited", innerExit: 0 }) === 0);
  check("exit: exited(8) — the target's OWN graceful deadline — passes through unchanged, not remapped", mapOutcomeExit({ status: "exited", innerExit: 8 }) === 8);
  check("exit: exited(10) passes through unchanged", mapOutcomeExit({ status: "exited", innerExit: 10 }) === 10);
  check("exit: killed-deadline -> 8 (the wrapper's own backstop)", mapOutcomeExit({ status: "killed-deadline" }) === WRAPPER_EXIT.DEADLINE);
  check("exit: killed-abort -> 130", mapOutcomeExit({ status: "killed-abort" }) === WRAPPER_EXIT.ABORTED);
  check("exit: spawn-failed -> 1", mapOutcomeExit({ status: "spawn-failed" }) === WRAPPER_EXIT.SPAWN_FAILED);
  check("exit: malformed outcome -> 1 (fail-safe, never a silent success)", mapOutcomeExit(null) === WRAPPER_EXIT.SPAWN_FAILED && mapOutcomeExit({}) === WRAPPER_EXIT.SPAWN_FAILED);

  // -- killGroup --
  let killed = [];
  killGroup((pid, sig) => killed.push([pid, sig]), 4242, "SIGKILL");
  check("killGroup: signals the NEGATIVE pgid (the whole group, not the bare pid)", killed.length === 1 && killed[0][0] === -4242 && killed[0][1] === "SIGKILL");
  let threwEsrch = false;
  try {
    killGroup(() => { const e = new Error("no such process"); e.code = "ESRCH"; throw e; }, 1, "SIGKILL");
  } catch { threwEsrch = true; }
  check("killGroup: swallows ESRCH (already-exited group), never throws", !threwEsrch);
  let logged = [];
  let threwOther = false;
  try {
    killGroup(() => { throw new Error("boom"); }, 1, "SIGKILL", (m) => logged.push(m));
  } catch { threwOther = true; }
  check("killGroup: logs-and-swallows a non-ESRCH error, never throws", !threwOther && logged.length === 1);

  // -- runKillable: fully injected, fake timer/spawn/kill/signal (no real processes/timers) --
  {
    // healthy path: child 'exit'(0) fires before the timer -> exited/0, kill attempted once
    // (the defensive sweep) and swallowed, timer never fires.
    const fired = { timerArmed: null, killed: [] };
    const handlers = {};
    const fakeChild = { pid: 555, on: (ev, cb) => { handlers[ev] = cb; } };
    const outcome = runKillable(
      { deadlineSec: 480, graceSec: 30, target: ["node", "x.mjs"] },
      {
        spawnFn: () => fakeChild,
        killFn: (pid, sig) => { fired.killed.push([pid, sig]); const e = new Error("ESRCH"); e.code = "ESRCH"; throw e; },
        setTimeoutFn: (fn, ms) => { fired.timerArmed = ms; return { id: "t1" }; },
        clearTimeoutFn: () => { fired.cleared = true; },
        onSignal: () => {},
      },
    );
    handlers.exit(0, null);
    const res = await outcome;
    check("runKillable: healthy exit(0) -> status exited, innerExit 0", res.status === "exited" && res.innerExit === 0);
    check("runKillable: arms the timer at (deadline+grace)*1000", fired.timerArmed === (480 + 30) * 1000);
    check("runKillable: clears the timer on settle", fired.cleared === true);
    check("runKillable: attempts the defensive sweep kill (swallowed ESRCH)", fired.killed.length === 1 && fired.killed[0][0] === -555);
  }

  {
    // deadline path: the timer callback fires (simulated by invoking it directly) before
    // any exit -> killed-deadline/8, and a LATE exit event after settle is a no-op.
    const handlers = {};
    let timerCb = null;
    const fakeChild = { pid: 777, on: (ev, cb) => { handlers[ev] = cb; } };
    const killed = [];
    const outcome = runKillable(
      { deadlineSec: 1, graceSec: 1, target: ["node", "x.mjs"] },
      {
        spawnFn: () => fakeChild,
        killFn: (pid, sig) => killed.push([pid, sig]),
        setTimeoutFn: (fn) => { timerCb = fn; return { id: "t2" }; },
        clearTimeoutFn: () => {},
        onSignal: () => {},
      },
    );
    timerCb();
    handlers.exit(0, null);   // late, post-settle exit — must be a no-op (single-settle guard)
    const res = await outcome;
    check("runKillable: deadline+grace elapsed -> status killed-deadline", res.status === "killed-deadline");
    check("runKillable: deadline kill signals the group (negative pgid) with SIGKILL", killed.length === 1 && killed[0][0] === -777 && killed[0][1] === "SIGKILL");
    check("runKillable: mapOutcomeExit(killed-deadline) === 8 (existing exit-8 disposition, no new verdict semantics)", mapOutcomeExit(res) === 8);
  }

  {
    // abort path: SIGTERM handler fires -> killed-abort/130.
    const handlers = {};
    let sigHandlers = {};
    const fakeChild = { pid: 999, on: (ev, cb) => { handlers[ev] = cb; } };
    const killed = [];
    const outcome = runKillable(
      { deadlineSec: 480, graceSec: 30, target: ["node", "x.mjs"] },
      {
        spawnFn: () => fakeChild,
        killFn: (pid, sig) => killed.push([pid, sig]),
        setTimeoutFn: () => ({ id: "t3" }),
        clearTimeoutFn: () => {},
        onSignal: (sig, cb) => { sigHandlers[sig] = cb; },
      },
    );
    sigHandlers.SIGTERM();
    const res = await outcome;
    check("runKillable: SIGTERM -> status killed-abort", res.status === "killed-abort");
    check("runKillable: abort kill signals the group with SIGKILL", killed.length === 1 && killed[0][1] === "SIGKILL");
    check("runKillable: mapOutcomeExit(killed-abort) === 130", mapOutcomeExit(res) === 130);
  }

  {
    // spawn failure: spawnFn throws synchronously -> spawn-failed/1, no timer armed.
    let timerArmed = false;
    const outcome = runKillable(
      { deadlineSec: 480, graceSec: 30, target: ["node", "x.mjs"] },
      {
        spawnFn: () => { throw new Error("ENOENT"); },
        killFn: () => {},
        setTimeoutFn: () => { timerArmed = true; return { id: "t4" }; },
        clearTimeoutFn: () => {},
        onSignal: () => {},
      },
    );
    const res = await outcome;
    check("runKillable: spawn throw -> status spawn-failed", res.status === "spawn-failed");
    check("runKillable: spawn-failed never arms the deadline timer", timerArmed === false);
    check("runKillable: mapOutcomeExit(spawn-failed) === 1", mapOutcomeExit(res) === 1);
  }

  if (fail) { console.log(`\nkillable-spawn --selftest: FAIL (${fail} failed)`); return 1; }
  console.log("killable-spawn --selftest: ok");
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("killable-spawn.mjs")) {
  if (process.argv.includes("--selftest")) {
    selftest().then((code) => { process.exitCode = code; });
  } else {
    process.stderr.write("killable-spawn.mjs is a library module (import runKillable) — not a standalone CLI. Use review-spawn.mjs.\n");
    process.exitCode = 2;
  }
}
