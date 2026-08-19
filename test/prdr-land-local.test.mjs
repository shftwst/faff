// FAFF-875 — `faff prdr land --local` CLI-boundary tests (the git-only PRDR landing gate).
//
// prdrSelftest() (prdr.js) already drives `prdrLand`/`landBaseFfOnly` in-process against real
// scaffolded git repos; this file is the CLI-BOUNDARY sibling — it spawns the REAL `faff`
// entrypoint (runCli) against real git repos on disk, exercising arg parsing / dispatch / exit
// codes / --json shape exactly as an operator or an L4 git-only run would invoke it. Mirrors
// test/merge-gate-local.test.mjs's own "assert at the CLI seam" stance and no-remote scaffold.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runCli } from "./helpers/run-cli.mjs";

const tmpDirs = [];
const mkTmp = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); tmpDirs.push(d); return d; };
after(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

const git = (cwd, ...args) => spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
const gitOut = (cwd, ...args) => { const r = git(cwd, ...args); return r.status === 0 ? (r.stdout || "").trim() : null; };

// Scaffold a no-remote repo with docs/prdr/ ready. Optionally add a remote to exercise the
// availability-gate bypass-guard.
function scaffoldRepo({ withRemote = false } = {}) {
  const dir = mkTmp("prdr-land-repo-");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@t.t");
  git(dir, "config", "user.name", "t");
  mkdirSync(join(dir, "docs", "prdr"), { recursive: true });
  writeFileSync(join(dir, "README.md"), "seed\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base");
  if (withRemote) {
    const bare = mkTmp("prdr-land-remote-");
    git(mkTmp("prdr-land-init-"), "init", "-q", "--bare", bare);
    git(dir, "remote", "add", "origin", bare);
  }
  return dir;
}

// Author a PRDR (never committed to base — the realistic "stranded, coverage 0/5" repro shape,
// see prdrSelftest's own FAFF-875 block for why this is the load-bearing scenario) and accept it,
// via the REAL CLI (spawned), so this file never reaches into prdr.js internals.
function authorAndAccept(repo, { title = "Ship booking flow", goal = "ship booking" } = {}) {
  const r = runCli(["prdr", "new", title, "--container", "portal", "--prd-goal", goal, "--root", repo]);
  assert.equal(r.code, 0, r.stderr);
  const acc = runCli(["prdr", "accept", "1", "--root", repo]);
  assert.equal(acc.code, 0, acc.stderr);
  return JSON.parse(acc.stdout);
}

// --- AC #2: the availability gate — no-remote / Accepted-only / accept-branch-only ---

test("CLI: land --local on a repo WITH a remote → exit 2, base ref unchanged, directs to the forge PR path", () => {
  const repo = scaffoldRepo({ withRemote: true });
  authorAndAccept(repo);
  const baseBefore = gitOut(repo, "rev-parse", "main");

  const { code, stderr } = runCli(["prdr", "land", "1", "--local", "--root", repo]);
  assert.equal(code, 2);
  assert.match(stderr, /repo has a remote/);
  assert.match(stderr, /forge PR path/);
  assert.equal(gitOut(repo, "rev-parse", "main"), baseBefore);
});

test("CLI: land --local requires --local (missing flag) → exit 2 usage error", () => {
  const repo = scaffoldRepo();
  authorAndAccept(repo);
  const { code, stderr } = runCli(["prdr", "land", "1", "--root", repo]);
  assert.equal(code, 2);
  assert.match(stderr, /--local/);
});

test("CLI: land --local on a non-Accepted (Proposed) landing-shaped branch → refuse exit 1", () => {
  const repo = scaffoldRepo();
  const r = runCli(["prdr", "new", "Widget", "--container", "c", "--prd-goal", "g", "--root", repo]);
  assert.equal(r.code, 0, r.stderr);
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "add widget");
  git(repo, "branch", "prdr/0001-widget"); // never actually accepted — still Proposed
  const { code, stderr } = runCli(["prdr", "land", "1", "--local", "--root", repo]);
  assert.equal(code, 1);
  assert.match(stderr, /not Accepted/);
});

test("CLI: land --local when the accept branch is absent → refuse exit 1", () => {
  const repo = scaffoldRepo();
  const r = runCli(["prdr", "new", "Widget", "--container", "c", "--prd-goal", "g", "--root", repo]);
  assert.equal(r.code, 0, r.stderr);
  const { code, stderr } = runCli(["prdr", "land", "1", "--local", "--root", repo]);
  assert.equal(code, 1);
  assert.match(stderr, /no landing branch matching/);
});

// --- AC #4: clean base / ff-descendant / path-segment-safe preconditions ---

test("CLI: land --local refuses a non-ff-descendant (base moved since accept) — names the rebase remedy", () => {
  const repo = scaffoldRepo();
  authorAndAccept(repo);
  writeFileSync(join(repo, "README.md"), "base moved independently\n");
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "base moves");
  const baseBefore = gitOut(repo, "rev-parse", "main");

  const { code, stderr } = runCli(["prdr", "land", "1", "--local", "--root", repo]);
  assert.equal(code, 1);
  assert.match(stderr, /not a fast-forward descendant/);
  assert.match(stderr, /rebase/);
  assert.equal(gitOut(repo, "rev-parse", "main"), baseBefore);
});

