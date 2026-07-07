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
const baseEnv = (repo, extra = {}) => ({ ...process.env, HOME, ...extra, FAFF_WORKTREE_ROOT: extra.FAFF_WORKTREE_ROOT ?? "" });

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
