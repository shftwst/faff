// FAFF-1415 — `faff worktree ensure`: graft's Step 3 worktree provisioning as one command.
// The git steps run against real temporary repositories (a bare origin with a symbolic HEAD, a main
// checkout, and a worktree root that FAFF_WORKTREE_ROOT points at). Store and restore exit codes the
// real primitives cannot be made to produce on demand are injected through `Deps`. Every child call is
// recorded, so a test can assert what never ran. Case names are the ones the spec's rule inventory cites.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, realpathSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");
const BUNDLED = path.resolve(HERE, "..", "plugin", "skills", "faff-graft");
const we = require("../plugin/skills/faff/bin/lib/worktree-ensure.js");

const ISSUE = "FAFF-9";
const KEYS = ["issue", "disposition", "mode", "cause", "resume_at", "wt", "branch", "base_ref", "behind", "setup_script", "graft_skill_dir", "resume", "detail", "warnings"].sort();

// --- Fixtures ---

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function faffCli(args, cwd, env) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// A main checkout with a bare origin (unless gitOnly) and a worktree root outside the repo.
function fixture({ gitOnly = false } = {}) {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), "faff-wt-ensure-")));
  const repo = path.join(parent, "repo");
  const wtroot = path.join(parent, "wtroot");
  const origin = path.join(parent, "origin.git");
  mkdirSync(repo);
  mkdirSync(wtroot);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@t.test");
  git(repo, "config", "user.name", "t");
  writeFileSync(path.join(repo, "a.txt"), "one\ntwo\nthree\n");
  git(repo, "add", "a.txt");
  git(repo, "commit", "-q", "-m", "init");
  if (!gitOnly) {
    git(parent, "init", "-q", "--bare", origin);
    git(parent, "--git-dir", origin, "symbolic-ref", "HEAD", "refs/heads/main");
    git(repo, "remote", "add", "origin", origin);
    git(repo, "push", "-q", "origin", "main");
  }
  const runDir = path.join(repo, ".faff", "runs", "run-20261101-000000-graft-FAFF-9");
  mkdirSync(runDir, { recursive: true });
  const env = { ...process.env, FAFF_WORKTREE_ROOT: wtroot, SKIP_NPM_PACKAGES_INSTALL: "1" };
  delete env.FAFF_RUN_DIR;
  return { parent, repo, wtroot, origin, runDir, env };
}

function cleanup(fx) {
  rmSync(fx.parent, { recursive: true, force: true });
}

// Real deps for the fixture, with per-call overrides and a call log. An override returns a spawn
// result to replace the real call, or undefined to let it run.
function deps(fx, over = {}) {
  const real = we.realDeps(fx.env);
  const calls = [];
  const wrap = (kind) => (...a) => {
    calls.push({ kind, args: a[0], extra: a[1] });
    const o = over[kind] && over[kind](...a);
    return o === undefined ? real[kind](...a) : o;
  };
  return { calls, d: { ...real, faff: wrap("faff"), git: wrap("git"), gitNet: wrap("gitNet"), gitBytes: wrap("gitBytes"), bash: wrap("bash"), ...(over.graftSkillDir ? { graftSkillDir: over.graftSkillDir } : {}) } };
}

function run(fx, opts = {}, over = {}) {
  const { calls, d } = deps(fx, over);
  const out = we.ensure({
    issue: ISSUE,
    mode: opts.mode ?? "interactive",
    slug: opts.slug ?? "demo",
    trackerBranch: opts.trackerBranch ?? null,
    labels: opts.labels === undefined ? (opts.mode === "autonomous" ? "[]" : null) : opts.labels,
    runDir: opts.runDir === undefined ? (opts.mode === "autonomous" ? fx.runDir : null) : opts.runDir,
    root: fx.repo,
  }, d);
  return { out, calls };
}

const faffCalls = (calls, sub) => calls.filter((c) => c.kind === "faff" && c.args[0] === sub);
const bashCalls = (calls, name) => calls.filter((c) => c.kind === "bash" && path.basename(c.args) === name);
const reply = (status, stdout = "", stderr = "") => ({ status, stdout, stderr });

// A fresh worktree for FAFF-9 made by the command itself.
function freshWorktree(fx) {
  const { out } = run(fx);
  assert.equal(out.disposition, "ready", JSON.stringify(out));
  return out.wt;
}

function rebaseInProgress(wt) {
  return ["rebase-merge", "rebase-apply"].some((d) => existsSync(git(wt, "rev-parse", "--path-format=absolute", "--git-path", d)));
}

// A pushed feature branch with one commit, and its checkpoint hash over the three-dot diff.
function pushedBranch(fx, branch = "FAFF-9-demo", { keepLocal = false } = {}) {
  git(fx.repo, "checkout", "-q", "-b", branch);
  writeFileSync(path.join(fx.repo, "feature.txt"), "built\n");
  git(fx.repo, "add", "feature.txt");
  git(fx.repo, "commit", "-q", "-m", "build");
  const tip = git(fx.repo, "rev-parse", "HEAD");
  git(fx.repo, "push", "-q", "origin", branch);
  git(fx.repo, "checkout", "-q", "main");
  if (!keepLocal) git(fx.repo, "branch", "-q", "-D", branch);
  const diff = spawnSync("git", ["diff", `origin/main...origin/${branch}`], { cwd: fx.repo });
  return { tip, hash: createHash("sha256").update(diff.stdout).digest("hex") };
}