test("CLI: land --local refuses a changed path OUTSIDE the PRDR dir — a sibling-prefix escape (segment-anchored, not a bare prefix match)", () => {
  const repo = scaffoldRepo();
  authorAndAccept(repo);
  git(repo, "checkout", "-q", "prdr/0001-ship-booking-flow");
  mkdirSync(join(repo, "docs", "prdr-notes"), { recursive: true });
  writeFileSync(join(repo, "docs", "prdr-notes", "evil.js"), "x\n");
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "sibling-prefix escape");
  git(repo, "checkout", "-q", "main");
  const baseBefore = gitOut(repo, "rev-parse", "main");

  const { code, stderr } = runCli(["prdr", "land", "1", "--local", "--root", repo]);
  assert.equal(code, 1);
  assert.match(stderr, /is outside the PRDR directory/);
  assert.match(stderr, /prdr-notes\/evil\.js/);
  assert.equal(gitOut(repo, "rev-parse", "main"), baseBefore);
});

// --- AC #5: candidate validation (prdrValidate + prdrGitTier) blocks a FAIL ---

test("CLI: land --local blocks on a candidate-validation FAIL (a required body section missing on the landing tree)", () => {
  const repo = scaffoldRepo();
  authorAndAccept(repo);
  git(repo, "checkout", "-q", "prdr/0001-ship-booking-flow");
  const p = join(repo, "docs", "prdr", "0001-ship-booking-flow.md");
  writeFileSync(p, readFileSync(p, "utf8").replace(/## Definition of done[\s\S]*$/, ""));
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "drop a required section");
  git(repo, "checkout", "-q", "main");
  const baseBefore = gitOut(repo, "rev-parse", "main");

  const { code, stderr } = runCli(["prdr", "land", "1", "--local", "--root", repo]);
  assert.equal(code, 1);
  assert.match(stderr, /missing "## Definition of done"/);
  assert.equal(gitOut(repo, "rev-parse", "main"), baseBefore);
});

// --- AC #6 + #8: happy path — ff-advance, working tree reflects it, JSON shape, persisted
// record, and coverage moves uncovered -> covered ---

test("CLI: land --local happy path — ff-advances base, refreshes the invoking worktree, emits {landed,old_base_sha,new_base_sha,coverage}, persists the landing record, and moves coverage uncovered->covered", () => {
  const repo = scaffoldRepo();
  authorAndAccept(repo, { goal: "ship booking" });
  const runDir = mkTmp("prdr-land-rundir-");

  const covBefore = runCli(["prdr", "coverage", "--root", repo, "--prd-goals", '["ship booking"]']);
  assert.equal(JSON.parse(covBefore.stdout).covered, false, "the Accepted-but-unmerged record is not yet counted");

  const baseBefore = gitOut(repo, "rev-parse", "main");
  const { code, stdout } = runCli(["prdr", "land", "1", "--local", "--root", repo, "--run-dir", runDir, "--issue", "FAFF-TEST", "--prd-goals", '["ship booking"]']);
  assert.equal(code, 0, stdout);
  const out = JSON.parse(stdout);

  assert.equal(out.landed, true);
  assert.equal(out.old_base_sha, baseBefore);
  assert.equal(typeof out.new_base_sha, "string");
  assert.notEqual(out.new_base_sha, baseBefore);
  assert.equal(out.coverage.covered, true, "landing moved the goal uncovered -> covered");

  assert.equal(gitOut(repo, "rev-parse", "main"), out.new_base_sha, "base ref advanced to the landing tip");
  const landed = readFileSync(join(repo, "docs", "prdr", "0001-ship-booking-flow.md"), "utf8");
  assert.match(landed, /Status:\*\* Accepted/, "the invoking worktree's own working tree reflects the landed record (in-place ff)");

  const persisted = JSON.parse(readFileSync(join(runDir, "FAFF-TEST", "prdr-landing-0001.json"), "utf8"));
  assert.equal(persisted.new_base_sha, out.new_base_sha);

  const covAfter = runCli(["prdr", "coverage", "--root", repo, "--prd-goals", '["ship booking"]']);
  assert.equal(JSON.parse(covAfter.stdout).covered, true);
});

test("CLI: land --local with no --run-dir/--issue still emits the JSON record on stdout (no persisted file)", () => {
  const repo = scaffoldRepo();
  authorAndAccept(repo);
  const { code, stdout } = runCli(["prdr", "land", "1", "--local", "--root", repo]);
  assert.equal(code, 0, stdout);
  assert.equal(JSON.parse(stdout).landed, true);
});

// --- AC #9 (regression guard, this file's own corner): a second `land` on an already-landed
// PRDR has no landing branch left to re-land from a fresh accept, but re-running against the
// SAME already-advanced base is exactly the ff-descendant check's job — assert idempotent
// safety isn't silently bypassed by asserting the base is truly at the tip already.

test("CLI: land --local base==landing (already at the same ref) refuses cleanly rather than mutating", () => {
  const repo = scaffoldRepo();
  authorAndAccept(repo);
  const { code: landCode } = runCli(["prdr", "land", "1", "--local", "--root", repo]);
  assert.equal(landCode, 0);
  // The landing branch (still present locally) now points at the SAME commit as main.
  const { code, stderr } = runCli(["prdr", "land", "1", "--local", "--root", repo, "--base", "prdr/0001-ship-booking-flow"]);
  assert.equal(code, 2);
  assert.match(stderr, /base and landing branch are the same ref/);
});
