// FAFF-575 — run-ledger.json mutations are lock-serialised through one critical section
// (mutateLedgerUnderLock), every write lands via a per-call-unique tmp rename, and the
// FAFF-527 owner-epoch fence is checked INSIDE the lock. Before this change the write
// path was read-merge-write with no serialisation (two writers could both pass the
// fence, then last-writer-wins silently), the write primitive used a fixed `.tmp`
// sibling (the documented two-concurrent-writers ENOENT crash), and `events --tokens`
// read-merge-wrote the whole ledger on a decayed single-writer assumption.
//
// These tests prove the headline objective (concurrent mutations all preserved) with
// real racing child processes — a mix of `sentry abort` marks (real CLI), checkpoint
// advances through the locked core, and `budget baseline` attempts (real CLI) — plus
// the mechanism's edge cases (unique-tmp overlap, stale-lock takeover, loud lock
// failure, mint-from-scratch, malformed-ledger loudness) and the critical-section
// hygiene the spec makes assertable on code structure. The fence-yield-through-the-core
// unit lives in test/lights-out-resume.test.mjs (alongside the fence's own rows);
// the shared-helper acquisition-loop behaviours already exercised via the events lock
// (test/events-concurrency.test.mjs, FAFF-574) are not duplicated here — this file
// covers the same helper through the LEDGER lock consumer.
//
// Kept deterministic-by-assertion (order-independent invariants: the abort mark is
// present, a checkpoint advance landed, exactly one baseline won) — never asserting
// which writer won a given interleaving.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mutateLedgerUnderLock, atomicWriteLedger } from "../plugin/skills/faff/bin/lib/heartbeat.js";
import { ACQUIRE_BUDGET_MS, STALE_LOCK_MS } from "../plugin/skills/faff/bin/lib/fs-lock.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");
const LIB = join(HERE, "..", "plugin", "skills", "faff", "bin", "lib");

function mkRun(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const runDir = join(root, ".faff", "runs", "RUN-L");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({
    run_id: "RUN-L",
    admitted: [],
    outcomes: {},
    owner: { status: "running", session_id: "sess-orig", pid: 1, started_at: "2026-07-22T00:00:00Z", last_heartbeat: "2026-07-22T00:00:00Z" },
  }, null, 2) + "\n");
  return { root, runDir, ledgerPath: join(runDir, "run-ledger.json") };
}

function runChild(cmd, args, opts = {}, stdinData = null) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts });
    if (stdinData !== null) child.stdin.end(stdinData);
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => resolve({ code, out, err }));
    child.on("error", () => resolve({ code: 1, out, err: err + "spawn-error" }));
  });
}

// A child process that performs one checkpoint-advance mutation through the locked core
// (the same mutation shape `events append --tokens` runs inside its critical section).
function checkpointAdvanceChild(runDir, total) {
  const script = `
    const { mutateLedgerUnderLock } = require(${JSON.stringify(join(LIB, "heartbeat.js"))});
    const res = mutateLedgerUnderLock(${JSON.stringify(runDir)}, (fresh) => {
      if (!fresh) return null;
      fresh.budget = fresh.budget && typeof fresh.budget === "object" ? fresh.budget : {};
      fresh.budget.tokens_at_last_event = { input: ${total}, output: 0, cache_write: 0, cache_read: 0 };
      return fresh;
    });
    if (!res.written) process.exit(3);
  `;
  return runChild(process.execPath, ["-e", script]);
}

