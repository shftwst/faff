// FAFF-957 — `faff review-target`: net-new real-git coverage proving the worktree-aware
// review-target resolver + the ambient-cwd/branch mismatch guard close the FAFF-930 incident gap
// (a forked ad-hoc `/code-review` with no explicit target silently reviewing the main checkout's
// unrelated diff instead of the build worktree's). Mirrors worktree-check.test.mjs's real-git
// fixture pattern (FAFF-948) plus merge-gate-controlflow.test.mjs's stub-`gh`-on-PATH pattern.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, realpathSync } from "node:fs";
import { tmpdir, devNull } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { runCli } from "../helpers/run-cli.mjs";

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
// (main/master) directly, matching worktree-check.test.mjs's fixture shape exactly.
// realpathSync: on macOS, tmpdir() (/var/folders/...) is a symlink to /private/var/folders/...,
// so a `git worktree add` under it resolves to the /private/... form in `git worktree list`'s
// output while a manually path.join()'d expectation stays on the symlinked form — resolve once,
// up front, so every downstream path.join(root, ...) already agrees with git's own resolution
// on every OS (Linux's /tmp has no such symlink, so this is a no-op there).
function makeFixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "faff957-reviewtarget-")));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", ENV.GIT_AUTHOR_EMAIL);
  git(root, "config", "user.name", ENV.GIT_AUTHOR_NAME);
  commitFile(root, "seed.txt", "seed\n", "seed");
  return root;
}

