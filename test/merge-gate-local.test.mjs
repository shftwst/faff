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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, basename, dirname } from "node:path";
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

// FAFF-690 (F1): --local now sources the governing level from the committed anchor at the branch head
// (git-show, local object store only — no forge fallback). Commit
// .faff/anchors/<basename(runDir)>/<issue>/run-ledger.json onto the branch under merge (scaffoldRepo
// leaves the repo on `feature`) so the anchor is in that branch's history. Returns the new branch head
// sha (the anchor commit) so callers that assert base-advanced-to-feature-tip re-read it AFTER.
function commitAnchor(repo, runDir, { issue = ISSUE, level = "L3" } = {}) {
  const abs = join(repo, ".faff", "anchors", basename(runDir), issue, "run-ledger.json");
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify({ run_id: basename(runDir), level }));
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "commit anchor");
  return git(repo, "rev-parse", "feature").stdout.trim();
}

// --- the CLI entrypoint dispatches --local correctly, end to end ---

test("CLI: --local on a clean no-remote repo → exit 0, merge-ok, base ref advances, merge-record.json on disk", () => {
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);
  const featureSha = commitAnchor(repo, runDir); // level L3 anchor on feature; new feature tip

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
  commitAnchor(repo, runDir);
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
  commitAnchor(repo, runDir);
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
  commitAnchor(repo, runDir);

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
  commitAnchor(repo, runDir);
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
  commitAnchor(repo, runDir);

  const { code, stdout } = runCli(baseArgs(runDir), { cwd: repo });
  assert.equal(code, 1);
  assert.match(JSON.parse(stdout).blockers.join(" "), /review verdict is fail/);
});

test("CLI: --local twice on an already-merged branch is idempotent (second call exit 0, no double-merge)", () => {
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);
  commitAnchor(repo, runDir);
  const first = runCli(baseArgs(runDir), { cwd: repo });
  assert.equal(first.code, 0);
  const second = runCli(baseArgs(runDir), { cwd: repo });
  assert.equal(second.code, 0);
  assert.equal(JSON.parse(second.stdout).note, "already merged");
});

test("FAFF-690: --local with NO committed anchor on the branch → exit 2 anchor-missing, base ref unchanged (git-show local-only, no fallback)", () => {
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);
  // Deliberately DO NOT commit an anchor — the branch head has no .faff/anchors/…/run-ledger.json.
  const baseBefore = git(repo, "rev-parse", "main").stdout.trim();
  const { code, stderr } = runCli(baseArgs(runDir), { cwd: repo });
  assert.equal(code, 2);
  assert.match(stderr, /no trusted committed anchor level/);
  assert.match(stderr, /anchor-missing/);
  assert.equal(git(repo, "rev-parse", "main").stdout.trim(), baseBefore, "fail-closed: nothing merged");
});

test("FAFF-690: --local with a committed anchor carrying no usable level → exit 2 anchor-malformed", () => {
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);
  // Commit an anchor whose run-ledger.json has no `level` field → level not in FLOOR_LEVELS.
  const abs = join(repo, ".faff", "anchors", basename(runDir), ISSUE, "run-ledger.json");
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify({ run_id: basename(runDir) })); // no level
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "anchor without a level");
  const baseBefore = git(repo, "rev-parse", "main").stdout.trim();
  const { code, stderr } = runCli(baseArgs(runDir), { cwd: repo });
  assert.equal(code, 2);
  assert.match(stderr, /anchor-malformed/);
  assert.equal(git(repo, "rev-parse", "main").stdout.trim(), baseBefore);
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
  commitAnchor(repo, runDir);
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

test("CLI: --local invoked FROM the base worktree itself (via --branch override) → the invoking cwd is never treated as its own peer", () => {
  // Defensive-filter regression (FAFF-545 review finding): baseCheckedOutWorktree() only matches
  // on branch name, so without excluding cwd's own worktree entry first, sitting IN the base
  // worktree and naming a different branch via --branch would make cwd match itself as a "peer"
  // and land through `git -C <cwd> merge --ff-only`, mutating the invoking process's own working
  // tree mid-command. The land step must exclude cwd's own entry BEFORE matching, so this
  // contrived-but-reachable case still lands via the plain update-ref (Case A), not a self-merge.
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);
  const featureSha = commitAnchor(repo, runDir); // anchor on feature (repo still on feature); new tip
  git(repo, "checkout", "-q", "main"); // now sitting ON the base branch itself
  const { code, stdout } = runCli(baseArgs(runDir, ["--branch", "feature"]), { cwd: repo });
  assert.equal(code, 0);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "merge-ok");
  assert.equal(out.merged, true);
  assert.equal(git(repo, "rev-parse", "main").stdout.trim(), featureSha, "base ref must land via update-ref, not a self-merge");
  // cwd's own working tree/HEAD were not touched by a `git merge` invocation — main's checkout
  // still reports whatever a plain update-ref would leave it as (git does NOT auto-refresh the
  // currently-checked-out worktree's index when its own branch ref moves out from under it via
  // update-ref — that is the pre-existing, unrelated-to-this-fix single-worktree caveat; the
  // point under test is that no `git merge` process ran in cwd at all).
});