function writeCheckpoint(fx, dir, branch, hash) {
  const r = faffCli(["build-progress", "write", dir, ISSUE, "--build-complete", "--diff-hash", hash, "--branch", branch], fx.repo, fx.env);
  assert.equal(r.status, 0, r.stderr);
  return path.join(dir, ISSUE, "build-progress.json");
}

// A resume store for FAFF-9 stashed by the real CLI, with dialogue rounds when the cause needs them.
function stash(fx, cause, branch, hash) {
  const src = path.join(fx.parent, "stash-run");
  mkdirSync(path.join(src, ISSUE, "build-review"), { recursive: true });
  writeCheckpoint(fx, src, branch, hash);
  const args = ["resume-store", "stash", "--run-dir", src, "--issue", ISSUE, "--cause", cause, "--store-root", path.join(fx.repo, ".faff", "resume")];
  if (cause === "build-review-dialogue") {
    writeFileSync(path.join(src, ISSUE, "build-review", "round-1.json"), "{}");
    writeFileSync(path.join(src, ISSUE, "build-review", "round-2.json"), "{}");
    args.push("--fix-rounds-used", "1", "--rebuttal-rounds-used", "1");
  }
  const r = faffCli(args, fx.repo, fx.env);
  assert.equal(r.status, 0, r.stderr);
  return path.join(fx.repo, ".faff", "resume", ISSUE);
}

function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, name.name);
      if (name.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return out;
}

// --- Reuse (rows 1-15) ---

test("existing fresh worktree is reused", () => {
  const fx = fixture();
  try {
    const wt = freshWorktree(fx);
    const { out, calls } = run(fx);
    assert.equal(out.disposition, "ready");
    assert.equal(out.mode, "reused");
    assert.equal(out.cause, "worktree-fresh");
    assert.equal(out.resume_at, "existing");
    assert.equal(out.wt, wt);
    assert.equal(out.base_ref, "origin/main");
    assert.equal(out.behind, 0);
    assert.equal(faffCalls(calls, "worktree-check").length, 1);
    assert.equal(bashCalls(calls, "setup-worktree.sh").length, 0);
  } finally { cleanup(fx); }
});

test("reused branch mismatch warns", () => {
  const fx = fixture();
  try {
    git(fx.repo, "worktree", "add", "-q", "-b", "FAFF-9-other", path.join(fx.wtroot, "FAFF-9-other"), "origin/main");
    const { out } = run(fx);
    assert.equal(out.mode, "reused");
    assert.equal(out.branch, "FAFF-9-other");
    assert.ok(out.warnings.some((w) => w.includes("FAFF-9-other") && w.includes("FAFF-9-demo")), JSON.stringify(out.warnings));
  } finally { cleanup(fx); }
});

test("stale worktree rebases cleanly", () => {
  const fx = fixture();
  try {
    const wt = freshWorktree(fx);
    writeFileSync(path.join(fx.repo, "b.txt"), "new\n");
    git(fx.repo, "add", "b.txt");
    git(fx.repo, "commit", "-q", "-m", "main moves");
    git(fx.repo, "push", "-q", "origin", "main");
    const mainTip = git(fx.repo, "rev-parse", "HEAD");
    const { out } = run(fx, { mode: "autonomous" });
    assert.equal(out.disposition, "ready");
    assert.equal(out.mode, "rebased");
    assert.equal(out.cause, "stale-rebased");
    assert.equal(out.resume_at, "existing");
    assert.equal(out.behind, 1);
    assert.equal(spawnSync("git", ["-C", wt, "merge-base", "--is-ancestor", mainTip, "HEAD"]).status, 0);
  } finally { cleanup(fx); }
});

function conflicted(fx) {
  const wt = freshWorktree(fx);
  writeFileSync(path.join(wt, "a.txt"), "one\nBRANCH\nthree\n");
  git(wt, "commit", "-q", "-am", "branch edit");
  writeFileSync(path.join(fx.repo, "a.txt"), "one\nMAIN\nthree\n");
  git(fx.repo, "commit", "-q", "-am", "main edit");
  git(fx.repo, "push", "-q", "origin", "main");
  return wt;
}

test("autonomous rebase conflict aborts and parks", () => {
  const fx = fixture();
  try {
    const wt = conflicted(fx);
    const { out } = run(fx, { mode: "autonomous" });
    assert.equal(out.disposition, "parked");
    assert.equal(out.cause, "rebase-conflict");
    assert.equal(out.wt, wt);
    assert.deepEqual(Object.keys(out.detail).sort(), ["base_ref", "behind", "worktree_path"]);
    assert.equal(rebaseInProgress(wt), false);
  } finally { cleanup(fx); }
});

test("interactive rebase conflict hands over", () => {
  const fx = fixture();
  try {
    const wt = conflicted(fx);
    const { out } = run(fx);
    assert.equal(out.disposition, "hand-over");
    assert.equal(out.cause, "rebase-conflict");
    assert.equal(rebaseInProgress(wt), true);
  } finally { cleanup(fx); }
});

test("no worktree creates fresh", () => {
  const fx = fixture();
  try {
    const { out } = run(fx);
    assert.equal(out.disposition, "ready");
    assert.equal(out.mode, "fresh");
    assert.equal(out.cause, "no-worktree");
    assert.equal(out.resume_at, "start");
    assert.equal(out.branch, "FAFF-9-demo");
    assert.equal(out.wt, path.join(fx.wtroot, "FAFF-9-demo"));
    assert.equal(git(out.wt, "branch", "--show-current"), "FAFF-9-demo");
  } finally { cleanup(fx); }
});

