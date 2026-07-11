// FAFF-355 — the repo's first real concurrency test. Under the parallel executor, N
// build subagents can tick `faff heartbeat` at the same instant an orchestrator writes
// a terminal outcome to the run ledger. Before this change, both were full-ledger
// read-modify-writes and could interleave, silently clobbering a write. The structural
// fix moves the heartbeat's ONLY write off the ledger onto a dedicated single-value
// file, so there is nothing left for a concurrent tick to clobber — this test proves
// it by spawning real child processes racing a scripted outcome write.
//
// Kept small and deterministic-by-assertion, per the spec's residual watch item:
// modest N, bounded wall-clock, asserting only order-independent invariants (every
// outcome present, every tick exits 0, the heartbeat file parses) — never scheduling
// or cross-process timestamp ordering.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function runHeartbeat(runDir) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, "heartbeat", runDir, "--json"]);
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.on("close", (code) => resolve({ code, out }));
    child.on("error", () => resolve({ code: 1, out: "" }));
  });
}

// Plays the orchestrator's outcome-writer role directly — FAFF-355 deliberately
// leaves no CLI primitive for this (spec §2 OUT OF SCOPE: "A CLI primitive for
// orchestrator outcome writes"). Mimics atomicWriteLedger's own tmp+rename idiom.
function writeOutcome(runDir, issue, outcome) {
  const target = join(runDir, "run-ledger.json");
  const ledger = JSON.parse(readFileSync(target, "utf8"));
  ledger.outcomes[issue] = outcome;
  const tmp = target + ".tmp";
  writeFileSync(tmp, JSON.stringify(ledger, null, 2) + "\n");
  renameSync(tmp, target);
}

const isoAgo = (secs) => new Date(Date.now() - secs * 1000).toISOString();

test("Scenario 1: N concurrent `faff heartbeat` ticks race scripted outcome writes — no lost update, every tick exits 0, the heartbeat file parses", async () => {
  const root = mkdtempSync(join(tmpdir(), "heartbeat-concurrency-"));
  const runDir = join(root, ".faff", "runs", "RUN-LIVE");
  mkdirSync(runDir, { recursive: true });
  const issues = ["A", "B", "C", "D", "E"];
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({
    run_id: "RUN-LIVE", admitted: issues, outcomes: {},
    owner: { status: "running", last_heartbeat: isoAgo(10) },
  }, null, 2) + "\n");

  try {
    const N_TICKS = 8;
    const tickPromises = Array.from({ length: N_TICKS }, () => runHeartbeat(runDir));
    // Interleave the "orchestrator's" outcome writes with the in-flight ticks — a
    // small stagger (never a sleep loop) is enough to overlap the two write paths
    // without making the test's runtime or outcome depend on real scheduling.
    const writePromises = issues.map((issue, i) => new Promise((resolve) => {
      setTimeout(() => { writeOutcome(runDir, issue, "shipped"); resolve(); }, i * 5);
    }));

    const [ticks] = await Promise.all([Promise.all(tickPromises), Promise.all(writePromises)]);

    for (const t of ticks) assert.equal(t.code, 0, "every concurrent heartbeat tick exits 0");
    for (const t of ticks) {
      const j = JSON.parse(t.out);
      assert.equal(j.written, true);
      assert.ok(Number.isFinite(Date.parse(j.last_heartbeat)), "each tick reports a parseable ISO timestamp");
    }

    // No lost update: every scripted outcome survived the race, whatever the interleaving.
    const final = JSON.parse(readFileSync(join(runDir, "run-ledger.json"), "utf8"));
    for (const issue of issues) assert.equal(final.outcomes[issue], "shipped", `outcome for ${issue} was not clobbered`);
    assert.equal(Object.keys(final.outcomes).length, issues.length, "no stray/duplicate outcome keys");

    // The heartbeat file exists and parses — order-independent: ANY interleaving
    // yields SOME recent timestamp, per the spec's edge-case table (never asserting
    // WHICH tick "won").
    const hb = readFileSync(join(runDir, "heartbeat"), "utf8").trim();
    assert.ok(Number.isFinite(Date.parse(hb)), "heartbeat file content parses as an ISO timestamp");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a tick never writes run-ledger.json under concurrency — the structural race-closer", async () => {
  const root = mkdtempSync(join(tmpdir(), "heartbeat-concurrency-nowrite-"));
  const runDir = join(root, ".faff", "runs", "RUN-LIVE");
  mkdirSync(runDir, { recursive: true });
  const before = JSON.stringify({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: {},
    owner: { status: "running", last_heartbeat: isoAgo(10) },
  }, null, 2) + "\n";
  writeFileSync(join(runDir, "run-ledger.json"), before);
  try {
    const results = await Promise.all(Array.from({ length: 6 }, () => runHeartbeat(runDir)));
    for (const r of results) assert.equal(r.code, 0);
    const after = readFileSync(join(runDir, "run-ledger.json"), "utf8");
    assert.equal(after, before, "run-ledger.json is byte-identical after N concurrent ticks — nothing to clobber");
    assert.ok(existsSync(join(runDir, "heartbeat")), "the heartbeat file was created instead");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