// --- FAFF-545: worktree-aware land when `base` is checked out in a peer worktree ---

test("CLI: --local when base is checked out in a CLEAN peer worktree → lands via merge --ff-only, peer index stays clean", () => {
  const repo = scaffoldRepo();
  const peerDir = mkTmp("mg-local-peer-");
  rmSync(peerDir, { recursive: true, force: true }); // `git worktree add` requires the target not exist
  git(repo, "worktree", "add", peerDir, "main");
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);
  const featureSha = commitAnchor(repo, runDir); // anchor on feature; new tip

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
  const featureSha = commitAnchor(repo, runDir); // anchor on feature; new tip
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
  commitAnchor(repo, runDir); // anchor on feature before the checkout dance
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
    // Find the admin dir by reading each `.git/worktrees/*/gitdir` file directly (no shelling
    // out to grep — test-hygiene finding from the FAFF-545 adversarial review: avoid string
    // interpolation into a shell command even for controlled mkdtempSync paths).
    const adminRoot = join(repo, ".git", "worktrees");
    for (const id of readdirSync(adminRoot)) {
      const gitdirFile = join(adminRoot, id, "gitdir");
      if (!existsSync(gitdirFile)) continue;
      if (readFileSync(gitdirFile, "utf8").includes(peerDir)) return join(adminRoot, id);
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
  commitAnchor(repo, runDir); // anchor on feature (peer holds main)
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

// --- FAFF-784: custody validation on the --local (git-only) path — the SAME gate, the SAME
// lane-boundary-derived requirement, "no caller opt-out" carried onto the git-only form too. ---

function sha256Hex(bytes) { return createHash("sha256").update(Buffer.from(bytes)).digest("hex"); }

function writeCustodyVerdict(runDir, issue, over = {}) {
  const record = {
    schema_version: 1, run_id: basename(runDir), issue, classification: "clean",
    paths: [], detail: "digest-verified", verified_at: "2026-08-15T00:00:00.000Z",
    merge_state_at_verification: "pre-merge", ...over,
  };
  const dir = join(runDir, issue);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "custody-verdict.json");
  const bytes = JSON.stringify(record);
  writeFileSync(file, bytes);
  return { file, sha256: sha256Hex(bytes) };
}

const custodyArgs = ({ file, sha256 } = {}) => (file ? ["--custody-verdict", file, "--custody-verdict-sha256", sha256] : []);

test("CLI: --local, dispatched (lane-boundary.json under the run-dir) + custody OMITTED → exit 1 refuse, base ref unchanged, no merge-record.json", () => {
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);
  writeFileSync(join(runDir, "lane-boundary.json"), JSON.stringify({ version: 1, lane: "evaluator", container: "own", host: "local", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false }));
  commitAnchor(repo, runDir);
  const baseBefore = git(repo, "rev-parse", "main").stdout.trim();

  const { code, stdout } = runCli(baseArgs(runDir), { cwd: repo });
  assert.equal(code, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "refuse");
  assert.ok(out.blockers.some((b) => /--custody-verdict/.test(b)));
  assert.equal(git(repo, "rev-parse", "main").stdout.trim(), baseBefore, "no merge without custody");
  assert.equal(existsSync(join(runDir, ISSUE, "merge-record.json")), false);
});

test("CLI: --local, dispatched + a VALID exact clean custody verdict → custody passes, lands exactly as the non-dispatched case", () => {
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);
  writeFileSync(join(runDir, "lane-boundary.json"), JSON.stringify({ version: 1, lane: "evaluator", container: "own", host: "local", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false }));
  const featureSha = commitAnchor(repo, runDir);
  const cv = writeCustodyVerdict(runDir, ISSUE);

  const { code, stdout } = runCli(baseArgs(runDir, custodyArgs(cv)), { cwd: repo });
  assert.equal(code, 0, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "merge-ok");
  assert.equal(out.merged, true);
  assert.equal(git(repo, "rev-parse", "main").stdout.trim(), featureSha, "custody-satisfied dispatched merge still lands");
});

