// FAFF-1405: the fingerprints and the progress file behind `faff gates run --budget-secs N --resume`,
// exercised directly on throwaway git repos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const P = require("../plugin/skills/faff/bin/lib/gates-progress.js");

function git(dir, ...args) {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "faff-gates-progress-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.invalid");
  git(dir, "config", "user.name", "t");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
}

const objectCount = (dir) => git(dir, "count-objects", "-v").match(/^count: (\d+)/m)[1];

test("the tree fingerprint sees edits, new files, deletions and modes, but not .faff/", () => {
  const dir = repo();
  const base = P.treeFingerprint(dir);
  assert.equal(P.treeFingerprint(dir), base);

  writeFileSync(join(dir, "a.txt"), "two\n");
  const edited = P.treeFingerprint(dir);
  assert.notEqual(edited, base);
  writeFileSync(join(dir, "a.txt"), "three\n");
  assert.notEqual(P.treeFingerprint(dir), edited, "a second edit to an already-modified file changes it");
  writeFileSync(join(dir, "a.txt"), "one\n");
  assert.equal(P.treeFingerprint(dir), base);

  writeFileSync(join(dir, "new.txt"), "x\n");
  const added = P.treeFingerprint(dir);
  assert.notEqual(added, base);
  chmodSync(join(dir, "new.txt"), 0o755);
  assert.notEqual(P.treeFingerprint(dir), added);

  mkdirSync(join(dir, ".faff", "other"), { recursive: true });
  writeFileSync(join(dir, ".faff", "other", "x.json"), "{}");
  const withFaff = P.treeFingerprint(dir);
  writeFileSync(join(dir, ".faff", "other", "x.json"), "{\"changed\":true}");
  assert.equal(P.treeFingerprint(dir), withFaff);
});

test("computing the tree fingerprint writes neither the index nor any object", () => {
  const dir = repo();
  writeFileSync(join(dir, "a.txt"), "changed\n");
  writeFileSync(join(dir, "untracked-secret.txt"), "do-not-store-me\n");
  const id = git(dir, "hash-object", "--no-filters", "untracked-secret.txt").trim();
  const indexBefore = readFileSync(join(dir, ".git", "index"));
  const before = objectCount(dir);
  P.treeFingerprint(dir);
  assert.deepEqual(readFileSync(join(dir, ".git", "index")), indexBefore);
  assert.equal(objectCount(dir), before);
  assert.notEqual(spawnSync("git", ["cat-file", "-e", id], { cwd: dir }).status, 0, "the untracked file's blob is not in the object store");
});

test("the plan fingerprint ignores the budget but sees rungs, units and other config", () => {
  const rung = { kind: "UNIT", name: "u", command: "node --test", required: true };
  const plans = [{ rung, mode: "pool", units: [{ id: "file:t/a.test.mjs", content: "abc" }] }];
  const cfg = { rung_timeout_ms: 1, run_budget_secs: 420, run_budget_secs_raw: null };
  const base = P.planFingerprint(plans, cfg);
  assert.equal(P.planFingerprint(plans, { ...cfg, run_budget_secs: 60, run_budget_secs_raw: 60 }), base);
  assert.notEqual(P.planFingerprint(plans, { ...cfg, rung_timeout_ms: 2 }), base);
  assert.notEqual(P.planFingerprint([{ ...plans[0], units: [{ id: "file:t/a.test.mjs", content: "abd" }] }], cfg), base);
  assert.notEqual(P.planFingerprint([{ ...plans[0], rung: { ...rung, command: "node --test x" } }], cfg), base);
});

test("progress round-trips, judges tree, plan and age, and is written 0600 by rename", () => {
  const dir = repo();
  const progress = {
    schema: P.PROGRESS_SCHEMA, tree: "t1", plan: "p1", written_at: new Date().toISOString(), calls: 1,
    done: [
      { rung_index: 0, unit: "whole", status: "pass", duration_ms: 5, detail: "pass output is not kept" },
      { rung_index: 1, unit: "file:t/a.test.mjs", status: "fail", duration_ms: 7, detail: "token=abcdefghijk failed" },
    ],
    rung_ms: { 0: 5 },
  };
  P.writeProgress(dir, progress, []);
  assert.equal(statSync(P.progressPath(dir)).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(dir, ".faff", "gates", ".gitignore"), "utf8"), "*\n");
  const read = P.readProgress(dir);
  assert.equal(read.kind, "ok");
  assert.equal(read.progress.done[0].detail, "");
  assert.match(read.progress.done[1].detail, /\[redacted\] failed/);
  const now = Date.now();
  assert.deepEqual(P.judgeProgress(read, "t1", "p1", now).discarded, null);
  assert.equal(P.judgeProgress(read, "t2", "p1", now).discarded, "tree-changed");
  assert.equal(P.judgeProgress(read, "t1", "p2", now).discarded, "plan-changed");
  assert.equal(P.judgeProgress(read, "t1", "p1", now + P.STALE_AFTER_MS + 1000).discarded, "stale");
  assert.equal(P.judgeProgress({ kind: "unreadable" }, "t1", "p1", now).discarded, "unreadable");
  assert.equal(P.judgeProgress({ kind: "absent" }, "t1", "p1", now).discarded, null);

  writeFileSync(P.progressPath(dir), JSON.stringify({ ...progress, calls: 0 }));
  assert.equal(P.readProgress(dir).kind, "unreadable");
  assert.equal(P.clearProgress(dir), true);
  assert.equal(existsSync(P.progressPath(dir)), false);
});

test("a detail that starts part-way through its output drops the leading fragment before redaction", () => {
  const cut = "lue-123 " + "x".repeat(600);
  assert.equal(P.redactDetail(cut, []).startsWith("lue-123"), false);
  assert.equal(P.redactDetail("short lue-123", []), "short lue-123");
  assert.equal(P.redactDetail("key configured-secret-value", ["configured-secret-value"]), "key [REDACTED]");
});

test("the grace is the smaller of 60 seconds and the budget", () => {
  assert.equal(P.graceSecs(2), 2);
  assert.equal(P.graceSecs(420), 60);
});
