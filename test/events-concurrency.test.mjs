// FAFF-574 — events.jsonl appends are lock-serialised with an O(1) tail-read seq mint.
// Before this change `seq` was minted by an unlocked read-modify-write (count the whole
// file, use the count), so two concurrent appends both minted the same seq, and each
// append was O(file size). These tests prove the headline objective (concurrent mint
// uniqueness) with real racing child processes, plus the mechanism's edge cases
// (bounded tail read, torn-line newline repair, stale-lock takeover, loud lock failure)
// and the `events validate` promotion of duplicate/regressed seq to a HARD finding.
//
// Kept deterministic-by-assertion (modest N, order-independent invariants: every record
// present, seq set is exactly 0..79, validate exits 0) — never asserting which writer
// won a given seq or any cross-process timing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { appendRecordUnderLock, tailReadNextSeq, seqFinding, TAIL_WINDOW_BYTES } from "../plugin/skills/faff/bin/lib/events.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function mkRoot(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const runDir = join(root, ".faff", "runs", "RUN-C");
  mkdirSync(runDir, { recursive: true });
  return { root, runDir, log: join(runDir, "events.jsonl") };
}

// One `faff events append` child, resolved with its exit code.
function appendOnce(root) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, "events", "append", "--run", "RUN-C", "--ts", "t"], { cwd: root });
    child.stdin.end(JSON.stringify({ phase: "run", type: "budget-checkpoint" }));
    let err = "";
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => resolve({ code, err }));
    child.on("error", () => resolve({ code: 1, err: "spawn-error" }));
  });
}

