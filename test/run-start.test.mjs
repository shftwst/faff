// FAFF-496 — the run-START trigger predicate's integration smoke (mirror of run-done.test.mjs).
//
// Proves the COMPOSITION seam end-to-end: `faff run-start` folds its passed-in signals into the
// fixed RunTriggerVerdict, and that verdict round-trips through `faff contract run-trigger`
// (Pattern-B — the validator re-derives {verdict, reason} from `signals`). Asserts the STRUCTURED
// verdict/reason tokens (never prose). The pure-core decision table lives in
// `faff run-start --selftest` + `faff contract run-trigger --selftest` (both run in CI); this is
// the live wiring + the load-bearing ordering / Pattern-B-rejection scenarios from spec §5/§8.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const faffBin = path.join(repoRoot, "plugin", "skills", "faff", "bin", "faff");

function faff(args, input) {
  const r = spawnSync("node", [faffBin, ...args], { cwd: repoRoot, encoding: "utf8", input });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status };
}

test("integration: outward + admissible PRD + a goal uncovered → plan/coverage-thin", () => {
  const r = faff(["run-start", "--target-resolved", "--outward", "--prd-present", "--prd-admissible", "--coverage-measurable", "--no-coverage-covered"]);
  assert.equal(r.code, 0);
  const v = JSON.parse(r.stdout);
  assert.equal(v.verdict, "plan");
  assert.equal(v.reason, "coverage-thin");
  assert.equal(v.signals.coverage_covered, false);
  assert.equal(v.conformant, true);
});

test("integration: outward + admissible PRD + every goal covered → drain/prd-covered", () => {
  const r = faff(["run-start", "--target-resolved", "--outward", "--prd-present", "--prd-admissible", "--coverage-measurable", "--coverage-covered"]);
  const v = JSON.parse(r.stdout);
  assert.equal(v.verdict, "drain");
  assert.equal(v.reason, "prd-covered");
});

test("integration: target = faff's own container (inward) → refuse/self-directed BEFORE any PRD check", () => {
  // Even with a present, admissible, uncovered PRD, the outward floor pre-empts the PRD checks.
  const r = faff(["run-start", "--target-resolved", "--no-outward", "--prd-present", "--prd-admissible", "--coverage-measurable", "--no-coverage-covered"]);
  const v = JSON.parse(r.stdout);
  assert.equal(v.verdict, "refuse");
  assert.equal(v.reason, "self-directed"); // never reaches coverage-thin
});

test("integration: outward + no PRD → drain/no-prd-nothing-to-plan (distinct from inward no-PRD)", () => {
  const outwardNoPrd = JSON.parse(faff(["run-start", "--target-resolved", "--outward", "--no-prd-present"]).stdout);
  assert.equal(outwardNoPrd.verdict, "drain");
  assert.equal(outwardNoPrd.reason, "no-prd-nothing-to-plan");
  const inwardNoPrd = JSON.parse(faff(["run-start", "--target-resolved", "--no-outward", "--no-prd-present"]).stdout);
  assert.equal(inwardNoPrd.verdict, "refuse");
  assert.equal(inwardNoPrd.reason, "self-directed");
});

test("integration: PRD present but not admissible → refuse/prd-inadmissible (fail-safe)", () => {
  const v = JSON.parse(faff(["run-start", "--target-resolved", "--outward", "--prd-present", "--no-prd-admissible"]).stdout);
  assert.equal(v.verdict, "refuse");
  assert.equal(v.reason, "prd-inadmissible");
});

test("integration: admissible PRD but coverage unmeasurable → refuse/coverage-unmeasurable (never drain/plan)", () => {
  const v = JSON.parse(faff(["run-start", "--target-resolved", "--outward", "--prd-present", "--prd-admissible", "--no-coverage-measurable"]).stdout);
  assert.equal(v.verdict, "refuse");
  assert.equal(v.reason, "coverage-unmeasurable");
});

test("integration: the produced verdict round-trips through `faff contract run-trigger`", () => {
  const produced = faff(["run-start", "--target-resolved", "--outward", "--prd-present", "--prd-admissible", "--coverage-measurable", "--no-coverage-covered"]);
  const c = faff(["contract", "run-trigger"], produced.stdout);
  assert.equal(c.code, 0, c.stderr); // conformant
  const contractData = JSON.parse(c.stdout);
  assert.equal(contractData.verdict, "plan");
  assert.equal(contractData.reason, "coverage-thin");
  assert.equal(contractData.conformant, true);
});

test("integration: `faff contract run-trigger` rejects a hand-altered drain on plan-shaped signals (Pattern-B)", () => {
  const planShaped = JSON.parse(faff(["run-start", "--target-resolved", "--outward", "--prd-present", "--prd-admissible", "--coverage-measurable", "--no-coverage-covered"]).stdout);
  const tampered = { ...planShaped, verdict: "drain", reason: "prd-covered" }; // hand-altered
  const c = faff(["contract", "run-trigger"], JSON.stringify(tampered));
  assert.equal(c.code, 1); // non-conformant
  const contractData = JSON.parse(c.stdout);
  assert.equal(contractData.verdict, "plan"); // the re-derived pair governs, never the forged one
  assert.equal(contractData.conformant, false);
  assert.ok(contractData.violations.some((s) => s.includes("does not match the re-derived")));
});

test("integration: --signals JSON bundle is accepted; a per-signal flag overrides it", () => {
  // Bundle says covered:true (would be drain); the --no-coverage-covered flag overrides → plan.
  const bundle = JSON.stringify({ target_resolved: true, outward: true, prd_present: true, prd_admissible: true, coverage_measurable: true, coverage_covered: true });
  const v = JSON.parse(faff(["run-start", "--signals", bundle, "--no-coverage-covered"]).stdout);
  assert.equal(v.verdict, "plan");
  assert.equal(v.reason, "coverage-thin");
});

test("integration: malformed --signals JSON → exit 2 (usage error)", () => {
  const r = faff(["run-start", "--signals", "not-json"]);
  assert.equal(r.code, 2);
});

test("integration: empty invocation → refuse/no-target (fail-safe, the privileged plan is unreachable)", () => {
  const v = JSON.parse(faff(["run-start"]).stdout);
  assert.equal(v.verdict, "refuse");
  assert.equal(v.reason, "no-target");
});

test("integration: prdr coverage emits the additive `measure` block without changing covered/satisfied", () => {
  const r = faff(["prdr", "coverage", "--prd-goals", '["g1","g2"]', "--live-prdrs", '[{"id":"0001","prd_goal":"g1","dod_verdict":"met"}]']);
  assert.equal(r.code, 0);
  const cov = JSON.parse(r.stdout);
  assert.equal(cov.covered, false); // g2 uncovered — unchanged semantics
  assert.deepEqual(cov.measure, { total_goals: 2, covered_goals: 1 });
  // The measure block is non-gating: it round-trips through the contract validator conformant.
  const c = faff(["contract", "prd-coverage"], r.stdout);
  assert.equal(c.code, 0, c.stderr);
});
