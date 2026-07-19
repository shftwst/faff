// FAFF-526 — merge-gate --local CLI-boundary tests (the git-only branch of the merge locus).
//
// mergeGateSelftest (merge-gate.js) already drives cmdMergeGateLocal in-process against real
// scaffolded git repos; this file is the CLI-BOUNDARY sibling — it spawns the REAL `faff`
// entrypoint (runCli) against real git repos on disk, exercising arg parsing / dispatch / exit
// codes / --json shape exactly as an operator or graft would invoke it. No `gh` stub is needed
// (git-only mode never shells out to `gh`) — the fixture is a real `git init` repo, mirroring
// merge-gate-controlflow.test.mjs's "assert at the CLI seam" stance for the PR path.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const { baseCheckedOutWorktree } = require("../plugin/skills/faff/bin/lib/merge-gate.js");

const tmpDirs = [];
const mkTmp = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); tmpDirs.push(d); return d; };
after(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

const git = (cwd, ...args) => spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

// Scaffold a no-remote repo with a declared `test` script (pass/fail controlled by the script body)
// and a `feature` branch one commit ahead of `main`. Optionally add a remote to exercise the
// bypass-guard, or omit the package.json entirely to exercise discovery:none.
function scaffoldRepo({ testScript = "true", withRemote = false } = {}) {
  const dir = mkTmp("mg-local-repo-");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@t.t");
  git(dir, "config", "user.name", "t");
  if (testScript !== null) {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: testScript } }));
  } else {
    writeFileSync(join(dir, "README.md"), "no gates declared\n");
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base");
  git(dir, "checkout", "-qb", "feature");
  writeFileSync(join(dir, "feature.txt"), "x");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "feature work");
  if (withRemote) {
    const bare = mkTmp("mg-local-remote-");
    git(mkTmp("mg-local-init-"), "init", "-q", "--bare", bare);
    git(dir, "remote", "add", "origin", bare);
  }
  return dir;
}

function seedRunDir(runDir, issue, { acVerified = true, reviewSignal = "pass" } = {}) {
  const issueDir = join(runDir, issue);
  mkdirSync(issueDir, { recursive: true });
  writeFileSync(join(issueDir, "ac-checklist.json"), JSON.stringify({ all_verified: acVerified }));
  writeFileSync(join(issueDir, "review-verdict.json"), JSON.stringify({ signal: reviewSignal, findings: [] }));
}

const ISSUE = "FAFF-526";
const baseArgs = (runDir, extra = []) => ["merge-gate", "--local", "--issue", ISSUE, "--run-dir", runDir, "--level", "L3", "--json", ...extra];

// --- the CLI entrypoint dispatches --local correctly, end to end ---

test("CLI: --local on a clean no-remote repo → exit 0, merge-ok, base ref advances, merge-record.json on disk", () => {
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);
  const featureSha = git(repo, "rev-parse", "feature").stdout.trim();

  const { code, stdout } = runCli(baseArgs(runDir), { cwd: repo });
  assert.equal(code, 0);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "merge-ok");
  assert.equal(out.merged, true);
  assert.equal(out.head_sha, featureSha);

  assert.equal(git(repo, "rev-parse", "main").stdout.trim(), featureSha, "base ref must land on the feature tip");
  const record = JSON.parse(readFileSync(join(runDir, ISSUE, "merge-record.json"), "utf8"));
  assert.equal(record.head_sha, featureSha);
  assert.equal(record.pr, 0, "no PR in git-only mode — the null-coerced sentinel");
  assert.equal(record.merged, true);
});

test("CLI: --local via --check-only never lands the merge (base ref unchanged)", () => {
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);
  const baseBefore = git(repo, "rev-parse", "main").stdout.trim();

  const { code, stdout } = runCli(baseArgs(runDir, ["--check-only"]), { cwd: repo });
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).verdict, "merge-ok");
  assert.equal(git(repo, "rev-parse", "main").stdout.trim(), baseBefore, "--check-only must never merge");
  assert.equal(existsSync(join(runDir, ISSUE, "merge-record.json")), false);
});

