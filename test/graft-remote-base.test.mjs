// FAFF-708 — graft's coupled diff instructions (review input + its review-progress hash, the
// resume-at-review recompute, and the Step 8b build-progress hash) must all derive from the FETCHED
// remote default branch, never a hardcoded local `main` / `origin/main`. The prose owns these as
// three fenced shell blocks, each immediately under a stable heading:
//   - `Remote-backed review diff`      (Step 9 — captures the diff ONCE, hashes those exact bytes)
//   - `Remote-backed resume diff`      (Step 3 — recomputes the checkpoint hash)
//   - `Remote-backed build-progress diff` (Step 8b — durable checkpoint hash)
// This test locates each by the single-block-under-a-stable-heading anchor (NOT a fuzzy grep of any
// `git diff`-shaped line — the anchor is the integrity boundary: an unrelated doc edit cannot smuggle
// a different command into the executed block), executes it in a stale-local-main / newer-remote
// fixture, and asserts the three share one diff identity: the remote-only sibling commit is excluded,
// the feature commit is included, and every hash equals the review block's captured-file digest.
// It also asserts none of the three blocks contains a literal `main...HEAD` or hardcoded `origin/main`
// base — the prompt-regression guard for the coupled twins.
//
// Integrity boundary (infosec, spec §3): the extracted blocks are committed, PR-reviewed content
// (trusted-command-source class), located by a stable structural anchor, and executed only inside a
// disposable git fixture. Runtime graft never extracts-and-executes Markdown — only this harness does,
// to prove the prose and the behaviour agree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, "..");
const GRAFT_SKILL_DIR = path.join(REPO_ROOT, "plugin", "skills", "faff-graft");
const SKILL_MD = path.join(GRAFT_SKILL_DIR, "SKILL.md");

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

// Extract the SINGLE fenced ```bash block immediately following the stable heading line. The
// heading is the bold-with-period marker `**<heading>.**` at the start of a line — cross-references
// elsewhere use the period-less bold `**<heading>**` mid-sentence, so this anchors the true heading
// only. "Immediately" = the next fenced block after the heading line; a body edit elsewhere cannot
// substitute a different block. Asserts exactly one heading match and that a bash fence follows.
function extractBlock(md, heading) {
  const marker = `**${heading}.**`;
  const lines = md.split("\n");
  const headingIdxs = lines.reduce((acc, l, i) => (l.startsWith(marker) ? [...acc, i] : acc), []);
  assert.equal(headingIdxs.length, 1, `expected exactly one heading line "${marker}", found ${headingIdxs.length}`);
  let i = headingIdxs[0] + 1;
  while (i < lines.length && !/^```bash\s*$/.test(lines[i])) {
    // Only whitespace/prose may sit between the heading and its block — never another fence.
    assert.ok(!/^```/.test(lines[i]), `a non-bash fence appears before the "${heading}" block`);
    i++;
  }
  assert.ok(i < lines.length, `no \`\`\`bash block found under "${heading}"`);
  const start = i + 1;
  let end = start;
  while (end < lines.length && !/^```\s*$/.test(lines[end])) end++;
  assert.ok(end < lines.length, `unterminated \`\`\`bash block under "${heading}"`);
  return lines.slice(start, end).join("\n");
}

const MD = readFileSync(SKILL_MD, "utf8");
const REVIEW_BLOCK = extractBlock(MD, "Remote-backed review diff");
const RESUME_BLOCK = extractBlock(MD, "Remote-backed resume diff");
const BUILDPROG_BLOCK = extractBlock(MD, "Remote-backed build-progress diff");

// Run an extracted block with an appended `echo "$<var>"`, capturing that variable's value from the
// last stdout line. env supplies the placeholders the block references ($branch, $diff_file).
function runBlock(block, cwd, echoVar, env) {
  const script = `${block}\necho "$${echoVar}"`;
  const r = spawnSync("bash", ["-c", script], {
    cwd,
    encoding: "utf8",
    // graft_skill_dir is the faff-graft skill dir the blocks resolve remote-diff-base.sh under
    // (in a real graft run the skill knows its own dir, resolved as in Step 3).
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", graft_skill_dir: GRAFT_SKILL_DIR, ...env },
  });
  assert.equal(r.status, 0, `block for $${echoVar} exited non-zero: ${r.stderr}`);
  return { value: r.stdout.trim().split("\n").pop().trim(), stdout: r.stdout };
}

