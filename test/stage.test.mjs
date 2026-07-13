// FAFF-457 — `faff stage-guard` + the selective-staging build-safety chokepoint.
// Closes the PR #258 vector: a bulk `git add -A` in a build worktree sweeping a stray
// untracked secret (`.env`) into a committed, pushed tree. Exercises the real entrypoint
// via runCli (arg parsing, exit codes, --json seam) against throwaway git repos, plus the
// born-verifiable scenarios: the selective build commit never carries the secret, and the
// sentry-abort WIP commit is still resumable while omitting it. Per ADR 0002 — assert the
// deterministic seam (stdout / exit / parsed JSON / the real git tree), never prose.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runCli } from "./helpers/run-cli.mjs";

const GENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
};

// A throwaway git repo with one committed file. Returns { dir, g } where g runs
// a `git -C <dir>` command and returns trimmed stdout.
function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-stage-"));
  const g = (...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8", env: GENV }).stdout?.trim() ?? "";
  g("init", "-q");
  // Repo-LOCAL committer identity — GENV only reaches git commands run through `g`;
  // the sentry-abort WIP commit runs inside the `faff sentry abort` CLI child, which
  // does NOT inherit GENV, so a global-config-less environment (CI) leaves that nested
  // `git commit` with no identity and it silently no-ops (no WIP sha). Repo-local config
  // is read by every git process in this repo, child included — so the WIP commit lands
  // in CI exactly as it does locally. (FAFF-457: the -z parse + secret-skip are correct;
  // this was the sole CI-only gap.)
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "README.md"), "hello\n");
  g("add", "--", "README.md");
  g("commit", "-q", "-m", "init");
  return { dir, g };
}
const write = (dir, rel, body) => fs.writeFileSync(path.join(dir, rel), body);

// ---------------------------------------------------------------- selftest ---
test("stage-guard --selftest passes (classification table)", () => {
  assert.equal(runCli(["stage-guard", "--selftest"]).code, 0);
});

// -------------------------------------------------------------- assert mode ---
test("assert: clean index exits 0", () => {
  const { dir, g } = tmpRepo();
  write(dir, "feature.js", "x\n");
  g("add", "--", "feature.js");
  assert.equal(runCli(["stage-guard", "--worktree", dir, "--mode", "assert"]).code, 0);
});

test("assert: a staged secret-class path exits 1 and names it", () => {
  const { dir, g } = tmpRepo();
  write(dir, ".env", "SECRET=live\n");
  g("add", "-f", "--", ".env");
  const { code, stdout } = runCli(["stage-guard", "--worktree", dir, "--mode", "assert", "--json"]);
  assert.equal(code, 1);
  const j = JSON.parse(stdout);
  assert.equal(j.ok, false);
  assert.deepEqual(j.secret_staged, [".env"]);
});

test("assert: a staged *.example template is NOT secret-class (allowlist), exits 0", () => {
  const { dir, g } = tmpRepo();
  write(dir, ".env.example", "SECRET=\n");
  g("add", "--", ".env.example");
  assert.equal(runCli(["stage-guard", "--worktree", dir, "--mode", "assert"]).code, 0);
});

test("assert: `.pub` is exempt ONLY for the SSH key family — a `.env.*.pub` is still caught", () => {
  const { dir, g } = tmpRepo();
  write(dir, "id_rsa.pub", "ssh-rsa AAAA...\n");   // public key — exempt
  write(dir, ".env.prod.pub", "SECRET=live\n");    // NOT the key family — still secret-class
  g("add", "-f", "--", "id_rsa.pub", ".env.prod.pub");
  const { code, stdout } = runCli(["stage-guard", "--worktree", dir, "--mode", "assert", "--json"]);
  assert.equal(code, 1);
  const j = JSON.parse(stdout);
  assert.deepEqual(j.secret_staged, [".env.prod.pub"], "id_rsa.pub is exempt; .env.prod.pub is not");
});

// -------------------------------------------------------------- filter mode ---
test("filter: unstages the secret-class path, reports it, exits 0", () => {
  const { dir, g } = tmpRepo();
  write(dir, ".env", "SECRET\n");
  write(dir, "keep.js", "code\n");
  g("add", "-f", "--", ".env", "keep.js");
  const { code, stdout } = runCli(["stage-guard", "--worktree", dir, "--mode", "filter", "--json"]);
  assert.equal(code, 0);
  const j = JSON.parse(stdout);
  assert.deepEqual(j.unstaged, [".env"]);
  const staged = g("diff", "--cached", "--name-only").split("\n").filter(Boolean);
  assert.ok(staged.includes("keep.js"), "the intended file stays staged");
  assert.ok(!staged.includes(".env"), ".env was unstaged");
});