test("CLI: --local on a repo WITH a remote → exit 2 (bypass-guard), base ref unchanged, no merge-record.json", () => {
  const repo = scaffoldRepo({ withRemote: true });
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);
  const baseBefore = git(repo, "rev-parse", "main").stdout.trim();

  const { code, stderr } = runCli(baseArgs(runDir), { cwd: repo });
  assert.equal(code, 2);
  assert.match(stderr, /repo has a remote/);
  assert.equal(git(repo, "rev-parse", "main").stdout.trim(), baseBefore);
  assert.equal(existsSync(join(runDir, ISSUE, "merge-record.json")), false);
});

test("CLI: --local with a failing declared gate → exit 1 refuse, ci_state ci-red, nothing merged", () => {
  const repo = scaffoldRepo({ testScript: "false" });
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);
  const baseBefore = git(repo, "rev-parse", "main").stdout.trim();

  const { code, stdout } = runCli(baseArgs(runDir), { cwd: repo });
  assert.equal(code, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "refuse");
  assert.equal(out.ci_state, "ci-red");
  assert.equal(git(repo, "rev-parse", "main").stdout.trim(), baseBefore);
});

test("CLI: --local with no declared gates (discovery:none) → exit 1 refuse, ci_state no-ci-coverage (fail-closed default)", () => {
  const repo = scaffoldRepo({ testScript: null });
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);

  const { code, stdout } = runCli(baseArgs(runDir), { cwd: repo });
  assert.equal(code, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "refuse");
  assert.equal(out.ci_state, "no-ci-coverage");
});

test("CLI: --local with AC not verified → exit 1 refuse, base ref unchanged", () => {
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE, { acVerified: false });
  const baseBefore = git(repo, "rev-parse", "main").stdout.trim();

  const { code, stdout } = runCli(baseArgs(runDir), { cwd: repo });
  assert.equal(code, 1);
  assert.match(JSON.parse(stdout).blockers.join(" "), /ACs not all verified/);
  assert.equal(git(repo, "rev-parse", "main").stdout.trim(), baseBefore);
});

test("CLI: --local with a non-pass review verdict → exit 1 refuse", () => {
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE, { reviewSignal: "fail" });

  const { code, stdout } = runCli(baseArgs(runDir), { cwd: repo });
  assert.equal(code, 1);
  assert.match(JSON.parse(stdout).blockers.join(" "), /review verdict is fail/);
});

test("CLI: --local twice on an already-merged branch is idempotent (second call exit 0, no double-merge)", () => {
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);
  const first = runCli(baseArgs(runDir), { cwd: repo });
  assert.equal(first.code, 0);
  const second = runCli(baseArgs(runDir), { cwd: repo });
  assert.equal(second.code, 0);
  assert.equal(JSON.parse(second.stdout).note, "already merged");
});

test("CLI: --local requires --issue and --run-dir (usage exit 2)", () => {
  const repo = scaffoldRepo();
  const { code, stderr } = runCli(["merge-gate", "--local", "--json"], { cwd: repo });
  assert.equal(code, 2);
  assert.match(stderr, /--issue and --run-dir are required/);
});

test("CLI: --local ignores/does not require --pr (no PR flag passed, still dispatches to the local branch)", () => {
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);
  // Deliberately omit --pr entirely — the PR-path's own "--pr required" usage error must NOT fire.
  const { code, stderr } = runCli(baseArgs(runDir), { cwd: repo });
  assert.equal(code, 0);
  assert.doesNotMatch(stderr, /--pr, --issue and --run-dir are required/);
});

// --- FAFF-545: baseCheckedOutWorktree — pure helper unit coverage ---

