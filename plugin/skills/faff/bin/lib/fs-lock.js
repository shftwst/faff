// fs-lock.js — the ONE home for the run-dir advisory file-lock idiom (FAFF-574 / FAFF-575).
//
// FAFF-574 settled advisory lock files as how run-dir state files serialise concurrent
// writers; FAFF-575 extracts the mechanics here so both consumers — the events.jsonl
// append core (events.js) and the run-ledger mutation core (heartbeat.js) — share one
// acquisition loop and one set of tuning constants. A second copy of either is the exact
// drift vector the events-side hand-rolled seq-mint copies demonstrated: never fork this.
//
// Mechanics: the lock is taken by atomic exclusive create (`fs.openSync(path, "wx")` —
// atomic on POSIX and Windows); the file's EXISTENCE is the lock, its {pid, ts} content
// is forensic only, never consulted for the decision. On EEXIST: take over a stale lock
// (mtime older than STALE_LOCK_MS ⇒ dead holder), else wait RETRY_INTERVAL_MS and retry
// until ACQUIRE_BUDGET_MS is spent, then THROW an error tagged with the caller's code —
// never fall through to an unlocked write (that would reintroduce the race under exactly
// the contention that fires it). Release is `unlink` in a `finally`, best-effort.
//
// Tuning constants are module-level, not config keys: a user has no basis to tune them,
// and each consumer's critical section is a handful of sub-millisecond syscalls, so
// STALE_LOCK_MS sits ~1000× above it and ACQUIRE_BUDGET_MS covers over a hundred
// contending writers. Assumes the locked path lives on a local filesystem where
// exclusive-create is atomic (both consumers' specs record the same assumption).

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const RETRY_INTERVAL_MS = 15;    // sleep between acquisition attempts
const ACQUIRE_BUDGET_MS = 2000;  // total time to keep trying before failing loudly
const STALE_LOCK_MS = 5000;      // a lock older than this is a dead holder — take it over

// Dependency-free synchronous sleep (Atomics.wait on a throwaway SharedArrayBuffer) — the
// sync style the rest of this CLI uses; no async/await, no busy-spin.
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Acquire the advisory lock at `lockPath`. `opts.code` tags the budget-exhaustion error
// (e.g. "EVENTS_LOCKED", "LEDGER_LOCKED") so each caller surfaces it per its own loudness
// contract; `opts.label` prefixes the message (e.g. "events lock", "ledger lock").
function acquireFileLock(lockPath, opts) {
  const code = (opts && opts.code) || "FILE_LOCKED";
  const label = (opts && opts.label) || "file lock";
  const start = Date.now();
  for (;;) {
    let fd;
    try {
      fd = fs.openSync(lockPath, "wx");
    } catch (e) {
      if (!e || e.code !== "EEXIST") throw e;
      let st = null;
      try { st = fs.statSync(lockPath); }
      catch (e2) { if (e2 && e2.code === "ENOENT") continue; throw e2; } // vanished — retry immediately
      if (st && (Date.now() - st.mtimeMs) > STALE_LOCK_MS) {
        try { fs.unlinkSync(lockPath); } catch (e3) { if (!e3 || e3.code !== "ENOENT") throw e3; }
        continue; // stale holder taken over — retry immediately
      }
      if (Date.now() - start >= ACQUIRE_BUDGET_MS) {
        const err = new Error(`${label}: could not acquire ${path.basename(lockPath)} within ${ACQUIRE_BUDGET_MS}ms`);
        err.code = code;
        throw err;
      }
      sleepMs(RETRY_INTERVAL_MS);
      continue;
    }
    try { fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() })); }
    finally { fs.closeSync(fd); }
    return;
  }
}

// Run `fn` with the advisory lock held; the lock is released in a `finally` (also on
// throw). Returns `fn`'s result. Throws the tagged error (from acquire) on budget
// exhaustion — callers decide their own degrade/loudness, but NEVER fall back to
// running `fn` unlocked.
function withFileLock(lockPath, fn, opts) {
  acquireFileLock(lockPath, opts);
  try {
    return fn();
  } finally {
    try { fs.unlinkSync(lockPath); } catch { /* release is best-effort — never mask the result */ }
  }
}

module.exports = { ACQUIRE_BUDGET_MS, RETRY_INTERVAL_MS, STALE_LOCK_MS, acquireFileLock, sleepMs, withFileLock };
