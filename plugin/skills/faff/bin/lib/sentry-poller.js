// ===========================================================================
// === region:governance — sentry-poller — FAFF-470: the mint-scoped detached watchdog poller ===
// (ADR-0065's PRIMARY invocation locus). Every sentry consult faff has today is
// COOPERATIVE — `sentry check` only runs when the supervised orchestrator volunteers
// control at a between-units checkpoint (FAFF-352). This module is the invocation
// locus that does NOT depend on that cooperation: a long-lived detached child
// process, spawned once at run-mint, that loops the UNMODIFIED `faff sentry check` /
// `faff sentry abort` CLI on a fixed interval and dies with the run. It carries no
// judgment and no detection math of its own — every verdict originates from a
// `sentry check` child call (greppable as the only decision input, see decideTick
// below); its only ledger-writing action is the existing `sentry abort` child
// (ledger-mark cancellation only, FAFF-332 NO-GO — no code path here ever sends a
// real signal to any PID; process.kill(pid, 0) below is a liveness PROBE only).
//
// Lifecycle surface (all inside <run-dir>/, sidecar files — never a ledger
// field-merge; the same FAFF-355 reasoning heartbeat.js's dedicated file uses, so a
// second live process never races the orchestrator's own ledger writes):
//   sentry-poller.json   — the handle {pid, started_at, interval_secs}, written once
//                           by `start` (the parent), tmp+rename atomic.
//   sentry-poller.stop   — the stop sentinel; existence alone is the signal (no
//                           content contract), probe-verified in the ADR-0065 spike.
//   sentry-poller.log    — append-only tick telemetry, one line per tick, best-effort
//                           (a log-write fault must never wedge the watchdog itself).
//
// This is the codebase's FIRST detached, unref'd `spawn` (every other child call in
// the CLI is a blocking `spawnSync`) — the detach/unref/sentinel/self-stop mechanics
// are exactly what ADR-0065's throwaway probe demonstrated: a detached poller
// reparents to PID 1 and survives its launching shell's exit; a stop sentinel
// cleanly terminates it; nothing external reaps it if the sentinel never arrives
// (bounded here by the owner.status self-stop AND a consecutive-fault cap — FAFF-425
// shape: an own-fault is logged and polling continues, never coerced into an abort,
// but a surface broken FOREVER must not poll forever either).
//
// decideTick is the PURE tick-decision core: given the gathered facts for one tick,
// it returns exactly one action and never touches the filesystem or spawns a
// process — the `run` loop's thin I/O shell (gatherFacts / runLoop) gathers facts,
// calls it, and acts on the verdict. This mirrors sentry.js's own
// evaluateDerailment/cmdSentry split (a pure evaluator behind a thin CLI shell) and
// is what --selftest drives directly, with no event loop and no real child process.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { ENTRYPOINT, findRoot, latestRunDir, readLedger } = require("./shared-infra");
const { appendEventRecord } = require("./events");

// Default poll interval (seconds) — inside ADR-0065's proposed 60-120s band; ~1/10
// of the 900s staleness default, so the poller adds at most ~10% latency to
// detection while keeping child-spawn load trivial (~40 checks/hour). Tunable per
// --interval-secs (min 1, for tests); explicit-flag-only — no env override, mirroring
// --now-ms's hermetic-override precedent (sentry.js).
const DEFAULT_INTERVAL_SECS = 90;

// A poller whose OWN surface (the `sentry check` child) is broken forever must not
// poll forever — bounds the orphan-process risk on a permanently faulty surface.
// 20 consecutive faults ~= 30 minutes at the default interval.
const FAULT_CAP = 20;

// The closed log-token vocabulary (spec §3). appendLog defends against a stray
// caller-typo'd token by coercing to "indeterminate" rather than writing an
// unrecognised token to the on-disk trail.
const LOG_TOKENS = new Set([
  "spawned", "poll-ok", "poll-trip", "advisory-trip", "abort-actioned", "abort-failed",
  "indeterminate", "self-stop-owner-status", "stop-sentinel", "run-dir-gone", "fault-cap-exit",
]);