test("clobbered worktree heals and is reused", () => {
  const fx = fixture();
  try {
    const wt = freshWorktree(fx);
    const admin = path.join(fx.repo, ".git", "worktrees");
    for (const id of readdirSync(admin)) rmSync(path.join(admin, id), { recursive: true, force: true });
    const { out, calls } = run(fx);
    assert.equal(out.disposition, "ready", JSON.stringify(out));
    assert.equal(out.mode, "healed");
    assert.equal(out.cause, "clobbered-healed");
    assert.equal(out.resume_at, "existing");
    assert.equal(out.wt, wt);
    assert.equal(faffCalls(calls, "worktree-heal").length, 1);
    assert.equal(faffCalls(calls, "worktree-check").length, 2);
  } finally { cleanup(fx); }
});

test("heal failure parks or hands over", () => {
  const fx = fixture();
  try {
    const clob = JSON.stringify({ issue: ISSUE, reason: "clobbered-recoverable", worktree_path: "/x/FAFF-9-demo" });
    const over = { faff: (a) => (a[0] === "worktree-check" ? reply(2, clob) : a[0] === "worktree-heal" ? reply(1, "{}") : undefined) };
    const auto = run(fx, { mode: "autonomous" }, over).out;
    assert.equal(auto.disposition, "parked");
    assert.equal(auto.cause, "heal-failed");
    assert.equal(auto.detail.worktree_path, "/x/FAFF-9-demo");
    assert.equal(run(fx, {}, over).out.disposition, "hand-over");
    // A heal that succeeds but whose re-check is exit 2 again is heal-failed, never a loop.
    let checks = 0;
    const again = { faff: (a) => (a[0] === "worktree-check" ? (checks++, reply(2, clob)) : a[0] === "worktree-heal" ? reply(0, JSON.stringify({ worktree_path: "/x/FAFF-9-demo" })) : undefined) };
    const r = run(fx, { mode: "autonomous" }, again);
    assert.equal(r.out.cause, "heal-failed");
    assert.equal(checks, 2);
    assert.equal(bashCalls(r.calls, "setup-worktree.sh").length, 0);
  } finally { cleanup(fx); }
});

test("uncertifiable never fresh-creates", () => {
  const fx = fixture();
  try {
    for (const reason of ["ambiguous-match", "no-branch", "base-unresolvable", "unreadable-behind", "git-unavailable"]) {
      const over = { faff: (a) => (a[0] === "worktree-check" ? reply(2, JSON.stringify({ issue: ISSUE, error: "x", reason })) : undefined) };
      for (const mode of ["autonomous", "interactive"]) {
        const { out, calls } = run(fx, { mode }, over);
        assert.equal(out.disposition, mode === "autonomous" ? "parked" : "hand-over", reason);
        assert.equal(out.cause, `uncertifiable:${reason}`);
        assert.equal(out.wt, null);
        assert.deepEqual(out.detail, { reason });
        assert.equal(bashCalls(calls, "setup-worktree.sh").length, 0, reason);
        assert.equal(faffCalls(calls, "build-progress").length, 0, reason);
      }
    }
    assert.deepEqual(readdirSync(fx.wtroot), []);
  } finally { cleanup(fx); }
});

// --- Resume from a checkpoint (rows 16-23) ---

test("interactive never resumes", () => {
  const fx = fixture();
  try {
    const { hash } = pushedBranch(fx);
    writeCheckpoint(fx, fx.runDir, "FAFF-9-demo", hash);
    stash(fx, "review-outage", "FAFF-9-demo", hash);
    const { out, calls } = run(fx, { mode: "interactive", runDir: fx.runDir, labels: JSON.stringify(["faff-awaiting-review"]) });
    assert.equal(out.mode, "fresh");
    assert.equal(out.cause, "no-worktree");
    assert.equal(faffCalls(calls, "build-progress").length, 0);
    assert.equal(faffCalls(calls, "resume-store").length, 0);
  } finally { cleanup(fx); }
});

test("no checkpoint, no hold creates fresh", () => {
  const fx = fixture();
  try {
    const { out, calls } = run(fx, { mode: "autonomous" });
    assert.equal(out.mode, "fresh");
    assert.equal(out.cause, "no-worktree");
    assert.equal(faffCalls(calls, "build-progress").length, 1);
    assert.equal(faffCalls(calls, "resume-store").length, 0);
    assert.deepEqual(out.warnings, []);
  } finally { cleanup(fx); }
});

test("checkpoint match resumes", () => {
  const fx = fixture();
  try {
    const { tip, hash } = pushedBranch(fx);
    writeCheckpoint(fx, fx.runDir, "FAFF-9-demo", hash);
    const { out } = run(fx, { mode: "autonomous" });
    assert.equal(out.disposition, "ready", JSON.stringify(out));
    assert.equal(out.mode, "resumed");
    assert.equal(out.cause, "checkpoint-match");
    assert.equal(out.resume_at, "gate");
    assert.equal(out.wt, path.join(fx.wtroot, "FAFF-9-demo"));
    assert.equal(out.branch, "FAFF-9-demo");
    assert.equal(git(out.wt, "rev-parse", "HEAD"), tip);
  } finally { cleanup(fx); }
});

test("recreate path flattens slashes under the resolved root", () => {
  const fx = fixture();
  try {
    const { tip, hash } = pushedBranch(fx, "team/FAFF-9-demo");
    writeCheckpoint(fx, fx.runDir, "team/FAFF-9-demo", hash);
    const { out } = run(fx, { mode: "autonomous" });
    assert.equal(out.mode, "resumed", JSON.stringify(out));
    assert.equal(out.wt, path.join(fx.wtroot, "team-FAFF-9-demo"));
    assert.equal(out.branch, "team/FAFF-9-demo");
    assert.equal(git(out.wt, "rev-parse", "HEAD"), tip);
  } finally { cleanup(fx); }
});

