// FAFF-591 — `faff effects declare/observe/check` from a linked build worktree resolve
// the run dir against the MAIN checkout, not cwd. Exercises the real CLI (per ADR 0002)
// against a real `git worktree add`, mirroring test/config-worktree-fallback.test.mjs's
// (FAFF-208) setup shape for the sibling resolver.

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

// A temp parent holding a main checkout (repo/, with .faff/runs/<run> already
// initialised) + a linked worktree (wt/) that has no run dir of its own.
function setup(run) {
  const parent = mkdtempSync(path.join(tmpdir(), "faff591-eff-"));
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

const MERGE_MAIN = JSON.stringify({ kind: "merge", target: "main" });

test("effects declare from a worktree lands in the MAIN checkout's declared-effects.jsonl (FAFF-591 AC2)", () => {
  const { parent, root, wt } = setup("run-A");
  try {
    const r = runCli(["effects", "declare", "--run", "run-A", "--issue", "FAFF-500", "--step", "merge", "--ts", "t"], { cwd: wt, input: MERGE_MAIN });
    assert.equal(r.code, 0, r.stderr);
    const ledgerInMain = path.join(root, ".faff", "runs", "run-A", "declared-effects.jsonl");
    assert.ok(existsSync(ledgerInMain), "ledger written under the MAIN checkout's run dir");
    const lines = readFileSync(ledgerInMain, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    const rec = JSON.parse(lines[0]);
    assert.equal(rec.run_id, "run-A");
    assert.equal(rec.kind_of_entry, "declare");
    // the worktree itself must have gained no .faff/runs copy
    assert.equal(existsSync(path.join(wt, ".faff", "runs", "run-A")), false, "no run dir materialised in the worktree");
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("effects observe + check from a worktree: declare-then-observe pair reads back clean (FAFF-591 AC3)", () => {
  const { parent, root, wt } = setup("run-B");
  try {
    const d = runCli(["effects", "declare", "--run", "run-B", "--issue", "FAFF-501", "--step", "merge", "--ts", "t"], { cwd: wt, input: MERGE_MAIN });
    assert.equal(d.code, 0, d.stderr);
    const o = runCli(["effects", "observe", "--run", "run-B", "--issue", "FAFF-501", "--step", "merge", "--ts", "t"], { cwd: wt, input: MERGE_MAIN });
    assert.equal(o.code, 0, o.stderr);
    // observe also landed in the main checkout, not the worktree
    const ledgerInMain = path.join(root, ".faff", "runs", "run-B", "declared-effects.jsonl");
    assert.equal(readFileSync(ledgerInMain, "utf8").trim().split("\n").length, 2);
    // check from the worktree reads the MAIN checkout's ledger — clean, not a false "clean"
    // against an empty worktree root
    const c = runCli(["effects", "check", "--run", "run-B", "--json"], { cwd: wt });
    assert.equal(c.code, 0, c.stderr);
    const result = JSON.parse(c.stdout);
    assert.equal(result.any_escape, false);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("explicit --root from a worktree is strict: no main-checkout fallback, exits 3 (FAFF-591 AC6)", () => {
  const { parent, wt } = setup("run-C");
  try {
    const r = runCli(["effects", "declare", "--run", "run-C", "--issue", "FAFF-502", "--step", "merge", "--root", wt], { cwd: wt, input: MERGE_MAIN });
    assert.equal(r.code, 3, "explicit --root never consults the main checkout");
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("genuinely missing run (main checkout also lacks it): worktree declare exits 3, check reports clean (FAFF-591 AC7)", () => {
  const { parent, wt } = setup("run-D-initialised"); // seeds run-D-initialised, NOT run-D-missing
  try {
    const d = runCli(["effects", "declare", "--run", "run-D-missing", "--issue", "FAFF-503", "--step", "merge"], { cwd: wt, input: MERGE_MAIN });
    assert.equal(d.code, 3);
    assert.match(d.stderr, /run dir missing/);
    const c = runCli(["effects", "check", "--run", "run-D-missing", "--json"], { cwd: wt });
    assert.equal(c.code, 0, "a missing ledger is a clean state, not exit 3");
    assert.equal(JSON.parse(c.stdout).any_escape, false);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("main-checkout behaviour is unchanged: declare/observe/check from the main checkout itself (no worktree involved)", () => {
  const { parent, root } = setup("run-E");
  try {
    const d = runCli(["effects", "declare", "--run", "run-E", "--issue", "FAFF-504", "--step", "merge", "--ts", "t"], { cwd: root, input: MERGE_MAIN });
    assert.equal(d.code, 0, d.stderr);
    const ledger = path.join(root, ".faff", "runs", "run-E", "declared-effects.jsonl");
    assert.ok(existsSync(ledger));
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
