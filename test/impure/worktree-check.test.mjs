// FAFF-948 — `faff worktree-check`: net-new real-git coverage proving the reuse-path staleness
// gap graft's Step 3 closes. Builds a real git-only (no origin) fixture with a base branch and a
// linked feature worktree, advances the base by one commit (simulating a merge landing on `main`
// while the worktree sits idle), and asserts `worktree-check` correctly classifies the now-stale
// worktree — mirroring `worktree-prune.test.mjs`'s real-git harness pattern (FAFF-762).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, devNull } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { runCli } from "../helpers/run-cli.mjs";

// Same determinism env as seed-repo.mjs (test/helpers) — a repo-local identity so a nested
// commit never silently no-ops in an identity-less CI environment (FAFF-476).
const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: "faff test",
  GIT_AUTHOR_EMAIL: "test@faff.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00 +0000",
  GIT_COMMITTER_NAME: "faff test",
  GIT_COMMITTER_EMAIL: "test@faff.invalid",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00 +0000",
};

function git(cwd, ...args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { env: ENV, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed (cwd=${cwd}): ${r.stderr}`);
  return r.stdout;
}

function commitFile(cwd, file, content, msg) {
  writeFileSync(path.join(cwd, file), content);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", msg);
}

// A git-only (no origin) repo — remote-diff-base.sh's git-only branch resolves the LOCAL default
// (main/master) directly, so no bare-remote fixture is needed to exercise worktree-check's base
// resolution honestly.
function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "faff948-wtcheck-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", ENV.GIT_AUTHOR_EMAIL);
  git(root, "config", "user.name", ENV.GIT_AUTHOR_NAME);
  commitFile(root, "seed.txt", "seed\n", "seed");
  return root;
}

test("worktree-check reports STALE + the correct behind count when main advances after the worktree forked", () => {
  const root = makeFixture();
  let worktreePath;
  try {
    // Branch + linked worktree, forked at main's current tip.
    git(root, "branch", "faff-948-stale-case");
    worktreePath = path.join(root, ".worktrees", "faff-948-stale-case");
    git(root, "worktree", "add", worktreePath, "faff-948-stale-case");

    // Advance main by exactly one commit — the FAFF-930 incident shape: a merge lands on
    // main while the worktree, forked earlier, keeps its now-stale base.
    commitFile(root, "merged-fix.txt", "fix\n", "a merge lands on main after the worktree forked");

    const { stdout, code } = runCli(["worktree-check", "--issue", "faff-948-stale-case", "--json"], { cwd: root });
    assert.equal(code, 1, stdout);
    const result = JSON.parse(stdout);
    assert.equal(result.stale, true, "a worktree one commit behind main must be reported stale");
    assert.equal(result.behind, 1, "exactly one commit landed on main since the worktree forked");
    assert.equal(result.threshold, 0, "default threshold is 0 — even one missed merge is stale");
    assert.equal(result.branch, "faff-948-stale-case");
    assert.equal(result.base_ref, "main", "git-only mode resolves the LOCAL default branch, no origin/ prefix");
  } finally {
    if (worktreePath) spawnSync("git", ["-C", root, "worktree", "remove", "--force", worktreePath]);
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("worktree-check reports FRESH (behind: 0) for a worktree current with main", () => {
  const root = makeFixture();
  let worktreePath;
  try {
    // Fork the branch AFTER main already has its tip commit — no divergence.
    git(root, "branch", "faff-948-fresh-case");
    worktreePath = path.join(root, ".worktrees", "faff-948-fresh-case");
    git(root, "worktree", "add", worktreePath, "faff-948-fresh-case");

    const { stdout, code } = runCli(["worktree-check", "--issue", "faff-948-fresh-case", "--json"], { cwd: root });
    assert.equal(code, 0, stdout);
    const result = JSON.parse(stdout);
    assert.equal(result.stale, false);
    assert.equal(result.behind, 0);
  } finally {
    if (worktreePath) spawnSync("git", ["-C", root, "worktree", "remove", "--force", worktreePath]);
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("worktree-check exits 2 (cannot certify) for an issue with no resolvable worktree — never a false fresh", () => {
  const root = makeFixture();
  try {
    const { stdout, stderr, code } = runCli(["worktree-check", "--issue", "faff-948-nonexistent", "--json"], { cwd: root });
    assert.equal(code, 2, stdout + stderr);
    // Never a fresh/stale claim — no worktree exists to certify against.
    assert.ok(!/"stale":(true|false)/.test(stdout), "an unresolvable issue must never emit a stale/fresh verdict");
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("worktree-check respects --behind-threshold — under the tolerance still reads fresh", () => {
  const root = makeFixture();
  let worktreePath;
  try {
    git(root, "branch", "faff-948-tolerant-case");
    worktreePath = path.join(root, ".worktrees", "faff-948-tolerant-case");
    git(root, "worktree", "add", worktreePath, "faff-948-tolerant-case");
    commitFile(root, "one-more.txt", "1\n", "one commit lands on main");

    const { stdout, code } = runCli(
      ["worktree-check", "--issue", "faff-948-tolerant-case", "--behind-threshold", "5", "--json"],
      { cwd: root },
    );
    assert.equal(code, 0, stdout);
    const result = JSON.parse(stdout);
    assert.equal(result.stale, false, "one commit behind is within an explicit threshold of 5");
    assert.equal(result.behind, 1);
    assert.equal(result.threshold, 5);
  } finally {
    if (worktreePath) spawnSync("git", ["-C", root, "worktree", "remove", "--force", worktreePath]);
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

// Pure-core coverage direct from the CLI's own --selftest entry (the classifyWorktreeStaleness
// table) — the same one `faff regions --selftest` sweeps.
test("worktree-check --selftest passes its pure-core classification table", () => {
  const { stdout, code } = runCli(["worktree-check", "--selftest"]);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /RESULT: PASS/);
});