test("git-only checkpoint match resumes", () => {
  const fx = fixture({ gitOnly: true });
  try {
    git(fx.repo, "checkout", "-q", "-b", "FAFF-9-demo");
    writeFileSync(path.join(fx.repo, "feature.txt"), "built\n");
    git(fx.repo, "add", "feature.txt");
    git(fx.repo, "commit", "-q", "-m", "build");
    const tip = git(fx.repo, "rev-parse", "HEAD");
    git(fx.repo, "checkout", "-q", "main");
    const diff = spawnSync("git", ["diff", "main...FAFF-9-demo"], { cwd: fx.repo });
    writeCheckpoint(fx, fx.runDir, "FAFF-9-demo", createHash("sha256").update(diff.stdout).digest("hex"));
    const { out } = run(fx, { mode: "autonomous" });
    assert.equal(out.mode, "resumed", JSON.stringify(out));
    assert.equal(out.base_ref, "main");
    assert.equal(git(out.wt, "rev-parse", "HEAD"), tip);
  } finally { cleanup(fx); }
});

test("resume base failure parks", () => {
  const fx = fixture();
  try {
    const { hash } = pushedBranch(fx);
    writeCheckpoint(fx, fx.runDir, "FAFF-9-demo", hash);
    const over = { bash: (script) => (path.basename(script) === "remote-diff-base.sh" ? reply(1, "", "no base\n") : undefined) };
    const { out, calls } = run(fx, { mode: "autonomous" }, over);
    assert.equal(out.disposition, "parked");
    assert.equal(out.cause, "resume-base-unresolvable");
    assert.equal(bashCalls(calls, "setup-worktree.sh").length, 0);
  } finally { cleanup(fx); }
});

test("diverged local branch parks", () => {
  const fx = fixture();
  try {
    const { hash } = pushedBranch(fx, "FAFF-9-demo", { keepLocal: true });
    git(fx.repo, "checkout", "-q", "FAFF-9-demo");
    writeFileSync(path.join(fx.repo, "local.txt"), "unpushed\n");
    git(fx.repo, "add", "local.txt");
    git(fx.repo, "commit", "-q", "-m", "local only");
    const localTip = git(fx.repo, "rev-parse", "HEAD");
    git(fx.repo, "checkout", "-q", "main");
    writeCheckpoint(fx, fx.runDir, "FAFF-9-demo", hash);
    const { out } = run(fx, { mode: "autonomous" });
    assert.equal(out.disposition, "parked");
    assert.equal(out.cause, "resume-branch-diverged");
    assert.equal(git(fx.repo, "rev-parse", "FAFF-9-demo"), localTip, "the local branch is never reset");
  } finally { cleanup(fx); }
});

test("failed recreate parks", () => {
  const fx = fixture();
  try {
    const { hash } = pushedBranch(fx);
    writeCheckpoint(fx, fx.runDir, "FAFF-9-demo", hash);
    mkdirSync(path.join(fx.wtroot, "FAFF-9-demo"));
    writeFileSync(path.join(fx.wtroot, "FAFF-9-demo", "squatter.txt"), "x\n");
    const { out } = run(fx, { mode: "autonomous" });
    assert.equal(out.disposition, "parked");
    assert.equal(out.cause, "resume-recreate-failed");
    assert.equal(out.wt, path.join(fx.wtroot, "FAFF-9-demo"));
  } finally { cleanup(fx); }
});

test("recreate reuses its own earlier worktree", () => {
  const fx = fixture();
  try {
    // A recorded branch without the issue-id token: worktree-check cannot match the recreated worktree.
    const { tip, hash } = pushedBranch(fx, "legacy-demo");
    writeCheckpoint(fx, fx.runDir, "legacy-demo", hash);
    const first = run(fx, { mode: "autonomous" }).out;
    assert.equal(first.mode, "resumed", JSON.stringify(first));
    const second = run(fx, { mode: "autonomous" });
    assert.equal(second.out.mode, "resumed", JSON.stringify(second.out));
    assert.equal(second.out.wt, first.wt);
    assert.equal(git(second.out.wt, "rev-parse", "HEAD"), tip);
    assert.equal(second.calls.filter((c) => c.kind === "git" && c.args[0] === "worktree" && c.args[1] === "add").length, 0);
  } finally { cleanup(fx); }
});

test("checkpoint mismatch creates fresh", () => {
  const fx = fixture();
  try {
    pushedBranch(fx);
    const file = writeCheckpoint(fx, fx.runDir, "FAFF-9-demo", "0".repeat(64));
    const before = readFileSync(file, "utf8");
    const { out } = run(fx, { mode: "autonomous" });
    assert.equal(out.mode, "fresh");
    assert.equal(out.cause, "checkpoint-mismatch");
    assert.equal(out.resume_at, "start");
    assert.equal(readFileSync(file, "utf8"), before, "the checkpoint is never modified");
  } finally { cleanup(fx); }
});

// --- Resume from the store (rows 24-36) ---

test("unlabelled store warns", () => {
  const fx = fixture();
  try {
    const store = stash(fx, "review-outage", "FAFF-9-demo", "0".repeat(64));
    const { out, calls } = run(fx, { mode: "autonomous", labels: "[]" });
    assert.equal(out.mode, "fresh");
    assert.equal(out.cause, "no-worktree");
    assert.equal(out.detail.store_path, store);
    assert.ok(out.warnings.some((w) => w.includes(store)), JSON.stringify(out.warnings));
    assert.equal(faffCalls(calls, "resume-store").length, 0);
  } finally { cleanup(fx); }
});

