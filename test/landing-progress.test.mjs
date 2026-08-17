// FAFF-846 — the `faff landing-progress` checkpoint CLI: read/record-fix-cycle/clear the
// per-issue `<run-dir>/<issue>/landing-progress.json` fix-cycle counter, so a persisted
// count of conflict/regression fix cycles survives a firing boundary (a beep-boop run
// ending and a later run resuming the same issue). Deterministic (pure JSON, no
// tracker/network/git); exercised end-to-end via the real CLI + the in-process --selftest.
// Mirrors test/review-progress.test.mjs and test/build-progress.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

function runDir() { return mkdtempSync(path.join(tmpdir(), "faff846-")); }

test("landing-progress --selftest passes (the pure fold table)", () => {
  const r = runCli(["landing-progress", "--selftest"]);
  assert.equal(r.code, 0, r.stderr);
});

test("read on a missing checkpoint exits 3 (no cycles yet — not an error)", () => {
  const rd = runDir();
  try {
    const r = runCli(["landing-progress", "read", rd, "FAFF-NONE"]);
    assert.equal(r.code, 3);
    assert.equal(r.stdout.trim(), "");
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("record-fix-cycle records fix_cycles=1, one history entry; file at <run-dir>/<issue>/landing-progress.json", () => {
  const rd = runDir();
  try {
    const w = runCli(["landing-progress", "record-fix-cycle", rd, "FAFF-1", "--kind", "conflict", "--head-sha", "abc", "--failing-checks", "ci/x,ci/y", "--tried", "rebase"]);
    assert.equal(w.code, 0, w.stderr);
    const rec = JSON.parse(w.stdout);
    assert.equal(rec.issue, "FAFF-1");
    assert.equal(rec.fix_cycles, 1);
    assert.equal(rec.history.length, 1);
    assert.equal(rec.history[0].cycle, 1);
    assert.equal(rec.history[0].kind, "conflict");
    assert.deepEqual(rec.history[0].failing_checks, ["ci/x", "ci/y"]);
    assert.deepEqual(rec.history[0].tried, ["rebase"]);
    assert.equal(rec.last_head_sha, "abc");
    assert.ok(existsSync(path.join(rd, "FAFF-1", "landing-progress.json")));
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("record-fix-cycle without --failing-checks/--tried defaults them to []", () => {
  const rd = runDir();
  try {
    const w = runCli(["landing-progress", "record-fix-cycle", rd, "FAFF-1", "--kind", "regression", "--head-sha", "abc"]);
    const rec = JSON.parse(w.stdout);
    assert.deepEqual(rec.history[0].failing_checks, []);
    assert.deepEqual(rec.history[0].tried, []);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("three record-fix-cycle calls reach fix_cycles 1, 2, 3; last_head_sha tracks the most recent head; a fourth is rejected at exit 2 without modifying the file (integration smoke §8)", () => {
  const rd = runDir();
  try {
    runCli(["landing-progress", "record-fix-cycle", rd, "FAFF-XX", "--kind", "conflict", "--head-sha", "abc"]);
    runCli(["landing-progress", "record-fix-cycle", rd, "FAFF-XX", "--kind", "regression", "--head-sha", "def"]);
    const w3 = runCli(["landing-progress", "record-fix-cycle", rd, "FAFF-XX", "--kind", "conflict", "--head-sha", "ghi"]);
    const rec3 = JSON.parse(w3.stdout);
    assert.equal(rec3.fix_cycles, 3);
    assert.equal(rec3.history.length, 3);
    assert.deepEqual(rec3.history.map((h) => h.cycle), [1, 2, 3]);
    assert.equal(rec3.last_head_sha, "ghi");

    const before = runCli(["landing-progress", "read", rd, "FAFF-XX"]).stdout;
    const w4 = runCli(["landing-progress", "record-fix-cycle", rd, "FAFF-XX", "--kind", "conflict", "--head-sha", "jkl"]);
    assert.equal(w4.code, 2);
    assert.match(w4.stderr, /already at 3/);
    const after = runCli(["landing-progress", "read", rd, "FAFF-XX"]).stdout;
    assert.equal(after, before, "a rejected 4th record must not modify the file (no silent clamp)");
    assert.equal(JSON.parse(after).fix_cycles, 3);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("record-fix-cycle with an unknown --kind is rejected (exit 2, names the legal set)", () => {
  const rd = runDir();
  try {
    const w = runCli(["landing-progress", "record-fix-cycle", rd, "FAFF-1", "--kind", "bogus", "--head-sha", "abc"]);
    assert.equal(w.code, 2);
    assert.match(w.stderr, /invalid --kind/);
    assert.match(w.stderr, /conflict \| regression/);
    assert.ok(!existsSync(path.join(rd, "FAFF-1", "landing-progress.json")), "no file written on a bad kind");
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("record-fix-cycle with a missing --head-sha is rejected (exit 2)", () => {
  const rd = runDir();
  try {
    const w = runCli(["landing-progress", "record-fix-cycle", rd, "FAFF-1", "--kind", "conflict"]);
    assert.equal(w.code, 2);
    assert.match(w.stderr, /requires --head-sha/);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("clear is idempotent: exits 0 whether or not the file exists, and the file is absent afterward", () => {
  const rd = runDir();
  try {
    // clear on an absent file
    const c1 = runCli(["landing-progress", "clear", rd, "FAFF-1"]);
    assert.equal(c1.code, 0);
    assert.ok(!existsSync(path.join(rd, "FAFF-1", "landing-progress.json")));

    runCli(["landing-progress", "record-fix-cycle", rd, "FAFF-1", "--kind", "conflict", "--head-sha", "abc"]);
    assert.ok(existsSync(path.join(rd, "FAFF-1", "landing-progress.json")));

    const c2 = runCli(["landing-progress", "clear", rd, "FAFF-1"]);
    assert.equal(c2.code, 0);
    assert.ok(!existsSync(path.join(rd, "FAFF-1", "landing-progress.json")));

    // clearing again (already absent) is still a clean no-op
    const c3 = runCli(["landing-progress", "clear", rd, "FAFF-1"]);
    assert.equal(c3.code, 0);

    const r = runCli(["landing-progress", "read", rd, "FAFF-1"]);
    assert.equal(r.code, 3);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("a malformed on-disk file reads as null (schema-tolerant): read exits 3, record-fix-cycle seeds a fresh record at cycle 1", () => {
  const rd = runDir();
  try {
    mkdirSync(path.join(rd, "FAFF-1"), { recursive: true });
    writeFileSync(path.join(rd, "FAFF-1", "landing-progress.json"), "{not json");

    const r = runCli(["landing-progress", "read", rd, "FAFF-1"]);
    assert.equal(r.code, 3);

    const w = runCli(["landing-progress", "record-fix-cycle", rd, "FAFF-1", "--kind", "conflict", "--head-sha", "abc"]);
    assert.equal(w.code, 0, w.stderr);
    const rec = JSON.parse(w.stdout);
    assert.equal(rec.fix_cycles, 1);
    assert.equal(rec.history.length, 1);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("bad usage (missing sub / run-dir / issue) exits 2", () => {
  assert.equal(runCli(["landing-progress"]).code, 2);
  assert.equal(runCli(["landing-progress", "read"]).code, 2);
  assert.equal(runCli(["landing-progress", "record-fix-cycle", "/tmp/x"]).code, 2);
});