function rmParent(parent) {
  spawnSync("rm", ["-rf", parent]);
}

// Fixture: origin/main = A→B; a work checkout whose LOCAL main is stale at A; a feature branch based
// on origin/main (B) with feature commit C, pushed to origin. The honest three-dot review diff
// (origin/main...HEAD) shows ONLY C; the buggy local (main...HEAD) would also show B.
function setupFixture() {
  const parent = mkdtempSync(path.join(tmpdir(), "faff708-graft-"));
  const origin = path.join(parent, "origin.git");
  git(parent, "init", "--bare", "-b", "main", "origin.git");

  const seed = path.join(parent, "seed");
  git(parent, "clone", "-q", origin, "seed");
  git(seed, "config", "user.email", "t@t.test");
  git(seed, "config", "user.name", "t");
  commitFile(seed, "A.txt", "A\n", "commit A (base)");
  git(seed, "push", "-q", "origin", "HEAD:main");

  // work: cloned while origin is at A, so local main stays stale at A.
  const work = path.join(parent, "work");
  git(parent, "clone", "-q", origin, "work");
  git(work, "config", "user.email", "t@t.test");
  git(work, "config", "user.name", "t");
  const shaA = git(work, "rev-parse", "HEAD").trim();

  // Advance origin/main to B (the just-merged sibling) via seed; work's local main is NOT advanced.
  const shaB = commitFile(seed, "B.txt", "B\n", "commit B (remote-only sibling)");
  git(seed, "push", "-q", "origin", "HEAD:main");

  // Fetch so origin/main is known locally (graft's blocks fetch too, but the feature branch must be
  // based on the true remote base B), then branch feature off origin/main and add feature commit C.
  git(work, "fetch", "-q", "origin", "main");
  const branch = "faff-708-feature";
  git(work, "checkout", "-q", "-b", branch, "origin/main");
  const shaC = commitFile(work, "C.txt", "C\n", "commit C (feature)");
  git(work, "push", "-q", "origin", `${branch}:${branch}`); // origin/<branch> == HEAD, for the remote-ref diffs

  // Local main stays stale at A (never fast-forwarded) — the whole point.
  assert.equal(git(work, "rev-parse", "main").trim(), shaA, "fixture invariant: local main must stay stale at A");
  return { parent, work, branch, shaA, shaB, shaC };
}

test("the three coupled graft diff blocks share one remote-based diff identity (FAFF-708)", () => {
  const fx = setupFixture();
  const diffFile = path.join(fx.parent, "review.diff");
  try {
    // Review block: captures the diff once to $diff_file and hashes those exact bytes into cur_hash.
    const review = runBlock(REVIEW_BLOCK, fx.work, "cur_hash", { branch: fx.branch, diff_file: diffFile });
    assert.ok(existsSync(diffFile), "review block must write the captured diff to $diff_file");
    const captured = readFileSync(diffFile, "utf8");
    // The remote-only sibling (B) is excluded; the feature commit (C) is included.
    assert.ok(captured.includes("C.txt"), "captured review diff must include the feature commit's file (C.txt)");
    assert.ok(!captured.includes("B.txt"), "captured review diff must EXCLUDE the remote-only sibling (B.txt)");
    // cur_hash is the digest of those exact bytes (no second git diff).
    const expected = createHash("sha256").update(captured).digest("hex");
    assert.equal(review.value, expected, "cur_hash must be the sha256 of the captured diff file");

    // Resume block: recomputes the checkpoint hash — must equal the review block's hash for this diff.
    const resume = runBlock(RESUME_BLOCK, fx.work, "cur", { branch: fx.branch });
    assert.equal(resume.value, review.value, "resume-diff hash must equal the review-diff hash (one identity)");

    // Build-progress block: durable checkpoint hash — must also equal the review block's hash.
    const buildprog = runBlock(BUILDPROG_BLOCK, fx.work, "diff_hash", { branch: fx.branch });
    assert.equal(buildprog.value, review.value, "build-progress hash must equal the review-diff hash (one identity)");
  } finally {
    rmParent(fx.parent);
  }
});