test("custom prefix hold label", () => {
  const fx = fixture();
  try {
    mkdirSync(path.join(fx.repo, ".faff"), { recursive: true });
    writeFileSync(path.join(fx.repo, ".faff", "config.yaml"), "tracking:\n  label_prefix: sd\n");
    // The adjudication role under the configured prefix is a hold: with no store it needs a human.
    const held = run(fx, { mode: "autonomous", labels: JSON.stringify(["sd-awaiting-adjudication"]) }).out;
    assert.equal(held.disposition, "needs-human", JSON.stringify(held));
    assert.equal(held.cause, "store-missing");
    // The review role too, by role rather than the literal default name.
    assert.equal(run(fx, { mode: "autonomous", labels: JSON.stringify(["sd-awaiting-review"]) }).out.cause, "store-missing");
    // The default-prefix name is not a hold under the sd prefix.
    assert.equal(run(fx, { mode: "autonomous", labels: JSON.stringify(["faff-awaiting-review"]) }).out.mode, "fresh");
  } finally { cleanup(fx); }
});

test("hold with missing store needs human", () => {
  const fx = fixture();
  try {
    const { out, calls } = run(fx, { mode: "autonomous", labels: JSON.stringify(["faff-awaiting-review"]) });
    assert.equal(out.disposition, "needs-human");
    assert.equal(out.cause, "store-missing");
    assert.equal(out.mode, null);
    assert.equal(bashCalls(calls, "setup-worktree.sh").length, 0);
    assert.deepEqual(readdirSync(fx.wtroot), [], "no worktree was created");
  } finally { cleanup(fx); }
});

test("store mismatch creates fresh, store kept", () => {
  const fx = fixture();
  try {
    pushedBranch(fx);
    const store = stash(fx, "review-outage", "FAFF-9-demo", "0".repeat(64));
    const before = snapshot(store);
    const { out, calls } = run(fx, { mode: "autonomous", labels: JSON.stringify(["faff-awaiting-review"]) });
    assert.equal(out.mode, "fresh");
    assert.equal(out.cause, "store-mismatch");
    assert.deepEqual(snapshot(store), before, "the store is left in place, unmodified");
    assert.equal(faffCalls(calls, "resume-store").length, 0);
  } finally { cleanup(fx); }
});

test("store restore resumes", () => {
  const fx = fixture();
  try {
    const { tip, hash } = pushedBranch(fx);
    stash(fx, "review-outage", "FAFF-9-demo", hash);
    const { out } = run(fx, { mode: "autonomous", labels: JSON.stringify(["faff-awaiting-review"]) });
    assert.equal(out.disposition, "ready", JSON.stringify(out));
    assert.equal(out.mode, "resumed-from-store");
    assert.equal(out.cause, "store-restored");
    assert.equal(out.resume_at, "gate");
    assert.equal(out.resume.cause, "review-outage");
    assert.equal(git(out.wt, "rev-parse", "HEAD"), tip);
    assert.ok(existsSync(path.join(fx.runDir, ISSUE, "build-progress.json")), "restore copied the store into the run dir");
  } finally { cleanup(fx); }
});

test("dialogue-cause store resumes at review", () => {
  const fx = fixture();
  try {
    const { hash } = pushedBranch(fx);
    stash(fx, "build-review-dialogue", "FAFF-9-demo", hash);
    const read = faffCli(["resume-store", "read", "--issue", ISSUE, "--store-root", path.join(fx.repo, ".faff", "resume")], fx.repo, fx.env);
    const { out } = run(fx, { mode: "autonomous", labels: JSON.stringify(["faff-awaiting-adjudication"]) });
    assert.equal(out.mode, "resumed-from-store", JSON.stringify(out));
    assert.equal(out.resume_at, "review");
    assert.equal(out.resume.cause, "build-review-dialogue");
    assert.deepEqual(out.resume.dialogue, JSON.parse(read.stdout).dialogue);
  } finally { cleanup(fx); }
});

test("judge-stage store resumes at review", () => {
  const fx = fixture();
  try {
    const { hash } = pushedBranch(fx);
    stash(fx, "review-outage", "FAFF-9-demo", hash);
    const dialogue = { hold_count: 2, next_round: 3, fix_rounds_used: 1, rebuttal_rounds_used: 1, stage: "judge" };
    const over = { faff: (a) => (a[0] === "resume-store" ? reply(0, JSON.stringify({ cause: "build-review-dialogue", dialogue })) : undefined) };
    const { out } = run(fx, { mode: "autonomous", labels: JSON.stringify(["faff-awaiting-adjudication"]) }, over);
    assert.equal(out.resume_at, "review");
    assert.deepEqual(out.resume.dialogue, dialogue, "the dialogue object is carried verbatim");
  } finally { cleanup(fx); }
});

test("store restore failure needs human", () => {
  const fx = fixture();
  try {
    const { hash } = pushedBranch(fx);
    stash(fx, "review-outage", "FAFF-9-demo", hash);
    for (const code of [1, 2, 3]) {
      const over = { faff: (a) => (a[0] === "resume-store" ? reply(code, "", `faff resume-store restore: broken ${code}\nmore\n`) : undefined) };
      const { out, calls } = run(fx, { mode: "autonomous", labels: JSON.stringify(["faff-awaiting-review"]) }, over);
      assert.equal(out.disposition, "needs-human");
      assert.equal(out.cause, `store-restore-failed:${code}`);
      assert.deepEqual(out.detail, { exit: code, stderr: `faff resume-store restore: broken ${code}` });
      assert.equal(bashCalls(calls, "setup-worktree.sh").length, 0);
    }
  } finally { cleanup(fx); }
});

