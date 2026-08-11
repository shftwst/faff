// setup-git-hooks.sh activates the DCO sign-off hook by pointing core.hooksPath at the
// tracked .githooks/ dir. It is shared by two callers (scripts/link-skills.sh at dev setup
// and the L3 CI runner) so it must stand alone: set the config in a real git repo, stay
// idempotent, honour --dry-run, and no-op cleanly when there is nothing to activate. The
// last test closes the loop the whole feature exists for: after activation, a plain commit
// carries a Signed-off-by trailer and an explicit `git commit -s` does not double it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync, chmodSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, "..", "..");
const SCRIPT_SRC = path.join(REPO_ROOT, "scripts", "setup-git-hooks.sh");
const HOOK_SRC = path.join(REPO_ROOT, ".githooks", "prepare-commit-msg");

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed (cwd=${cwd}): ${r.stderr}`);
  return r.stdout;
}

function rmParent(parent) {
  spawnSync("rm", ["-rf", parent]);
}

// A temp repo carrying scripts/setup-git-hooks.sh, so the script's REPO_ROOT ($SCRIPT_DIR/..)
// resolves to it. `withHooks` also copies the real .githooks/prepare-commit-msg in, so the
// activation has something to point at (and the end-to-end test can exercise it).
function makeRepo({ withHooks = true, initGit = true } = {}) {
  const parent = mkdtempSync(path.join(tmpdir(), "setup-hooks-"));
  const repo = path.join(parent, "repo");
  mkdirSync(path.join(repo, "scripts"), { recursive: true });
  cpSync(SCRIPT_SRC, path.join(repo, "scripts", "setup-git-hooks.sh"));
  if (withHooks) {
    mkdirSync(path.join(repo, ".githooks"), { recursive: true });
    cpSync(HOOK_SRC, path.join(repo, ".githooks", "prepare-commit-msg"));
    chmodSync(path.join(repo, ".githooks", "prepare-commit-msg"), 0o755);
  }
  if (initGit) {
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "dev@example.test");
    git(repo, "config", "user.name", "Dev Person");
  }
  return { parent, repo };
}

function run(repo, ...args) {
  return spawnSync("bash", [path.join(repo, "scripts", "setup-git-hooks.sh"), ...args], { encoding: "utf8" });
}

function hooksPath(repo) {
  const r = spawnSync("git", ["-C", repo, "config", "--local", "--get", "core.hooksPath"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}

test("sets core.hooksPath to .githooks in a git repo (activation)", () => {
  const { parent, repo } = makeRepo();
  try {
    const r = run(repo);
    assert.equal(r.status, 0, `exited non-zero: ${r.stderr}`);
    assert.match(r.stdout, /set core\.hooksPath → \.githooks/);
    assert.equal(hooksPath(repo), ".githooks");
  } finally {
    rmParent(parent);
  }
});

test("is idempotent: a second run reports 'already' and leaves the value unchanged", () => {
  const { parent, repo } = makeRepo();
  try {
    run(repo);
    const r = run(repo);
    assert.equal(r.status, 0, `exited non-zero: ${r.stderr}`);
    assert.match(r.stdout, /already → \.githooks/);
    assert.equal(hooksPath(repo), ".githooks");
  } finally {
    rmParent(parent);
  }
});

test("--dry-run reports the intended change and writes nothing", () => {
  const { parent, repo } = makeRepo();
  try {
    const r = run(repo, "--dry-run");
    assert.equal(r.status, 0, `exited non-zero: ${r.stderr}`);
    assert.match(r.stdout, /would set core\.hooksPath → \.githooks \(currently: unset\)/);
    assert.equal(hooksPath(repo), "", "dry-run must not write the config");
  } finally {
    rmParent(parent);
  }
});

test("no-op (exit 0) when .githooks/ is absent, safe to call unconditionally", () => {
  const { parent, repo } = makeRepo({ withHooks: false });
  try {
    const r = run(repo);
    assert.equal(r.status, 0, `must exit 0 with no .githooks/, got ${r.status}: ${r.stderr}`);
    assert.equal(hooksPath(repo), "", "must not set config when there is no hooks dir");
  } finally {
    rmParent(parent);
  }
});

test("no-op (exit 0) outside a git repository", () => {
  const { parent, repo } = makeRepo({ initGit: false });
  try {
    const r = run(repo);
    assert.equal(r.status, 0, `must exit 0 outside a git repo, got ${r.status}: ${r.stderr}`);
  } finally {
    rmParent(parent);
  }
});

test("after activation, a plain commit is signed off and `git commit -s` does not duplicate it", () => {
  const { parent, repo } = makeRepo();
  try {
    run(repo);

    // A plain commit, no -s: the hook must add exactly one Signed-off-by for the git identity.
    writeFileSync(path.join(repo, "a.txt"), "a\n");
    git(repo, "add", "a.txt");
    git(repo, "commit", "-q", "-m", "feat: a");
    const body1 = git(repo, "show", "-s", "--format=%B", "HEAD");
    const trailers1 = body1.split("\n").filter((l) => l.startsWith("Signed-off-by:"));
    assert.deepEqual(trailers1, ["Signed-off-by: Dev Person <dev@example.test>"]);

    // An explicit -s commit: interpret-trailers keys on the token, so still exactly one.
    writeFileSync(path.join(repo, "b.txt"), "b\n");
    git(repo, "add", "b.txt");
    git(repo, "commit", "-q", "-s", "-m", "feat: b");
    const body2 = git(repo, "show", "-s", "--format=%B", "HEAD");
    const count2 = body2.split("\n").filter((l) => l.startsWith("Signed-off-by:")).length;
    assert.equal(count2, 1, "explicit -s must not produce a duplicate Signed-off-by");
  } finally {
    rmParent(parent);
  }
});