// A stub `gh` answering `pr list --head <branch> --state open --json number` from an
// env-supplied canned response — no network, mirrors merge-gate-controlflow.test.mjs's stub
// pattern. STUB_PR_NUMBERS is a JSON array string; "[]" simulates "no open PR" (the pre-PR case).
function stubGhEnv(prNumbersJson) {
  const stubDir = mkdtempSync(path.join(tmpdir(), "faff957-gh-stub-"));
  const ghPath = path.join(stubDir, "gh");
  writeFileSync(ghPath, `#!/usr/bin/env bash
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  printf '%s' "$STUB_PR_NUMBERS"
  exit 0
fi
printf 'stub gh: unhandled subcommand: %s\\n' "$*" >&2
exit 3
`);
  chmodSync(ghPath, 0o755);
  return { stubDir, env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}`, STUB_PR_NUMBERS: prNumbersJson } };
}

test("review-target --resolve emits a worktree/branch/base target pre-PR (no open PR) — the FAFF-930 incident's pre-PR case", () => {
  const root = makeFixture();
  const { stubDir, env } = stubGhEnv("[]");
  let worktreePath;
  try {
    git(root, "branch", "faff-930-spec-review");
    worktreePath = path.join(root, ".worktrees", "faff-930-spec-review");
    git(root, "worktree", "add", worktreePath, "faff-930-spec-review");

    const { stdout, code } = runCli(["review-target", "--resolve", "--issue", "faff-930", "--json"], { cwd: root, env });
    assert.equal(code, 0, stdout);
    const result = JSON.parse(stdout);
    assert.equal(result.kind, "worktree");
    assert.equal(result.branch, "faff-930-spec-review");
    assert.equal(result.path, worktreePath);
    assert.equal(result.base, "main", "git-only mode resolves the LOCAL default branch, no origin/ prefix");
    assert.equal(result.target, `--path ${worktreePath} --base main --branch faff-930-spec-review`);
  } finally {
    if (worktreePath) spawnSync("git", ["-C", root, "worktree", "remove", "--force", worktreePath]);
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    rmSync(stubDir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("review-target --resolve emits pr:<n> when an open PR exists for the branch — the incident's own recovery shape (`gh pr diff 797`)", () => {
  const root = makeFixture();
  const { stubDir, env } = stubGhEnv('[{"number":797}]');
  let worktreePath;
  try {
    git(root, "branch", "faff-930-spec-review");
    worktreePath = path.join(root, ".worktrees", "faff-930-spec-review");
    git(root, "worktree", "add", worktreePath, "faff-930-spec-review");

    const { stdout, code } = runCli(["review-target", "--resolve", "--issue", "faff-930", "--json"], { cwd: root, env });
    assert.equal(code, 0, stdout);
    const result = JSON.parse(stdout);
    assert.equal(result.kind, "pr");
    assert.equal(result.pr, 797);
    assert.equal(result.target, "pr:797");
  } finally {
    if (worktreePath) spawnSync("git", ["-C", root, "worktree", "remove", "--force", worktreePath]);
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    rmSync(stubDir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("review-target --guard reproduces the FAFF-930 incident: ambient cwd on the wrong branch -> exit 1 naming the correct target", () => {
  const root = makeFixture();
  const { stubDir, env } = stubGhEnv("[]");
  let worktreePath;
  try {
    // The build branch (faff-930), plus an UNRELATED branch the "ambient cwd" (root) sits on —
    // mirrors the incident: ambient cwd on faff-947's branch during a faff-930 build.
    git(root, "branch", "faff-930-spec-review");
    worktreePath = path.join(root, ".worktrees", "faff-930-spec-review");
    git(root, "worktree", "add", worktreePath, "faff-930-spec-review");
    git(root, "checkout", "-q", "-b", "faff-947-decision-capture");

    const { stdout, stderr, code } = runCli(["review-target", "--guard", "--issue", "faff-930", "--json"], { cwd: root, env });
    assert.equal(code, 1, stdout + stderr);
    const result = JSON.parse(stdout);
    assert.equal(result.ok, false);
    assert.equal(result.ambient_branch, "faff-947-decision-capture");
    assert.equal(result.branch, "faff-930-spec-review");
    assert.match(stderr, /use --path/, "the guard must name the correct explicit target to use");
  } finally {
    if (worktreePath) spawnSync("git", ["-C", root, "worktree", "remove", "--force", worktreePath]);
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    rmSync(stubDir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("review-target --guard exits 0 when the ambient cwd IS the branch under build", () => {
  const root = makeFixture();
  const { stubDir, env } = stubGhEnv("[]");
  let worktreePath;
  try {
    git(root, "branch", "faff-930-spec-review");
    worktreePath = path.join(root, ".worktrees", "faff-930-spec-review");
    git(root, "worktree", "add", worktreePath, "faff-930-spec-review");

    // Run the guard FROM the worktree itself — the correct, non-buggy invocation shape.
    const { stdout, code } = runCli(["review-target", "--guard", "--issue", "faff-930", "--json"], { cwd: worktreePath, env });
    assert.equal(code, 0, stdout);
    const result = JSON.parse(stdout);
    assert.equal(result.ok, true);
    assert.equal(result.ambient_branch, "faff-930-spec-review");
  } finally {
    if (worktreePath) spawnSync("git", ["-C", root, "worktree", "remove", "--force", worktreePath]);
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    rmSync(stubDir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("review-target --guard with no --issue is a no-op (not in a worktree build lane) — exit 0, never a refuse", () => {
  const root = makeFixture();
  const { stdout, code } = runCli(["review-target", "--guard", "--json"], { cwd: root });
  assert.equal(code, 0, stdout);
  const result = JSON.parse(stdout);
  assert.equal(result.issue, null);
});

test("review-target --resolve exits 2 (fail-safe refuse) for an issue with no resolvable worktree — reason: no-worktree, never a silent pass", () => {
  const root = makeFixture();
  const { stdout, code } = runCli(["review-target", "--resolve", "--issue", "faff-999-nonexistent", "--json"], { cwd: root });
  assert.equal(code, 2, stdout);
  const result = JSON.parse(stdout);
  assert.equal(result.reason, "no-worktree");
});

test("review-target --guard exits 2 (fail-safe refuse) when the target is ambiguous — an --issue was given, so unresolvable is never a no-op", () => {
  const root = makeFixture();
  let wt1, wt2;
  try {
    git(root, "branch", "faff-930-dup-case");
    git(root, "branch", "faff-930-dup-case-extra");
    wt1 = path.join(root, ".worktrees", "faff-930-dup-case");
    wt2 = path.join(root, ".worktrees", "faff-930-dup-case-extra");
    git(root, "worktree", "add", wt1, "faff-930-dup-case");
    git(root, "worktree", "add", wt2, "faff-930-dup-case-extra");

    const { stdout, code } = runCli(["review-target", "--guard", "--issue", "faff-930-dup-case", "--json"], { cwd: root });
    assert.equal(code, 2, stdout);
    const result = JSON.parse(stdout);
    assert.equal(result.reason, "ambiguous-match");
  } finally {
    for (const wt of [wt1, wt2]) if (wt) spawnSync("git", ["-C", root, "worktree", "remove", "--force", wt]);
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("review-target: --resolve and --guard together is a usage error", () => {
  const { code } = runCli(["review-target", "--resolve", "--guard", "--issue", "faff-1"]);
  assert.equal(code, 2);
});

test("review-target --selftest passes its pure formatTarget table", () => {
  const { stdout, code } = runCli(["review-target", "--selftest"]);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /RESULT: PASS/);
});

// AC4's "integration check that the resolved target is non-empty for an admitted issue" — the
// build-lane invariant's own testable half (the dispatch-prompt text itself is asserted by
// review — this proves the resolver it points at actually produces a usable target).
test("review-target --resolve: the resolved target string is always non-empty for a real worktree lane", () => {
  const root = makeFixture();
  const { stubDir, env } = stubGhEnv("[]");
  let worktreePath;
  try {
    git(root, "branch", "faff-957-admitted");
    worktreePath = path.join(root, ".worktrees", "faff-957-admitted");
    git(root, "worktree", "add", worktreePath, "faff-957-admitted");

    const { stdout, code } = runCli(["review-target", "--resolve", "--issue", "faff-957", "--json"], { cwd: root, env });
    assert.equal(code, 0, stdout);
    const result = JSON.parse(stdout);
    assert.ok(result.target && result.target.length > 0, "the resolved target must never be empty for an admitted issue");
  } finally {
    if (worktreePath) spawnSync("git", ["-C", root, "worktree", "remove", "--force", worktreePath]);
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    rmSync(stubDir, { recursive: true, force: true, maxRetries: 3 });
  }
});
