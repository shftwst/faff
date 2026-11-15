// FAFF-1454 — the bundled setup-worktree.sh refuses what `faff worktree ensure` refuses, by itself,
// so a direct or hook invocation is covered too: a symlink or an existing entry at the worktree path,
// a branch that already exists on origin, and a worktree root it cannot resolve (never a $HOME guess).
// Each case drives the real script against temporary git repos, with FAFF_WORKTREE_ROOT pointing at a
// temp dir and HOME pointing at an empty temp dir.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, realpathSync, rmSync, chmodSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, "..", "plugin", "skills", "faff-graft", "setup-worktree.sh");
const FAFF_BIN_DIR = path.resolve(HERE, "..", "plugin", "skills", "faff", "bin");

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

// A main checkout (with a bare origin unless gitOnly), an empty worktree root and an empty HOME.
function fixture({ gitOnly = false } = {}) {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), "faff-setup-wt-")));
  const repo = path.join(parent, "repo");
  const wtroot = path.join(parent, "wtroot");
  const home = path.join(parent, "home");
  const origin = path.join(parent, "origin.git");
  for (const d of [repo, wtroot, home]) mkdirSync(d);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@t.test");
  git(repo, "config", "user.name", "t");
  writeFileSync(path.join(repo, "a.txt"), "one\n");
  git(repo, "add", "a.txt");
  git(repo, "commit", "-q", "-m", "init");
  if (!gitOnly) {
    git(parent, "init", "-q", "--bare", origin);
    git(parent, "--git-dir", origin, "symbolic-ref", "HEAD", "refs/heads/main");
    git(repo, "remote", "add", "origin", origin);
    git(repo, "push", "-q", "origin", "main");
  }
  const env = { ...process.env, HOME: home, FAFF_WORKTREE_ROOT: wtroot, SKIP_NPM_PACKAGES_INSTALL: "1", PATH: `${FAFF_BIN_DIR}${path.delimiter}${process.env.PATH ?? ""}` };
  delete env.CLAUDE_PLUGIN_ROOT;
  delete env.FAFF_WORKTREE_BASE_REF;
  return { parent, repo, wtroot, home, origin, env };
}

const cleanup = (fx) => rmSync(fx.parent, { recursive: true, force: true });

function runScript(fx, name, env = fx.env) {
  return spawnSync("bash", [SCRIPT, name, fx.repo], { cwd: fx.repo, env, encoding: "utf8" });
}

