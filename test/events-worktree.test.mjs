// FAFF-591 — `faff events append` from a linked build worktree resolves the run dir
// against the MAIN checkout, not cwd (the sibling defect to `effects declare/observe/
// check`, same root cause, same fix — bin/lib/shared-infra.js's resolveRunDir).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

function setup(run) {
  const parent = mkdtempSync(path.join(tmpdir(), "faff591-evt-"));
  const root = path.join(parent, "repo");
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@t.test");
  git(root, "config", "user.name", "t");
  git(root, "commit", "-q", "--allow-empty", "-m", "init");
  mkdirSync(path.join(root, ".faff", "runs", run), { recursive: true });
  const wt = path.join(parent, "wt");
  git(root, "worktree", "add", "-q", "--detach", wt);
  return { parent, root, wt };
}

const NOTE = JSON.stringify({ phase: "run", type: "run-resume", data: { msg: "hi" } });

test("events append from a worktree lands in the MAIN checkout's events.jsonl (FAFF-591 AC4)", () => {
  const { parent, root, wt } = setup("run-F");
  try {
    const r = runCli(["events", "append", "--run", "run-F", "--ts", "t"], { cwd: wt, input: NOTE });
    assert.equal(r.code, 0, r.stderr);
    const eventsInMain = path.join(root, ".faff", "runs", "run-F", "events.jsonl");
    assert.ok(existsSync(eventsInMain), "events.jsonl written under the MAIN checkout's run dir");
    const rec = JSON.parse(readFileSync(eventsInMain, "utf8").trim().split("\n")[0]);
    assert.equal(rec.run_id, "run-F");
    assert.equal(rec.type, "run-resume");
    assert.equal(existsSync(path.join(wt, ".faff", "runs", "run-F")), false, "no run dir materialised in the worktree");
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("events append with explicit --root from a worktree is strict: exits 3, no main-checkout fallback", () => {
  const { parent, wt } = setup("run-G");
  try {
    const r = runCli(["events", "append", "--run", "run-G", "--root", wt], { cwd: wt, input: NOTE });
    assert.equal(r.code, 3);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("events append: genuinely missing run everywhere still exits 3 naming .faff/runs/<run>", () => {
  const { parent, wt } = setup("run-H-initialised");
  try {
    const r = runCli(["events", "append", "--run", "run-H-missing"], { cwd: wt, input: NOTE });
    assert.equal(r.code, 3);
    assert.match(r.stderr, /run dir missing/);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("events append from the main checkout itself is unchanged (no regression)", () => {
  const { parent, root } = setup("run-I");
  try {
    const r = runCli(["events", "append", "--run", "run-I", "--ts", "t"], { cwd: root, input: NOTE });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(path.join(root, ".faff", "runs", "run-I", "events.jsonl")));
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
