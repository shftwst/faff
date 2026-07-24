// FAFF-591 — pure precedence unit tests for `resolveRunDir(root, run, rootExplicit)`
// (bin/lib/shared-infra.js), the worktree-aware `.faff/runs/<run>` resolver shared by
// `effects.js` (declare/observe/check) and `events.js` (append). Mirrors findConfig's
// worktree→main-checkout fallback shape (FAFF-208), applied to run dirs instead of
// config files. mainWorktreeRoot does the only git probing — reused, not re-implemented.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { resolveRunDir } from "../plugin/skills/faff/bin/lib/shared-infra.js";

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

// A temp parent holding a main checkout (repo/) + a linked worktree (wt/). Returns
// { parent, root, wt }. `runInMain` seeds `.faff/runs/<run>` in the main checkout only.
function setup(run, { runInMain = false } = {}) {
  const parent = mkdtempSync(path.join(tmpdir(), "faff591-"));
  const root = path.join(parent, "repo");
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@t.test");
  git(root, "config", "user.name", "t");
  git(root, "commit", "-q", "--allow-empty", "-m", "init");
  if (runInMain) mkdirSync(path.join(root, ".faff", "runs", run), { recursive: true });
  const wt = path.join(parent, "wt");
  git(root, "worktree", "add", "-q", "--detach", wt);
  return { parent, root, wt };
}

test("returns the cwd-root dir when .faff/runs/<run> exists there (byte-for-byte today's behaviour)", () => {
  const { parent, root } = setup("run-1", { runInMain: true });
  try {
    const got = resolveRunDir(root, "run-1", false);
    assert.equal(got, path.join(root, ".faff", "runs", "run-1"));
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("falls back to the main checkout's run dir when the worktree root lacks it (rootExplicit=false)", () => {
  const { parent, root, wt } = setup("run-2", { runInMain: true });
  try {
    const got = resolveRunDir(wt, "run-2", false);
    assert.equal(got, path.join(root, ".faff", "runs", "run-2"), "resolves to the MAIN checkout's run dir, not the worktree's");
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("rootExplicit=true never consults mainWorktreeRoot — no fallback even when the main checkout has the run", () => {
  const { parent, wt } = setup("run-3", { runInMain: true });
  try {
    const got = resolveRunDir(wt, "run-3", true);
    assert.equal(got, path.join(wt, ".faff", "runs", "run-3"), "explicit --root is a strict escape hatch — no git probe, no fallback");
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("genuinely missing everywhere: returns the cwd-root path (the canonical exit-3 path), no throw", () => {
  const { parent, wt } = setup("run-4", { runInMain: false });
  try {
    const got = resolveRunDir(wt, "run-4", false);
    assert.equal(got, path.join(wt, ".faff", "runs", "run-4"));
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("mainWorktreeRoot -> null (non-git root) degrades to the cwd-root path, no throw", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "faff591-nongit-"));
  try {
    const got = resolveRunDir(dir, "run-5", false);
    assert.equal(got, path.join(dir, ".faff", "runs", "run-5"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("root === mainWorktreeRoot(root) (already the main checkout): no self-fallback, cwd-root path returned", () => {
  const { parent, root } = setup("run-6", { runInMain: false });
  try {
    const got = resolveRunDir(root, "run-6", false);
    assert.equal(got, path.join(root, ".faff", "runs", "run-6"));
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
