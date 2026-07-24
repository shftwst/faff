// FAFF-595 — setup-worktree.sh gains a direct-argument input mode alongside the hook-stdin mode so
// the faff-graft skill step can provision a build worktree via the shell, with no Claude Code
// WorktreeCreate hook. This exercises the direct path end-to-end and asserts parity with hook mode:
// both share the one provisioning body (branch-off-HEAD, FAFF-532 tracked-skip config-copy,
// path-on-stdout). A third case proves the direct path never invokes jq (jq absent from PATH).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from "node:fs";
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
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

// A tmp git repo whose committed .faffrc.yaml = version A, working tree = divergent version B
// (uncommitted), plus an untracked overlay (.env, .claude/settings.local.json, .faffrc.local.yaml).
function setupRepo(versionA, versionB) {
  const parent = mkdtempSync(path.join(tmpdir(), "faff595-"));
  const repo = path.join(parent, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@t.test");
  git(repo, "config", "user.name", "t");
  writeFileSync(path.join(repo, "README.md"), "x\n");
  writeFileSync(path.join(repo, ".faffrc.yaml"), versionA); // committed = A
  git(repo, "add", "README.md", ".faffrc.yaml");
  git(repo, "commit", "-q", "-m", "init");
  writeFileSync(path.join(repo, ".faffrc.yaml"), versionB); // working tree = B (uncommitted divergence)
  // untracked machine-local overlay
  writeFileSync(path.join(repo, ".env"), "SECRET=1\n");
  writeFileSync(path.join(repo, ".faffrc.local.yaml"), "overlay: OV\n");
  mkdirSync(path.join(repo, ".claude"));
  writeFileSync(path.join(repo, ".claude", "settings.local.json"), '{"k":1}\n');
  return { parent, repo };
}

const BASE_ENV = { SKIP_NPM_PACKAGES_INSTALL: "1", CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };

// Run the script in DIRECT mode: name + repo-root as positional args, no stdin.
function runDirect(repo, wtRoot, extraEnv = {}) {
  const r = spawnSync("bash", [SCRIPT, "feat-x", repo], {
    encoding: "utf8",
    env: { ...process.env, ...BASE_ENV, FAFF_WORKTREE_ROOT: wtRoot, ...extraEnv },
  });
  return r;
}

// Run the script in HOOK mode: JSON on stdin, no args.
function runHook(repo, wtRoot) {
  const r = spawnSync("bash", [SCRIPT], {
    input: JSON.stringify({ name: "feat-x", cwd: repo }),
    encoding: "utf8",
    env: { ...process.env, ...BASE_ENV, FAFF_WORKTREE_ROOT: wtRoot },
  });
  return r;
}

function lastLine(stdout) {
  return stdout.trim().split("\n").pop().trim();
}

function assertConfigParity(wt) {
  // FAFF-532: tracked .faffrc.yaml stays at the worktree's own ref (A), NOT the invoking checkout's B.
  assert.equal(
    readFileSync(path.join(wt, ".faffrc.yaml"), "utf8"),
    "faff_base: A\n",
    "worktree's tracked .faffrc.yaml must be its own-ref A, not clobbered with B",
  );
  // Untracked overlay files are copied in.
  assert.equal(readFileSync(path.join(wt, ".env"), "utf8"), "SECRET=1\n", ".env overlay must be copied");
  assert.equal(
    readFileSync(path.join(wt, ".faffrc.local.yaml"), "utf8"),
    "overlay: OV\n",
    ".faffrc.local.yaml overlay must be copied",
  );
  assert.equal(
    readFileSync(path.join(wt, ".claude", "settings.local.json"), "utf8"),
    '{"k":1}\n',
    ".claude/settings.local.json overlay must be copied",
  );
}

test("direct mode provisions a worktree on a new branch off HEAD, with FAFF-532 config parity (FAFF-595)", () => {
  const { parent, repo } = setupRepo("faff_base: A\n", "faff_base: B\n");
  const wtRoot = path.join(parent, "wt");
  try {
    const r = runDirect(repo, wtRoot);
    assert.equal(r.status, 0, `direct mode exited non-zero: ${r.stderr}`);
    const wt = lastLine(r.stdout);
    assert.ok(wt.startsWith(wtRoot), `worktree path must be under ${wtRoot}; got: ${wt}`);
    assert.ok(existsSync(wt), "the printed worktree path must exist");
    // new branch off HEAD, named feat-x
    const branch = git(wt, "rev-parse", "--abbrev-ref", "HEAD").trim();
    assert.equal(branch, "feat-x", "worktree must be on the new branch feat-x");
    assertConfigParity(wt);
  } finally {
    git(repo, "worktree", "prune");
    rmParent(parent);
  }
});

test("hook mode and direct mode produce identical config-copy outcomes; both print path last (FAFF-595 parity)", () => {
  // Two equivalent fixtures — one driven by hook stdin, one by direct args.
  const hookFix = setupRepo("faff_base: A\n", "faff_base: B\n");
  const directFix = setupRepo("faff_base: A\n", "faff_base: B\n");
  const hookRoot = path.join(hookFix.parent, "wt");
  const directRoot = path.join(directFix.parent, "wt");
  try {
    const hr = runHook(hookFix.repo, hookRoot);
    assert.equal(hr.status, 0, `hook mode exited non-zero: ${hr.stderr}`);
    const dr = runDirect(directFix.repo, directRoot);
    assert.equal(dr.status, 0, `direct mode exited non-zero: ${dr.stderr}`);

    const hookWt = lastLine(hr.stdout);
    const directWt = lastLine(dr.stdout);
    assert.ok(hookWt.startsWith(hookRoot) && existsSync(hookWt), "hook mode must print an existing path last");
    assert.ok(directWt.startsWith(directRoot) && existsSync(directWt), "direct mode must print an existing path last");

    // Identical config-copy outcomes across the two modes.
    assertConfigParity(hookWt);
    assertConfigParity(directWt);
  } finally {
    git(hookFix.repo, "worktree", "prune");
    git(directFix.repo, "worktree", "prune");
    rmParent(hookFix.parent);
    rmParent(directFix.parent);
  }
});

test("direct mode succeeds with jq absent from PATH — the direct path never invokes jq (FAFF-595)", () => {
  const { parent, repo } = setupRepo("faff_base: A\n", "faff_base: B\n");
  const wtRoot = path.join(parent, "wt");
  // Build a sandbox bin with every command the script's body needs EXCEPT jq, then pin PATH to it.
  const sandboxBin = path.join(parent, "bin");
  mkdirSync(sandboxBin);
  const needed = [
    "bash", "git", "node", "env", "sh",
    "basename", "dirname", "tr", "date", "mkdir", "cp", "cat", "grep",
    "rm", "head", "find", "sed", "uname",
  ];
  for (const cmd of needed) {
    const found = spawnSync("bash", ["-c", `command -v ${cmd}`], { encoding: "utf8" }).stdout.trim();
    if (found) symlinkSync(found, path.join(sandboxBin, cmd));
  }
  // Sanity: jq must NOT be resolvable through the sandbox PATH.
  const jqProbe = spawnSync("bash", ["-c", "command -v jq || true"], {
    encoding: "utf8",
    env: { PATH: sandboxBin },
  });
  assert.equal(jqProbe.stdout.trim(), "", "test setup invalid: jq is still reachable via the sandbox PATH");

  try {
    const r = runDirect(repo, wtRoot, { PATH: sandboxBin });
    assert.equal(r.status, 0, `direct mode with no jq exited non-zero: ${r.stderr}`);
    const wt = lastLine(r.stdout);
    assert.ok(wt.startsWith(wtRoot) && existsSync(wt), `must print an existing worktree path; got: ${wt}`);
    assertConfigParity(wt);
  } finally {
    git(repo, "worktree", "prune");
    rmParent(parent);
  }
});

function rmParent(parent) {
  spawnSync("rm", ["-rf", parent]);
}
