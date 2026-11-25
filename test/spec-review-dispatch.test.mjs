import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import results from "../plugin/skills/faff/bin/lib/spec-review-results.js";
import { runCli } from "./helpers/run-cli.mjs";

test("cache advisory uses the maximum post-prime TTFT and includes the threshold", () => {
  const check = (times, strategy = "prime-then-parallel") => results.cacheAdvisory(strategy, times.map(ttftMs => ({ ttftMs })));
  assert.match(check([1000, 100, 200]), /dispatch_strategy: parallel \(ratio 0\.2\)/);
  assert.equal(check([1000, 199, 1]), null);
  for (const values of [[1000], [0, 2], [null, 2], [1000, null], [1000, NaN], [1000, -1]]) {
    assert.equal(check(values), "prefill-cache: not-computed");
  }
  for (const strategy of ["serial", "parallel"]) assert.equal(check([1000, 1000], strategy), null);
});

test("dispatch records configuration faults and refuses invalid selections, partial retry inputs or invalid budgets before transport", t => {
  const root = mkdtempSync(join(tmpdir(), "faff-dispatch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "pin");
  const call = (...flags) => runCli(["spec-review", "dispatch", "--dir", dir, "--spec", "draft.md", "--root", root, ...flags], { cwd: root });
  for (const flags of [["--enabled-lenses", "QA,QA"], ["--enabled-lenses", "QA,absent"], ["--enabled-lenses", ""],
    ["--enabled-lenses", ",QA"], ["--enabled-lenses", "QA", "--retry-lenses", "infosec"],
    ["--retry-lenses", "QA,QA"], ["--run-dir", root], ["--run-dir", root, "--turn-budget-secs", "1"], ["--lenses", "QA"], ["--turn-budget-secs", "0"], ["--turn-budget-secs", "Infinity"]]) {
    assert.equal(call(...flags).code, 2);
    assert.equal(existsSync(dir), false);
  }
  writeFileSync(join(root, ".faffrc.yaml"), "adversarial:\n  backends: []\n");
  const outcome = call();
  assert.equal(outcome.code, 0, outcome.stderr);
  assert.equal(JSON.parse(outcome.stdout.split("\n")[1]).verdict, "needs-human");
  assert.equal(JSON.parse(readFileSync(join(dir, "pin-capture.json"))).state, "skipped-no-lens");
  assert.equal(existsSync(join(dir, "round-1.json")), false);
  const selected = call("--enabled-lenses", "QA");
  assert.equal(selected.code, 0, selected.stderr);
  assert.match(selected.stderr, /served 0\/1 lenses/);
  assert.deepEqual(JSON.parse(selected.stdout.split("\n")[1]), {
    verdict: "needs-human", objections: [{ lens: "QA", severity: "blocker" }],
  });
});

test("recording a fresh unserved review keeps the ordinary park and requires its own bounded issue", t => {
  const root = mkdtempSync(join(tmpdir(), "faff-record-review-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, ".faff", "spec-review", "ABC-1");
  writeFileSync(join(root, ".faffrc.yaml"), "adversarial:\n  backends: []\n");
  const env = { ...process.env };
  delete env.FAFF_RUN_DIR;
  const call = (...flags) => runCli(["spec-review", "dispatch", "--dir", dir, "--spec", "draft.md",
    "--root", root, "--record-round", "interactive", ...flags], { cwd: root, env });
  for (const flags of [["--turn-budget-secs", "10"], ["--issue", "ABC-2", "--turn-budget-secs", "10"],
    ["--issue", "ABC-1", "--turn-budget-secs", "10", "--retry-lenses", "QA"]]) {
    assert.equal(call(...flags).code, 2);
    assert.ok(!existsSync(dir));
  }
  writeFileSync(join(root, ".faffrc.yaml"), "prep:\n  spec_review_turn_budget_secs: false\n");
  assert.equal(call("--issue", "ABC-1").code, 2);
  assert.ok(!existsSync(dir));
  writeFileSync(join(root, ".faffrc.yaml"), "adversarial:\n  backends: []\n");
  const result = call("--issue", "ABC-1");
  assert.equal(result.code, 0, result.stderr);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.action, "park");
  assert.equal(decision.verdict, "needs-human");
  assert.deepEqual(decision, JSON.parse(readFileSync(join(dir, "decision-1.json"))));
  assert.equal(existsSync(join(dir, "served-1.json")), false);
});
