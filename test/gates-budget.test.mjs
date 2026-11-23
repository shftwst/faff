// FAFF-1405: `faff gates run --budget-secs N --resume`. Drives the real CLI on throwaway git repos
// whose rungs are package.json `sleep` scripts, so each case controls exactly when a unit finishes
// relative to the budget and the ceiling (budget + min(60, budget) on the call clock). Budgets leave
// at least a second of slack either side of every boundary, so a loaded host stays deterministic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

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

function ownedRun(dir, name = "active", status = "running") {
  const runDir = join(dir, ".faff", "runs", name);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ owner: { status } }));
  return runDir;
}

const contractBlock = (stdout) => (stdout.match(/```faff-contract:quality-gates\n([^\n]*)\n```/) || [])[1];
const progressFile = (dir) => join(dir, ".faff", "gates", "run-progress.json");
const readProgress = (dir) => JSON.parse(readFileSync(progressFile(dir), "utf8"));

for (const [name, files, signal, gateExit, contractExit] of [
  ["passing", pkg({ test: "true" }), "pass", 0, 0],
  ["failing", pkg({ lint: "false", test: "true" }), "fail", 1, 0],
  ["errored", pkg({ test: "exit 127" }), "needs-human", 1, 0],
  ["undiscovered", { "README.md": "empty ladder" }, "needs-human", 1, 1],
  ["advisory", { ".faffrc.yaml": "gates:\n  fallback: advisory\n" }, "pass", 0, 0],
]) {
  test(`a finished ${name} ladder reports the quality-gates decision`, (t) => {
    const dir = repo(files);
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    for (const flags of [[], ["--resume"]]) {
      const result = gates(dir, ["--json", ...flags]);
      assert.equal(result.status, gateExit, result.stderr);
      assert.equal(result.json.signal, signal);
      const validated = spawnSync(process.execPath, [CLI, "contract", "quality-gates"], {
        input: JSON.stringify(result.json.contract), encoding: "utf8", env: env(),
      });
      assert.equal(validated.status, contractExit, validated.stderr);
      const { signal: validatedSignal, violations } = JSON.parse(validated.stdout);
      assert.deepEqual(result.json.receipt, { signal: validatedSignal, violations });
      assert.equal(result.json.receipt.signal, signal);
    }
  });
}

