// FAFF-532 — the WorktreeCreate hook must NOT clobber a git-TRACKED .faffrc.yaml. `git worktree add`
// already materialises every tracked path at the worktree's own ref, so the config-copy step must
// copy ONLY files git does not track (the untracked machine-local overlays). Copying $CWD's version
// over a tracked, committed .faffrc.yaml silently reverts it to the invoking checkout's — the
// FAFF-529 clobber. This exercises the real hook end-to-end against a tmp git repo with a
// behavioural divergence: worktree ref = version A, invoking checkout working tree = version B.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, "..");
const PLUGIN_ROOT = path.join(REPO_ROOT, "plugin");
const HOOK = path.join(PLUGIN_ROOT, "skills", "faff-graft", "setup-worktree.sh");

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

// A tmp git repo whose committed .faffrc.yaml = version A, working tree = divergent version B
// (uncommitted), plus an untracked .faffrc.local.yaml overlay. Returns { parent, repo }.
function setupRepo(versionA, versionB, overlay) {
  const parent = mkdtempSync(path.join(tmpdir(), "faff532-"));
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
  if (overlay !== undefined) writeFileSync(path.join(repo, ".faffrc.local.yaml"), overlay); // untracked overlay
  return { parent, repo };
}

// Run the real hook against `repo`, worktree root pinned to a tmpdir. Returns the printed path.
function runHook(repo, parent) {
  const wtRoot = path.join(parent, "wt");
  const input = JSON.stringify({ name: "feat-x", cwd: repo });
  const r = spawnSync("bash", [HOOK], {
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      SKIP_NPM_PACKAGES_INSTALL: "1",
      FAFF_WORKTREE_ROOT: wtRoot,
      CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, // so the hook resolves the faff binary and reads FAFF_WORKTREE_ROOT
    },
  });
  assert.equal(r.status, 0, `hook exited non-zero: ${r.stderr}`);
  const wt = r.stdout.trim().split("\n").pop().trim();
  assert.ok(wt && wt.startsWith(wtRoot), `hook must print a worktree path under ${wtRoot}; got: ${wt}`);
  return wt;
}

test("a TRACKED .faffrc.yaml keeps its own-ref content (A), NOT the invoking checkout's copy (B) (FAFF-532)", () => {
  const { parent, repo } = setupRepo(
    "faff_base: A\n", // committed (own-ref) version A
    "faff_base: B\n", // invoking checkout working tree version B
    "overlay: OV\n",  // untracked overlay
  );
  try {
    const wt = runHook(repo, parent);
    assert.equal(
      readFileSync(path.join(wt, ".faffrc.yaml"), "utf8"),
      "faff_base: A\n",
      "worktree's tracked .faffrc.yaml must be its own-ref A, not clobbered with the invoking checkout's B",
    );
    assert.equal(
      readFileSync(path.join(wt, ".faffrc.local.yaml"), "utf8"),
      "overlay: OV\n",
      "the untracked overlay must still be copied into the worktree",
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("an UNTRACKED (gitignored) .faffrc.yaml in an unmigrated repo is still copied (FAFF-186 preserved)", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "faff532u-"));
  const repo = path.join(parent, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@t.test");
  git(repo, "config", "user.name", "t");
  writeFileSync(path.join(repo, "README.md"), "x\n");
  writeFileSync(path.join(repo, ".gitignore"), ".faffrc.yaml\n");
  git(repo, "add", "README.md", ".gitignore");
  git(repo, "commit", "-q", "-m", "init");
  // .faffrc.yaml is present but gitignored-and-untracked (unmigrated adopter repo)
  writeFileSync(path.join(repo, ".faffrc.yaml"), "adopter: yes\n");
  try {
    const wt = runHook(repo, parent);
    assert.equal(
      readFileSync(path.join(wt, ".faffrc.yaml"), "utf8"),
      "adopter: yes\n",
      "an untracked .faffrc.yaml must still be copied — git would not otherwise carry it (FAFF-186)",
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
