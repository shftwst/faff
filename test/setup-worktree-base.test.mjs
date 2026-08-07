// FAFF-708 — setup-worktree.sh must base a new worktree branch on the FETCHED remote default
// branch, not the invoking checkout's possibly-stale local HEAD. `faff merge-gate --execute` merges
// remotely and never advances the operator's local default-branch checkout, so branching off local
// HEAD can silently omit a just-merged sibling. These tests exercise the base-selection body added
// to the shared direct/hook provisioning path:
//   - a stale-local-HEAD / newer-remote fixture (through BOTH direct and hook mode) lands the
//     worktree on the fetched remote tip and contains the remote-only commit;
//   - a non-`main` default branch proves the resolved name supplies the base (no guessed `main`);
//   - a reachable remote advertising no symbolic HEAD fails before `git worktree add`;
//   - an unreachable/unfetchable origin fails before `git worktree add`, leaving no branch, no
//     worktree directory, and no `git worktree list` entry — never a HEAD-based fall-back;
//   - a repository with NO origin still branches off local HEAD and performs no fetch (git-only).
// The pre-existing tracked-config own-ref protection and untracked-overlay copying stay covered by
// setup-worktree-{clobber,config,direct}.test.mjs as non-regression coverage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, "..");
const PLUGIN_ROOT = path.join(REPO_ROOT, "plugin");
const SCRIPT = path.join(PLUGIN_ROOT, "skills", "faff-graft", "setup-worktree.sh");

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed (cwd=${cwd}): ${r.stderr}`);
  return r.stdout;
}

function commitFile(repo, file, content, msg) {
  writeFileSync(path.join(repo, file), content);
  git(repo, "add", file);
  git(repo, "commit", "-q", "-m", msg);
  return git(repo, "rev-parse", "HEAD").trim();
}

// Build a bare origin (default branch = `defaultBranch`) with commit A, an invoking checkout cloned
// while origin is still at A (so its local default branch is STALE at A), then push commit B to
// origin's default branch so origin is ahead. Returns the invoking checkout + origin's B tip.
function setupStaleFixture(defaultBranch = "main") {
  const parent = mkdtempSync(path.join(tmpdir(), "faff708-"));
  const origin = path.join(parent, "origin.git");
  git(parent, "init", "--bare", "-b", defaultBranch, "origin.git");

  const seed = path.join(parent, "seed");
  git(parent, "clone", "-q", origin, "seed");
  git(seed, "config", "user.email", "t@t.test");
  git(seed, "config", "user.name", "t");
  commitFile(seed, "A.txt", "A\n", "commit A");
  git(seed, "push", "-q", "origin", `HEAD:${defaultBranch}`);

  // Invoking checkout cloned while origin is at A — its local default branch stays at A.
  const work = path.join(parent, "work");
  git(parent, "clone", "-q", origin, "work");
  git(work, "config", "user.email", "t@t.test");
  git(work, "config", "user.name", "t");
  const shaA = git(work, "rev-parse", "HEAD").trim();

  // Advance origin's default branch to B via the seed clone; the invoking checkout is NOT advanced.
  const shaB = commitFile(seed, "B.txt", "B\n", "commit B (remote-only)");
  git(seed, "push", "-q", "origin", `HEAD:${defaultBranch}`);

  return { parent, origin, work, shaA, shaB, defaultBranch };
}

const BASE_ENV = { SKIP_NPM_PACKAGES_INSTALL: "1", CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };

function runDirect(repo, wtRoot, name = "feat-x", extraEnv = {}) {
  return spawnSync("bash", [SCRIPT, name, repo], {
    encoding: "utf8",
    env: { ...process.env, ...BASE_ENV, FAFF_WORKTREE_ROOT: wtRoot, ...extraEnv },
  });
}

function runHook(repo, wtRoot, name = "feat-x", extraEnv = {}) {
  return spawnSync("bash", [SCRIPT], {
    input: JSON.stringify({ name, cwd: repo }),
    encoding: "utf8",
    env: { ...process.env, ...BASE_ENV, FAFF_WORKTREE_ROOT: wtRoot, ...extraEnv },
  });
}

function lastLine(stdout) {
  return stdout.trim().split("\n").pop().trim();
}

function rmParent(parent) {
  spawnSync("rm", ["-rf", parent]);
}

for (const mode of ["direct", "hook"]) {
  test(`${mode} mode: stale local HEAD, worktree is based on the fetched remote default tip (FAFF-708)`, () => {
    const fx = setupStaleFixture("main");
    const wtRoot = path.join(fx.parent, "wt");
    try {
      const r = mode === "direct" ? runDirect(fx.work, wtRoot) : runHook(fx.work, wtRoot);
      assert.equal(r.status, 0, `${mode} mode exited non-zero: ${r.stderr}`);
      const wt = lastLine(r.stdout);
      assert.ok(existsSync(wt), `worktree path must exist: ${wt}`);
      // The new branch tip equals the freshly fetched remote default tip (B), NOT the stale local A.
      const wtHead = git(wt, "rev-parse", "HEAD").trim();
      assert.equal(wtHead, fx.shaB, "worktree HEAD must equal origin's default tip (B), not stale local A");
      assert.notEqual(wtHead, fx.shaA, "worktree must NOT be based on the stale local HEAD (A)");
      // The remote-only commit's file is present.
      assert.ok(existsSync(path.join(wt, "B.txt")), "the remote-only commit B's file must exist in the worktree");
    } finally {
      git(fx.work, "worktree", "prune");
      rmParent(fx.parent);
    }
  });
}

for (const mode of ["direct", "hook"]) {
  test(`${mode} mode: non-\`main\` default branch supplies the base (no guessed main) (FAFF-708)`, () => {
    const fx = setupStaleFixture("trunk");
    const wtRoot = path.join(fx.parent, "wt");
    try {
      const r = mode === "direct" ? runDirect(fx.work, wtRoot) : runHook(fx.work, wtRoot);
      assert.equal(r.status, 0, `${mode} mode exited non-zero: ${r.stderr}`);
      const wt = lastLine(r.stdout);
      const wtHead = git(wt, "rev-parse", "HEAD").trim();
      assert.equal(wtHead, fx.shaB, "worktree must be based on origin/trunk's tip, resolved from the remote symref");
      assert.ok(existsSync(path.join(wt, "B.txt")), "remote-only commit on origin/trunk must be present");
    } finally {
      git(fx.work, "worktree", "prune");
      rmParent(fx.parent);
    }
  });
}