// ----------------------------------------------------------------- wip mode ---
test("wip: stages tracked edits + non-secret untracked, drops the secret, stays resumable", () => {
  const { dir, g } = tmpRepo();
  write(dir, "README.md", "changed\n");   // tracked edit
  write(dir, "newfile.js", "x\n");        // untracked, intended
  write(dir, ".env", "SECRET\n");         // untracked, stray secret
  const { code, stdout } = runCli(["stage-guard", "--worktree", dir, "--mode", "wip", "--json"]);
  assert.equal(code, 0);
  const j = JSON.parse(stdout);
  assert.equal(j.staged_nonempty, true);
  assert.deepEqual(j.skipped, [".env"]);
  const staged = g("diff", "--cached", "--name-only").split("\n").filter(Boolean);
  assert.ok(staged.includes("README.md") && staged.includes("newfile.js"));
  assert.ok(!staged.includes(".env"), ".env is never staged in the WIP");
});

// ------------------------------------------------- usage / not-a-repo faults ---
test("bad --mode exits 2; a non-repo worktree exits 2", () => {
  assert.equal(runCli(["stage-guard", "--worktree", ".", "--mode", "bogus"]).code, 2);
  const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), "faff-nonrepo-"));
  assert.equal(runCli(["stage-guard", "--worktree", nonRepo, "--mode", "assert"]).code, 2);
});

// ---------------------------------------- born-verifiable: the build commit ---
test("build commit: selective stage + assert → the secret never reaches the tree", () => {
  const { dir, g } = tmpRepo();
  write(dir, "README.md", "edit\n");   // tracked edit
  write(dir, "feature.js", "code\n");  // intended new file
  write(dir, ".env", "SECRET=live\n"); // stray untracked secret (NOT gitignored)
  // The prescribed selective stage: `git add -u` + explicit new path — NEVER `git add -A`.
  g("add", "-u");
  g("add", "--", "feature.js");
  // The guard is clean because .env was never staged.
  assert.equal(runCli(["stage-guard", "--worktree", dir, "--mode", "assert"]).code, 0);
  g("commit", "-q", "-m", "build");
  const tree = g("ls-tree", "-r", "--name-only", "HEAD").split("\n").filter(Boolean);
  assert.ok(tree.includes("feature.js"), "the intended file is committed");
  assert.ok(!tree.includes(".env"), ".env is absent from the committed tree");
});

// ------------------------------------ born-verifiable: sentry-abort WIP commit ---
function mkRun(dir, id) {
  const rd = path.join(dir, ".faff", "runs", id);
  fs.mkdirSync(rd, { recursive: true });
  const ledger = { run_id: id, admitted: ["FAFF-9"], outcomes: {}, owner: { status: "running", started_at: "2020-01-01T00:00:00Z", last_heartbeat: "2020-01-01T00:00:00Z" } };
  fs.writeFileSync(path.join(rd, "run-ledger.json"), JSON.stringify(ledger, null, 2) + "\n");
  return rd;
}

test("sentry abort: a resumable WIP commit is created and the untracked .env is not in it", () => {
  const { dir, g } = tmpRepo();
  const rd = mkRun(dir, "r");
  write(dir, "feature.txt", "wip\n");   // untracked, legitimate in-flight work
  write(dir, ".env", "SECRET\n");       // untracked, stray secret
  const r = runCli(["sentry", "abort", "--run-dir", rd, "--issue", "FAFF-9", "--signal", "budget-breach", "--worktree", dir, "--json"]);
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, "aborted-resumable");
  assert.ok(out.wip_commit, "a resumable WIP sha is still produced");
  assert.deepEqual(out.wip_skipped_secret_class, [".env"], "the skipped secret is reported");
  // The committed WIP tree carries the work but NOT the secret.
  const tree = g("ls-tree", "-r", "--name-only", "HEAD").split("\n").filter(Boolean);
  assert.ok(tree.includes("feature.txt"), "in-flight work is preserved");
  assert.ok(!tree.includes(".env"), ".env never reached the WIP commit");
  // And it is recorded on the ledger for the operator.
  const led = JSON.parse(fs.readFileSync(path.join(rd, "run-ledger.json"), "utf8"));
  assert.deepEqual(led.abort.wip_skipped_secret_class, [".env"]);
});