test("baseCheckedOutWorktree: base checked out nowhere → null (Case A)", () => {
  const entries = [{ path: "/a", branch: "feature" }, { path: "/b", branch: null }];
  assert.equal(baseCheckedOutWorktree(entries, "main"), null);
});

test("baseCheckedOutWorktree: base checked out in exactly one peer → returns that entry (Case B)", () => {
  const peer = { path: "/peer", branch: "main" };
  const entries = [{ path: "/a", branch: "feature" }, peer];
  assert.deepEqual(baseCheckedOutWorktree(entries, "main"), peer);
});

test("baseCheckedOutWorktree: base checked out in >1 worktree → { anomaly: true }", () => {
  const entries = [{ path: "/a", branch: "main" }, { path: "/b", branch: "main" }];
  assert.deepEqual(baseCheckedOutWorktree(entries, "main"), { anomaly: true });
});

// --- FAFF-545: worktree-aware land when `base` is checked out in a peer worktree ---

test("CLI: --local when base is checked out in a CLEAN peer worktree → lands via merge --ff-only, peer index stays clean", () => {
  const repo = scaffoldRepo();
  const peerDir = mkTmp("mg-local-peer-");
  rmSync(peerDir, { recursive: true, force: true }); // `git worktree add` requires the target not exist
  git(repo, "worktree", "add", peerDir, "main");
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);
  const featureSha = git(repo, "rev-parse", "feature").stdout.trim();

  const { code, stdout } = runCli(baseArgs(runDir), { cwd: repo });
  assert.equal(code, 0);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "merge-ok");
  assert.equal(out.merged, true);
  assert.equal(out.head_sha, featureSha);

  // The base ref advanced...
  assert.equal(git(repo, "rev-parse", "main").stdout.trim(), featureSha);
  // ...AND the peer worktree's HEAD + index are consistent — no phantom staged-deletes.
  assert.equal(git(peerDir, "rev-parse", "HEAD").stdout.trim(), featureSha);
  assert.equal(git(peerDir, "status", "--porcelain").stdout.trim(), "", "peer worktree must report a clean status post-merge");

  const record = JSON.parse(readFileSync(join(runDir, ISSUE, "merge-record.json"), "utf8"));
  assert.equal(record.head_sha, featureSha);
  assert.equal(record.merged, true);
});

test("CLI: --local single-worktree regression — base checked out nowhere else still lands via update-ref (byte-for-byte unchanged)", () => {
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);
  const featureSha = git(repo, "rev-parse", "feature").stdout.trim();
  const baseBefore = git(repo, "rev-parse", "main").stdout.trim();
  assert.notEqual(baseBefore, featureSha);

  const { code, stdout } = runCli(baseArgs(runDir), { cwd: repo });
  assert.equal(code, 0);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "merge-ok");
  assert.equal(out.merged, true);
  assert.equal(git(repo, "rev-parse", "main").stdout.trim(), featureSha, "base ref must land via update-ref exactly as before");
});