test("store busy is claimed-by-peer", () => {
  const fx = fixture();
  try {
    const { hash } = pushedBranch(fx);
    stash(fx, "review-outage", "FAFF-9-demo", hash);
    const over = { faff: (a) => (a[0] === "resume-store" ? reply(4, "", "busy\n") : undefined) };
    const { out } = run(fx, { mode: "autonomous", labels: JSON.stringify(["faff-awaiting-review"]) }, over);
    assert.equal(out.disposition, "claimed-by-peer");
    assert.equal(out.cause, "store-busy");
  } finally { cleanup(fx); }
});

test("a failed or overrun fetch parks the recreate and warns on the stale path", () => {
  const fx = fixture();
  try {
    const { hash } = pushedBranch(fx);
    writeCheckpoint(fx, fx.runDir, "FAFF-9-demo", hash);
    const over = { gitNet: (a) => (a[0] === "fetch" ? reply(null, "", "killed after the network bound\n") : undefined) };
    const { out } = run(fx, { mode: "autonomous" }, over);
    assert.equal(out.disposition, "parked");
    assert.equal(out.cause, "resume-recreate-failed");
    assert.equal(out.detail.stage, "fetch");
    assert.deepEqual(readdirSync(fx.wtroot), [], "no worktree was added after the failed fetch");
  } finally { cleanup(fx); }
  const fx2 = fixture();
  try {
    freshWorktree(fx2);
    writeFileSync(path.join(fx2.repo, "b.txt"), "new\n");
    git(fx2.repo, "add", "b.txt");
    git(fx2.repo, "commit", "-q", "-m", "main moves");
    git(fx2.repo, "push", "-q", "origin", "main");
    const over = { gitNet: (a) => (a[0] === "-C" && a[2] === "fetch" ? reply(128, "", "unreachable\n") : undefined) };
    const { out } = run(fx2, { mode: "autonomous" }, over);
    assert.equal(out.mode, "rebased", JSON.stringify(out));
    assert.ok(out.warnings.some((w) => w.includes("git fetch") && w.includes("failed")), JSON.stringify(out.warnings));
  } finally { cleanup(fx2); }
});

test("fetches run under the network bound", () => {
  const fx = fixture();
  try {
    const d = we.realDeps({ ...fx.env, FAFF_GIT_NET_TIMEOUT: "1", GIT_SSH_COMMAND: "" });
    git(fx.repo, "remote", "set-url", "origin", "ssh://git@192.0.2.1/x.git");
    const t0 = Date.now();
    const r = d.gitNet(["fetch", "origin"], fx.repo);
    assert.notEqual(r.status, 0);
    assert.ok(Date.now() - t0 < 15000, "a black-holed origin fails within the bound, never hangs");
  } finally { cleanup(fx); }
});

test("an unparseable restore record needs a human, never a silent gate", () => {
  const fx = fixture();
  try {
    const { hash } = pushedBranch(fx);
    stash(fx, "build-review-dialogue", "FAFF-9-demo", hash);
    const over = { faff: (a) => (a[0] === "resume-store" ? reply(0, "not json\n") : undefined) };
    const { out, calls } = run(fx, { mode: "autonomous", labels: JSON.stringify(["faff-awaiting-adjudication"]) }, over);
    assert.equal(out.disposition, "needs-human");
    assert.equal(out.cause, "store-restore-failed:0");
    assert.equal(calls.filter((c) => c.kind === "git" && c.args[0] === "worktree" && c.args[1] === "add").length, 0);
  } finally { cleanup(fx); }
});

// --- Branch naming and provisioning (rows 37-46, 52) ---

test("conventions cache written", () => {
  const fx = fixture();
  try {
    run(fx);
    assert.ok(existsSync(path.join(fx.repo, ".faff", "conventions.json")));
  } finally { cleanup(fx); }
});

test("branch naming per scheme", () => {
  const scheme = (s) => ({ faff: (a) => (a[0] === "conventions" && a[1] === "get" ? reply(0, `${s}\n`) : undefined) });
  for (const [s, hint, want, wantDir] of [
    ["issue-slug", "faff-9-ignored", "FAFF-9-demo", "FAFF-9-demo"],
    ["slash-scoped", null, "feature-FAFF-9-demo", "feature-FAFF-9-demo"],
    ["tracker-hint", "alec/faff-9-from-linear", "alec-faff-9-from-linear", "alec-faff-9-from-linear"],
    ["tracker-hint", null, "FAFF-9-demo", "FAFF-9-demo"],
  ]) {
    const fx = fixture();
    try {
      const { out } = run(fx, { trackerBranch: hint }, scheme(s));
      assert.equal(out.disposition, "ready", `${s}: ${JSON.stringify(out)}`);
      assert.equal(out.branch, want, s);
      assert.equal(out.wt, path.join(fx.wtroot, wantDir), s);
      assert.deepEqual(out.warnings, [], s);
    } finally { cleanup(fx); }
  }
});