// --- Scenario: concurrent mutation preservation (the headline objective) ------------
test("8 concurrent locked mutations (abort marks + checkpoint advances + baseline attempts) → all preserved, one baseline, parseable ledger", async () => {
  const { root, runDir, ledgerPath } = mkRun("ledger-concurrency-");
  try {
    const children = [
      // 2 × sentry abort (real CLI — the detached poller's genuinely concurrent writer)
      runChild(process.execPath, [CLI, "sentry", "abort", "--run-dir", runDir, "--signal", "test-sig"], { cwd: root }),
      runChild(process.execPath, [CLI, "sentry", "abort", "--run-dir", runDir, "--signal", "test-sig-2"], { cwd: root }),
      // 3 × checkpoint advance through the locked core (the --tokens inner mutation)
      checkpointAdvanceChild(runDir, 100),
      checkpointAdvanceChild(runDir, 200),
      checkpointAdvanceChild(runDir, 300),
      // 3 × budget baseline (real CLI; estimate-degraded zero baseline — write-once)
      runChild(process.execPath, [CLI, "budget", "baseline", "--run-dir", runDir, "--session-id", "s1"], { cwd: root }),
      runChild(process.execPath, [CLI, "budget", "baseline", "--run-dir", runDir, "--session-id", "s2"], { cwd: root }),
      runChild(process.execPath, [CLI, "budget", "baseline", "--run-dir", runDir, "--session-id", "s3"], { cwd: root }),
    ];
    const results = await Promise.all(children);
    results.forEach((r, i) => assert.equal(r.code, 0, `child ${i} exits 0 (stderr: ${r.err})`));

    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8")); // parses — no torn write
    // The abort mark is present (either abort child's — both write the same status).
    assert.equal(ledger.abort && ledger.abort.status, "aborted-resumable", "abort mark present");
    // A checkpoint advance landed (one of the three totals — last lock-holder wins, none torn).
    const cp = ledger.budget && ledger.budget.tokens_at_last_event;
    assert.ok(cp && [100, 200, 300].includes(cp.input), `checkpoint advance present (got ${JSON.stringify(cp)})`);
    // Exactly one baseline was written (write-once under the lock).
    const winners = results.slice(5).filter((r) => { try { return JSON.parse(r.out).baseline_written === true; } catch { return false; } });
    assert.equal(winners.length, 1, "exactly one budget-baseline attempt wins");
    assert.ok(typeof ledger.budget.measure_session_id === "string" && ledger.budget.measure_session_id, "the winning baseline pinned its session");
    // No lock or tmp orphan remains.
    const leftovers = readdirSync(runDir).filter((f) => f.includes(".lock") || f.includes(".tmp"));
    assert.deepEqual(leftovers, [], "no lock file or tmp orphan left in the run dir");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Scenario: fixed-tmp crash retired (unique-tmp write primitive) -----------------
test("two processes writing the ledger at the same moment through atomicWriteLedger → no ENOENT, complete surviving file", async () => {
  const { root, runDir, ledgerPath } = mkRun("ledger-tmp-overlap-");
  try {
    const writerScript = (tag) => `
      const { atomicWriteLedger } = require(${JSON.stringify(join(LIB, "heartbeat.js"))});
      for (let i = 0; i < 200; i++) {
        atomicWriteLedger(${JSON.stringify(runDir)}, { run_id: "RUN-L", writer: ${JSON.stringify(tag)}, i });
      }
    `;
    const [a, b] = await Promise.all([
      runChild(process.execPath, ["-e", writerScript("A")]),
      runChild(process.execPath, ["-e", writerScript("B")]),
    ]);
    assert.equal(a.code, 0, `writer A exits 0 — no ENOENT rename race (stderr: ${a.err})`);
    assert.equal(b.code, 0, `writer B exits 0 — no ENOENT rename race (stderr: ${b.err})`);
    const surviving = JSON.parse(readFileSync(ledgerPath, "utf8"));
    assert.ok(["A", "B"].includes(surviving.writer), "the surviving file is one writer's complete, parseable output");
    assert.equal(surviving.i, 199, "the surviving file is a COMPLETE final write, not a torn interleaving");
    const orphans = readdirSync(runDir).filter((f) => f.includes(".tmp"));
    assert.deepEqual(orphans, [], "no tmp orphan left behind");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Scenario: lock edge cases through the ledger consumer --------------------------
test("a stale ledger lock (mtime past the bound) is taken over; the mutation succeeds and releases the lock", () => {
  const { root, runDir, ledgerPath } = mkRun("ledger-stale-lock-");
  try {
    const lockPath = ledgerPath + ".lock";
    writeFileSync(lockPath, JSON.stringify({ pid: 999999, ts: "dead" }));
    const old = (Date.now() - (STALE_LOCK_MS + 60000)) / 1000;
    utimesSync(lockPath, old, old); // a holder that died mid-section long ago
    const res = mutateLedgerUnderLock(runDir, (fresh) => ({ ...fresh, taken_over: true }));
    assert.equal(res.written, true, "the stale lock was taken over and the mutation landed");
    assert.equal(JSON.parse(readFileSync(ledgerPath, "utf8")).taken_over, true);
    assert.ok(!existsSync(lockPath), "the lock is released after the mutation");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a fresh live ledger lock is waited on until the acquisition budget is spent, then throws LEDGER_LOCKED (never an unlocked write)", () => {
  const { root, runDir, ledgerPath } = mkRun("ledger-live-lock-");
  try {
    writeFileSync(ledgerPath + ".lock", JSON.stringify({ pid: process.pid, ts: new Date().toISOString() })); // a live holder
    const before = readFileSync(ledgerPath, "utf8");
    const t0 = Date.now();
    assert.throws(
      () => mutateLedgerUnderLock(runDir, (fresh) => ({ ...fresh, clobbered: true })),
      (e) => e.code === "LEDGER_LOCKED",
      "budget exhaustion throws the tagged error",
    );
    assert.ok(Date.now() - t0 >= ACQUIRE_BUDGET_MS - 50, "the full acquisition budget was spent waiting");
    assert.equal(readFileSync(ledgerPath, "utf8"), before, "nothing was written — no unlocked-write fallback");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Scenario: mint-from-scratch and malformed-ledger loudness ----------------------
test("mutateLedgerUnderLock on an absent ledger hands the mutate a null fresh read (the mint path) and writes from scratch", () => {
  const root = mkdtempSync(join(tmpdir(), "ledger-mint-"));
  const runDir = join(root, ".faff", "runs", "RUN-M");
  mkdirSync(runDir, { recursive: true });
  try {
    let sawNull = false;
    const res = mutateLedgerUnderLock(runDir, (fresh) => { sawNull = fresh === null; return { run_id: "RUN-M", minted: true }; });
    assert.equal(sawNull, true, "an absent ledger reaches the mutate as null (mint-from-scratch)");
    assert.equal(res.written, true);
    assert.equal(JSON.parse(readFileSync(join(runDir, "run-ledger.json"), "utf8")).minted, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("mutateLedgerUnderLock on a MALFORMED ledger throws loudly (never silently degrades to an empty object) and still releases the lock", () => {
  const root = mkdtempSync(join(tmpdir(), "ledger-malformed-"));
  const runDir = join(root, ".faff", "runs", "RUN-B");
  mkdirSync(runDir, { recursive: true });
  try {
    writeFileSync(join(runDir, "run-ledger.json"), "{ not json");
    assert.throws(() => mutateLedgerUnderLock(runDir, (fresh) => fresh), SyntaxError, "a corrupt ledger surfaces loudly");
    assert.ok(!existsSync(join(runDir, "run-ledger.json.lock")), "the lock is released on throw (finally)");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a null-returning mutate aborts without writing (and without a yield)", () => {
  const { root, runDir, ledgerPath } = mkRun("ledger-abort-mutate-");
  try {
    const before = readFileSync(ledgerPath, "utf8");
    const res = mutateLedgerUnderLock(runDir, () => null);
    assert.deepEqual(res, { written: false, yielded: false });
    assert.equal(readFileSync(ledgerPath, "utf8"), before, "nothing written on a null mutate");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Integration smoke (DoD): --tokens append ∥ sentry abort ------------------------
test("smoke: parallel `events append --tokens` and `sentry abort` → ledger parses, abort mark present, honest tokens_source, no tmp orphan", async () => {
  const { root, runDir, ledgerPath } = mkRun("ledger-smoke-");
  try {
    const [append, abort] = await Promise.all([
      runChild(process.execPath, [CLI, "events", "append", "--run", "RUN-L", "--tokens"], { cwd: root },
        JSON.stringify({ phase: "run", type: "budget-checkpoint" })),
      runChild(process.execPath, [CLI, "sentry", "abort", "--run-dir", runDir, "--signal", "smoke-sig"], { cwd: root }),
    ]);
    assert.equal(append.code, 0, `append exits 0 (stderr: ${append.err})`);
    assert.equal(abort.code, 0, `abort exits 0 (stderr: ${abort.err})`);
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    assert.equal(ledger.abort && ledger.abort.status, "aborted-resumable", "abort mark present");
    // The emitted record carries EITHER an advanced transcript checkpoint OR the honest
    // estimate degrade — never a fabricated delta (in this env, no transcript ⇒ estimate).
    const rec = JSON.parse(append.out);
    assert.ok(["transcript", "estimate"].includes(rec.data.tokens_source), "honest tokens_source on the emitted record");
    if (rec.data.tokens_source === "transcript") {
      assert.ok(ledger.budget && ledger.budget.tokens_at_last_event, "a transcript delta implies the checkpoint advanced");
    }
    const leftovers = readdirSync(runDir).filter((f) => f.includes(".tmp") || f.includes(".lock"));
    assert.deepEqual(leftovers, [], "no tmp orphan or lock file remains");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Caller loudness contracts on LEDGER_LOCKED (DoD, caller table) -----------------
test("sentry abort under a held ledger lock exits 1 naming the lock (the abort mark is the abort — never a silent skip)", async () => {
  const { root, runDir, ledgerPath } = mkRun("ledger-abort-locked-");
  try {
    writeFileSync(ledgerPath + ".lock", JSON.stringify({ pid: process.pid, ts: new Date().toISOString() })); // live holder
    const r = await runChild(process.execPath, [CLI, "sentry", "abort", "--run-dir", runDir, "--signal", "sig"], { cwd: root });
    assert.equal(r.code, 1, "abort exits 1 when the lock cannot be acquired");
    assert.match(r.err, /LEDGER|ledger lock/i, "stderr names the lock");
    assert.equal(JSON.parse(readFileSync(ledgerPath, "utf8")).abort, undefined, "no unlocked-write fallback — the mark was NOT written");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("budget baseline under a held ledger lock prints baseline_written:false reason ledger-locked and exits 0 (metering never crashes a run)", async () => {
  const { root, runDir, ledgerPath } = mkRun("ledger-baseline-locked-");
  try {
    writeFileSync(ledgerPath + ".lock", JSON.stringify({ pid: process.pid, ts: new Date().toISOString() })); // live holder
    const r = await runChild(process.execPath, [CLI, "budget", "baseline", "--run-dir", runDir, "--session-id", "s1"], { cwd: root });
    assert.equal(r.code, 0, "baseline exits 0 on a busy lock");
    const out = JSON.parse(r.out);
    assert.equal(out.baseline_written, false);
    assert.equal(out.reason, "ledger-locked");
    const budget = JSON.parse(readFileSync(ledgerPath, "utf8")).budget;
    assert.ok(!budget || !budget.measure_session_id, "checkpoint state untouched — no unlocked write");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Critical-section hygiene (spec §4 — assertable on code structure) --------------
// The expensive pre-work runs BEFORE the lock is acquired: sentry abort's WIP commit
// (a git/stage-guard subprocess) and events --tokens' transcript measurement both
// appear strictly before their mutateLedgerUnderLock call in their command's source.
test("critical-section hygiene: sentry abort commits WIP, and events --tokens measures, BEFORE acquiring the ledger lock", () => {
  const sentrySrc = readFileSync(join(LIB, "sentry.js"), "utf8");
  const abortBranch = sentrySrc.slice(sentrySrc.indexOf('if (sub === "abort")'));
  const wipIdx = abortBranch.indexOf("stage-guard");
  const sentryLockIdx = abortBranch.indexOf("mutateLedgerUnderLock");
  assert.ok(wipIdx > -1 && sentryLockIdx > -1, "both the WIP stage and the locked mutation exist in the abort branch");
  assert.ok(wipIdx < sentryLockIdx, "sentry abort: the WIP commit subprocess runs before the locked ledger mutation");

  const eventsSrc = readFileSync(join(LIB, "events.js"), "utf8");
  const appendBranch = eventsSrc.slice(eventsSrc.indexOf('if (cmd === "append")'));
  const measureIdx = appendBranch.indexOf("measureTokensByClass(");
  const eventsLockIdx = appendBranch.indexOf("mutateLedgerUnderLock");
  assert.ok(measureIdx > -1 && eventsLockIdx > -1, "both the token measurement and the locked mutation exist in the append branch");
  assert.ok(measureIdx < eventsLockIdx, "events --tokens: the transcript measurement runs before the locked ledger mutation");
});

// --- The sweep: no production ledger write bypasses the locked core -----------------
// DoD: "grep shows no production atomicWriteLedger/atomicWriteLedgerFenced call outside
// it". atomicWriteLedgerFenced is gone entirely; atomicWriteLedger's only production
// call site is inside mutateLedgerUnderLock (heartbeat.js — the core's own write step).
test("writer sweep: no production module calls atomicWriteLedger outside the locked core; atomicWriteLedgerFenced no longer exists", () => {
  const files = readdirSync(LIB).filter((f) => f.endsWith(".js"));
  for (const f of files) {
    const src = readFileSync(join(LIB, f), "utf8");
    assert.ok(!src.includes("atomicWriteLedgerFenced"), `${f}: atomicWriteLedgerFenced is superseded by mutateLedgerUnderLock`);
    if (f === "heartbeat.js") continue; // the primitive's home — the core calls it there
    const callSites = src.split("\n").filter((l) => /\batomicWriteLedger\s*\(/.test(l) && !l.trim().startsWith("//") && !l.trim().startsWith("*"));
    assert.deepEqual(callSites, [], `${f}: no direct atomicWriteLedger call outside the locked core`);
  }
});