test("CLI: --local, dispatched + retained digest MISMATCH (verdict replaced after recording) → exit 1 refuse, base ref unchanged", () => {
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);
  writeFileSync(join(runDir, "lane-boundary.json"), JSON.stringify({ version: 1, lane: "evaluator", container: "own", host: "local", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false }));
  commitAnchor(repo, runDir);
  const baseBefore = git(repo, "rev-parse", "main").stdout.trim();
  const original = writeCustodyVerdict(runDir, ISSUE);
  writeCustodyVerdict(runDir, ISSUE, { detail: "replaced after recording" }); // on-disk bytes now differ

  const { code, stdout } = runCli(baseArgs(runDir, custodyArgs(original)), { cwd: repo });
  assert.equal(code, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "refuse");
  assert.ok(out.blockers.some((b) => /digest mismatch/.test(b)));
  assert.equal(git(repo, "rev-parse", "main").stdout.trim(), baseBefore);
});

test("CLI: --local, an INDETERMINATE (malformed) lane-boundary.json refuses unconditionally, even with a valid custody verdict passed", () => {
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);
  writeFileSync(join(runDir, "lane-boundary.json"), "{not valid json");
  commitAnchor(repo, runDir);
  const baseBefore = git(repo, "rev-parse", "main").stdout.trim();
  const cv = writeCustodyVerdict(runDir, ISSUE);

  const { code, stdout } = runCli(baseArgs(runDir, custodyArgs(cv)), { cwd: repo });
  assert.equal(code, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "refuse");
  assert.ok(out.blockers.some((b) => /indeterminate/.test(b)));
  assert.equal(git(repo, "rev-parse", "main").stdout.trim(), baseBefore);
});

test("CLI: --local, NO lane-boundary.json (interactive / no-dispatch-cut) → existing behaviour unchanged, custody never consulted", () => {
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE); // deliberately no lane-boundary.json
  const featureSha = commitAnchor(repo, runDir);

  const { code, stdout } = runCli(baseArgs(runDir), { cwd: repo }); // no custody args either
  assert.equal(code, 0);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "merge-ok");
  assert.equal(git(repo, "rev-parse", "main").stdout.trim(), featureSha);
});

test("CLI: --local, an already-merged branch + custody OMITTED on a dispatched run → merged:true, refuse (never an unqualified merge-ok)", () => {
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);
  writeFileSync(join(runDir, "lane-boundary.json"), JSON.stringify({ version: 1, lane: "evaluator", container: "own", host: "local", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false }));
  commitAnchor(repo, runDir);
  // Land the branch first WITH valid custody (a legitimate prior merge)...
  const cv = writeCustodyVerdict(runDir, ISSUE);
  const first = runCli(baseArgs(runDir, custodyArgs(cv)), { cwd: repo });
  assert.equal(first.code, 0);
  // ...then re-invoke with custody OMITTED on the now-already-merged branch.
  const second = runCli(baseArgs(runDir), { cwd: repo });
  assert.equal(second.code, 1);
  const out = JSON.parse(second.stdout);
  assert.equal(out.verdict, "refuse");
  assert.equal(out.merged, true, "the branch IS merged — custody is simply not re-provable on this call");
});

// --- FAFF-784 regression: merge-fence continues to deny a raw local merge attempt on a dispatched
// run whose custody would otherwise refuse — the sanctioned `faff merge-gate --local` path is not
// the only enforcement; a same-uid actor cannot route around custody by shelling raw `git merge`. ---

test("FAFF-784: raw `git merge` is still denied by merge-fence on a repo carrying a dispatched (lane-boundary.json) run whose custody has not been recorded", () => {
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedRunDir(runDir, ISSUE);
  writeFileSync(join(runDir, "lane-boundary.json"), JSON.stringify({ version: 1, lane: "evaluator", container: "own", host: "local", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false }));
  git(repo, "checkout", "-q", "main"); // sitting ON the base branch
  const { code, stderr } = runCli(["merge-fence", "--hook"], { input: fenceEvent("git merge feature", repo) });
  assert.equal(code, 2, "merge-fence denies the raw merge regardless of custody state — it never even reads lane-boundary.json");
  assert.match(stderr, /faff merge-gate --local/);
});