const registered = (fx) => git(fx.repo, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).length;
const localBranch = (fx, b) => spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${b}`], { cwd: fx.repo }).status === 0;
const setupLog = (fx) => (existsSync(path.join(fx.wtroot, "setup.log")) ? readFileSync(path.join(fx.wtroot, "setup.log"), "utf8") : "");

// Push a branch to origin, then drop it locally.
function pushRemoteOnly(fx, branch) {
  git(fx.repo, "branch", "-q", branch);
  git(fx.repo, "push", "-q", "origin", branch);
  git(fx.repo, "branch", "-q", "-D", branch);
}

// A bin dir holding only the named tools, so `faff` is reachable only when a test puts it there.
function restrictedBin(fx, names) {
  const bin = mkdtempSync(path.join(fx.parent, "bin-"));
  for (const name of names) {
    const r = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" });
    const target = r.stdout.trim();
    if (r.status === 0 && target.startsWith("/")) symlinkSync(target, path.join(bin, name));
  }
  return bin;
}

test("control: the script creates a worktree under the resolved root", () => {
  const fx = fixture();
  try {
    const r = runScript(fx, "FAFF-9-x");
    assert.equal(r.status, 0, setupLog(fx));
    assert.equal(r.stdout.trim(), path.join(fx.wtroot, "FAFF-9-x"));
    assert.equal(registered(fx), 2);
    assert.equal(existsSync(path.join(fx.home, ".faff")), false);
  } finally { cleanup(fx); }
});

test("a symlink at the worktree path exits 1 and registers nothing", () => {
  for (const dangling of [false, true]) {
    const fx = fixture();
    try {
      const outside = path.join(fx.parent, "outside");
      if (!dangling) mkdirSync(outside);
      symlinkSync(outside, path.join(fx.wtroot, "FAFF-9-x"));
      const r = runScript(fx, "FAFF-9-x");
      assert.equal(r.status, 1, `dangling=${dangling}`);
      assert.equal(registered(fx), 1, `dangling=${dangling}: only the main checkout`);
      assert.equal(localBranch(fx, "FAFF-9-x"), false);
      assert.match(setupLog(fx), /FATAL: .*FAFF-9-x is a symlink/);
      if (!dangling) assert.deepEqual(readdirSync(outside), [], "nothing is written through the link");
    } finally { cleanup(fx); }
  }
});

test("an existing entry at the worktree path exits 1 and registers nothing", () => {
  for (const kind of ["dir", "file"]) {
    const fx = fixture();
    try {
      const at = path.join(fx.wtroot, "FAFF-9-x");
      if (kind === "dir") mkdirSync(at); else writeFileSync(at, "x\n");
      const r = runScript(fx, "FAFF-9-x");
      assert.equal(r.status, 1, kind);
      assert.equal(registered(fx), 1, kind);
      assert.match(setupLog(fx), /FATAL: .*FAFF-9-x already exists/);
    } finally { cleanup(fx); }
  }
});

test("a branch already on origin exits 1 and creates no local branch", () => {
  const fx = fixture();
  try {
    pushRemoteOnly(fx, "FAFF-9-x");
    const r = runScript(fx, "FAFF-9-x");
    assert.equal(r.status, 1);
    assert.equal(localBranch(fx, "FAFF-9-x"), false);
    assert.equal(registered(fx), 1);
    assert.match(setupLog(fx), /FATAL: origin already has branch FAFF-9-x/);
  } finally { cleanup(fx); }
});

test("a slashed name is refused when origin has the flattened or the real branch", () => {
  for (const pushed of ["feature-FAFF-9-x", "feature/FAFF-9-x"]) {
    const fx = fixture();
    try {
      pushRemoteOnly(fx, pushed);
      const r = runScript(fx, "feature/FAFF-9-x");
      assert.equal(r.status, 1, pushed);
      assert.equal(localBranch(fx, "feature-FAFF-9-x"), false, pushed);
      assert.match(setupLog(fx), new RegExp(`FATAL: origin already has branch ${pushed}`));
    } finally { cleanup(fx); }
  }
});

test("a pinned base does not bypass the origin check, and a failed check fails closed", () => {
  const fx = fixture();
  try {
    pushRemoteOnly(fx, "FAFF-9-x");
    const tip = git(fx.repo, "rev-parse", "main");
    const r = runScript(fx, "FAFF-9-x", { ...fx.env, FAFF_WORKTREE_BASE_REF: tip });
    assert.equal(r.status, 1);
    assert.equal(localBranch(fx, "FAFF-9-x"), false);
    assert.match(setupLog(fx), /FATAL: origin already has branch FAFF-9-x/);
  } finally { cleanup(fx); }
  const fx2 = fixture();
  try {
    // The pinned path tolerates a failed fetch, so an unreachable origin first shows up at the check.
    git(fx2.repo, "remote", "set-url", "origin", path.join(fx2.parent, "gone.git"));
    const tip = git(fx2.repo, "rev-parse", "main");
    const r = runScript(fx2, "FAFF-9-x", { ...fx2.env, FAFF_WORKTREE_BASE_REF: tip });
    assert.equal(r.status, 1);
    assert.equal(localBranch(fx2, "FAFF-9-x"), false);
    assert.match(setupLog(fx2), /FATAL: could not check origin for branch FAFF-9-x \(git ls-remote exit [0-9]+\)/);
  } finally { cleanup(fx2); }
});

test("a failed worktree-root lookup exits 1 and never falls back to $HOME", () => {
  for (const [label, body] of [["exit 1", 'echo "boom" >&2; exit 1'], ["empty output", "exit 0"]]) {
    const fx = fixture();
    try {
      const stub = mkdtempSync(path.join(fx.parent, "stub-"));
      writeFileSync(path.join(stub, "faff"), `#!/usr/bin/env bash\nif [ "$1" = "worktree-root" ]; then ${body}; fi\nexit 0\n`);
      chmodSync(path.join(stub, "faff"), 0o755);
      const r = runScript(fx, "FAFF-9-x", { ...fx.env, PATH: `${stub}${path.delimiter}${process.env.PATH ?? ""}` });
      assert.equal(r.status, 1, label);
      const want = label === "exit 1" ? "exit 1" : "exit 0";
      assert.ok(r.stderr.split("\n").some((l) => l.startsWith(`setup-worktree: faff worktree-root failed (${want}); refusing to fall back to $HOME`)), `${label}: ${r.stderr}`);
      assert.equal(existsSync(path.join(fx.home, ".faff")), false, `${label}: HOME gains no .faff`);
      assert.deepEqual(readdirSync(fx.wtroot), [], `${label}: nothing is created`);
      assert.equal(registered(fx), 1, label);
    } finally { cleanup(fx); }
  }
});

test("no resolvable faff binary exits 1 and never falls back to $HOME", () => {
  const fx = fixture();
  try {
    const bin = restrictedBin(fx, ["bash", "sh", "dirname", "basename", "tr", "git", "cat", "node", "date", "mkdir"]);
    const env = { ...fx.env, PATH: bin };
    delete env.CLAUDE_PLUGIN_ROOT;
    assert.notEqual(spawnSync("sh", ["-c", "command -v faff"], { env, encoding: "utf8" }).status, 0, "fixture invariant: faff is not on PATH");
    const r = runScript(fx, "FAFF-9-x", env);
    assert.equal(r.status, 1, r.stderr);
    assert.ok(r.stderr.split("\n").some((l) => l.startsWith("setup-worktree: no faff binary resolvable")), r.stderr);
    assert.equal(existsSync(path.join(fx.home, ".faff")), false, "HOME gains no .faff");
    assert.deepEqual(readdirSync(fx.wtroot), []);
  } finally { cleanup(fx); }
});
