// FAFF-38 — the terminating-condition predicate's integration smoke.
//
// Proves the COMPOSITION seam end-to-end: the real signal CLIs (`faff budget check`,
// `faff prdr coverage`) emit JSON that `faff run-done` folds into the fixed RunDoneVerdict,
// and that verdict round-trips through `faff contract run-termination`. Asserts the STRUCTURED
// verdict/reason tokens (never prose), mirroring cli-next-seam.test.mjs. The pure-core ladder +
// safety-floor table lives in `faff run-done --selftest` (run in CI); this is the live wiring.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const faffBin = path.join(repoRoot, "plugin", "skills", "faff", "bin", "faff");

function faff(args, input) {
  // FAFF_RUN_DIR is cleared so budget check resolves the unbounded default, not a live run ledger.
  const env = { ...process.env, FAFF_RUN_DIR: "" };
  const r = spawnSync("node", [faffBin, ...args], { cwd: repoRoot, encoding: "utf8", input, env });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status };
}

test("integration: live budget + prdr coverage → run-done drained/run-complete", () => {
  const budget = faff(["budget", "check", "--json"]);
  assert.equal(budget.code, 0);
  const budgetState = JSON.parse(budget.stdout);
  assert.deepEqual(budgetState.breached, []); // unbounded default — nothing breached

  const cov = faff(["prdr", "coverage", "--prd-goals", "[]"]);
  assert.equal(cov.code, 0);
  const coverage = JSON.parse(cov.stdout);
  assert.equal(coverage.satisfied, true); // no goals, no live PRDRs → trivially satisfied

  const r = faff([
    "run-done", "--queue-empty", "--ledger-clean",
    "--budget", budget.stdout.trim(),
    "--prd-coverage", cov.stdout.trim(),
  ]);
  assert.equal(r.code, 0);
  const verdict = JSON.parse(r.stdout); // assert the structured seam, not the prose reason
  assert.equal(verdict.verdict, "run-complete");
  assert.equal(verdict.reason, "drained");
  assert.equal(verdict.policy_source, "structural-default");
  assert.equal(verdict.conformant, true);
});

test("integration: --no-ledger-clean at drain → continue/undispatched-ledger (the floor, never silent complete)", () => {
  const budget = faff(["budget", "check", "--json"]);
  const r = faff(["run-done", "--queue-empty", "--no-ledger-clean", "--budget", budget.stdout.trim()]);
  assert.equal(r.code, 0);
  const verdict = JSON.parse(r.stdout);
  assert.equal(verdict.verdict, "continue");
  assert.equal(verdict.reason, "undispatched-ledger");
});

test("integration: the produced verdict round-trips through `faff contract run-termination`", () => {
  const r = faff(["run-done", "--queue-empty", "--ledger-clean"]);
  assert.equal(r.code, 0);
  const c = faff(["contract", "run-termination"], r.stdout);
  assert.equal(c.code, 0, c.stderr); // conformant
  const contractData = JSON.parse(c.stdout);
  assert.equal(contractData.verdict, "run-complete");
  assert.equal(contractData.conformant, true);
});

test("integration: malformed --budget JSON → exit 2 (usage error)", () => {
  const r = faff(["run-done", "--budget", "not-json"]);
  assert.equal(r.code, 2);
});