// Direct coverage of the remote-diff-base.sh helper the three blocks share — the fail-loud base
// resolver is a named oracle in its own right, not only via the extracted blocks.
const HELPER = path.join(GRAFT_SKILL_DIR, "remote-diff-base.sh");

function runHelper(cwd, env = {}) {
  return spawnSync("bash", [HELPER], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
  });
}

test("remote-diff-base.sh prints the fetched remote default (incl. non-`main`), and fails loud when origin is unreachable (FAFF-708)", () => {
  // Reuse a stale fixture: origin default = trunk, work checkout is a clone of it.
  const parent = mkdtempSync(path.join(tmpdir(), "faff708-helper-"));
  try {
    git(parent, "init", "--bare", "-b", "trunk", "origin.git");
    const seed = path.join(parent, "seed");
    git(parent, "clone", "-q", path.join(parent, "origin.git"), "seed");
    git(seed, "config", "user.email", "t@t.test");
    git(seed, "config", "user.name", "t");
    commitFile(seed, "A.txt", "A\n", "A");
    git(seed, "push", "-q", "origin", "HEAD:trunk");
    const work = path.join(parent, "work");
    git(parent, "clone", "-q", path.join(parent, "origin.git"), "work");

    const ok = runHelper(work);
    assert.equal(ok.status, 0, `helper exited non-zero on a reachable remote: ${ok.stderr}`);
    assert.equal(ok.stdout.trim(), "origin/trunk", "helper must print the resolved non-main default (origin/trunk)");

    // Unreachable origin -> non-zero, no base printed (never a stale fall-back).
    git(work, "remote", "set-url", "origin", path.join(parent, "gone.git"));
    const bad = runHelper(work, { FAFF_GIT_NET_TIMEOUT: "5" });
    assert.notEqual(bad.status, 0, "helper must fail loud when origin cannot be reached");
    assert.equal(bad.stdout.trim(), "", "helper must print no base on failure (no stale fall-back)");
  } finally {
    rmParent(parent);
  }
});

test("remote-diff-base.sh falls back to the locally-resolved default in a no-origin (git-only) repo (FAFF-708)", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "faff708-helper-local-"));
  const repo = path.join(parent, "repo");
  mkdirSync(repo);
  try {
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "t@t.test");
    git(repo, "config", "user.name", "t");
    commitFile(repo, "A.txt", "A\n", "A");
    const r = runHelper(repo);
    assert.equal(r.status, 0, `git-only helper exited non-zero: ${r.stderr}`);
    assert.equal(r.stdout.trim(), "main", "git-only helper must print the local default branch, no origin/ prefix");
  } finally {
    rmParent(parent);
  }
});

test("remote-diff-base.sh fails loud in a no-origin repo whose default branch is neither main nor master (FAFF-708)", () => {
  // Mirrors merge-gate.js resolveLocalBase: check main then master, refuse if neither exists.
  const parent = mkdtempSync(path.join(tmpdir(), "faff708-helper-neither-"));
  const repo = path.join(parent, "repo");
  mkdirSync(repo);
  try {
    git(repo, "init", "-q", "-b", "trunk");
    git(repo, "config", "user.email", "t@t.test");
    git(repo, "config", "user.name", "t");
    commitFile(repo, "A.txt", "A\n", "A"); // only `trunk` exists — no main, no master
    const r = runHelper(repo);
    assert.notEqual(r.status, 0, "helper must refuse when neither local main nor master exists (no bogus master)");
    assert.equal(r.stdout.trim(), "", "helper must print no base when it cannot resolve one");
  } finally {
    rmParent(parent);
  }
});

