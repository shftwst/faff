import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { runCli } from "./helpers/run-cli.mjs";

const issue = "ISS-1";
const head = "a".repeat(40);
const pushed = "b".repeat(40);
const other = "c".repeat(40);
const cli = fileURLToPath(new URL("../plugin/skills/faff/bin/faff", import.meta.url));
const require = createRequire(import.meta.url);

test("the current landing progress schema is additive over legacy evidence", () => {
  const { classifySchemaChange } = require("../plugin/skills/faff/bin/lib/evidence.js");
  const rel = "schema/landing-progress.schema.json";
  const bundled = readFileSync(new URL(`../plugin/skills/faff/contracts/evidence-v0.3/${rel}`, import.meta.url));
  assert.deepEqual(bundled, readFileSync(new URL(`../verification/evidence/v0.3/${rel}`, import.meta.url)));
  const current = JSON.parse(bundled);
  const legacy = structuredClone(current);
  delete legacy.properties.attempt;
  delete legacy.properties.history.items.properties.attempt_id;
  assert.deepEqual(classifySchemaChange(legacy, current), { additive: true, reasons: [] });
});

function fixture(t, mode = "unattended") {
  const cwd = mkdtempSync(join(tmpdir(), "landing-attempt-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const runDir = join(cwd, "run");
  const file = join(runDir, issue, "landing-progress.json");
  const observed = { issue, pr: 7, token: "needs-fix", reason: "regression", head_sha: head, failing_checks: ["unit", "lint"] };
  const write = (name, row) => { writeFileSync(join(cwd, name), JSON.stringify(row)); return name; };
  const args = (verb, ...extra) => ["land", "fix-attempt", verb, "--run-dir", runDir, "--issue", issue, "--pr", "7", "--mode", mode, ...extra];
  const command = (verb, ...extra) => runCli(args(verb, ...extra), { cwd });
  const read = () => JSON.parse(readFileSync(file, "utf8"));
  const before = (row = observed) => write("before.json", row);
  const after = row => write("after.json", { issue, pr: 7, head_sha: pushed, ...row });
  const run = (...values) => {
    const r = command(...values);
    assert.equal(r.code, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const begin = (row, next) => run("begin", "--before", before(row), ...(next ? ["--next", next] : []));
  return { args, command, cwd, runDir, file, observed, before, after, read, run, begin };
}

test("a confirmed no-push counts once, and a distinct same-head attempt can spend the next cycle", t => {
  const f = fixture(t);
  assert.deepEqual(f.run("status"), { action: "observe" });
  const first = f.begin();
  assert.equal(first.action, "implement");
  assert.deepEqual(f.begin(), { action: "await-result", attempt: first.attempt });
  const failed = ["submit", "--attempt", first.attempt, "--no-push", "--tried", "reran unit"];
  assert.deepEqual(f.run(...failed), { action: "continue", next: first.attempt, fix_cycles: 1 });
  const saved = readFileSync(f.file);
  assert.equal(f.run(...failed).fix_cycles, 1);
  assert.deepEqual(readFileSync(f.file), saved);
  assert.deepEqual(f.read().history[0].failing_checks, ["lint", "unit"]);
  assert.equal(f.read().last_head_sha, head);
  assert.equal(f.read().history[0].attempt_id, first.attempt);
  assert.equal(f.begin().next, first.attempt);
  const second = f.begin(f.observed, first.attempt);
  assert.notEqual(second.attempt, first.attempt);
  assert.equal(f.command(...failed).code, 2);
  assert.equal(f.run("submit", "--attempt", second.attempt, "--no-push").fix_cycles, 2);
  const third = f.begin(f.observed, second.attempt);
  const park = f.run("submit", "--attempt", third.attempt, "--no-push");
  assert.equal(park.action, "hard-park");
  assert.equal(park.fix_cycles, 3);
  assert.equal(f.run("submit", "--attempt", third.attempt, "--no-push").action, "hard-park");
  assert.deepEqual(f.run("status"), park);
  assert.deepEqual(f.begin(f.observed, third.attempt), park);
  assert.equal(f.read().history.length, 3);
});

test("a persisted push resumes through pending and deadline without a charge, then records exact check names on its head", t => {
  const f = fixture(t);
  const { attempt } = f.begin();
  assert.equal(f.run("submit", "--attempt", attempt, "--pushed", pushed).action, "observe-again");
  assert.equal(f.command("submit", "--attempt", attempt, "--pushed", other).code, 2);
  const saved = readFileSync(f.file);
  for (const [token, action] of [["pending", "observe-again"], ["landing-resumable", "landing-resumable"]]) {
    const result = f.run("assess", "--attempt", attempt, "--after", f.after({ token, head_sha: undefined }));
    assert.deepEqual(result, { action, attempt, pushed });
    assert.deepEqual(readFileSync(f.file), saved);
  }
  assert.deepEqual(f.run("status"), { action: "observe-again", attempt, pushed });
  assert.equal(f.command("assess", "--attempt", attempt, "--after", f.after({ token: "ready", pr: 8 })).code, 2);
  assert.equal(f.command("assess", "--attempt", attempt, "--after", f.after({ token: "errored" })).code, 2);
  const assess = ["assess", "--attempt", attempt, "--after", f.after({ token: "needs-fix", reason: "regression", failing_checks: ["new, name", "unit"] })];
  assert.equal(f.run(...assess).fix_cycles, 1);
  assert.equal(f.run(...assess).fix_cycles, 1);
  assert.equal(f.read().last_head_sha, pushed);
  assert.deepEqual(f.read().history[0].failing_checks, ["new, name", "unit"]);
});

test("an obsolete head never counts, and a shadow resolution stays parked across processes", t => {
  const f = fixture(t, "shadow");
  const { attempt } = f.begin();
  f.run("submit", "--attempt", attempt, "--pushed", pushed);
  assert.equal(f.run("assess", "--attempt", attempt, "--after", f.after({ token: "ready" })).action, "park-shadow");
  assert.deepEqual(f.run("status"), { action: "park-shadow", attempt });
  assert.equal(f.begin().action, "park-shadow");
  assert.equal(f.read().fix_cycles, 0);
  assert.equal(runCli(f.args("status").map(x => x === "shadow" ? "unattended" : x), { cwd: f.cwd }).code, 2);

  const g = fixture(t);
  const second = g.begin();
  g.run("submit", "--attempt", second.attempt, "--pushed", pushed);
  assert.equal(g.run("assess", "--attempt", second.attempt, "--after", g.after({ token: "superseded", head_sha: other })).action, "superseded");
  assert.equal(g.run("status").action, "superseded");
  assert.equal(g.read().fix_cycles, 0);
});

test("legacy valid counters are carried, while a present corrupt counter cannot restart the budget", t => {
  const f = fixture(t);
  const old = runCli(["landing-progress", "record-fix-cycle", f.runDir, issue, "--kind", "conflict", "--head-sha", head], { cwd: f.cwd });
  assert.equal(old.code, 0, old.stderr);
  const { attempt } = f.begin();
  assert.equal(f.run("submit", "--attempt", attempt, "--no-push").fix_cycles, 2);
  assert.equal(f.read().history[0].attempt_id, undefined);
  assert.equal(f.read().history[1].attempt_id, attempt);
  for (const corruption of ["{", JSON.stringify({ ...f.read(), fix_cycles: 0 })]) {
    writeFileSync(f.file, corruption);
    assert.equal(f.command("status").code, 2);
    assert.equal(f.command("begin", "--before", f.before()).code, 2);
    assert.equal(readFileSync(f.file, "utf8"), corruption);
  }
});

test("concurrent submissions of the same attempt record one cycle", async t => {
  const f = fixture(t);
  const { attempt } = f.begin();
  const args = f.args("submit", "--attempt", attempt, "--no-push");
  const invoke = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: f.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", data => { out += data; });
    child.stderr.on("data", data => { err += data; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, out, err }));
  });
  for (const r of await Promise.all([invoke(), invoke()])) {
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).fix_cycles, 1);
  }
  assert.equal(f.read().history.length, 1);
});

