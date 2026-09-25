// FAFF-1114 — self-heal a graft worktree whose `.git/worktrees/<id>/` admin metadata was
// pruned out-of-band while its checkout dir + branch ref survived. Exercises the real CLI
// (per ADR 0002) against a real `git worktree add` + a simulated clobber (`rm -rf` the admin
// dir), mirroring test/effects-worktree.test.mjs's git-fixture shape. Detection lives in
// worktree-check (the new `clobbered-recoverable` reason); the heal lives in worktree-heal.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

// A temp parent holding a main checkout (repo/) and a sibling worktree root (wtroot/) that
// FAFF_WORKTREE_ROOT points at, so the FAFF-382 resolver `worktree-heal` shells lands there.
function setup() {
  const parent = mkdtempSync(path.join(tmpdir(), "faff1114-heal-"));
  const repo = path.join(parent, "repo");
  const wtroot = path.join(parent, "wtroot");
  mkdirSync(repo);
  mkdirSync(wtroot);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@t.test");
  git(repo, "config", "user.name", "t");
  git(repo, "commit", "-q", "--allow-empty", "-m", "init");
  return { parent, repo, wtroot, env: { ...process.env, FAFF_WORKTREE_ROOT: wtroot } };
}

// Add a linked worktree on a new branch under wtroot, matching setup-worktree.sh's placement
// (`<wtroot>/<safe-name>`, safe-name = branch with '/'->'-'). Returns the checkout path.
function addWorktree(repo, wtroot, branch) {
  const safe = branch.replace(/\//g, "-");
  const wt = path.join(wtroot, safe);
  git(repo, "worktree", "add", "-q", "-b", branch, wt, "HEAD");
  return wt;
}

// Simulate the out-of-band clobber: delete the admin dir(s) for `wt`, checkout survives.
function clobber(repo, wt) {
  const base = path.join(repo, ".git", "worktrees");
  const norm = (p) => p.replace(/\/+$/, "");
  for (const id of readdirSync(base)) {
    const gd = readFileSync(path.join(base, id, "gitdir"), "utf8").trim(); // names "<checkout>/.git"
    if (norm(gd.replace(/\/\.git$/, "")) === norm(wt)) rmSync(path.join(base, id), { recursive: true, force: true });
  }
}

test("worktree-check reports clobbered-recoverable (not no-worktree) with worktree_path/branch/admin_id (AC: detection)", () => {
  const { parent, repo, wtroot, env } = setup();
  try {
    const wt = addWorktree(repo, wtroot, "faff-1114-thread");
    writeFileSync(path.join(wt, "wip.txt"), "wip\n");
    clobber(repo, wt);
    const r = runCli(["worktree-check", "--issue", "faff-1114", "--root", repo, "--json"], { cwd: repo, env });
    assert.equal(r.code, 2, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.reason, "clobbered-recoverable");
    assert.equal(j.worktree_path.replace(/\/+$/, ""), wt.replace(/\/+$/, ""));
    assert.equal(j.branch, "faff-1114-thread");
    assert.equal(j.admin_id, "faff-1114-thread");
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("worktree-heal re-registers the worktree, restores git ops on the correct branch, and preserves working-tree content (AC: heal + WIP)", () => {
  const { parent, repo, wtroot, env } = setup();
  try {
    const wt = addWorktree(repo, wtroot, "faff-1114-thread");
    writeFileSync(path.join(wt, "wip.txt"), "wip content\n");
    git(wt, "add", "wip.txt"); // staged before the clobber; staging is lost, content survives
    clobber(repo, wt);
    // pre-heal: git ops from the checkout fail
    assert.notEqual(spawnSync("git", ["-C", wt, "status"], { encoding: "utf8" }).status, 0);

    const h = runCli(["worktree-heal", "--issue", "faff-1114", "--root", repo, "--json"], { cwd: repo, env });
    assert.equal(h.code, 0, h.stderr);
    const hj = JSON.parse(h.stdout);
    assert.equal(hj.healed, true);
    assert.equal(hj.branch, "faff-1114-thread");

    // git worktree list tracks it again
    assert.ok(git(repo, "worktree", "list").includes(wt), "worktree re-listed");
    // correct branch, resolvable HEAD
    assert.equal(git(wt, "rev-parse", "--abbrev-ref", "HEAD").trim(), "faff-1114-thread");
    assert.doesNotThrow(() => git(wt, "rev-parse", "--verify", "HEAD"));
    // working-tree content preserved; a subsequent commit includes it
    git(wt, "add", "-A");
    git(wt, "commit", "-q", "-m", "wip commit");
    assert.ok(git(wt, "show", "--stat", "--oneline", "HEAD").includes("wip.txt"), "WIP change is in the commit");
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("two same-token branches, one checkout → heal binds to the checkout's OWN branch, never the stale one (AC: branch bound to checkout)", () => {
  const { parent, repo, wtroot, env } = setup();
  try {
    const wt = addWorktree(repo, wtroot, "faff-1114-thread");
    git(repo, "branch", "faff-1114-old"); // a second, stale same-token branch in the ref store
    writeFileSync(path.join(wt, "wip.txt"), "wip\n");
    clobber(repo, wt);

    const h = runCli(["worktree-heal", "--issue", "faff-1114", "--root", repo, "--json"], { cwd: repo, env });
    assert.equal(h.code, 0, h.stderr);
    assert.equal(JSON.parse(h.stdout).branch, "faff-1114-thread", "bound to the checkout's own branch");
    assert.equal(git(wt, "rev-parse", "--abbrev-ref", "HEAD").trim(), "faff-1114-thread");
    // a commit lands on the checkout's real branch, never the stale tip
    git(wt, "add", "-A");
    git(wt, "commit", "-q", "-m", "on own branch");
    const threadTip = git(repo, "rev-parse", "faff-1114-thread").trim();
    const oldTip = git(repo, "rev-parse", "faff-1114-old").trim();
    assert.notEqual(threadTip, oldTip, "the stale branch tip is untouched");
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("directory ambiguity: >1 issue-matching candidate dir → null finding / no-worktree, no mutation (AC: fail-safe)", () => {
  const { parent, repo, wtroot, env } = setup();
  try {
    const a = addWorktree(repo, wtroot, "faff-1114-a");
    const b = addWorktree(repo, wtroot, "faff-1114-b");
    clobber(repo, a);
    clobber(repo, b);
    const c = runCli(["worktree-check", "--issue", "faff-1114", "--root", repo, "--json"], { cwd: repo, env });
    assert.equal(c.code, 2);
    assert.equal(JSON.parse(c.stdout).reason, "no-worktree", "ambiguous → fail-safe no-worktree");
    const h = runCli(["worktree-heal", "--issue", "faff-1114", "--root", repo, "--json"], { cwd: repo, env });
    assert.equal(h.code, 2, "heal is a no-op on ambiguity");
    // no admin dir was recreated for either candidate
    assert.equal(existsSync(path.join(repo, ".git", "worktrees", "faff-1114-a")), false);
    assert.equal(existsSync(path.join(repo, ".git", "worktrees", "faff-1114-b")), false);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("branch gone: zero refs map to the checkout → null / no-worktree (AC: no bindable branch)", () => {
  const { parent, repo, wtroot, env } = setup();
  try {
    const wt = addWorktree(repo, wtroot, "faff-1114-thread");
    clobber(repo, wt);
    // the branch ref is also gone (a deeper clobber); the worktree is untracked so the ref frees up
    git(repo, "update-ref", "-d", "refs/heads/faff-1114-thread");
    const c = runCli(["worktree-check", "--issue", "faff-1114", "--root", repo, "--json"], { cwd: repo, env });
    assert.equal(c.code, 2);
    assert.equal(JSON.parse(c.stdout).reason, "no-worktree", "no bindable branch → fail-safe no-worktree");
    const h = runCli(["worktree-heal", "--issue", "faff-1114", "--root", repo, "--json"], { cwd: repo, env });
    assert.equal(h.code, 2, "heal is a no-op when the branch is gone");
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("idempotency: re-run heal after a successful heal → exit 2 no-op via the null-finding path (AC: idempotent)", () => {
  const { parent, repo, wtroot, env } = setup();
  try {
    const wt = addWorktree(repo, wtroot, "faff-1114-thread");
    clobber(repo, wt);
    const first = runCli(["worktree-heal", "--issue", "faff-1114", "--root", repo, "--json"], { cwd: repo, env });
    assert.equal(first.code, 0, first.stderr);
    const second = runCli(["worktree-heal", "--issue", "faff-1114", "--root", repo, "--json"], { cwd: repo, env });
    assert.equal(second.code, 2, "admin dir now present → detect_clobber null → no-op");
    assert.equal(JSON.parse(second.stdout).healed, false);
    // and worktree-check now certifies it (fresh/stale), no longer clobbered-recoverable
    const c = runCli(["worktree-check", "--issue", "faff-1114", "--root", repo, "--json"], { cwd: repo, env });
    assert.notEqual(c.stdout.includes("clobbered-recoverable"), true);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("no worktree at all for the issue → plain no-worktree (unchanged existing reason)", () => {
  const { parent, repo, env } = setup();
  try {
    const c = runCli(["worktree-check", "--issue", "faff-9999", "--root", repo, "--json"], { cwd: repo, env });
    assert.equal(c.code, 2);
    assert.equal(JSON.parse(c.stdout).reason, "no-worktree");
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
