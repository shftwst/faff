// FAFF-402 — the `faff build-progress` checkpoint CLI: read/write the per-issue
// `<run-dir>/<issue>/build-progress.json` so a re-dispatched graft RESUMES at review
// (recreating the worktree from origin/<branch>, skipping the build) instead of rebuilding.
// Deterministic (pure JSON, no tracker/network/git); exercised end-to-end via the real CLI
// + the in-process --selftest. Mirrors test/review-progress.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

function runDir() { return mkdtempSync(path.join(tmpdir(), "faff402-")); }

test("build-progress --selftest passes (the pure fold table)", () => {
  const r = runCli(["build-progress", "--selftest"]);
  assert.equal(r.code, 0, r.stderr);
});

test("write --build-complete records status/diff_hash/branch/pushed_at; file at <run-dir>/<issue>/build-progress.json", () => {
  const rd = runDir();
  try {
    const w = runCli(["build-progress", "write", rd, "FAFF-402", "--build-complete", "--diff-hash", "abc123", "--branch", "faff-402-x"]);
    assert.equal(w.code, 0, w.stderr);
    const rec = JSON.parse(w.stdout);
    assert.equal(rec.issue, "FAFF-402");
    assert.equal(rec.build.status, "complete");
    assert.equal(rec.build.diff_hash, "abc123");
    assert.equal(rec.build.branch, "faff-402-x");
    assert.ok(rec.build.pushed_at, "pushed_at is stamped");
    assert.ok(existsSync(path.join(rd, "FAFF-402", "build-progress.json")));
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("read round-trips a written checkpoint (integration smoke)", () => {
  const rd = runDir();
  try {
    runCli(["build-progress", "write", rd, "FAFF-TEST", "--build-complete", "--diff-hash", "deadbeef", "--branch", "b1"]);
    const r = runCli(["build-progress", "read", rd, "FAFF-TEST"]);
    assert.equal(r.code, 0);
    const rec = JSON.parse(r.stdout);
    assert.equal(rec.build.diff_hash, "deadbeef");
    assert.equal(rec.build.branch, "b1");
    assert.equal(rec.build.status, "complete");
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("read on a missing checkpoint exits 3 (no checkpoint yet — not an error)", () => {
  const rd = runDir();
  try {
    const r = runCli(["build-progress", "read", rd, "FAFF-NONE"]);
    assert.equal(r.code, 3);
    assert.equal(r.stdout.trim(), "");
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("write --build-complete without --diff-hash is rejected (exit 2 — the diff-identity guard needs it)", () => {
  const rd = runDir();
  try {
    const w = runCli(["build-progress", "write", rd, "FAFF-1", "--build-complete", "--branch", "b"]);
    assert.equal(w.code, 2);
    assert.match(w.stderr, /requires --diff-hash/);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("write --build-complete without --branch is rejected (exit 2 — a pruned-worktree resume checks it out)", () => {
  const rd = runDir();
  try {
    const w = runCli(["build-progress", "write", rd, "FAFF-1", "--build-complete", "--diff-hash", "h"]);
    assert.equal(w.code, 2);
    assert.match(w.stderr, /requires --branch/);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("write without --build-complete is rejected (exit 2)", () => {
  const rd = runDir();
  try {
    const w = runCli(["build-progress", "write", rd, "FAFF-1", "--diff-hash", "h", "--branch", "b"]);
    assert.equal(w.code, 2);
    assert.match(w.stderr, /expected --build-complete/);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("bad usage (missing sub / run-dir / issue) exits 2", () => {
  assert.equal(runCli(["build-progress"]).code, 2);
  assert.equal(runCli(["build-progress", "read"]).code, 2);
  assert.equal(runCli(["build-progress", "write", "/tmp/x"]).code, 2);
});

test("a re-write with a new diff_hash replaces the record (a moved branch = a fresh build-complete)", () => {
  const rd = runDir();
  try {
    runCli(["build-progress", "write", rd, "FAFF-1", "--build-complete", "--diff-hash", "A", "--branch", "b"]);
    const w = runCli(["build-progress", "write", rd, "FAFF-1", "--build-complete", "--diff-hash", "B", "--branch", "b"]);
    const rec = JSON.parse(w.stdout);
    assert.equal(rec.build.diff_hash, "B", "the new diff_hash replaces the old");
  } finally { rmSync(rd, { recursive: true, force: true }); }
});