test("tracker hint without issue id falls back", () => {
  const fx = fixture();
  try {
    const over = { faff: (a) => (a[0] === "conventions" && a[1] === "get" ? reply(0, "tracker-hint\n") : undefined) };
    const { out } = run(fx, { trackerBranch: "some-feature" }, over);
    assert.equal(out.branch, "FAFF-9-demo");
    assert.ok(out.warnings.some((w) => w.includes("does not carry the issue id")), JSON.stringify(out.warnings));
    // A token embedded in a longer number is not the issue id.
    assert.equal(run(fx, { trackerBranch: "faff-90-other" }, over).out.branch, "FAFF-9-demo");
  } finally { cleanup(fx); }
});

test("invalid tracker hint falls back", () => {
  const fx = fixture();
  try {
    const over = { faff: (a) => (a[0] === "conventions" && a[1] === "get" ? reply(0, "tracker-hint\n") : undefined) };
    const { out } = run(fx, { trackerBranch: "faff-9..bad" }, over);
    assert.equal(out.branch, "FAFF-9-demo");
    assert.ok(out.warnings.some((w) => w.includes("not a valid branch name")), JSON.stringify(out.warnings));
  } finally { cleanup(fx); }
});

test("non-kebab slug exits 2", () => {
  const fx = fixture();
  try {
    for (const slug of ["Demo", "demo_x", "a/b", "-demo", "demo-"]) {
      const r = faffCli(["worktree", "ensure", "--issue", ISSUE, "--mode", "interactive", "--slug", slug, "--root", fx.repo, "--json"], fx.repo, fx.env);
      assert.equal(r.status, 2, slug);
    }
    assert.deepEqual(readdirSync(fx.wtroot), []);
  } finally { cleanup(fx); }
});

test("bundled script used", () => {
  const fx = fixture();
  try {
    const { out, calls } = run(fx);
    assert.equal(out.setup_script, "bundled");
    assert.equal(bashCalls(calls, "setup-worktree.sh")[0].args, path.join(BUNDLED, "setup-worktree.sh"));
  } finally { cleanup(fx); }
});

test("project wrapper preferred", () => {
  const fx = fixture();
  try {
    mkdirSync(path.join(fx.repo, "scripts"));
    const wrapper = path.join(fx.repo, "scripts", "setup-worktree.sh");
    writeFileSync(wrapper, `#!/usr/bin/env bash\nexec bash ${JSON.stringify(path.join(BUNDLED, "setup-worktree.sh"))} "$@"\n`);
    const { out, calls } = run(fx);
    assert.equal(out.disposition, "ready", JSON.stringify(out));
    assert.equal(out.setup_script, "project");
    assert.equal(bashCalls(calls, "setup-worktree.sh")[0].args, wrapper);
    assert.equal(out.graft_skill_dir, BUNDLED, "graft_skill_dir stays the bundled dir");
  } finally { cleanup(fx); }
});

test("missing script parks or hands over", () => {
  const fx = fixture();
  try {
    const empty = mkdtempSync(path.join(fx.parent, "no-graft-"));
    const auto = run(fx, { mode: "autonomous" }, { graftSkillDir: empty }).out;
    assert.equal(auto.disposition, "parked");
    assert.equal(auto.cause, "setup-script-unresolvable");
    assert.equal(run(fx, {}, { graftSkillDir: empty }).out.disposition, "hand-over");
  } finally { cleanup(fx); }
});

test("failed provision parks or hands over", () => {
  const fx = fixture();
  try {
    for (const [status, stdout] of [[1, "/some/path\n"], [0, ""], [0, "\n\n"]]) {
      const over = { bash: (script) => (path.basename(script) === "setup-worktree.sh" ? reply(status, stdout) : undefined) };
      const auto = run(fx, { mode: "autonomous" }, over).out;
      assert.equal(auto.disposition, "parked");
      assert.equal(auto.cause, "setup-failed");
      assert.equal(auto.detail.exit, status);
      assert.equal(auto.detail.setup_log, path.join(fx.wtroot, "setup.log"));
      assert.equal(run(fx, {}, over).out.disposition, "hand-over");
    }
  } finally { cleanup(fx); }
});

test("graft_skill_dir is the bundled dir", () => {
  const fx = fixture();
  try {
    assert.equal(we.GRAFT_SKILL_DIR, BUNDLED);
    assert.ok(existsSync(path.join(we.GRAFT_SKILL_DIR, "remote-diff-base.sh")));
    const over = { faff: (a) => (a[0] === "worktree-check" ? reply(2, JSON.stringify({ reason: "no-branch" })) : undefined) };
    assert.equal(run(fx, {}, over).out.graft_skill_dir, BUNDLED, "set on a non-ready result too");
    assert.equal(run(fx).out.graft_skill_dir, BUNDLED);
  } finally { cleanup(fx); }
});

// --- Existence and the root assert (rows 47-51) ---

function outsideWorktree(fx) {
  const elsewhere = path.join(fx.parent, "elsewhere", "FAFF-9-demo");
  git(fx.repo, "worktree", "add", "-q", "-b", "FAFF-9-demo", elsewhere, "origin/main");
  return elsewhere;
}

test("worktree outside root parks", () => {
  const fx = fixture();
  try {
    const elsewhere = outsideWorktree(fx);
    const { out } = run(fx, { mode: "autonomous" });
    assert.equal(out.disposition, "parked");
    assert.equal(out.cause, "root-outside");
    assert.equal(out.wt, elsewhere);
    assert.equal(out.detail.resolved_root, fx.wtroot);
    assert.equal(out.detail.actual, elsewhere);
  } finally { cleanup(fx); }
});

