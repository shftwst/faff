// FAFF-208 — config resolution falls back to the MAIN worktree's .faffrc.yaml when a
// linked worktree lacks the (gitignored, per-checkout) copy. A build worktree created
// outside the WorktreeCreate hook (e.g. a raw `git worktree add`) otherwise has no config,
// so `faff config get` silently resolves to defaults — the gate-degradation that misfired
// FAFF-198's adversarial review to the localhost default. Exercised through the real CLI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

// A temp parent holding a main checkout (repo/) + a linked worktree (wt/) whose checkout
// does NOT contain the uncommitted .faffrc.yaml. Returns { parent, root, wt }.
function setup(faffrcBody) {
  const parent = mkdtempSync(path.join(tmpdir(), "faff208-"));
  const root = path.join(parent, "repo");
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@t.test");
  git(root, "config", "user.name", "t");
  writeFileSync(path.join(root, "README.md"), "x\n");
  git(root, "add", "README.md");
  git(root, "commit", "-q", "-m", "init");
  if (faffrcBody !== undefined) writeFileSync(path.join(root, ".faffrc.yaml"), faffrcBody);
  const wt = path.join(parent, "wt");
  git(root, "worktree", "add", "-q", "--detach", wt); // checks out HEAD — no .faffrc.yaml
  return { parent, root, wt };
}

const FAFFRC = "faffter_dark:\n  adversarial:\n    host: http://example.test:11434\n";

test("config get from a linked worktree without .faffrc.yaml falls back to the main checkout's config (FAFF-208)", () => {
  const { parent, wt } = setup(FAFFRC);
  try {
    const { stdout, code } = runCli(["config", "get", "faffter_dark.adversarial.host"], { cwd: wt });
    assert.equal(code, 0, "exit 0 — resolved via the main-worktree fallback");
    assert.equal(stdout.trim(), "http://example.test:11434");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("config get from the main checkout itself is unchanged (no regression)", () => {
  const { parent, root } = setup(FAFFRC);
  try {
    const { stdout, code } = runCli(["config", "get", "faffter_dark.adversarial.host"], { cwd: root });
    assert.equal(code, 0);
    assert.equal(stdout.trim(), "http://example.test:11434");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("no false resolution: a worktree returns the -d default (exit 3) when the main checkout also has no config (FAFF-208)", () => {
  const { parent, wt } = setup(undefined); // no .faffrc.yaml anywhere
  try {
    const { stdout, code } = runCli(["config", "get", "faffter_dark.adversarial.host", "-d", "DEFAULT"], { cwd: wt });
    assert.equal(code, 3, "absent everywhere → -d default path");
    assert.equal(stdout.trim(), "DEFAULT");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
