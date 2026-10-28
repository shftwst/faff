// FAFF-1405: `faff gates run --budget-secs N --resume`. Drives the real CLI on throwaway git repos
// whose rungs are package.json `sleep` scripts, so each case controls exactly when a unit finishes
// relative to the budget and the ceiling (budget + min(60, budget) on the call clock). Budgets leave
// at least a second of slack either side of every boundary, so a loaded host stays deterministic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");

function env(extra = {}) {
  const e = { ...process.env, ...extra };
  delete e.NODE_TEST_CONTEXT;
  return e;
}

function git(dir, ...args) {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), "faff-gates-budget-"));
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), body);
  }
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.invalid");
  git(dir, "config", "user.name", "t");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
}

const pkg = (scripts) => ({ "package.json": JSON.stringify({ scripts }) });

function gates(dir, args, extraEnv) {
  const r = spawnSync("node", [CLI, "gates", "run", "--root", dir, ...args], { encoding: "utf8", env: env(extraEnv) });
  let json = null;
  if (args.includes("--json")) { try { json = JSON.parse(r.stdout); } catch { /* not JSON */ } }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

const contractBlock = (stdout) => (stdout.match(/```faff-contract:quality-gates\n([^\n]*)\n```/) || [])[1];
const progressFile = (dir) => join(dir, ".faff", "gates", "run-progress.json");
const readProgress = (dir) => JSON.parse(readFileSync(progressFile(dir), "utf8"));

test("an incomplete call exits 3 with no contract block, and --resume finishes with the uninterrupted contract", () => {
  const dir = repo(pkg({ lint: "sleep 1", test: "sleep 6" }));
  const first = gates(dir, ["--json", "--budget-secs", "5"]);
  assert.equal(first.status, 3, first.stderr);
  assert.equal(first.json.status, "incomplete");
  assert.equal(first.json.units_done, 1);
  assert.equal(first.json.units_total, 2);
  assert.equal("contract" in first.json, false);
  assert.equal("signal" in first.json, false);
  // A budget cut is discarded: only the finished lint unit is in progress.
  assert.deepEqual(readProgress(dir).done.map((u) => [u.rung_index, u.unit, u.status]), [[0, "whole", "pass"]]);

  const second = gates(dir, ["--json", "--resume", "--budget-secs", "5"]);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.json.resumed.calls, 2);
  assert.equal("discarded" in second.json.resumed, false);
  assert.equal(existsSync(progressFile(dir)), false);

  const plain = gates(dir, []);
  const resumedText = gates(dir, ["--budget-secs", "5"]);   // fresh progress; finishes in two calls below
  assert.equal(resumedText.status, 3);
  const finished = gates(dir, ["--resume", "--budget-secs", "5"]);
  assert.equal(finished.status, 0);
  assert.equal(contractBlock(finished.stdout), contractBlock(plain.stdout));
});

test("the non-JSON exit-3 output is the single incomplete line, preceded by the discard line when set", () => {
  const dir = repo(pkg({ lint: "sleep 1", test: "sleep 6" }));
  const r = gates(dir, ["--budget-secs", "3"]);
  assert.equal(r.status, 3);
  assert.equal(r.stdout, "gate ladder: incomplete (budget 3s): 1 of 2 units done; run again with --resume\n");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { lint: "sleep 1", test: "sleep 6" } }) + "\n");
  const again = gates(dir, ["--resume", "--budget-secs", "3"]);
  assert.equal(again.status, 3);
  assert.equal(again.stdout, "progress discarded: tree-changed\ngate ladder: incomplete (budget 3s): 1 of 2 units done; run again with --resume\n");
});

test("a tree change, a plan change and stale progress each discard the progress", () => {
  const dir = repo(pkg({ lint: "sleep 1", test: "sleep 6" }));
  assert.equal(gates(dir, ["--budget-secs", "3"]).status, 3);
  writeFileSync(join(dir, "untracked.txt"), "new\n");
  assert.equal(gates(dir, ["--json", "--resume", "--budget-secs", "3"]).json.discarded, "tree-changed");

  mkdirSync(join(dir, ".faff"), { recursive: true });
  writeFileSync(join(dir, ".faff", "config.yaml"), "gates:\n  rung_timeout_ms: 900000\n");
  assert.equal(gates(dir, ["--json", "--resume", "--budget-secs", "3"]).json.discarded, "plan-changed");

  const p = readProgress(dir);
  p.written_at = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  writeFileSync(progressFile(dir), JSON.stringify(p));
  const stale = gates(dir, ["--json", "--resume", "--budget-secs", "3"]);
  assert.equal(stale.json.discarded, "stale");
  assert.equal(stale.json.units_done, 1);
});