test("interactive outside root warns", () => {
  const fx = fixture();
  try {
    const elsewhere = outsideWorktree(fx);
    const { out } = run(fx);
    assert.equal(out.disposition, "ready");
    assert.equal(out.mode, "reused");
    assert.equal(out.cause, "worktree-fresh");
    assert.equal(out.resume_at, "existing");
    assert.equal(out.detail.actual, elsewhere);
    assert.ok(out.warnings.some((w) => w.includes("not under the resolved root")), JSON.stringify(out.warnings));
  } finally { cleanup(fx); }
});

test("root assert tooling failure warns", () => {
  const fx = fixture();
  try {
    const over = { git: (a) => (a[0] === "-C" && a[2] === "rev-parse" && a[3] === "--show-toplevel" && a[1] !== fx.repo ? reply(128, "", "boom") : undefined) };
    const { out } = run(fx, { mode: "autonomous" }, over);
    assert.equal(out.disposition, "ready", JSON.stringify(out));
    assert.ok(out.warnings.some((w) => w.startsWith("root assert skipped")), JSON.stringify(out.warnings));
  } finally { cleanup(fx); }
});

test("missing worktree path refuses", () => {
  const fx = fixture();
  try {
    const ghost = path.join(fx.wtroot, "ghost");
    const over = { bash: (script) => (path.basename(script) === "setup-worktree.sh" ? reply(0, `log line\n${ghost}\n`) : undefined) };
    const auto = run(fx, { mode: "autonomous" }, over).out;
    assert.equal(auto.disposition, "parked");
    assert.equal(auto.cause, "worktree-missing");
    assert.equal(auto.wt, ghost);
    assert.equal(run(fx, {}, over).out.disposition, "hand-over");
  } finally { cleanup(fx); }
});

// --- Invocation, output shape and scope ---

test("bad invocations exit 2 before anything runs", () => {
  const fx = fixture();
  try {
    const cli = (...a) => faffCli(["worktree", "ensure", "--root", fx.repo, "--json", ...a], fx.repo, fx.env);
    assert.equal(cli("--mode", "interactive", "--slug", "demo").status, 2, "missing --issue");
    assert.equal(cli("--issue", ISSUE, "--slug", "demo").status, 2, "missing --mode");
    assert.equal(cli("--issue", ISSUE, "--mode", "interactive").status, 2, "missing --slug");
    assert.equal(cli("--issue", ISSUE, "--mode", "autonomous", "--slug", "demo", "--labels", "[]").status, 2, "autonomous without a run dir");
    assert.equal(cli("--issue", ISSUE, "--mode", "autonomous", "--slug", "demo", "--run-dir", fx.runDir).status, 2, "--labels missing at the hold check");
    assert.equal(cli("--issue", ISSUE, "--mode", "autonomous", "--slug", "demo", "--run-dir", fx.runDir, "--labels", "not json").status, 2, "--labels unparseable");
    assert.equal(faffCli(["worktree", "nope"], fx.repo, fx.env).status, 2, "unknown verb");
    assert.deepEqual(readdirSync(fx.wtroot), [], "nothing was created");
    // A reused worktree in autonomous mode never reaches the hold check, so --labels is not required.
    freshWorktree(fx);
    const reused = cli("--issue", ISSUE, "--mode", "autonomous", "--slug", "demo", "--run-dir", fx.runDir);
    assert.equal(reused.status, 0, reused.stderr);
    assert.equal(JSON.parse(reused.stdout).mode, "reused");
    // $FAFF_RUN_DIR stands in for --run-dir.
    const viaEnv = faffCli(["worktree", "ensure", "--issue", ISSUE, "--mode", "autonomous", "--slug", "demo", "--root", fx.repo, "--json"], fx.repo, { ...fx.env, FAFF_RUN_DIR: fx.runDir });
    assert.equal(viaEnv.status, 0, viaEnv.stderr);
  } finally { cleanup(fx); }
});

test("every result carries every key, nulls on a non-ready result", () => {
  const fx = fixture();
  try {
    const ready = run(fx).out;
    assert.deepEqual(Object.keys(ready).sort(), KEYS);
    const parked = run(fx, { mode: "autonomous" }, { faff: (a) => (a[0] === "worktree-check" ? reply(2, JSON.stringify({ reason: "ambiguous-match" })) : undefined) }).out;
    assert.deepEqual(Object.keys(parked).sort(), KEYS);
    for (const k of ["mode", "resume_at", "setup_script", "resume"]) assert.equal(parked[k], null, k);
    assert.equal(typeof parked.detail, "object");
    const text = faffCli(["worktree", "ensure", "--issue", ISSUE, "--mode", "interactive", "--slug", "demo", "--root", fx.repo], fx.repo, fx.env);
    assert.equal(text.status, 0);
    assert.match(text.stdout, /^FAFF-9: ready — reused \(worktree-fresh\), resume at existing — /);
  } finally { cleanup(fx); }
});

test("the command makes no tracker call and spawns only the composed primitives", () => {
  const fx = fixture();
  try {
    const { hash } = pushedBranch(fx);
    stash(fx, "review-outage", "FAFF-9-demo", hash);
    const { calls } = run(fx, { mode: "autonomous", labels: JSON.stringify(["faff-awaiting-review"]) });
    const subs = new Set(calls.filter((c) => c.kind === "faff").map((c) => c.args[0]));
    for (const s of subs) assert.ok(["conventions", "worktree-check", "worktree-heal", "build-progress", "resume-store"].includes(s), s);
    const src = readFileSync(path.join(HERE, "..", "plugin", "skills", "faff", "bin", "lib", "worktree-ensure.ts"), "utf8");
    assert.doesNotMatch(src, /linear|get_issue|tracker probe|commissaire/i);
  } finally { cleanup(fx); }
});