test("bounded gates tick the explicit run and unit before work and on either terminal outcome", (t) => {
  const dir = repo({
    ...pkg({ test: "node probe.cjs" }),
    "probe.cjs": [
      'const fs = require("node:fs");',
      'const run = ".faff/runs/active";',
      'const first = fs.readFileSync(run + "/heartbeat", "utf8");',
      'if (first !== fs.readFileSync(run + "/heartbeat.ABC-1", "utf8")) process.exit(2);',
      'fs.writeFileSync(run + "/probe", first);',
      'fs.unlinkSync(run + "/heartbeat");',
      'fs.unlinkSync(run + "/heartbeat.ABC-1");',
      'process.exit(Number(process.env.PROBE_EXIT));',
    ].join("\n"),
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const active = ownedRun(dir);
  const peer = ownedRun(dir, "peer");
  for (const exit of [0, 1]) {
    rmSync(join(active, "probe"), { force: true });
    const result = gates(dir, ["--resume", "--json", "--run-dir", active, "--unit", "ABC-1"], {
      PROBE_EXIT: String(exit), FAFF_RUN_DIR: peer,
    });
    assert.equal(result.status, exit, result.stderr);
    assert.equal(result.json.receipt.signal, exit === 0 ? "pass" : "fail");
    const atEntry = readFileSync(join(active, "probe"), "utf8");
    const atExit = readFileSync(join(active, "heartbeat"), "utf8");
    assert.ok(Date.parse(atExit.trim()) >= Date.parse(atEntry.trim()));
    assert.equal(readFileSync(join(active, "heartbeat.ABC-1"), "utf8"), atExit);
    assert.equal(existsSync(join(peer, "heartbeat")), false);
  }
});

test("a quiet gate stays fresh past the owner's stall window and stops renewing when it returns", async (t) => {
  const owner = repo({ ".faffrc.yaml": "sentry:\n  stall_window_secs: 1\n" });
  const run = ownedRun(owner);
  const dir = repo({
    ...pkg({ test: "node pause.cjs" }),
    "pause.cjs": [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'const file = (name) => path.join(process.env.PROBE_RUN, name);',
      'const read = (name) => fs.readFileSync(file(name), "utf8").trim();',
      'const entry = read("heartbeat");',
      'setTimeout(() => {',
      '  const observation = { entry, run: read("heartbeat"), unit: read("heartbeat.ABC-1"), now: Date.now() };',
      '  fs.writeFileSync(file("in-gate.json"), JSON.stringify(observation));',
      '}, 2500);',
    ].join("\n"),
  });
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(owner, { recursive: true, force: true });
  });
  const { cmdGates } = require(join(dirname(CLI), "lib/gates-cli.js"));
  const { evalWallClock, evalMemberStall, sentryThresholds } = require(join(dirname(CLI), "lib/sentry.js"));
  t.mock.method(console, "log", () => {});
  const oldProbe = process.env.PROBE_RUN;
  process.env.PROBE_RUN = run;
  t.after(() => {
    if (oldProbe === undefined) delete process.env.PROBE_RUN;
    else process.env.PROBE_RUN = oldProbe;
  });
  assert.equal(await cmdGates(["run", "--root", dir, "--resume", "--run-dir", run, "--unit", "ABC-1"]), 0);
  const sample = JSON.parse(readFileSync(join(run, "in-gate.json"), "utf8"));
  const thresholds = sentryThresholds({ sentry: { stall_window_secs: 1 } });
  const classifyRun = (timestamp) => evalWallClock({ owner: { status: "running", last_heartbeat: timestamp } }, sample.now, thresholds);
  const classifyMember = (timestamp) => evalMemberStall([{ issue: "ABC-1" }], { "ABC-1": timestamp }, sample.now, thresholds);
  assert.equal(classifyRun(sample.entry).evidence.tripped_on, "heartbeat-staleness");
  assert.equal(classifyMember(sample.entry).length, 1);
  assert.equal(classifyRun(sample.run), null);
  assert.deepEqual(classifyMember(sample.unit), []);

  const finalTick = readFileSync(join(run, "heartbeat"), "utf8");
  await new Promise((resolve) => setTimeout(resolve, 750));
  assert.equal(readFileSync(join(run, "heartbeat"), "utf8"), finalTick);
  assert.equal(readFileSync(join(run, "heartbeat.ABC-1"), "utf8"), finalTick);
});

test("only an explicit, valid heartbeat target on a bounded run can refresh liveness", (t) => {
  const dir = repo(pkg({ test: "true" }));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const active = ownedRun(dir);
  const closed = ownedRun(dir, "closed", "done");
  const ambient = { FAFF_RUN_DIR: active };
  assert.equal(gates(dir, ["--resume", "--json"], ambient).status, 0);
  assert.equal(gates(dir, ["--resume", "--json", "--run-dir", closed, "--unit", "ABC-1"], ambient).status, 0);
  for (const args of [
    ["--run-dir", active, "--unit", "ABC-1"],
    ["--resume", "--run-dir", active],
    ["--resume", "--unit", "ABC-1"],
    ["--resume", "--run-dir", "", "--unit", "ABC-1"],
    ["--resume", "--run-dir", active, "--unit", "../other"],
    ["--resume", "--run-dir", join(dir, "missing"), "--unit", "ABC-1"],
    ["--clear-progress", "--run-dir", active, "--unit", "ABC-1"],
    ["--budget-secs", "0", "--run-dir", active, "--unit", "ABC-1"],
  ]) {
    assert.equal(gates(dir, args, ambient).status, 2, JSON.stringify(args));
  }
  for (const run of [active, closed]) {
    assert.equal(existsSync(join(run, "heartbeat")), false);
    assert.equal(existsSync(join(run, "heartbeat.ABC-1")), false);
  }
});