function handlePath(runDir) { return path.join(runDir, "sentry-poller.json"); }
function stopSentinelPath(runDir) { return path.join(runDir, "sentry-poller.stop"); }
function logPathFor(runDir) { return path.join(runDir, "sentry-poller.log"); }

// Atomic tmp+rename write — the SAME idiom heartbeat.js's atomicWriteSingleValueFile
// uses (FAFF-355), so a concurrent reader (`status`) never observes a partial write.
function atomicWriteFile(target, content) {
  const tmp = `${target}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, target);
}

function writeHandle(runDir, handle) {
  atomicWriteFile(handlePath(runDir), JSON.stringify(handle, null, 2) + "\n");
}

function readHandle(runDir) {
  try { return JSON.parse(fs.readFileSync(handlePath(runDir), "utf8")); }
  catch { return null; }
}

// process.kill(pid, 0) is the standard liveness PROBE (signal 0 sends nothing) — it
// throws ESRCH when the pid is gone. This is the ONLY process.kill call in this
// module, and it is never a real signal: the poller never kills, signals, or
// interrupts any process (D5 / the WHY-principles DoD item).
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

// Best-effort append — a telemetry-write fault must never terminate or block the
// loop (spec DoD: "log-append failure never terminates or blocks the loop"). Also
// the only writer for the "run-dir-gone" token, which is best-effort by definition
// (the dir it would write into may already be gone) — the same swallow covers both.
function appendLog(runDir, token, detail) {
  const tok = LOG_TOKENS.has(token) ? token : "indeterminate";
  try {
    const line = `${new Date().toISOString()} ${tok}${detail !== undefined ? ` ${JSON.stringify(detail)}` : ""}\n`;
    fs.appendFileSync(logPathFor(runDir), line);
  } catch { /* telemetry must never wedge the watchdog */ }
}

// -----------------------------------------------------------------------------
// The pure tick-decision core. NO filesystem access, NO process spawn — every
// input is a gathered fact, every output is exactly one action for the thin I/O
// shell to perform. This is what --selftest drives directly (SENTRY_POLLER_
// SELFTEST_CASES below), and it is the ONLY place tick dispatch logic lives.
//
// facts:
//   sentinelExists    bool
//   runDirExists      bool
//   ledgerFault       string|null   — set iff the ledger was unreadable/malformed
//   ownerStatus       string|null   — ledger.owner.status (absent ⇒ null)
//   isL4              bool          — ledger.level === "L4"
//   checkFault        string|null   — set iff the `sentry check` child faulted
//                                     (exit 3 / unparseable stdout / spawn error)
//   checkPayload      object|null   — the parsed `sentry check --json` payload
//   consecutiveFaults int           — the fault streak BEFORE this tick
//
// Returns { action, terminal, consecutiveFaults, ... }. `consecutiveFaults` is the
// streak the CALLER must carry into the NEXT tick (decideTick never mutates input).
// For action "abort", `terminal` is left null — the I/O shell only knows whether the
// loop ends once it has run the `sentry abort` child and observed its exit status
// (spec §4: a failed abort child logs abort-failed and CONTINUES, retried next tick).
// -----------------------------------------------------------------------------
function decideTick(facts) {
  const cf = Number.isInteger(facts.consecutiveFaults) ? facts.consecutiveFaults : 0;
  if (facts.sentinelExists) {
    return { action: "stop-sentinel", terminal: true, consecutiveFaults: cf };
  }
  if (!facts.runDirExists) {
    return { action: "run-dir-gone", terminal: true, consecutiveFaults: cf };
  }
  if (facts.ledgerFault) {
    return faultDecision(`ledger unreadable/malformed: ${facts.ledgerFault}`, cf);
  }
  if (facts.ownerStatus !== "running") {
    return { action: "self-stop-owner-status", terminal: true, consecutiveFaults: cf, status: facts.ownerStatus ?? null };
  }
  if (facts.checkFault) {
    return faultDecision(facts.checkFault, cf);
  }
  const payload = facts.checkPayload || {};
  if (payload.tripped && payload.intervention === "abort") {
    // Mint-scoped action (ADR-0044 / the existing beep-boop handling table): acting
    // is conditional on level, the CONSULT never is. A non-L4 run gets the same
    // advisory telemetry every other trip gets — never a forked consult.
    if (facts.isL4) return { action: "abort", terminal: null, consecutiveFaults: 0, payload };
    return { action: "advisory-trip", terminal: false, consecutiveFaults: 0, payload };
  }
  if (payload.tripped && (payload.intervention === "pause" || payload.intervention === "correct")) {
    // Anti-pattern (spec HOW): the poller never acts on pause/correct at ANY level —
    // those are orchestrator-judgment interventions (park an issue, author a
    // corrective) that only make sense at a cooperative checkpoint. Both levels get
    // the same advisory-trip telemetry, never a dispatch action.
    return { action: "advisory-trip", terminal: false, consecutiveFaults: 0, payload };
  }
  return { action: "poll-ok", terminal: false, consecutiveFaults: 0, payload };
}

function faultDecision(reason, consecutiveFaultsBefore) {
  const cf = consecutiveFaultsBefore + 1;
  if (cf >= FAULT_CAP) {
    return { action: "fault-cap-exit", terminal: true, consecutiveFaults: cf, reason };
  }
  return { action: "indeterminate", terminal: false, consecutiveFaults: cf, reason };
}

// --interval-secs: integer >= 1, default DEFAULT_INTERVAL_SECS. Pure parse, no I/O.
function parseIntervalSecs(raw) {
  if (raw == null) return { value: DEFAULT_INTERVAL_SECS };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    return { error: `--interval-secs must be an integer >= 1 (got ${JSON.stringify(raw)})` };
  }
  return { value: n };
}

// -----------------------------------------------------------------------------
// Thin I/O: gather this tick's facts from the filesystem + a `sentry check` child
// call, matching decideTick's short-circuit order exactly (no point spawning the
// check child if the sentinel/dir-gone/ledger-fault/owner-status checks already
// resolve the tick) — the ordering is a pure optimisation, not a behaviour fork:
// decideTick still short-circuits identically on whichever facts ARE populated.
// -----------------------------------------------------------------------------
function gatherFacts(runDir, consecutiveFaults) {
  const facts = {
    consecutiveFaults, sentinelExists: false, runDirExists: false, ledgerFault: null,
    ownerStatus: null, isL4: false, checkFault: null, checkPayload: null,
  };
  facts.sentinelExists = fs.existsSync(stopSentinelPath(runDir));
  if (facts.sentinelExists) return facts;
  facts.runDirExists = fs.existsSync(runDir);
  if (!facts.runDirExists) return facts;

  let ledger;
  try { ledger = readLedger(runDir); }
  catch (e) { facts.ledgerFault = e.message; return facts; }
  facts.ownerStatus = (ledger.owner && ledger.owner.status) ?? null;
  facts.isL4 = ledger.level === "L4";
  if (facts.ownerStatus !== "running") return facts;

  const r = spawnSync(process.execPath, [ENTRYPOINT, "sentry", "check", "--json", "--run-dir", runDir], { encoding: "utf8" });
  if (r.error) { facts.checkFault = `spawn error: ${r.error.message}`; return facts; }
  if (r.status === 3) { facts.checkFault = "sentry check exit 3 (indeterminate — the check's own fault)"; return facts; }
  if (r.status !== 0) { facts.checkFault = `sentry check exited ${r.status}`; return facts; }
  try { facts.checkPayload = JSON.parse(r.stdout); }
  catch (e) { facts.checkFault = `unparseable sentry check output: ${e.message}`; }
  return facts;
}

function logDecision(runDir, decision) {
  switch (decision.action) {
    case "stop-sentinel": appendLog(runDir, "stop-sentinel"); break;
    case "run-dir-gone": appendLog(runDir, "run-dir-gone"); break;
    case "self-stop-owner-status": appendLog(runDir, "self-stop-owner-status", { status: decision.status }); break;
    case "indeterminate": appendLog(runDir, "indeterminate", { reason: decision.reason }); break;
    case "fault-cap-exit": appendLog(runDir, "fault-cap-exit", { reason: decision.reason, consecutive_faults: decision.consecutiveFaults }); break;
    case "advisory-trip": appendLog(runDir, "advisory-trip", { intervention: decision.payload.intervention, signals: (decision.payload.verdicts || []).map((v) => v.signal) });
      break;
    case "poll-ok": appendLog(runDir, "poll-ok", { intervention: decision.payload.intervention }); break;
    default: break; // "abort" is logged by runLoop, once the abort child's own result is known
  }
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// The foreground loop `sentry-poller run` executes — spawned detached+unref'd by
// `start`. Async (returns a Promise): bin/faff's main() already resolves a
// returned Promise to an exit code (the FAFF-422 `engine call` precedent), so the
// interval sleep is a real non-blocking setTimeout, not a busy-wait.
async function runLoop(runDir, intervalSecs) {
  appendLog(runDir, "spawned", { pid: process.pid, interval_secs: intervalSecs });
  let consecutiveFaults = 0;
  for (;;) {
    const facts = gatherFacts(runDir, consecutiveFaults);
    const decision = decideTick(facts);
    consecutiveFaults = decision.consecutiveFaults;

    if (decision.action === "abort") {
      // FAFF-332 NO-GO / D9: no --worktree (the poller has no reliable source for
      // the in-flight worktree path) — ledger-mark cancellation only. The WIP
      // auto-commit courtesy is skipped by design; nothing is destroyed.
      const a = spawnSync(process.execPath, [ENTRYPOINT, "sentry", "abort", "--run-dir", runDir, "--json"], { encoding: "utf8" });
      if (a.status === 0) {
        // D10: one sentry-checkpoint event on the L4 abort action only (never per-tick —
        // that would spam events.jsonl). Best-effort: a failure here never blocks or
        // reorders the abort, which has already landed on the ledger.
        try {
          let ledger = null;
          try { ledger = readLedger(runDir); } catch { /* best-effort — the abort already landed */ }
          const runId = (ledger && ledger.run_id) || path.basename(runDir);
          appendEventRecord(runDir, runId, { phase: "run", type: "sentry-checkpoint", data: decision.payload });
        } catch { /* best-effort */ }
        appendLog(runDir, "abort-actioned", { signals: (decision.payload.verdicts || []).map((v) => v.signal) });
        return;
      }
      appendLog(runDir, "abort-failed", { exit: a.status });
      await sleep(intervalSecs * 1000);
      continue;
    }

    logDecision(runDir, decision);
    if (decision.terminal) return;
    await sleep(intervalSecs * 1000);
  }
}

// -----------------------------------------------------------------------------
// CLI shell
// -----------------------------------------------------------------------------

function printResult(payload, asJson, humanLine) {
  if (asJson) console.log(JSON.stringify(payload));
  else console.log(humanLine);
}

// Run-dir resolution for start/stop/status — the STANDARD chain, mirroring
// `sentry check` byte-for-byte (sentry.js cmdSentry): --run-dir -> $FAFF_RUN_DIR ->
// latest under .faff/runs, filtering out a candidate whose ledger is missing.
function resolveRunDir(get, root) {
  let runDir = get("--run-dir") || process.env.FAFF_RUN_DIR || null;
  if (runDir && !fs.existsSync(path.join(runDir, "run-ledger.json"))) runDir = null;
  if (!runDir) runDir = latestRunDir(root);
  return runDir;
}

function cmdStart(runDir, get, asJson) {
  if (!runDir) {
    process.stderr.write("faff sentry-poller start: no run dir (pass --run-dir, set $FAFF_RUN_DIR, or run inside a run)\n");
    return 3;
  }
  const intervalRes = parseIntervalSecs(get("--interval-secs"));
  if (intervalRes.error) {
    process.stderr.write(`faff sentry-poller start: ${intervalRes.error}\n`);
    return 2;
  }
  const intervalSecs = intervalRes.value;

  const existing = readHandle(runDir);
  if (existing && pidAlive(existing.pid)) {
    printResult({ already_running: true, pid: existing.pid }, asJson, `faff sentry-poller: already running (pid ${existing.pid})`);
    return 0;
  }

  // Clear a stale sentinel from a previous stop in this run dir — else the fresh
  // poller would read it and exit on tick 1.
  try { fs.unlinkSync(stopSentinelPath(runDir)); } catch { /* absent is the common case */ }

  const child = spawn(process.execPath, [ENTRYPOINT, "sentry-poller", "run", "--run-dir", runDir, "--interval-secs", String(intervalSecs)], { detached: true, stdio: "ignore" });
  child.unref();

  try {
    writeHandle(runDir, { pid: child.pid, started_at: new Date().toISOString(), interval_secs: intervalSecs });
  } catch (e) {
    // Handle-write failure after spawn is loud (exit 1 — the lifecycle record is
    // load-bearing) — but per the spec-review advisory, ALSO write the stop
    // sentinel so the now-untracked poller reaps itself at its very next tick
    // instead of running forever unrecorded.
    try { atomicWriteFile(stopSentinelPath(runDir), ""); } catch { /* best-effort */ }
    process.stderr.write(`faff sentry-poller start: spawned (pid ${child.pid}) but failed to write the handle: ${e.message} — stop sentinel written so it self-reaps\n`);
    return 1;
  }
  printResult({ spawned: true, pid: child.pid, interval_secs: intervalSecs }, asJson, `faff sentry-poller: spawned (pid ${child.pid}, interval ${intervalSecs}s)`);
  return 0;
}

function cmdStop(runDir, asJson) {
  if (!runDir) {
    process.stderr.write("faff sentry-poller stop: no run dir (pass --run-dir, set $FAFF_RUN_DIR, or run inside a run)\n");
    return 3;
  }
  const handle = readHandle(runDir);
  try {
    atomicWriteFile(stopSentinelPath(runDir), "");
  } catch (e) {
    process.stderr.write(`faff sentry-poller stop: failed to write stop sentinel: ${e.message}\n`);
    return 1;
  }
  const pid = handle ? handle.pid : null;
  const alive = pid != null ? pidAlive(pid) : false;
  printResult({ signalled: true, pid: pid ?? null, alive }, asJson, `faff sentry-poller: stop sentinel written${pid != null ? ` (pid ${pid}${alive ? ", alive" : ", not alive"})` : " (no handle on record)"}`);
  return 0;
}

function cmdStatus(runDir, asJson) {
  if (!runDir) {
    process.stderr.write("faff sentry-poller status: no run dir (pass --run-dir, set $FAFF_RUN_DIR, or run inside a run)\n");
    return 3;
  }
  const handle = readHandle(runDir);
  if (!handle) {
    printResult({ running: false }, asJson, "faff sentry-poller: not running (no handle)");
    return 0;
  }
  const alive = pidAlive(handle.pid);
  printResult(
    { running: alive, pid: handle.pid, started_at: handle.started_at, interval_secs: handle.interval_secs },
    asJson,
    `faff sentry-poller: ${alive ? "running" : "not running"} (pid ${handle.pid}, started ${handle.started_at}, interval ${handle.interval_secs}s)`,
  );
  return 0;
}

// `run` is the internal loop entrypoint — spawned by `start`, never invoked by
// prose. Requires an explicit --run-dir (no chain resolution: the parent always
// passes the exact dir it resolved). Returns a Promise resolving to the exit code.
function cmdRun(get) {
  const runDir = get("--run-dir");
  if (!runDir) {
    process.stderr.write("faff sentry-poller run: --run-dir is required\n");
    return 2;
  }
  if (!fs.existsSync(runDir)) {
    process.stderr.write(`faff sentry-poller run: run dir not found: ${runDir}\n`);
    return 3;
  }
  const intervalRes = parseIntervalSecs(get("--interval-secs"));
  if (intervalRes.error) {
    process.stderr.write(`faff sentry-poller run: ${intervalRes.error}\n`);
    return 2;
  }
  return runLoop(runDir, intervalRes.value).then(() => 0);
}

const { parseArgs, usageError } = require("./argv");
const SENTRY_POLLER_SPEC = {
  flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--root": { arity: 1 }, "--run-dir": { arity: 1 }, "--interval-secs": { arity: 1 } },
  positionals: { min: 0, max: 1, name: "verb" },
};

function cmdSentryPoller(args) {
  if (args.includes("--selftest")) return sentryPollerSelftest();
  const parsed = parseArgs(args, SENTRY_POLLER_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, "usage: faff sentry-poller <start|stop|status|run> [--run-dir DIR] [--interval-secs N] [--root DIR] [--json]");
  const sub = parsed.positionals[0];
  const get = (f) => (parsed.values[f] === undefined ? null : parsed.values[f]);
  const asJson = !!parsed.values["--json"];
  const root = get("--root") || findRoot();

  if (sub === "run") return cmdRun(get);

  const runDir = resolveRunDir(get, root);
  if (sub === "start") return cmdStart(runDir, get, asJson);
  if (sub === "stop") return cmdStop(runDir, asJson);
  if (sub === "status") return cmdStatus(runDir, asJson);

  process.stderr.write("faff sentry-poller: expected one of start | stop | status | run (or --selftest)\n");
  return 2;
}

// -----------------------------------------------------------------------------
// --selftest: a pure fixture table over decideTick — every dispatch row the spec's
// DoD names (sentinel / dir-gone / ledger-fault / owner-status / L4-abort /
// non-L4-advisory / pause / correct / indeterminate / fault-cap), plus
// parseIntervalSecs's validation table. No filesystem, no child process.
// -----------------------------------------------------------------------------
const TRIP_ABORT = { tripped: true, intervention: "abort", verdicts: [{ signal: "wall-clock-runaway", severity: "trip" }] };
const TRIP_PAUSE = { tripped: true, intervention: "pause", verdicts: [{ signal: "fix-review-thrash", severity: "warn" }] };
const TRIP_CORRECT = { tripped: true, intervention: "correct", verdicts: [{ signal: "fix-review-thrash", severity: "trip" }] };
const NO_TRIP = { tripped: false, intervention: "continue", verdicts: [] };

const SENTRY_POLLER_SELFTEST_CASES = [
  ["stop sentinel present -> stop-sentinel, terminal",
    { sentinelExists: true, runDirExists: true, consecutiveFaults: 0 },
    { action: "stop-sentinel", terminal: true, consecutiveFaults: 0 }],
  ["run dir gone -> run-dir-gone, terminal",
    { sentinelExists: false, runDirExists: false, consecutiveFaults: 0 },
    { action: "run-dir-gone", terminal: true, consecutiveFaults: 0 }],
  ["ledger unreadable -> indeterminate, fault streak +1",
    { sentinelExists: false, runDirExists: true, ledgerFault: "ENOENT", consecutiveFaults: 0 },
    { action: "indeterminate", terminal: false, consecutiveFaults: 1 }],
  ["owner.status not running -> self-stop-owner-status, terminal",
    { sentinelExists: false, runDirExists: true, ledgerFault: null, ownerStatus: "done", isL4: true, consecutiveFaults: 0 },
    { action: "self-stop-owner-status", terminal: true, consecutiveFaults: 0, status: "done" }],
  ["owner absent (null status) -> self-stop-owner-status",
    { sentinelExists: false, runDirExists: true, ledgerFault: null, ownerStatus: null, isL4: false, consecutiveFaults: 0 },
    { action: "self-stop-owner-status", terminal: true, consecutiveFaults: 0, status: null }],
  ["sentry check exit 3 -> indeterminate, fault streak +1",
    { sentinelExists: false, runDirExists: true, ledgerFault: null, ownerStatus: "running", isL4: true, checkFault: "sentry check exit 3", consecutiveFaults: 3 },
    { action: "indeterminate", terminal: false, consecutiveFaults: 4 }],
  ["L4 + tripped abort -> abort, fault streak reset",
    { sentinelExists: false, runDirExists: true, ledgerFault: null, ownerStatus: "running", isL4: true, checkFault: null, checkPayload: TRIP_ABORT, consecutiveFaults: 2 },
    { action: "abort", terminal: null, consecutiveFaults: 0, payload: TRIP_ABORT }],
  ["non-L4 + tripped abort -> advisory-trip, never touches the ledger",
    { sentinelExists: false, runDirExists: true, ledgerFault: null, ownerStatus: "running", isL4: false, checkFault: null, checkPayload: TRIP_ABORT, consecutiveFaults: 0 },
    { action: "advisory-trip", terminal: false, consecutiveFaults: 0, payload: TRIP_ABORT }],
  ["L4 + pause intervention -> advisory-trip, never dispatches (anti-pattern guard)",
    { sentinelExists: false, runDirExists: true, ledgerFault: null, ownerStatus: "running", isL4: true, checkFault: null, checkPayload: TRIP_PAUSE, consecutiveFaults: 0 },
    { action: "advisory-trip", terminal: false, consecutiveFaults: 0, payload: TRIP_PAUSE }],
  ["non-L4 + correct intervention -> advisory-trip",
    { sentinelExists: false, runDirExists: true, ledgerFault: null, ownerStatus: "running", isL4: false, checkFault: null, checkPayload: TRIP_CORRECT, consecutiveFaults: 0 },
    { action: "advisory-trip", terminal: false, consecutiveFaults: 0, payload: TRIP_CORRECT }],
  ["no trip -> poll-ok, fault streak reset",
    { sentinelExists: false, runDirExists: true, ledgerFault: null, ownerStatus: "running", isL4: true, checkFault: null, checkPayload: NO_TRIP, consecutiveFaults: 5 },
    { action: "poll-ok", terminal: false, consecutiveFaults: 0, payload: NO_TRIP }],
  ["19th consecutive fault -> still indeterminate (cap is 20)",
    { sentinelExists: false, runDirExists: true, ledgerFault: "still broken", consecutiveFaults: 18 },
    { action: "indeterminate", terminal: false, consecutiveFaults: 19 }],
  ["20th consecutive fault -> fault-cap-exit, terminal (bounds the orphan-process risk)",
    { sentinelExists: false, runDirExists: true, ledgerFault: "still broken", consecutiveFaults: 19 },
    { action: "fault-cap-exit", terminal: true, consecutiveFaults: 20 }],
];

function sentryPollerSelftest() {
  let fail = 0;
  for (const [name, facts, want] of SENTRY_POLLER_SELFTEST_CASES) {
    const got = decideTick(facts);
    const pick = (d) => ({ action: d.action, terminal: d.terminal, consecutiveFaults: d.consecutiveFaults, ...(d.status !== undefined ? { status: d.status } : {}), ...(d.payload !== undefined ? { payload: d.payload } : {}) });
    const gotPicked = pick(got);
    const wantPicked = { action: want.action, terminal: want.terminal, consecutiveFaults: want.consecutiveFaults, ...(want.status !== undefined ? { status: want.status } : {}), ...(want.payload !== undefined ? { payload: want.payload } : {}) };
    const ok = JSON.stringify(gotPicked) === JSON.stringify(wantPicked);
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` → ${JSON.stringify(gotPicked)} (want ${JSON.stringify(wantPicked)})`}`);
  }

  const intervalCases = [
    ["absent -> default 90", null, { value: DEFAULT_INTERVAL_SECS }],
    ["'1' -> 1 (test minimum)", "1", { value: 1 }],
    ["'90' -> 90", "90", { value: 90 }],
    ["'0' -> error (must be >= 1)", "0", { error: true }],
    ["'-5' -> error", "-5", { error: true }],
    ["'abc' -> error (not an integer)", "abc", { error: true }],
    ["'1.5' -> error (not an integer)", "1.5", { error: true }],
  ];
  for (const [name, raw, want] of intervalCases) {
    const got = parseIntervalSecs(raw);
    const ok = want.error ? !!got.error : got.value === want.value;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} parseIntervalSecs: ${name}${ok ? "" : ` → ${JSON.stringify(got)}`}`);
  }

  const total = SENTRY_POLLER_SELFTEST_CASES.length + intervalCases.length;
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${total} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  DEFAULT_INTERVAL_SECS, FAULT_CAP, LOG_TOKENS, SENTRY_POLLER_SELFTEST_CASES,
  appendLog, atomicWriteFile, cmdSentryPoller, decideTick, gatherFacts, handlePath,
  logDecision, parseIntervalSecs, pidAlive, readHandle, resolveRunDir, runLoop,
  sentryPollerSelftest, stopSentinelPath, logPathFor, writeHandle,
};