// FAFF-744 — the SSH-transport bound. Build a stub dir containing ONLY a symlinked real `git` plus
// a fake `ssh`, so PATH resolution never finds a real `timeout`/`gtimeout` — reproducing the
// "stock macOS without coreutils" host the ticket targets — while `git` itself still works. The
// fake `ssh` records its own invocation (argv) to a log file and exits 1 immediately: git's ssh
// transport then fails fast (no real network hang needed to prove the resolver bounds it — the
// bound is on the RECORDED command git would have run, which is what the assertions check).
const REAL_GIT = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim() || "/usr/bin/git";
// spawnSync resolves its own executable ("bash") through whatever `env.PATH` is passed to it (not
// the current process's PATH), so a stub PATH containing only `git`+`ssh` would otherwise fail to
// even find `bash` itself — resolve it to an absolute path once, up front.
const REAL_BASH = spawnSync("sh", ["-c", "command -v bash"], { encoding: "utf8" }).stdout.trim() || "/bin/bash";

function makeSshStubDir() {
  const stubDir = mkdtempSync(path.join(tmpdir(), "faff744-sshstub-"));
  symlinkSync(REAL_GIT, path.join(stubDir, "git"));
  const sshLog = path.join(stubDir, "ssh-invocations.log");
  const sshStub = path.join(stubDir, "ssh");
  writeFileSync(sshStub, `#!/bin/sh\nprintf '%s\\n' "$0 $*" >> "${sshLog}"\nexit 1\n`);
  chmodSync(sshStub, 0o755);
  return { stubDir, sshLog };
}