test("a contradictory pass keeps its raw contract and produces a needs-human receipt", (t) => {
  const { printOutcome } = require(join(dirname(CLI), "lib", "gates-cli.js"));
  const output = t.mock.method(console, "log", () => {});
  const outcome = { signal: "pass", rungs: [{ kind: "LINT", status: "fail" }] };
  assert.equal(printOutcome(outcome, true), 1);
  const result = JSON.parse(output.mock.calls[0].arguments[0]);
  assert.deepEqual(result.contract, outcome);
  assert.deepEqual(result.receipt, {
    signal: "needs-human", violations: ["pass signal but a rung has status fail"],
  });
});

test("an unavailable quality-gates schema withholds a passing receipt", async (t) => {
  const dir = repo({ ".faffrc.yaml": "gates:\n  fallback: advisory\n" });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { cmdGates } = require(join(dirname(CLI), "lib", "gates-cli.js"));
  const fs = require("node:fs");
  const read = fs.readFileSync;
  t.mock.method(fs, "readFileSync", (path, ...args) => {
    if (String(path).endsWith("quality-gates.schema.json")) throw new Error("unreadable schema");
    return read(path, ...args);
  });
  const output = t.mock.method(console, "log", () => {});
  const error = t.mock.method(process.stderr, "write", () => true);
  assert.equal(await cmdGates(["run", "--root", dir, "--json"]), 2);
  assert.equal(output.mock.callCount(), 0);
  assert.match(error.mock.calls[0].arguments[0], /quality-gates validation failed:.*unreadable schema/);
});

