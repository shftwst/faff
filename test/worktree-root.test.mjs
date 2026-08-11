// FAFF-382 — `faff worktree-root`: the single canonical worktree-root resolver + the
// `--assert` containment gate that makes the FAFF-379-verified isolation property bind.
// Exercises the real entrypoint via runCli (arg parsing, exit codes, --json seam) and the
// linked-worktree main-checkout mapping the graft Step-3 assert depends on. Per ADR 0002 —
// assert the deterministic seam (stdout / exit / parsed JSON), never prose.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runCli } from "./helpers/run-cli.mjs";

// A throwaway git repo so findRoot/mainWorktreeRoot anchor there. `home` is where the
// default root lands (HOME/.faff/worktrees/<repo>).
function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-wtr-"));
  spawnSync("git", ["-C", dir, "init", "-q"], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", "init"], {
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  });
  return dir;
}
const HOME = "/home/faff-test";
// FAFF-561 — build a HERMETIC child env: only what `node`/`git` need to run (PATH) plus the
// fixed HOME sentinel, never `...process.env`. Spreading the ambient environment leaks git-context
// vars (GIT_DIR / GIT_COMMON_DIR / GIT_WORK_TREE / …) into the spawned resolver's default-source
// `git rev-parse --git-common-dir` probe, redirecting it off the fixture repo — the concurrent-
// worktree flake this file's `default`-source assertions used to hit. An allow-list closes the
// whole ambient-leak class where a GIT_* deny-list would not. `extra` is the escape hatch the
// env-source (FAFF_WORKTREE_ROOT) and config-source (on-disk .faffrc.yaml) tests rely on.
const baseEnv = (repo, extra = {}) => {
  const env = { HOME, PATH: process.env.PATH, ...extra };
  if (!("FAFF_WORKTREE_ROOT" in extra)) env.FAFF_WORKTREE_ROOT = "";
  return env;
};

test("worktree-root --selftest passes", () => {
  const { code } = runCli(["worktree-root", "--selftest"]);
  assert.equal(code, 0);
});

test("default resolves to HOME/.faff/worktrees/<basename(repo)>, source default", () => {
  const repo = tmpRepo();
  const { stdout, code } = runCli(["worktree-root", "--json"], { cwd: repo, env: baseEnv(repo) });
  assert.equal(code, 0);
  const out = JSON.parse(stdout);
  assert.equal(out.source, "default");
  assert.equal(out.root, path.join(HOME, ".faff/worktrees", path.basename(repo)));
});

test("FAFF_WORKTREE_ROOT wins, used verbatim (no <repo> suffix), source env", () => {
  const repo = tmpRepo();
  const { stdout } = runCli(["worktree-root", "--json"], { cwd: repo, env: baseEnv(repo, { FAFF_WORKTREE_ROOT: "/custom/wt" }) });
  const out = JSON.parse(stdout);
  assert.equal(out.source, "env");
  assert.equal(out.root, "/custom/wt");
});

test(".faffrc worktree_root wins when no env, verbatim, source config", () => {
  const repo = tmpRepo();
  fs.writeFileSync(path.join(repo, ".faffrc.yaml"), "worktree_root: /cfg/wt\n");
  const { stdout } = runCli(["worktree-root", "--json"], { cwd: repo, env: baseEnv(repo) });
  const out = JSON.parse(stdout);
  assert.equal(out.source, "config");
  assert.equal(out.root, "/cfg/wt");
});

test("--assert: a path strictly UNDER the resolved root exits 0", () => {
  const repo = tmpRepo();
  const root = path.join(HOME, ".faff/worktrees", path.basename(repo));
  const { code } = runCli(["worktree-root", "--assert", path.join(root, "some-branch")], { cwd: repo, env: baseEnv(repo) });
  assert.equal(code, 0);
});

test("--assert: a path OUTSIDE the resolved root exits 1, naming path + root", () => {
  const repo = tmpRepo();
  const { code, stderr } = runCli(["worktree-root", "--assert", "/somewhere/else/br"], { cwd: repo, env: baseEnv(repo) });
  assert.equal(code, 1);
  assert.match(stderr, /\/somewhere\/else\/br/);
  assert.match(stderr, /not under the resolved root/);
});

test("--assert: the resolved root itself is NOT strictly under (exit 1)", () => {
  const repo = tmpRepo();
  const root = path.join(HOME, ".faff/worktrees", path.basename(repo));
  const { code } = runCli(["worktree-root", "--assert", root], { cwd: repo, env: baseEnv(repo) });
  assert.equal(code, 1);
});

// The graft Step-3 assert runs with cwd = the linked worktree. findRoot() there returns the
// worktree, whose basename is the branch dir — so the default <repo> suffix must be mapped
// back to the MAIN checkout (mainWorktreeRoot), else the resolved root diverges from the hook's
// and the assert false-refuses. This is the single-source guarantee across the dispatch.
test("single-source: from a linked worktree, the resolved root equals the main-checkout root", () => {
  const repo = tmpRepo();
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "faff-wtr-linked-")) + "/wt";
  const add = spawnSync("git", ["-C", repo, "worktree", "add", "-q", "-b", "feat-x", wt], { encoding: "utf8" });
  assert.equal(add.status, 0, add.stderr);
  const fromMain = JSON.parse(runCli(["worktree-root", "--json"], { cwd: repo, env: baseEnv(repo) }).stdout);
  const fromWt = JSON.parse(runCli(["worktree-root", "--json"], { cwd: wt, env: baseEnv(repo) }).stdout);
  assert.equal(fromWt.root, fromMain.root, "linked worktree resolves the same root as the main checkout");
  assert.equal(fromWt.root, path.join(HOME, ".faff/worktrees", path.basename(repo)));
});

// FAFF-561 regression guard — the ambient-leak reproducer. The default-source flake tracked the
// host's git-worktree topology because `baseEnv` spread `...process.env`, forwarding ambient
// git-context vars (set when the suite runs inside a build worktree) into the child's git probe.
// Here we set those vars in THIS process's environment — exactly as a live concurrent-worktree
// host would — pointing at an UNRELATED repo, then resolve the default source. With the pre-fix
// spread the probe would follow the ambient GIT_DIR to `bogus` and the root basename would diverge;
// the hermetic `baseEnv` forwards none of them, so the probe stays anchored to the fixture repo.
test("default source ignores ambient git-context env vars (FAFF-561 regression guard)", () => {
  const repo = tmpRepo();
  const bogus = tmpRepo(); // an unrelated, valid git dir the ambient env points at — must NOT be followed
  const saved = { ...process.env };
  // Simulate the leak: ambient git-context vars redirecting repo discovery off the fixture repo.
  process.env.GIT_DIR = path.join(bogus, ".git");
  process.env.GIT_COMMON_DIR = path.join(bogus, ".git");
  process.env.GIT_WORK_TREE = bogus;
  try {
    const { stdout, code } = runCli(["worktree-root", "--json"], { cwd: repo, env: baseEnv(repo) });
    assert.equal(code, 0);
    const out = JSON.parse(stdout);
    assert.equal(out.source, "default");
    assert.equal(out.root, path.join(HOME, ".faff/worktrees", path.basename(repo)));
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
