// FAFF-1087 — end-to-end integration coverage for the two IMPURE git-mutation functions in the
// dependency-stacking interlock: boundedRebaseOntoMain and dependencyInterlock (merge-gate.js).
// FAFF-1077 unit-covers the pure seams (classifyDependencyGate, readStackAnchor, the additive
// decideFloor leg); this file drives the real git operations those pure seams compose, against a
// real two-branch stack with a real bare-remote and a stubbed gh.
//
// Coverage split (spec §3): direct function calls are the primary vehicle for the squash-safe
// property, the one-shot conflict, and the check-only/execute fork (minimal stub surface, precise
// assertions); one full-CLI `faff merge-gate --execute` test proves the never-merge-before-B
// ordering end-to-end (the additive dependency_gate leg refuses D while B is OPEN, and flips to
// satisfied once B is MERGED). It asserts only the presence/absence of the stacked-dependency
// blocker and the merge sentinel, never an all-green floor.
//
// Shard-safety (docs/reference/docker-gated-tests.md): every repo / bare-remote / stub / subprocess
// is built INSIDE a test body — only cheap constants sit at module scope. No docker probe is added.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runCli } from "./helpers/run-cli.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const libDir = resolve(here, "..", "plugin", "skills", "faff", "bin", "lib");
const mergeGatePath = join(libDir, "merge-gate.js");