function readRecords(log) {
  return readFileSync(log, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
}

// --- Scenario: concurrent mint uniqueness (the headline objective) -----------
test("16 concurrent append processes × 5 events → 80 records, seq exactly 0..79, no duplicate", async () => {
  const { root, log } = mkRoot("events-concurrency-");
  try {
    const N_WORKERS = 16, PER_WORKER = 5;
    // Each worker runs its 5 appends sequentially; the 16 workers race each other.
    const worker = async () => {
      const codes = [];
      for (let i = 0; i < PER_WORKER; i++) codes.push((await appendOnce(root)).code);
      return codes;
    };
    const results = await Promise.all(Array.from({ length: N_WORKERS }, worker));
    for (const codes of results) for (const c of codes) assert.equal(c, 0, "every concurrent append exits 0");

    const recs = readRecords(log);
    assert.equal(recs.length, N_WORKERS * PER_WORKER, "all 80 records present");
    const seqs = recs.map((r) => r.seq).sort((a, b) => a - b);
    assert.deepEqual(seqs, Array.from({ length: 80 }, (_, i) => i), "seq is exactly 0..79 — unique + gap-free under contention");

    // No lock file left behind, and `events validate` sees a clean, in-order log.
    assert.ok(!existsSync(log + ".lock"), "the advisory lock file is released after every append");
    const v = await new Promise((resolve) => {
      const c = spawn(process.execPath, [CLI, "events", "validate", "--file", log]);
      c.on("close", (code) => resolve(code));
    });
    assert.equal(v, 0, "validate exits 0 on the concurrently-written log");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Scenario: duplicate seq is a HARD validate finding (no [advisory]) ------
test("validate: two records with the same seq → exit 1, duplicate/regressed finding WITHOUT the [advisory] tag", async () => {
  const { root, log } = mkRoot("events-dupseq-");
  try {
    writeFileSync(log, [
      JSON.stringify({ schema: 1, run_id: "RUN-C", seq: 3, ts: "t", phase: "run", type: "run-start" }),
      JSON.stringify({ schema: 1, run_id: "RUN-C", seq: 4, ts: "t", phase: "run", type: "budget-checkpoint" }),
      JSON.stringify({ schema: 1, run_id: "RUN-C", seq: 4, ts: "t", phase: "run", type: "budget-checkpoint" }),
    ].join("\n") + "\n");
    const r = await new Promise((resolve) => {
      const c = spawn(process.execPath, [CLI, "events", "validate", "--file", log]);
      let err = ""; c.stderr.on("data", (d) => { err += d; });
      c.on("close", (code) => resolve({ code, err }));
    });
    assert.equal(r.code, 1, "any seq fault still exits 1");
    assert.match(r.err, /duplicate\/regressed seq/, "duplicate seq is reported as a duplicate/regressed finding");
    assert.doesNotMatch(r.err, /got 4\).*\[advisory\]/, "the duplicate finding is HARD — not [advisory]-tagged");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("validate: a forward gap alone stays [advisory] and still exits 1 (no accidental hardening)", async () => {
  const { root, log } = mkRoot("events-gap-");
  try {
    writeFileSync(log, [
      JSON.stringify({ schema: 1, run_id: "RUN-C", seq: 0, ts: "t", phase: "run", type: "run-start" }),
      JSON.stringify({ schema: 1, run_id: "RUN-C", seq: 2, ts: "t", phase: "run", type: "budget-checkpoint" }),
    ].join("\n") + "\n");
    const r = await new Promise((resolve) => {
      const c = spawn(process.execPath, [CLI, "events", "validate", "--file", log]);
      let err = ""; c.stderr.on("data", (d) => { err += d; });
      c.on("close", (code) => resolve({ code, err }));
    });
    assert.equal(r.code, 1);
    assert.match(r.err, /non-contiguous seq.*\[advisory\]/, "a forward gap keeps the [advisory] tag");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Unit: bounded tail read + mint = last.seq + 1 ---------------------------
test("tailReadNextSeq reads at most TAIL_WINDOW_BYTES on a large file and mints last.seq + 1", () => {
  const { root, log } = mkRoot("events-tail-");
  try {
    // Build a log larger than the tail window: many padded records, last seq = 999.
    const filler = "x".repeat(200); // pad data so the file comfortably exceeds 64 KiB
    const recs = [];
    for (let i = 0; i <= 999; i++) recs.push(JSON.stringify({ schema: 1, run_id: "RUN-C", seq: i, ts: "t", phase: "run", type: "budget-checkpoint", data: { pad: filler } }));
    writeFileSync(log, recs.join("\n") + "\n");
    assert.ok(statSync(log).size > TAIL_WINDOW_BYTES, "fixture file exceeds the tail window");
    const { seq, prevRecord } = tailReadNextSeq(log);
    assert.equal(seq, 1000, "next seq is minted from the last record (999) + 1");
    assert.equal(prevRecord.seq, 999, "prevRecord is the last parseable tail record");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("tailReadNextSeq on an absent or empty log mints seq 0", () => {
  const { root, log } = mkRoot("events-empty-");
  try {
    assert.deepEqual(tailReadNextSeq(log), { seq: 0, prevRecord: null }, "absent file → seq 0");
    writeFileSync(log, "");
    assert.deepEqual(tailReadNextSeq(log), { seq: 0, prevRecord: null }, "empty file → seq 0");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Unit: torn final line → newline-repair + mint from last parseable -------
test("torn final line (no newline) → next append newline-repairs, mints from the last parseable record, torn line stays malformed to validate", async () => {
  const { root, log } = mkRoot("events-torn-");
  try {
    // A well-formed record, then a torn (unterminated, invalid-JSON) trailing fragment.
    writeFileSync(log,
      JSON.stringify({ schema: 1, run_id: "RUN-C", seq: 0, ts: "t", phase: "run", type: "run-start" }) + "\n" +
      '{"schema":1,"run_id":"RUN-C","seq":1,"ts":"t","phase":"run","type":"budget-che');
    // Append through the core: mints from the last PARSEABLE record (seq 0) → seq 1,
    // and prefixes a newline so it never concatenates onto the torn fragment.
    const rec = appendRecordUnderLock(root && join(root, ".faff", "runs", "RUN-C"), (seq) => ({ schema: 1, run_id: "RUN-C", seq, ts: "t", phase: "run", type: "budget-checkpoint" }));
    assert.equal(rec.seq, 1, "mint skips the torn line and derives from the last parseable record");
    const rawLines = readFileSync(log, "utf8").split("\n").filter((l) => l !== "");
    assert.equal(rawLines.length, 3, "torn fragment preserved as its own line; new record on a fresh line (repair never rewrites bytes)");
    assert.throws(() => JSON.parse(rawLines[1]), "the torn fragment is still there, still unparseable");
    assert.equal(JSON.parse(rawLines[2]).seq, 1, "the newly appended record is well-formed");

    // validate reports the torn line as malformed while the well-formed records pass their envelope checks.
    const r = await new Promise((resolve) => {
      const c = spawn(process.execPath, [CLI, "events", "validate", "--file", log]);
      let err = ""; c.stderr.on("data", (d) => { err += d; });
      c.on("close", (code) => resolve({ code, err }));
    });
    assert.equal(r.code, 1, "a malformed line makes validate exit 1");
    assert.match(r.err, /line 2: malformed/, "the torn fragment is reported as a malformed line");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Unit: stale-lock takeover, fresh-lock wait, budget exhaustion -----------
test("a stale lock (mtime older than the bound) is taken over; the append succeeds and leaves no lock behind", () => {
  const { root, runDir, log } = mkRoot("events-stale-");
  try {
    const lock = log + ".lock";
    writeFileSync(lock, JSON.stringify({ pid: 999999, ts: "old" }));
    const old = Date.now() / 1000 - 60; // 60s ago, far beyond STALE_LOCK_MS (5s)
    utimesSync(lock, old, old);
    const rec = appendRecordUnderLock(runDir, (seq) => ({ schema: 1, run_id: "RUN-C", seq, ts: "t", phase: "run", type: "run-start" }));
    assert.equal(rec.seq, 0, "the append proceeds after taking over the stale lock");
    assert.ok(!existsSync(lock), "no lock file left behind");
    assert.equal(readRecords(log).length, 1, "exactly one record written");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a fresh live lock is waited on until the acquisition budget is spent, then throws EVENTS_LOCKED", () => {
  const { root, runDir, log } = mkRoot("events-locked-");
  try {
    const lock = log + ".lock";
    writeFileSync(lock, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() })); // fresh → live holder
    const t0 = Date.now();
    assert.throws(
      () => appendRecordUnderLock(runDir, (seq) => ({ schema: 1, run_id: "RUN-C", seq, ts: "t", phase: "run", type: "run-start" })),
      (e) => e && e.code === "EVENTS_LOCKED",
      "budget exhaustion throws a tagged EVENTS_LOCKED error",
    );
    assert.ok(Date.now() - t0 >= 2000, "it waited out the full ACQUIRE_BUDGET_MS before failing (never a silent unlocked append)");
    assert.ok(!existsSync(log), "nothing was appended while the lock was held");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Unit: the pure seq classifier ------------------------------------------
test("seqFinding classifies duplicate/regression as HARD, forward gap as [advisory], contiguous/first as clean", () => {
  assert.equal(seqFinding(-1, 0), null, "first record");
  assert.equal(seqFinding(3, 4), null, "contiguous");
  assert.match(seqFinding(4, 4), /duplicate\/regressed seq/); assert.doesNotMatch(seqFinding(4, 4), /\[advisory\]/);
  assert.match(seqFinding(5, 3), /duplicate\/regressed seq/); assert.doesNotMatch(seqFinding(5, 3), /\[advisory\]/);
  assert.match(seqFinding(4, 7), /\[advisory\]/, "forward gap stays advisory");
});