test("changing gates.run_budget_secs does not change the plan", () => {
  const dir = repo(pkg({ lint: "sleep 1", test: "sleep 6" }));
  mkdirSync(join(dir, ".faff"), { recursive: true });
  writeFileSync(join(dir, ".faff", "config.yaml"), "gates:\n  run_budget_secs: 3\n");
  assert.equal(gates(dir, ["--resume"]).status, 3);
  writeFileSync(join(dir, ".faff", "config.yaml"), "gates:\n  run_budget_secs: 4\n");
  const r = gates(dir, ["--json", "--resume"]);
  const discarded = r.json.status === "incomplete" ? r.json.discarded : r.json.resumed.discarded;
  assert.equal(discarded, undefined);
  if (r.json.status !== "incomplete") assert.equal(r.json.resumed.calls, 2);
});

test("a unit that cannot finish by the ceiling is recorded errored, the run ends needs-human, and a higher ceiling retries it", () => {
  const dir = repo(pkg({ lint: "sleep 4", test: "true" }));
  const t0 = Date.now();
  const first = gates(dir, ["--json", "--resume", "--budget-secs", "1"]);   // ceiling 2 s
  assert.ok(Date.now() - t0 < 4000, "the call stopped at the ceiling, not when the unit finished");
  assert.equal(first.status, 3);
  assert.equal(first.json.units_done, 1);
  const rec = readProgress(dir).done[0];
  assert.equal(rec.reason, "exceeds-call-budget");
  assert.equal(rec.ceiling_secs, 2);

  const second = gates(dir, ["--json", "--resume", "--budget-secs", "1"]);
  assert.equal(second.status, 1);
  assert.equal(second.json.signal, "needs-human");
  assert.deepEqual(second.json.contract.rungs, [{ kind: "LINT", status: "errored" }, { kind: "UNIT", status: "pass" }]);

  // Leave a ceiling cut behind again, then resume under a budget whose ceiling is higher.
  rmSync(progressFile(dir), { force: true });
  assert.equal(gates(dir, ["--resume", "--budget-secs", "1"]).status, 3);
  const retried = gates(dir, ["--json", "--resume", "--budget-secs", "8"]);
  assert.equal(retried.status, 0, retried.stdout);
  assert.equal(retried.json.contract.rungs[0].status, "pass");
});

test("a call whose first unit outlasts the budget still runs it to the ceiling, and units_done rises every exit-3 call", () => {
  const dir = repo(pkg({ lint: "sleep 3", typecheck: "sleep 3", test: "true" }));
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const r = gates(dir, ["--json", "--resume", "--budget-secs", "2"]);   // ceiling 4 s
    if (r.status !== 3) { assert.ok(r.status === 0 || r.status === 1, r.stdout + r.stderr); break; }
    seen.push(r.json.units_done);
  }
  assert.ok(seen.length >= 1);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] > seen[i - 1], `units_done ${seen}`);
});

test("a malformed or symlinked progress file is reported unreadable and never used", () => {
  const dir = repo(pkg({ lint: "sleep 1", test: "sleep 6" }));
  assert.equal(gates(dir, ["--budget-secs", "3"]).status, 3);
  writeFileSync(progressFile(dir), "{not json");
  assert.equal(gates(dir, ["--json", "--resume", "--budget-secs", "3"]).json.discarded, "unreadable");
  const real = join(dir, "elsewhere.json");
  writeFileSync(real, readFileSync(progressFile(dir)));
  rmSync(progressFile(dir));
  symlinkSync(real, progressFile(dir));
  const r = gates(dir, ["--json", "--resume", "--budget-secs", "3"]);
  assert.equal(r.json.discarded, "unreadable");
});