const tmpDirs = [];
const mkTmp = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); tmpDirs.push(d); return d; };
after(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

const git = (cwd, ...args) => spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
const gitOut = (cwd, ...args) => { const r = git(cwd, ...args); return r.status === 0 ? (r.stdout || "").trim() : null; };

// The real git absolute path, captured with the un-shadowed PATH before any stub is installed — so
// the git-argv recording shim below can exec the real binary while shadowing `git` on PATH.
function realGitPath() {
  const r = spawnSync("bash", ["-c", "command -v git"], { encoding: "utf8" });
  return (r.stdout || "").trim();
}

// Build a genuine two-branch stack on a filesystem bare-remote (the FAFF-1077 scaffoldRepoWithRemote
// pattern, extended to two divergent branches + a committed stack anchor). D is branched off B's
// PINNED tip, so D's history carries B's own commit(s) underneath D's — the real precondition the
// squash-safe rebase must handle. Options let a caller vary D's file (a d.txt-only build never
// conflicts with a b.txt squash; a b.txt-editing build does) and whether the level-anchor
// (run-ledger.json, for the full-CLI resolveAnchorLevel path) is committed alongside the stack anchor.
function buildStack({ issue = "FAFF-D", runId = "run-x", dBranch = "faff-d", bBranch = "faff-b", dPr = 42, bPr = 7, dModifiesB = false, withLevelAnchor = false } = {}) {
  const dir = mkTmp("faff-1087-repo-");
  const bare = mkTmp("faff-1087-remote-");
  git(mkTmp("faff-1087-bareinit-"), "init", "-q", "-b", "main", "--bare", bare);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@t.t");
  git(dir, "config", "user.name", "t");
  writeFileSync(join(dir, "README.md"), "seed\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base");
  git(dir, "remote", "add", "origin", bare);
  git(dir, "push", "-q", "origin", "main");

  // Dependency branch B: introduce b.txt with its own commit, push, and PIN its tip.
  git(dir, "checkout", "-q", "-b", bBranch);
  writeFileSync(join(dir, "b.txt"), "L1\nL2\nL3\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "B work: add b.txt");
  git(dir, "push", "-q", "origin", bBranch);
  const pinnedTip = gitOut(dir, "rev-parse", "HEAD");
  const bOriginalSha = pinnedTip; // B's own pre-squash commit sha

  // Dependent branch D off B's pinned tip: its own commit (d.txt, or a b.txt edit for the conflict
  // case), then the committed stack anchor (+ optionally the level-anchor).
  git(dir, "checkout", "-q", "-b", dBranch, pinnedTip);
  if (dModifiesB) {
    writeFileSync(join(dir, "b.txt"), "L1\nD2\nL3\n"); // D edits line 2 — collides with a squash that also edits line 2
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "D work: edit b.txt line 2");
  } else {
    writeFileSync(join(dir, "d.txt"), "d1\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "D work: add d.txt");
  }
  const anchorRel = join(".faff", "anchors", runId, issue);
  const anchorDirAbs = join(dir, anchorRel);
  mkdirSync(anchorDirAbs, { recursive: true });
  writeFileSync(join(anchorDirAbs, "stack-parent.json"), JSON.stringify({
    dependent: issue, parent_issue: "FAFF-B", parent_pr: bPr, parent_branch: bBranch, parent_tip_sha: pinnedTip, stacked_at: "2026-09-28T00:00:00Z",
  }) + "\n");
  if (withLevelAnchor) {
    writeFileSync(join(anchorDirAbs, "run-ledger.json"), JSON.stringify({ run_id: runId, level: "L3", admitted: [issue], outcomes: {} }) + "\n");
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "D anchor");
  git(dir, "push", "-q", "origin", dBranch);
  const dHeadBefore = gitOut(dir, "rev-parse", "HEAD");

  return { dir, bare, pinnedTip, bOriginalSha, dHeadBefore, dBranch, bBranch, issue, runId, dPr, bPr };
}

// Land B's forge SQUASH-merge on the bare-remote's main: a SINGLE new commit carrying b.txt's content,
// never a fast-forward or merge of B's original commits — so B's original SHAs are absent from
// post-merge main (the property the rebase must survive). `conflicting` edits line 2 differently from
// D, forcing the single rebase --onto attempt to conflict.
function squashBOntoMain(stack, { conflicting = false } = {}) {
  const { dir, dBranch } = stack;
  git(dir, "checkout", "-q", "main");
  writeFileSync(join(dir, "b.txt"), conflicting ? "L1\nS2\nL3\n" : "L1\nL2\nL3\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "squash-merge B (single commit)");
  git(dir, "push", "-q", "origin", "main");
  const squashSha = gitOut(dir, "rev-parse", "HEAD");
  git(dir, "checkout", "-q", dBranch); // leave the repo on D, as the merge locus expects
  return { squashSha };
}

// A two-PR gh stub that discriminates on the PR-number argument ($3), serving D's and B's states
// independently in one run — the load-bearing extension over the shared single-PR STUB_GH. D's PR
// emits the {headRefOid,headRefName,state,url} shape cmdMergeGate reads; B's PR emits the
// {state,mergeCommit} shape observeForgeMerge parses. It answers repo view, pr checks and the CI api
// probes so nothing falls through, records `pr merge` argv to a sentinel, and exits non-zero on an
// unhandled subcommand. NOTE: this is self-contained here — the shared STUB_GH in
// merge-gate-controlflow.test.mjs is left untouched.
const TWO_PR_STUB_GH = `#!/usr/bin/env bash
case "$1" in
  repo)
    [ "$2" = "view" ] && { printf '{"nameWithOwner":"%s"}' "$STUB_REPO"; exit 0; } ;;
  pr)
    case "$2" in
      view)
        case "$3" in
          "$STUB_D_PR") printf '{"headRefOid":"%s","headRefName":"%s","state":"OPEN","url":"https://example.test/pr/%s"}' "$STUB_D_HEAD" "$STUB_D_BRANCH" "$3"; exit 0 ;;
          "$STUB_B_PR")
            if [ "$STUB_B_STATE" = "MERGED" ]; then
              printf '{"state":"MERGED","mergeCommit":{"oid":"%s"}}' "$STUB_B_MERGE_SHA"
            else
              printf '{"state":"%s","mergeCommit":null}' "$STUB_B_STATE"
            fi
            exit 0 ;;
          *) printf 'stub gh: unknown pr number: %s\\n' "$3" >&2; exit 3 ;;
        esac ;;
      checks) printf '[]'; exit 0 ;;
      merge)  printf '%s' "$*" > "$STUB_MERGE_SENTINEL"; exit 0 ;;
    esac ;;
  api)
    case "$*" in
      *check-runs*) printf '%s' "$STUB_CHECK_RUNS"; exit 0 ;;
      *status*)     printf '%s' "$STUB_STATUS"; exit 0 ;;
      *contents*)   printf '%s' "$STUB_ANCHOR_CONTENT"; exit 0 ;;
    esac ;;
esac
printf 'stub gh: unhandled subcommand: %s\\n' "$*" >&2
exit 3
`;

function writeGhStub({ dPr, bPr, dHead, dBranch, bState, bMergeSha = "", checkRuns = "[]", status = '{"state":"pending","count":0}' } = {}) {
  const stubDir = mkTmp("faff-1087-gh-");
  const ghPath = join(stubDir, "gh");
  writeFileSync(ghPath, TWO_PR_STUB_GH);
  chmodSync(ghPath, 0o755);
  const sentinel = join(stubDir, "merge-sentinel");
  const env = {
    ...process.env,
    PATH: `${stubDir}:${process.env.PATH}`,
    STUB_REPO: "owner/repo",
    STUB_D_PR: String(dPr),
    STUB_B_PR: String(bPr),
    STUB_D_HEAD: dHead,
    STUB_D_BRANCH: dBranch,
    STUB_B_STATE: bState,
    STUB_B_MERGE_SHA: bMergeSha,
    STUB_CHECK_RUNS: checkRuns,
    STUB_STATUS: status,
    STUB_MERGE_SENTINEL: sentinel,
    STUB_ANCHOR_CONTENT: JSON.stringify({ type: "file", encoding: "base64", content: Buffer.from(JSON.stringify({ run_id: "run-x", level: "L3" })).toString("base64") }),
  };
  return { env, sentinel, stubDir };
}

// === Squash-safe rebase — the highest-risk mechanic, proven empirically ===

test("boundedRebaseOntoMain: after B squash-merges, D rebases --onto main carrying ONLY D's own commits (squash-safe)", async () => {
  const { boundedRebaseOntoMain } = await import(mergeGatePath);
  const stack = buildStack({ dModifiesB: false });
  const { squashSha } = squashBOntoMain(stack, { conflicting: false });
  const { dir, pinnedTip, bOriginalSha, dHeadBefore, dBranch } = stack;

  // Record the git argv (proves --force-with-lease, never a bare --force) via a PATH shim active
  // only around this call. The shim execs the real git so the operations really happen.
  const shimDir = mkTmp("faff-1087-gitshim-");
  const argvLog = join(shimDir, "git-argv.log");
  const real = realGitPath();
  writeFileSync(join(shimDir, "git"), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${argvLog}"\nexec "${real}" "$@"\n`);
  chmodSync(join(shimDir, "git"), 0o755);

  const savedPath = process.env.PATH;
  let result;
  try {
    process.env.PATH = `${shimDir}:${savedPath}`;
    result = boundedRebaseOntoMain(dir, { parent_tip_sha: pinnedTip }, dHeadBefore);
  } finally {
    process.env.PATH = savedPath;
  }

  assert.equal(result.outcome, "ok", "a clean squash-safe rebase returns ok");
  assert.notEqual(result.headSha, dHeadBefore, "the rebase advanced D's head onto the new main");

  // Assert the REBASED COMMIT TREE (git show HEAD:<path>), not the working directory.
  assert.equal(gitOut(dir, "show", "HEAD:d.txt"), "d1", "D's own file is present in the rebased tree");
  assert.equal(gitOut(dir, "show", "HEAD:b.txt"), "L1\nL2\nL3", "the squashed b.txt content is present, replayed from origin/main");

  // D's rebased history above origin/main is EXACTLY D's own commits (the d.txt commit + the anchor
  // commit) — no B pre-squash commit rides along.
  const above = gitOut(dir, "log", "--format=%s", "origin/main..HEAD").split("\n").filter(Boolean);
  assert.deepEqual(above, ["D anchor", "D work: add d.txt"], "only D's own commits sit above the squashed main");
  assert.equal(git(dir, "merge-base", "--is-ancestor", bOriginalSha, "origin/main").status !== 0, true, "B's original pre-squash commit is NOT an ancestor of the squashed main");

  // The push landed on origin/D, and it used --force-with-lease, never a bare --force.
  assert.equal(gitOut(dir, "rev-parse", `origin/${dBranch}`), result.headSha, "origin/D advanced to the rebased head (force-push landed)");
  const argv = readFileSync(argvLog, "utf8");
  assert.match(argv, /push .*--force-with-lease/, "the force-push carried --force-with-lease");
  assert.equal(/push[^\n]*--force(?!-with-lease)/.test(argv), false, "the force-push never used a bare --force");
});

// === One-shot conflict — a single rebase attempt, aborted, never retried ===

test("boundedRebaseOntoMain: a same-line conflict aborts the single rebase attempt and never force-pushes", async () => {
  const { boundedRebaseOntoMain } = await import(mergeGatePath);
  const stack = buildStack({ dModifiesB: true }); // D edits b.txt line 2
  squashBOntoMain(stack, { conflicting: true });   // main's squash edits b.txt line 2 differently
  const { dir, pinnedTip, dHeadBefore, dBranch } = stack;
  const originDBefore = gitOut(dir, "rev-parse", `origin/${dBranch}`);

  const result = boundedRebaseOntoMain(dir, { parent_tip_sha: pinnedTip }, dHeadBefore);

  assert.equal(result.outcome, "conflict", "an overlapping conflict returns conflict, not ok");
  assert.equal(existsSync(join(dir, ".git", "rebase-merge")), false, "the rebase was aborted — no in-progress rebase-merge state");
  assert.equal(existsSync(join(dir, ".git", "rebase-apply")), false, "the rebase was aborted — no in-progress rebase-apply state");
  assert.equal(gitOut(dir, "status", "--porcelain"), "", "the working tree is clean after the abort");
  assert.equal(gitOut(dir, "rev-parse", "HEAD"), dHeadBefore, "D's branch is unchanged from before — one attempt, no retry");
  assert.equal(gitOut(dir, "rev-parse", `origin/${dBranch}`), originDBefore, "no force-push landed on the remote after the conflict");
});

// === Check-only vs execute fork — a preview never touches D's branch ===

test("dependencyInterlock: check-only (mutate:false) with a MERGED dependency reports satisfied and never touches D's branch", async () => {
  const { dependencyInterlock } = await import(mergeGatePath);
  const stack = buildStack({ dModifiesB: false });
  const { dir, dHeadBefore, dBranch, runId, issue, bPr } = stack;
  const originDBefore = gitOut(dir, "rev-parse", `origin/${dBranch}`);
  const runDir = join(mkTmp("faff-1087-run-"), runId); // basename(runDir) === runId, matching the committed anchor path

  const { env } = writeGhStub({ dPr: 42, bPr, dHead: dHeadBefore, dBranch, bState: "MERGED", bMergeSha: "f".repeat(40) });
  // dependencyInterlock shells gh IN-PROCESS (observeForgeMerge → spawnSync inherits process.env),
  // so shadow BOTH the PATH and the STUB_* vars the stub reads for the duration of the call.
  const stubKeys = ["PATH", "STUB_REPO", "STUB_D_PR", "STUB_B_PR", "STUB_D_HEAD", "STUB_D_BRANCH", "STUB_B_STATE", "STUB_B_MERGE_SHA", "STUB_CHECK_RUNS", "STUB_STATUS", "STUB_MERGE_SENTINEL", "STUB_ANCHOR_CONTENT"];
  const saved = {};
  for (const k of stubKeys) saved[k] = process.env[k];
  let preview;
  try {
    for (const k of stubKeys) if (env[k] !== undefined) process.env[k] = env[k];
    preview = dependencyInterlock({ cwd: dir, runDir, issue, headSha: dHeadBefore, mutate: false });
  } finally {
    for (const k of stubKeys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }

  assert.equal(preview.gate, "satisfied", "a MERGED dependency previews as satisfied");
  assert.equal(preview.headSha, null, "check-only advances no head — no rebase ran");
  assert.equal(gitOut(dir, "rev-parse", "HEAD"), dHeadBefore, "D's local branch tip is unchanged by a preview");
  assert.equal(gitOut(dir, "rev-parse", `origin/${dBranch}`), originDBefore, "origin/D is unchanged by a preview (no force-push)");
});

// === Never-merge-before-B ordering, driven end-to-end through faff merge-gate ===

test("faff merge-gate --execute: refuses D while B's PR is OPEN, and the dependency blocker clears once B is MERGED", async () => {
  const stack = buildStack({ dModifiesB: false, withLevelAnchor: true });
  const { dir, pinnedTip, dHeadBefore, dBranch, runId, issue, dPr, bPr } = stack;
  const runDir = join(mkTmp("faff-1087-run-"), runId);
  mkdirSync(join(runDir, issue), { recursive: true });

  const cliArgs = (env) => runCli(
    ["merge-gate", "--pr", String(dPr), "--issue", issue, "--run-dir", runDir, "--repo", "owner/repo", "--level", "L3", "--json", "--execute", "--squash"],
    { cwd: dir, env },
  );

  // --- B OPEN: the stacked-dependency leg refuses, and D is never merged before B ---
  const open = writeGhStub({ dPr, bPr, dHead: dHeadBefore, dBranch, bState: "OPEN" });
  const rOpen = cliArgs(open.env);
  assert.notEqual(rOpen.code, 0, "with B open the gate must refuse (a blocked dependency leg)");
  assert.ok(rOpen.stdout.trim(), `merge-gate emitted no JSON (code ${rOpen.code}); stderr: ${rOpen.stderr}`);
  const openResult = JSON.parse(rOpen.stdout);
  assert.match(openResult.blockers.join(" "), /stacked dependency PR not yet merged/, "the stacked-dependency blocker fires while B is OPEN");
  assert.equal(existsSync(open.sentinel), false, "D is never merged before B — no gh pr merge is spawned");

  // --- B MERGED: land B's squash on origin/main so the interlock's rebase is clean, then re-run ---
  squashBOntoMain(stack, { conflicting: false });
  const merged = writeGhStub({ dPr, bPr, dHead: dHeadBefore, dBranch, bState: "MERGED", bMergeSha: "f".repeat(40) });
  const rMerged = cliArgs(merged.env);
  assert.ok(rMerged.stdout.trim(), `merge-gate (B merged) emitted no JSON (code ${rMerged.code}); stderr: ${rMerged.stderr}`);
  const mergedResult = JSON.parse(rMerged.stdout);
  assert.equal(/stacked dependency PR not yet merged/.test(mergedResult.blockers.join(" ")), false, "once B is MERGED the dependency leg flips to satisfied — the not-yet-merged blocker is gone");
  assert.equal(existsSync(merged.sentinel), false, "the incomplete floor (no AC/review) still refuses, so no merge is spawned either way");
});