test("the real land entry checks the expected head before observing CI", t => {
  const f = fixture(t);
  const bin = join(f.cwd, "bin");
  mkdirSync(bin);
  const gh = join(bin, "gh");
  const calls = join(f.cwd, "gh-calls");
  writeFileSync(gh, `#!/bin/sh
printf '%s\\n' "$*" >> "$FAFF_TEST_CALLS"
case "$1 $2" in
  'repo view') printf '%s\\n' '{"nameWithOwner":"example/repo"}' ;;
  'pr view') printf '%s\\n' '{"headRefOid":"${other}","mergeStateStatus":"CLEAN"}' ;;
  *) exit 88 ;;
esac
`);
  chmodSync(gh, 0o755);
  const args = ["land", "--pr", "7", "--issue", issue, "--run-dir", f.runDir, "--json", "--fix-checks", "--expect-head", pushed];
  const result = runCli(args, { cwd: f.cwd, env: { ...process.env, PATH: bin + ":" + process.env.PATH, FAFF_TEST_CALLS: calls } });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { pr: 7, issue, token: "superseded", head_sha: other });
  assert.deepEqual(readFileSync(calls, "utf8").trim().split("\n").map(s => s.split(" ").slice(0, 2).join(" ")), ["repo view", "pr view"]);
});

