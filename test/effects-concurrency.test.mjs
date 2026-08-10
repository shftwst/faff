// FAFF-621 — declared-effects.jsonl appends are lock-serialised BATCHES: the N descriptors
// of one `faff effects declare`/`observe` land as N contiguous chained records under ONE
// lock acquisition (appendRecordsUnderLock). This is the deterministic contiguity oracle the
// prior (per-descriptor-lock) design lacked: one batch = one lock = one atomic, gap-free seq
// run, so honest concurrent traffic can NEVER split a batch or interleave mid-batch — only
// tampering breaks the chain. These tests race real child processes to prove it: every record
// present, seqs exactly 0..N-1 (unique + gap-free), every batch's own two records adjacent in
// seq order (atomicity), and the whole ledger re-hashes clean from genesis.
//
// Kept deterministic-by-assertion (order-independent invariants) — never asserting which
// writer won a given seq block or any cross-process timing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyEffectsChain } from "../plugin/skills/faff/bin/lib/events.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function mkRoot(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const runDir = join(root, ".faff", "runs", "RUN-C");
  mkdirSync(runDir, { recursive: true });
  return { root, runDir, ledger: join(runDir, "declared-effects.jsonl") };
}

// One `faff effects declare` child of TWO descriptors under a unique step, resolved with its
// exit code. Two descriptors ⇒ one batch of two chained records under one lock.
function declareBatch(root, step) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, "effects", "declare", "--run", "RUN-C", "--issue", "FAFF-621", "--step", step, "--ts", "t"], { cwd: root });
    child.stdin.end(JSON.stringify([{ kind: "file-write", target: "x" }, { kind: "file-write", target: "y" }]));
    let err = "";
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => resolve({ code, err }));
    child.on("error", () => resolve({ code: 1, err: "spawn-error" }));
  });
}

function readRecords(ledger) {
  return readFileSync(ledger, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
}

function assertChainVerifies(ledger, runId) {
  const raw = readFileSync(ledger);
  const bufs = []; let start = 0;
  for (let i = 0; i < raw.length; i++) if (raw[i] === 0x0a) { bufs.push(raw.subarray(start, i)); start = i + 1; }
  if (start < raw.length) bufs.push(raw.subarray(start));
  let expected = sha256(Buffer.from(runId, "utf8"));
  bufs.forEach((buf, i) => {
    let rec = null; try { rec = JSON.parse(buf.toString("utf8")); } catch { /* torn/legacy */ }
    if (rec && rec.schema === 2) assert.equal(rec.prev, expected, `line ${i + 1}: prev matches the hash of the line above`);
    expected = sha256(buf);
  });
}

// --- Scenario: 16 concurrent batches × 3 declares of 2 descriptors each --------
test("16 concurrent workers × 3 two-descriptor batches → 96 records, seq exactly 0..95, every batch atomic (its 2 seqs adjacent), chain verifies", async () => {
  const { root, ledger } = mkRoot("effects-concurrency-");
  try {
    const N_WORKERS = 16, BATCHES_PER_WORKER = 3;
    // Each worker runs its 3 batches sequentially; the 16 workers race each other. Every batch
    // carries a unique step so we can prove no honest interleave split it.
    const worker = async (w) => {
      const codes = [];
      for (let b = 0; b < BATCHES_PER_WORKER; b++) codes.push((await declareBatch(root, `w${w}-b${b}`)).code);
      return codes;
    };
    const results = await Promise.all(Array.from({ length: N_WORKERS }, (_, w) => worker(w)));
    for (const codes of results) for (const c of codes) assert.equal(c, 0, "every concurrent declare exits 0");

    const recs = readRecords(ledger);
    const total = N_WORKERS * BATCHES_PER_WORKER * 2;
    assert.equal(recs.length, total, `all ${total} records present`);
    const bySeq = recs.slice().sort((a, b) => a.seq - b.seq);
    assert.deepEqual(bySeq.map((r) => r.seq), Array.from({ length: total }, (_, i) => i), "seq is exactly 0..N-1 — unique + gap-free under contention");

    // Atomicity oracle: with one-lock-per-batch each batch owns a contiguous 2-seq block, so
    // the seq-sorted stream partitions into 2-blocks that each share ONE step — no honest
    // writer interleaved between a batch's two records.
    for (let i = 0; i < total; i += 2) {
      assert.equal(bySeq[i].step, bySeq[i + 1].step, `batch at seq ${i} is contiguous (both records share a step)`);
    }
    // And every declared step contributed exactly its 2 records.
    const byStep = new Map();
    for (const r of recs) byStep.set(r.step, (byStep.get(r.step) || 0) + 1);
    assert.equal(byStep.size, N_WORKERS * BATCHES_PER_WORKER, "every batch's step is present");
    for (const [step, n] of byStep) assert.equal(n, 2, `step ${step} contributed exactly 2 records`);

    // The advisory lock is released, and the whole concurrently-written chain verifies.
    assert.ok(!existsSync(ledger + ".lock"), "the advisory lock file is released after every batch");
    for (const r of recs) assert.equal(r.schema, 2, "every concurrently-appended record is schema 2");
    assertChainVerifies(ledger, "RUN-C");
    assert.equal(verifyEffectsChain(join(root, ".faff", "runs", "RUN-C"), {}).status, "verified", "verifyEffectsChain reports verified over the raced ledger");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