test("an incomplete call exits 3 with no contract block, and --resume finishes with the uninterrupted contract", () => {
  const dir = repo(pkg({ lint: "sleep 1", test: "sleep 6" }));
  const run = ownedRun(dir);
  const target = ["--run-dir", run, "--unit", "ABC-1"];
  const first = gates(dir, ["--json", "--budget-secs", "5", ...target]);
  const firstTick = readFileSync(join(run, "heartbeat.ABC-1"), "utf8");
  assert.equal(first.status, 3, first.stderr);
  assert.equal(first.json.status, "incomplete");
  assert.equal(first.json.units_done, 1);
  assert.equal(first.json.units_total, 2);
  assert.equal("contract" in first.json, false);
  assert.equal("receipt" in first.json, false);
  assert.equal("signal" in first.json, false);
  // A budget cut is discarded: only the finished lint unit is in progress.
  assert.deepEqual(readProgress(dir).done.map((u) => [u.rung_index, u.unit, u.status]), [[0, "whole", "pass"]]);

  const second = gates(dir, ["--json", "--resume", "--budget-secs", "5", ...target]);
  assert.ok(Date.parse(readFileSync(join(run, "heartbeat.ABC-1"), "utf8").trim()) > Date.parse(firstTick.trim()));
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.json.resumed.calls, 2);
  assert.deepEqual(second.json.receipt, { signal: "pass", violations: [] });
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
  const run = ownedRun(dir);
  const t0 = Date.now();
  const first = gates(dir, ["--json", "--resume", "--budget-secs", "1", "--run-dir", run, "--unit", "ABC-1"], { FAFF_RUN_HEARTBEAT_STALE_SECS: "1" });   // ceiling 2 s
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

test("a finished run that discarded progress reports resumed.discarded and one call", () => {
  const dir = repo(pkg({ lint: "sleep 1", test: "sleep 6" }));
  assert.equal(gates(dir, ["--budget-secs", "3"]).status, 3);
  writeFileSync(join(dir, "untracked.txt"), "edit\n");
  const r = gates(dir, ["--json", "--resume", "--budget-secs", "20"]);
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(r.json.resumed, { calls: 1, discarded: "tree-changed" });
});

test("units recorded in matching progress are not run again", () => {
  const mark = join(mkdtempSync(join(tmpdir(), "faff-gates-mark-")), "runs.log");
  const dir = repo(pkg({ lint: `echo run >> ${mark} && sleep 1`, test: "sleep 6" }));
  assert.equal(gates(dir, ["--budget-secs", "3"]).status, 3);
  assert.equal(gates(dir, ["--resume", "--budget-secs", "20"]).status, 0);
  assert.equal(readFileSync(mark, "utf8"), "run\n");
});

test("a required rung that fails after a resume ends the ladder with exit 1 and deletes the progress", () => {
  const dir = repo(pkg({ lint: "sleep 1", test: "sleep 4 && false" }));
  assert.equal(gates(dir, ["--budget-secs", "2"]).status, 3);
  assert.equal(existsSync(progressFile(dir)), true);
  const r = gates(dir, ["--json", "--resume", "--budget-secs", "10"]);
  assert.equal(r.status, 1);
  assert.equal(r.json.signal, "fail");
  assert.equal(existsSync(progressFile(dir)), false);
});

// A CI `run: node --test` step is the shard-capable UNIT rung the file pool splits.
const POOL_CI = "on: pull_request\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node --test\n";
const quickTest = `import { test } from "node:test";\n// ${"padding ".repeat(40)}\ntest("quick", () => {});\n`;
const slowTest = `import { test } from "node:test";\ntest("slow", async () => { await new Promise((r) => setTimeout(r, 12000)); });\n`;

test("editing an ignored pool test file between calls reports plan-changed", () => {
  const dir = repo({
    ".github/workflows/ci.yml": POOL_CI,
    ".gitignore": "t/local.test.mjs\n",
    ".faff/config.yaml": "gates:\n  local_test_files: t/*.test.mjs\n  local_shard_concurrency: 1\n",
    "t/a.test.mjs": quickTest,
    "t/b.test.mjs": slowTest,
  });
  writeFileSync(join(dir, "t", "local.test.mjs"), `import { test } from "node:test";\ntest("local", () => {});\n`);
  assert.equal(gates(dir, ["--budget-secs", "3"]).status, 3);
  writeFileSync(join(dir, "t", "local.test.mjs"), `import { test } from "node:test";\ntest("local edited", () => {});\n`);
  assert.equal(gates(dir, ["--json", "--resume", "--budget-secs", "3"]).json.discarded, "plan-changed");
});

test("progress is rewritten after each recorded unit, so a killed call keeps what it finished", async () => {
  const dir = repo({
    ".github/workflows/ci.yml": POOL_CI,
    ".faff/config.yaml": "gates:\n  local_test_files: t/*.test.mjs\n  local_shard_concurrency: 1\n",
    "t/a.test.mjs": quickTest,
    "t/b.test.mjs": slowTest,
  });
  const child = spawn("node", [CLI, "gates", "run", "--root", dir, "--budget-secs", "60"], { env: env(), stdio: "ignore" });
  const deadline = Date.now() + 20000;
  while (!existsSync(progressFile(dir)) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  child.kill("SIGKILL");
  await new Promise((r) => child.on("exit", r));
  const units = readProgress(dir).done.map((u) => u.unit);
  assert.deepEqual(units, ["file:t/a.test.mjs"]);
});

test("setup time before the first unit does not shorten that unit's ceiling", async () => {
  const { runBudgetedLadder } = require("../plugin/skills/faff/bin/lib/gates-select.js");
  const dir = repo(pkg({ lint: "sleep 3" }));
  // Setup takes 3 s, longer than the 2 s budget. Measured from the call's start the 4 s ceiling would
  // cut the 3 s unit after 1 s; measured on the call clock, the unit finishes inside it.
  const afterSetup = () => new Promise((r) => setTimeout(r, 3000));
  const res = await runBudgetedLadder(dir, { budgetSecs: 2, resume: false, afterSetup });
  assert.ok(res.outcome, JSON.stringify(res));
  assert.ok(res.outcome.setup_ms >= 3000);
  assert.equal(res.outcome.rungs[0].status, "pass");
});