test("a live conflict and a green pushed head round-trip through the normal land observations", t => {
  const f = fixture(t);
  const bin = join(f.cwd, "bin");
  mkdirSync(bin);
  const gh = join(bin, "gh");
  writeFileSync(gh, `#!/usr/bin/env node
const args = process.argv.slice(2);
const head = process.env.FAKE_LANDING_HEAD;
const conflict = head === "${head}";
const print = row => console.log(JSON.stringify(row));
if (args[0] === "repo" && args[1] === "view") print({ nameWithOwner: "example/repo" });
else if (args[0] === "pr" && args[1] === "view") {
  print({ headRefOid: head, mergeable: conflict ? "CONFLICTING" : "MERGEABLE", mergeStateStatus: conflict ? "DIRTY" : "CLEAN", reviewDecision: "APPROVED" });
} else if (args[0] === "api" && args.includes("--paginate") && args.some(arg => arg.includes("/commits/" + head + "/check-runs"))) {
  print({ head_sha: head, name: "unit", status: "completed", conclusion: "success" });
} else if (args[0] === "api" && args.some(arg => arg.includes("/commits/" + head + "/status"))) {
  print({ state: "success", count: 0 });
} else throw new Error("uncaptured effect: " + args.join(" "));
`);
  chmodSync(gh, 0o755);
  const observe = (observedHead, ...extra) => {
    const result = runCli(["land", "--pr", "7", "--issue", issue, "--run-dir", f.runDir, "--json", "--fix-checks", ...extra], {
      cwd: f.cwd,
      env: { ...process.env, PATH: bin + ":" + process.env.PATH, FAKE_LANDING_HEAD: observedHead },
    });
    assert.equal(result.code, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const original = observe(head);
  assert.equal(original.token, "needs-fix");
  assert.equal(original.reason, "conflict");
  const { attempt } = f.begin(original);
  f.run("submit", "--attempt", attempt, "--pushed", pushed, "--tried", "rebase");
  const current = observe(pushed, "--expect-head", pushed);
  assert.equal(current.token, "ready");
  assert.equal(f.run("assess", "--attempt", attempt, "--after", f.after(current)).action, "continue");
  assert.equal(f.read().fix_cycles, 0);
});