// Repo with an ssh-shaped origin (no real remote needs to exist — the stub `ssh` intercepts before
// any real connection attempt).
function makeSshOriginRepo() {
  const repo = mkdtempSync(path.join(tmpdir(), "faff744-repo-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@t.test");
  git(repo, "config", "user.name", "t");
  commitFile(repo, "A.txt", "A\n", "A");
  git(repo, "remote", "add", "origin", "git@example.invalid:some-org/some-repo.git");
  return repo;
}

test("SSH origin, no timeout/gtimeout binary: net_git's ssh carries BatchMode=yes + ConnectTimeout=<NET_TIMEOUT>, resolver fails loud within a bounded wall-clock, prints no base (FAFF-744)", () => {
  const { stubDir, sshLog } = makeSshStubDir();
  const repo = makeSshOriginRepo();
  try {
    // Sanity: the stub dir alone resolves neither `timeout` nor `gtimeout` — reproducing the
    // "stock macOS without coreutils" host this test targets.
    const hasTimeout = spawnSync("sh", ["-c", "command -v timeout"], { env: { PATH: stubDir } });
    const hasGtimeout = spawnSync("sh", ["-c", "command -v gtimeout"], { env: { PATH: stubDir } });
    assert.notEqual(hasTimeout.status, 0, "test fixture invariant: `timeout` must not resolve on the stub PATH");
    assert.notEqual(hasGtimeout.status, 0, "test fixture invariant: `gtimeout` must not resolve on the stub PATH");

    const start = Date.now();
    const r = spawnSync(REAL_BASH, [HELPER], {
      cwd: repo,
      encoding: "utf8",
      env: { PATH: stubDir, GIT_TERMINAL_PROMPT: "0", FAFF_GIT_NET_TIMEOUT: "5" },
    });
    const elapsedMs = Date.now() - start;

    // (b) bounded wall-clock, non-zero, no base printed — the stub fails the connection immediately,
    // so this also proves the resolver doesn't hang waiting on anything else in that path.
    assert.notEqual(r.status, 0, "resolver must fail loud on a black-holed/unreachable SSH origin");
    assert.equal(r.stdout.trim(), "", "resolver must print no base on failure (no stale fall-back)");
    assert.ok(elapsedMs < 15000, `resolver took ${elapsedMs}ms — expected a bounded, fast failure`);

    // (a) the ssh invocation net_git() ran carries the default bound.
    assert.ok(existsSync(sshLog), "the stub ssh must have been invoked at least once");
    const invocations = readFileSync(sshLog, "utf8");
    assert.ok(invocations.includes("BatchMode=yes"), "ssh invocation must carry -o BatchMode=yes");
    assert.ok(invocations.includes("ConnectTimeout=5"), "ssh invocation must carry -o ConnectTimeout=<NET_TIMEOUT>");
    assert.ok(invocations.includes("ServerAliveInterval=5"), "ssh invocation must carry -o ServerAliveInterval=<NET_TIMEOUT>");
    assert.ok(invocations.includes("ServerAliveCountMax=1"), "ssh invocation must carry -o ServerAliveCountMax=1");
  } finally {
    rmParent(stubDir);
    rmParent(repo);
  }
});

test("operator-set GIT_SSH_COMMAND is passed through verbatim — never clobbered, never appended to (FAFF-744)", () => {
  const { stubDir, sshLog } = makeSshStubDir();
  const repo = makeSshOriginRepo();
  // The operator's own transport command: an absolute path (avoids PATH lookup ambiguity) to a
  // second recorder plus a marker flag that is unmistakably theirs, not faff's default bound.
  const operatorLog = path.join(stubDir, "operator-ssh-invocations.log");
  const operatorSsh = path.join(stubDir, "operator-ssh");
  writeFileSync(operatorSsh, `#!/bin/sh\nprintf '%s\\n' "$0 $*" >> "${operatorLog}"\nexit 1\n`);
  chmodSync(operatorSsh, 0o755);
  const operatorCommand = `${operatorSsh} --operator-owns-this-transport`;
  try {
    const r = spawnSync(REAL_BASH, [HELPER], {
      cwd: repo,
      encoding: "utf8",
      env: {
        PATH: stubDir,
        GIT_TERMINAL_PROMPT: "0",
        FAFF_GIT_NET_TIMEOUT: "5",
        GIT_SSH_COMMAND: operatorCommand,
      },
    });
    assert.notEqual(r.status, 0, "resolver must still fail loud (the operator stub also refuses the connection)");
    assert.equal(r.stdout.trim(), "", "resolver must print no base on failure");

    // The faff-default ssh stub (plain `ssh` on PATH) must NEVER have been invoked.
    assert.ok(!existsSync(sshLog), "faff's default ssh bound must not run when the operator set GIT_SSH_COMMAND");

    // The operator's own command was invoked, byte-identically to what they set — no appended
    // -o BatchMode / -o ConnectTimeout, no clobbering.
    assert.ok(existsSync(operatorLog), "the operator's own GIT_SSH_COMMAND must have been invoked");
    const invocations = readFileSync(operatorLog, "utf8");
    assert.ok(invocations.includes("--operator-owns-this-transport"), "the operator's own flag must be present");
    assert.ok(!invocations.includes("BatchMode=yes"), "faff must not append its own -o BatchMode to an operator-set command");
    assert.ok(!invocations.includes("ConnectTimeout="), "faff must not append its own -o ConnectTimeout to an operator-set command");
  } finally {
    rmParent(stubDir);
    rmParent(repo);
  }
});

test("no coupled graft diff block hardcodes a `main...HEAD` or `origin/main` base (FAFF-708 prompt-regression guard)", () => {
  for (const [name, block] of [
    ["Remote-backed review diff", REVIEW_BLOCK],
    ["Remote-backed resume diff", RESUME_BLOCK],
    ["Remote-backed build-progress diff", BUILDPROG_BLOCK],
  ]) {
    assert.ok(!block.includes("main...HEAD"), `${name} block must not hardcode a local \`main...HEAD\` base`);
    assert.ok(!block.includes("origin/main"), `${name} block must not hardcode an \`origin/main\` base`);
    // Each block must derive its base from the fail-loud remote-diff-base.sh helper (which resolves
    // the default branch from the remote's advertised symref), not an inline hardcoded ref.
    assert.ok(
      block.includes("remote-diff-base.sh"),
      `${name} block must resolve its base via the remote-diff-base.sh helper`,
    );
  }
});