test("a symlinked .faff/gates exits 2 progress-dir-unsafe and writes nothing through it", () => {
  const dir = repo(pkg({ lint: "true" }));
  const target = mkdtempSync(join(tmpdir(), "faff-gates-target-"));
  mkdirSync(join(dir, ".faff"));
  symlinkSync(target, join(dir, ".faff", "gates"));
  const r = gates(dir, ["--budget-secs", "3"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /progress-dir-unsafe/);
  assert.equal(existsSync(join(target, "run-progress.json")), false);
  assert.equal(existsSync(join(target, ".gitignore")), false);
});

test("a tracked .faff/gates/.gitignore that does not ignore progress exits 2 and is left untouched", () => {
  const dir = repo({ ...pkg({ lint: "true" }), ".faff/gates/.gitignore": "keep-me\n" });
  const r = gates(dir, ["--budget-secs", "3"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /progress-file-not-ignored/);
  assert.equal(readFileSync(join(dir, ".faff", "gates", ".gitignore"), "utf8"), "keep-me\n");
});

test("progress redacts configured and secret-shaped values from a failing unit, stores no pass detail, and is ignored by git", () => {
  const dir = repo({
    // A CI `run: node --test` step is the shard-capable UNIT rung the file pool splits.
    ".github/workflows/ci.yml": "on: pull_request\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node --test\n",
    ".faff/config.yaml": "gates:\n  local_test_files: t/*.test.mjs\n  local_shard_concurrency: 1\nbackends:\n  x:\n    api_key_env: GATES_BUDGET_TEST_KEY\n",
    // Largest first in the pool, so the failing file runs, then the slow one is cut.
    "t/a.test.mjs": `import { test } from "node:test";\n// ${"padding ".repeat(40)}\ntest("leaks", () => { throw "key " + process.env.GATES_BUDGET_TEST_KEY + " token=abcdefghijklmnop"; });\n`,
    "t/b.test.mjs": `import { test } from "node:test";\ntest("slow", async () => { await new Promise((r) => setTimeout(r, 15000)); });\n`,
  });
  const r = gates(dir, ["--json", "--budget-secs", "3"], { GATES_BUDGET_TEST_KEY: "configured-secret-value-123" });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  const raw = readFileSync(progressFile(dir), "utf8");
  assert.equal(raw.includes("configured-secret-value-123"), false);
  assert.equal(raw.includes("abcdefghijklmnop"), false);
  const rec = readProgress(dir).done.find((u) => u.unit === "file:t/a.test.mjs");
  assert.equal(rec.status, "fail");
  assert.match(rec.detail, /\[REDACTED\]/);                // the configured secret value
  assert.match(rec.detail, /\[redacted\]/);                // the secret-shaped token=… value
  assert.equal(readFileSync(join(dir, ".faff", "gates", ".gitignore"), "utf8"), "*\n");
  assert.equal(git(dir, "status", "--porcelain"), "");
});

test("--clear-progress deletes the progress, runs nothing, and refuses other flags", () => {
  const dir = repo(pkg({ lint: "sleep 1", test: "sleep 6" }));
  assert.equal(gates(dir, ["--budget-secs", "3"]).status, 3);
  const c = gates(dir, ["--clear-progress"]);
  assert.equal(c.status, 0);
  assert.equal(c.stdout, "");
  assert.equal(existsSync(progressFile(dir)), false);
  assert.equal(gates(dir, ["--clear-progress", "--resume"]).status, 2);
});

test("--budget-secs accepts only an integer from 1 to 480, and an oversized config budget is clamped", () => {
  const dir = repo(pkg({ lint: "true" }));
  for (const bad of ["0", "-1", "1.5", "481", "abc"]) {
    assert.equal(gates(dir, ["--budget-secs", bad]).status, 2, bad);
  }
  assert.equal(gates(dir, ["--budget-secs"]).status, 2);
  mkdirSync(join(dir, ".faff"), { recursive: true });
  writeFileSync(join(dir, ".faff", "config.yaml"), "gates:\n  run_budget_secs: 600\n");
  const r = gates(dir, ["--json", "--resume"]);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /gates\.run_budget_secs 600 is above 480; clamped to 480/);
});

test("gates.run_budget_secs defaults to 420", () => {
  const dir = repo(pkg({ lint: "true" }));
  const r = spawnSync("node", [CLI, "config", "get", "gates.run_budget_secs"], { cwd: dir, encoding: "utf8", env: env() });
  assert.equal(r.stdout.trim(), "420");
});

test("either flag outside a git work tree exits 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-gates-nogit-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { lint: "true" } }));
  assert.equal(gates(dir, ["--budget-secs", "3"]).status, 2);
  assert.equal(gates(dir, ["--resume"]).status, 2);
});

test("with neither flag, a run neither reads, writes nor deletes a progress file", () => {
  const dir = repo(pkg({ lint: "true" }));
  mkdirSync(join(dir, ".faff", "gates"), { recursive: true });
  writeFileSync(progressFile(dir), "sentinel");
  const r = gates(dir, ["--json"]);
  assert.equal(r.status, 0);
  assert.equal("resumed" in r.json, false);
  assert.equal(readFileSync(progressFile(dir), "utf8"), "sentinel");
});