test("CLI: --local when base is checked out in MORE THAN ONE peer worktree → refuses (exit 1) with a naming blocker", () => {
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);
  const baseBefore = git(repo, "rev-parse", "main").stdout.trim();

  // Git normally refuses to check the same branch out twice — fake the anomaly the same way the
  // underlying bug class arises (a direct filesystem write bypassing git's checkout guard) so the
  // anomaly branch is exercised at the CLI boundary, not just via the pure-helper unit test above.
  git(repo, "checkout", "-qb", "throwaway1");
  git(repo, "checkout", "-q", "feature");
  git(repo, "checkout", "-qb", "throwaway2");
  git(repo, "checkout", "-q", "feature");
  const peer1 = mkTmp("mg-local-anomaly1-"); rmSync(peer1, { recursive: true, force: true });
  const peer2 = mkTmp("mg-local-anomaly2-"); rmSync(peer2, { recursive: true, force: true });
  git(repo, "worktree", "add", peer1, "throwaway1");
  git(repo, "worktree", "add", peer2, "throwaway2");
  const idFor = (peerDir) => {
    const list = git(repo, "worktree", "list", "--porcelain").stdout;
    const lines = list.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === `worktree ${peerDir}`) {
        // find the admin dir by matching gitdir file contents under .git/worktrees/*
        const admin = spawnSync("bash", ["-c", `grep -rl "${peerDir}" ${join(repo, ".git", "worktrees")}/*/gitdir 2>/dev/null | head -1`], { encoding: "utf8" }).stdout.trim();
        return admin ? admin.replace(/\/gitdir$/, "") : null;
      }
    }
    return null;
  };
  const admin1 = idFor(peer1);
  const admin2 = idFor(peer2);
  assert.ok(admin1 && admin2, "expected to resolve both peers' git admin dirs");
  writeFileSync(join(admin1, "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(admin2, "HEAD"), "ref: refs/heads/main\n");

  const { code, stdout } = runCli(baseArgs(runDir), { cwd: repo });
  assert.equal(code, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "refuse");
  assert.equal(out.merged, false);
  assert.match(out.blockers.join(" "), /checked out in multiple worktrees/);
  assert.equal(git(repo, "rev-parse", "main").stdout.trim(), baseBefore, "base ref must be unmodified on refuse");
});

test("CLI: --local when base is checked out in a DIRTY peer worktree → refuses (exit 1), neither base ref nor peer worktree modified", () => {
  const repo = scaffoldRepo();
  const peerDir = mkTmp("mg-local-peer-");
  rmSync(peerDir, { recursive: true, force: true });
  git(repo, "worktree", "add", peerDir, "main");
  writeFileSync(join(peerDir, "uncommitted.txt"), "dirty");
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);
  const baseBefore = git(repo, "rev-parse", "main").stdout.trim();
  const peerHeadBefore = git(peerDir, "rev-parse", "HEAD").stdout.trim();

  const { code, stdout } = runCli(baseArgs(runDir), { cwd: repo });
  assert.equal(code, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "refuse");
  assert.equal(out.merged, false);
  assert.match(out.blockers.join(" "), new RegExp(peerDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.equal(git(repo, "rev-parse", "main").stdout.trim(), baseBefore, "base ref must be unmodified on refuse");
  assert.equal(git(peerDir, "rev-parse", "HEAD").stdout.trim(), peerHeadBefore, "peer worktree HEAD must be unmodified on refuse");
  assert.equal(existsSync(join(peerDir, "uncommitted.txt")), true, "peer worktree's uncommitted file must survive the refuse");
});

// --- merge-fence: the no-remote-gated raw base-branch mutation wall, driven via its --hook CLI surface ---

function fenceEvent(command, cwd) {
  return JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd });
}

test("CLI: merge-fence --hook denies a raw `git merge <feature>` while sitting on the base branch of a no-remote repo", () => {
  const repo = scaffoldRepo();
  git(repo, "checkout", "-q", "main"); // sitting ON the base branch
  const { code, stderr } = runCli(["merge-fence", "--hook"], { input: fenceEvent("git merge feature", repo) });
  assert.equal(code, 2);
  assert.match(stderr, /faff merge-gate --local/);
});

test("CLI: merge-fence --hook ALLOWS `git merge <base>` run from a feature branch (base-branch consumption)", () => {
  const repo = scaffoldRepo();
  // already on `feature` after scaffoldRepo()
  const { code } = runCli(["merge-fence", "--hook"], { input: fenceEvent("git merge main", repo) });
  assert.equal(code, 0);
});

test("CLI: merge-fence --hook is a no-op on a repo WITH a remote (matcher dormant)", () => {
  const repo = scaffoldRepo({ withRemote: true });
  git(repo, "checkout", "-q", "main");
  const { code } = runCli(["merge-fence", "--hook"], { input: fenceEvent("git merge feature", repo) });
  assert.equal(code, 0);
});
