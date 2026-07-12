// FAFF-403 — the retry-later/awaiting-review disposition's INTEGRATION SMOKE TEST (spec §8).
// The disposition procedure itself is agent-executed graft prose (faff-graft/SKILL.md Step 9),
// not a callable function — but every mechanical step it prescribes (mkdir/cp the resume store,
// increment the outage-retry counter, carry the counter forward, compare against the retry-limit
// config knob) is deterministic and reproducible with plain fs + the real CLI, no tracker/LLM
// involved. This test drives exactly that sequence end-to-end, mirroring the spec's own smoke test:
//
//   1. Seed a run dir with a build-complete checkpoint + a review-progress phase1-pass/phase2-in_flight record.
//   2. Simulate the unavailable disposition: no review-verdict.json is ever written; the counter
//      increments; both checkpoints are stashed to a run-agnostic resume store.
//   3. Seed a FRESH run dir (a later, different drain) and carry the stash forward — proving the
//      resume store survives a run boundary, byte-for-byte.
//   4. Increment again from the new location → the counter reads 2, not reset to 1 (the cross-drain
//      loop-safety pin the spec calls a required build gate) — then compare against a lowered
//      retry-limit config knob to confirm the disposition's own arithmetic (retries >= limit) escalates.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runCli } from "./helpers/run-cli.mjs";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function tmpRunDir(prefix) { return mkdtempSync(path.join(tmpdir(), prefix)); }

function configGet(cwd, key) {
  try {
    return execFileSync("node", [CLI, "config", "get", key], { cwd, encoding: "utf8" }).trim();
  } catch (e) { return (e.stdout ?? "").toString().trim(); }
}

test("FAFF-403 integration smoke: hold → cross-drain resume-store carry-forward → escalation arithmetic", () => {
  const runA = tmpRunDir("faff403-runA-");
  const runB = tmpRunDir("faff403-runB-");
  const resumeStore = mkdtempSync(path.join(tmpdir(), "faff403-resume-"));
  const ISSUE = "FAFF-403";
  try {
    // --- 1. Seed run A: a build-complete checkpoint + a phase1-pass/phase2-in_flight review record ---
    runCli(["build-progress", "write", runA, ISSUE, "--build-complete", "--diff-hash", "H1", "--branch", "b1"]);
    runCli(["review-progress", "write", runA, ISSUE, "--phase1-pass", "--diff-hash", "H1"]);
    runCli(["review-progress", "write", runA, ISSUE, "--phase2", "in_flight"]);
    assert.ok(existsSync(path.join(runA, ISSUE, "build-progress.json")));
    assert.ok(existsSync(path.join(runA, ISSUE, "review-progress.json")));

    // --- 2. Simulate the unavailable disposition (retry-later arm) ---
    // No review-verdict.json is EVER written by this arm — assert its absence throughout.
    assert.ok(!existsSync(path.join(runA, ISSUE, "review-verdict.json")), "retry-later never writes a terminal verdict");
    const inc1 = runCli(["review-progress", "write", runA, ISSUE, "--outage-retry"]);
    assert.equal(inc1.code, 0, inc1.stderr);
    assert.equal(JSON.parse(inc1.stdout).outage_retries, 1);
    // Stash both checkpoints to the run-agnostic resume store.
    mkdirSync(path.join(resumeStore, ISSUE), { recursive: true });
    copyFileSync(path.join(runA, ISSUE, "build-progress.json"), path.join(resumeStore, ISSUE, "build-progress.json"));
    copyFileSync(path.join(runA, ISSUE, "review-progress.json"), path.join(resumeStore, ISSUE, "review-progress.json"));
    assert.ok(existsSync(path.join(resumeStore, ISSUE, "build-progress.json")));
    assert.ok(existsSync(path.join(resumeStore, ISSUE, "review-progress.json")));
    assert.ok(!existsSync(path.join(runA, ISSUE, "review-verdict.json")), "still no terminal verdict after the hold");

    // --- 3. A LATER, DIFFERENT drain: seed a fresh run dir, carry the stash forward ---
    mkdirSync(path.join(runB, ISSUE), { recursive: true });
    copyFileSync(path.join(resumeStore, ISSUE, "build-progress.json"), path.join(runB, ISSUE, "build-progress.json"));
    copyFileSync(path.join(resumeStore, ISSUE, "review-progress.json"), path.join(runB, ISSUE, "review-progress.json"));
    const carried = runCli(["review-progress", "read", runB, ISSUE]);
    assert.equal(carried.code, 0);
    const carriedRec = JSON.parse(carried.stdout);
    assert.equal(carriedRec.outage_retries, 1, "the carried counter survives the run boundary");
    assert.equal(carriedRec.phase1.diff_hash, "H1");
    assert.equal(carriedRec.phase2.status, "in_flight");
    const carriedBuild = runCli(["build-progress", "read", runB, ISSUE]);
    assert.equal(carriedBuild.code, 0);
    assert.equal(JSON.parse(carriedBuild.stdout).build.diff_hash, "H1", "the build checkpoint carries forward too");

    // --- 4. Increment again from the NEW location → 2, never reset to 1 (the loop-safety pin) ---
    const inc2 = runCli(["review-progress", "write", runB, ISSUE, "--outage-retry"]);
    assert.equal(JSON.parse(inc2.stdout).outage_retries, 2, "cross-drain carry-forward: counter counts up, never resets");

    // --- Escalation arithmetic: with the default limit (3), 2 held attempts still proceed retry-later ---
    const defaultLimit = Number(configGet(runB, "graft.review_outage_retry_limit"));
    assert.equal(defaultLimit, 3);
    assert.ok(2 < defaultLimit, "2 held attempts is still under the default limit — retry-later, not escalate");

    // Lower the knob via a real .faffrc.yaml and confirm the disposition's own comparison escalates.
    writeFileSync(path.join(runB, ".faffrc.yaml"), "graft:\n  review_outage_retry_limit: \"2\"\n");
    const loweredLimit = Number(configGet(runB, "graft.review_outage_retry_limit"));
    assert.equal(loweredLimit, 2);
    assert.ok(2 >= loweredLimit, "retries (2) >= the lowered limit (2) — the arm now escalates to needs-human");
  } finally {
    rmSync(runA, { recursive: true, force: true });
    rmSync(runB, { recursive: true, force: true });
    rmSync(resumeStore, { recursive: true, force: true });
  }
});

test("FAFF-403: a fresh (never-held) issue is unaffected — no outage_retries field at all", () => {
  const rd = tmpRunDir("faff403-fresh-");
  try {
    runCli(["review-progress", "write", rd, "FAFF-1", "--phase1-pass", "--diff-hash", "h"]);
    const rec = JSON.parse(runCli(["review-progress", "read", rd, "FAFF-1"]).stdout);
    assert.equal(rec.outage_retries, undefined, "an issue that never held carries no outage_retries key");
  } finally { rmSync(rd, { recursive: true, force: true }); }
});