// --- FAFF-892: the merge-floor corrective-integrity leg admits the digest-verified custody basis ---
// Joint acceptance gate with FAFF-893 (the producer): at L4 with honest-absence (no
// FAFF_INTEGRITY_BOUNDARY in this env), a clean per-issue custody verdict GRANTS the integrity leg
// (custody-trusted), so a runbook-correct L4 --local run merges; absent/tampered custody still refuses.

// Stage an L4 run with every non-integrity floor leg green (AC, review, and a fresh meets-spec holdout),
// so the corrective-integrity leg is the sole variable the custody flags move.
function seedL4RunGreen(runDir, issue) {
  seedRunDir(runDir, issue); // ac-checklist verified + review-verdict pass
  const issueDir = join(runDir, issue);
  // build-progress checkpoint with an OLD updated_at so the holdout (written now) reads fresh.
  writeFileSync(join(issueDir, "build-progress.json"), JSON.stringify({ updated_at: "2020-01-01T00:00:00.000Z", build: { pushed_at: "2020-01-01T00:00:00.000Z" } }));
  // conformant code-blind meets-spec holdout (written last ⇒ mtime > the checkpoint timestamp)
  writeFileSync(join(issueDir, "holdout.json"), JSON.stringify({
    aggregate: "meets-spec", code_blind: true,
    criteria: [{ class: "assertion", verdict: "met", evidence_present: true }],
    violations: [],
  }));
}

// A schema-clean custody-verdict.json at the canonical per-issue path + its sha256 (matching custodyHashBytes).
function writeCleanCustodyVerdict(runDir, issue) {
  const record = JSON.stringify({
    schema_version: 1, run_id: basename(runDir), issue,
    verified_at: "2026-08-20T00:00:00.000Z", merge_state_at_verification: "pre-merge",
    classification: "clean", paths: [], detail: "digest-verified — no diffs against the held manifest",
  });
  const p = join(runDir, issue, "custody-verdict.json");
  writeFileSync(p, record);
  return { path: p, sha: createHash("sha256").update(record, "utf8").digest("hex") };
}

const l4Args = (runDir, extra = []) => ["merge-gate", "--local", "--issue", ISSUE, "--run-dir", runDir, "--level", "L4", "--json", ...extra];

test("FAFF-892: L4 --local, honest-absence + clean per-issue custody verdict → integrity GRANTS (custody-trusted), merge-ok", () => {
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedL4RunGreen(runDir, ISSUE);
  const { path: vp, sha } = writeCleanCustodyVerdict(runDir, ISSUE);
  commitAnchor(repo, runDir, { level: "L4" });
  const { code, stdout } = runCli(l4Args(runDir, ["--custody-verdict", vp, "--custody-verdict-sha256", sha]), { cwd: repo });
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "merge-ok", `expected merge-ok, got ${stdout}`);
  assert.equal(out.integrity, "custody-trusted", "the merge record annotates the truthful digest basis, not asserted/unasserted");
  assert.equal(code, 0);
});

test("FAFF-892: L4 --local, honest-absence + NO custody verdict → integrity refuses (unasserted-refuse), unchanged", () => {
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedL4RunGreen(runDir, ISSUE);
  commitAnchor(repo, runDir, { level: "L4" });
  const { code, stdout } = runCli(l4Args(runDir), { cwd: repo });
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "refuse");
  assert.ok(out.blockers.some((b) => /corrective-artifact integrity unasserted at L4/.test(b)), `expected the integrity blocker, got ${JSON.stringify(out.blockers)}`);
  assert.equal(code, 1);
});

test("FAFF-892: L4 --local, custody verdict bytes altered after recording (sha mismatch) → integrity refuses, never grants", () => {
  const repo = scaffoldRepo();
  const runDir = mkTmp("mg-local-run-");
  seedL4RunGreen(runDir, ISSUE);
  const { path: vp } = writeCleanCustodyVerdict(runDir, ISSUE);
  commitAnchor(repo, runDir, { level: "L4" });
  // pass a stale/wrong retained sha ⇒ computeCustodyVerdictAdmission digest-mismatch ⇒ error arm ⇒ refuse
  const { code, stdout } = runCli(l4Args(runDir, ["--custody-verdict", vp, "--custody-verdict-sha256", "0".repeat(64)]), { cwd: repo });
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "refuse");
  assert.notEqual(out.integrity, "custody-trusted");
  assert.equal(code, 1);
});
