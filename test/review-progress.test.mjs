// FAFF-329 — the `faff review-progress` checkpoint CLI: read/write the per-issue
// `<run-dir>/<issue>/review-progress.json` so a re-dispatched build subagent RESUMES the
// graft review step instead of repeating the slow Phase-2. Deterministic (pure JSON, no
// tracker/network); exercised end-to-end via the real CLI + the in-process --selftest.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

function runDir() { return mkdtempSync(path.join(tmpdir(), "faff329-")); }

test("review-progress --selftest passes (the pure fold table)", () => {
  const r = runCli(["review-progress", "--selftest"]);
  assert.equal(r.code, 0, r.stderr);
});

test("write --phase1-pass records done/pass + diff_hash and seeds phase2 pending", () => {
  const rd = runDir();
  try {
    const w = runCli(["review-progress", "write", rd, "FAFF-329", "--phase1-pass", "--diff-hash", "abc123"]);
    assert.equal(w.code, 0, w.stderr);
    const rec = JSON.parse(w.stdout);
    assert.equal(rec.phase1.status, "done");
    assert.equal(rec.phase1.verdict, "pass");
    assert.equal(rec.phase1.diff_hash, "abc123");
    assert.equal(rec.phase2.status, "pending");
    // the file lives at <run-dir>/<issue>/review-progress.json
    assert.ok(existsSync(path.join(rd, "FAFF-329", "review-progress.json")));
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("write --phase2 transitions preserve phase1 + its diff_hash; read round-trips (integration smoke §8)", () => {
  const rd = runDir();
  try {
    runCli(["review-progress", "write", rd, "FAFF-TEST", "--phase1-pass", "--diff-hash", "abc123"]);
    runCli(["review-progress", "write", rd, "FAFF-TEST", "--phase2", "in_flight"]);
    const r = runCli(["review-progress", "read", rd, "FAFF-TEST"]);
    assert.equal(r.code, 0);
    const rec = JSON.parse(r.stdout);
    assert.equal(rec.phase1.verdict, "pass");
    assert.equal(rec.phase1.diff_hash, "abc123");
    assert.equal(rec.phase2.status, "in_flight");
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("write --phase2 complete sets findings_ref + attempts", () => {
  const rd = runDir();
  try {
    runCli(["review-progress", "write", rd, "FAFF-1", "--phase1-pass", "--diff-hash", "h"]);
    const w = runCli(["review-progress", "write", rd, "FAFF-1", "--phase2", "complete", "--findings", "/f/x.md", "--attempts", "3"]);
    const rec = JSON.parse(w.stdout);
    assert.equal(rec.phase2.status, "complete");
    assert.equal(rec.phase2.findings_ref, "/f/x.md");
    assert.equal(rec.phase2.attempts, 3);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("read on a missing checkpoint exits 3 (no checkpoint yet — not an error)", () => {
  const rd = runDir();
  try {
    const r = runCli(["review-progress", "read", rd, "FAFF-NONE"]);
    assert.equal(r.code, 3);
    assert.equal(r.stdout.trim(), "");
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("write --phase2 with an unknown status fails loud (exit 2, names the legal set)", () => {
  const rd = runDir();
  try {
    const w = runCli(["review-progress", "write", rd, "FAFF-1", "--phase2", "bogus"]);
    assert.equal(w.code, 2);
    assert.match(w.stderr, /invalid phase2 status/);
    assert.match(w.stderr, /pending \| in_flight \| complete \| skipped_deadline \| skipped_unreachable/);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("skipped_deadline and skipped_unreachable are valid phase2 statuses (the deadline/skip records)", () => {
  const rd = runDir();
  try {
    runCli(["review-progress", "write", rd, "FAFF-1", "--phase1-pass", "--diff-hash", "h"]);
    for (const s of ["skipped_deadline", "skipped_unreachable"]) {
      const w = runCli(["review-progress", "write", rd, "FAFF-1", "--phase2", s]);
      assert.equal(w.code, 0, `${s} should be accepted`);
      assert.equal(JSON.parse(w.stdout).phase2.status, s);
    }
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("bad usage (missing sub / run-dir / issue) exits 2", () => {
  assert.equal(runCli(["review-progress"]).code, 2);
  assert.equal(runCli(["review-progress", "read"]).code, 2);
  assert.equal(runCli(["review-progress", "write", "/tmp/x"]).code, 2);
});