test("reachable remote that advertises no symbolic HEAD fails before `git worktree add` (FAFF-708)", () => {
  const fx = setupStaleFixture("main");
  const wtRoot = path.join(fx.parent, "wt");
  try {
    // Detach origin's HEAD so `git ls-remote --symref origin HEAD` advertises no `ref:` line.
    git(fx.origin, "update-ref", "--no-deref", "HEAD", fx.shaB);
    // Sanity: the remote must now advertise no symbolic HEAD.
    const sym = git(fx.work, "ls-remote", "--symref", "origin", "HEAD");
    assert.ok(!/^ref: /m.test(sym), `test setup invalid: origin still advertises a symref:\n${sym}`);

    const r = runDirect(fx.work, wtRoot);
    assert.notEqual(r.status, 0, "provisioning must exit non-zero when the remote advertises no symbolic HEAD");
    // No branch was guessed / created, no worktree dir, no worktree metadata entry.
    const branches = git(fx.work, "branch", "--list", "feat-x").trim();
    assert.equal(branches, "", "no worktree branch must be created when the default branch cannot be resolved");
    assert.ok(!existsSync(path.join(wtRoot, "feat-x")), "no worktree directory must be created");
    assert.ok(!git(fx.work, "worktree", "list", "--porcelain").includes("feat-x"), "no worktree metadata entry");
  } finally {
    git(fx.work, "worktree", "prune");
    rmParent(fx.parent);
  }
});

test("unreachable/unfetchable origin fails before `git worktree add`, no HEAD fall-back (FAFF-708)", () => {
  const fx = setupStaleFixture("main");
  const wtRoot = path.join(fx.parent, "wt");
  try {
    // Repoint origin at a nonexistent path so both ls-remote and fetch fail fast (no hang under
    // GIT_TERMINAL_PROMPT=0 + timeout). A short FAFF_GIT_NET_TIMEOUT keeps the test snappy.
    git(fx.work, "remote", "set-url", "origin", path.join(fx.parent, "does-not-exist.git"));
    const r = runDirect(fx.work, wtRoot, "feat-x", { FAFF_GIT_NET_TIMEOUT: "5" });
    assert.notEqual(r.status, 0, "provisioning must fail when origin exists but cannot be reached/fetched");
    // Terminal BEFORE `git worktree add`: no branch, no worktree dir, no metadata entry, no stale-HEAD base.
    assert.equal(git(fx.work, "branch", "--list", "feat-x").trim(), "", "no branch must be created");
    assert.ok(!existsSync(path.join(wtRoot, "feat-x")), "no worktree directory must be created");
    assert.ok(!git(fx.work, "worktree", "list", "--porcelain").includes("feat-x"), "no worktree metadata entry");
  } finally {
    git(fx.work, "worktree", "prune");
    rmParent(fx.parent);
  }
});

test("no-origin repository branches off local HEAD and performs no fetch (git-only) (FAFF-708)", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "faff708-local-"));
  const repo = path.join(parent, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@t.test");
  git(repo, "config", "user.name", "t");
  const shaHead = commitFile(repo, "A.txt", "A\n", "init");
  const wtRoot = path.join(parent, "wt");
  try {
    const r = runDirect(repo, wtRoot);
    assert.equal(r.status, 0, `git-only provisioning exited non-zero: ${r.stderr}`);
    const wt = lastLine(r.stdout);
    assert.equal(git(wt, "rev-parse", "HEAD").trim(), shaHead, "git-only worktree must be based on local HEAD");
    // The setup log records the git-only path and no remote fetch.
    const log = readFileSync(path.join(wtRoot, "setup.log"), "utf8");
    assert.ok(/no origin remote — git-only mode/.test(log), "log must record the git-only, no-fetch path");
    assert.ok(!/fetched remote default/.test(log), "git-only path must not fetch a remote default branch");
  } finally {
    git(repo, "worktree", "prune");
    rmParent(parent);
  }
});
