// FAFF-931 — born-verifiable regression test for the spec-judge-discrimination grade branch.
//
// Until this test existed the folded enum-membership fix (an out-of-enum/null ruling must never
// vacuously PASS an `outcome_not` oracle) was asserted only in prose (the spec's scenarios + DONE):
// no runnable check drove `grade()` on a spec-judge-discrimination case, so a build could revert to
// the pre-fix fail-open branch and still pass every other check green. This test closes that gap.
//
// Every oracle graded here is READ from the committed `oracles.json` (never transcribed as a
// literal), so an oracle-shape edit to that file turns this test red (the corpus-to-branch binding);
// only the rulings are test-supplied, since they simulate judge outputs, not oracle payloads. Reuses
// the free-to-run `grade()` drive pattern test/eval-grader.test.mjs already uses — pure, no frontier
// calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { grade } from "../eval/grader.mjs";
import { SPEC_JUDGE_OUTCOMES } from "../plugin/skills/faff/bin/lib/contract-defs.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const SEAM_DIR = join(REPO, "plugin", "skills", "faffter-dark-spec-review", "eval", "spec-judge-discrimination");
const GRADER_PATH = join(REPO, "eval", "grader.mjs");
const K = "spec-judge-discrimination";

const registry = JSON.parse(readFileSync(join(SEAM_DIR, "oracles.json"), "utf8"));

test("committed oracles.json is the spec-judge-discrimination corpus (2 cases)", () => {
  assert.equal(registry.grader_kind, K);
  assert.equal(registry.cases.length, 2);
});

// Bind each oracle FROM the committed file (never a hardcoded literal), matched by case_file.
const defectEntry = registry.cases.find((x) => x.case_file === "case-defect.json");
const tasteEntry = registry.cases.find((x) => x.case_file === "case-taste.json");
const defectOracle = defectEntry && defectEntry.oracle;
const tasteOracle = tasteEntry && tasteEntry.oracle;

test("corpus-to-branch binding: the committed pair's oracle shapes are what the branch expects", () => {
  // An oracle-shape edit to the committed file (a changed outcome_not value, a renamed case) turns
  // this assertion red, so the test guards what the corpus actually says.
  assert.ok(defectOracle, "case-defect.json entry present in oracles.json");
  assert.ok(tasteOracle, "case-taste.json entry present in oracles.json");
  assert.ok(Object.prototype.hasOwnProperty.call(defectOracle, "outcome_not"));
  assert.equal(defectOracle.outcome_not, "AFFIRM_SPEC");
  assert.ok(Object.prototype.hasOwnProperty.call(tasteOracle, "outcome"));
  assert.equal(tasteOracle.outcome, "AFFIRM_SPEC");
});

test("case-defect oracle (outcome_not: AFFIRM_SPEC): PASS on a non-AFFIRM_SPEC enum ruling", () => {
  const r = grade({ kind: K, oracle: defectOracle }, { ruling: "UPHOLD_REVIEW" });
  assert.equal(r.score, 1);
  assert.equal(r.graded, "PASS");
});

test("case-defect oracle: FAIL when the ruling equals the forbidden outcome", () => {
  const r = grade({ kind: K, oracle: defectOracle }, { ruling: "AFFIRM_SPEC" });
  assert.equal(r.score, 0);
  assert.equal(r.graded, "FAIL");
});

test("case-defect oracle: an out-of-enum ruling FAILs — the enum-membership fold (never a vacuous PASS)", () => {
  const r = grade({ kind: K, oracle: defectOracle }, { ruling: "AFFIRM_SPECX" });
  assert.equal(r.score, 0);
  assert.equal(r.graded, "FAIL");
});

test("case-defect oracle: a null ruling FAILs, never throws", () => {
  assert.doesNotThrow(() => grade({ kind: K, oracle: defectOracle }, { ruling: null }));
  const r = grade({ kind: K, oracle: defectOracle }, { ruling: null });
  assert.equal(r.score, 0);
  assert.equal(r.graded, "FAIL");
});

test("case-taste oracle (outcome: AFFIRM_SPEC): PASS when the ruling matches", () => {
  const r = grade({ kind: K, oracle: tasteOracle }, { ruling: "AFFIRM_SPEC" });
  assert.equal(r.score, 1);
  assert.equal(r.graded, "PASS");
});

test("case-taste oracle: an out-of-enum ruling FAILs, not a throw", () => {
  const r = grade({ kind: K, oracle: tasteOracle }, { ruling: "BANANA" });
  assert.equal(r.score, 0);
  assert.equal(r.graded, "FAIL");
});

test("a malformed oracle (neither outcome nor outcome_not) FAILs cleanly, never throws", () => {
  assert.doesNotThrow(() => grade({ kind: K, oracle: {} }, { ruling: "AFFIRM_SPEC" }));
  const r = grade({ kind: K, oracle: {} }, { ruling: "AFFIRM_SPEC" });
  assert.equal(r.score, 0);
  assert.equal(r.graded, "FAIL");
});

// --- Single-source invariant (spec §6, round-2 fold: two concrete decidable predicates, replacing
// the brittler import-text regex — the runtime value-equality check below carries the real guarantee) ---

const graderSrc = readFileSync(GRADER_PATH, "utf8");

test("single-source (a): the grader imports SPEC_JUDGE_OUTCOMES from a specifier ending contract-defs.js", () => {
  // Import form unconstrained (named / renamed / multi-line) — a benign reformat must not false-positive.
  // Matches an `import ... SPEC_JUDGE_OUTCOMES ... from "...contract-defs.js"` statement irrespective of
  // exact whitespace/brace layout.
  assert.match(
    graderSrc,
    /import\s[^;]*\bSPEC_JUDGE_OUTCOMES\b[^;]*from\s*["'][^"']*contract-defs\.js["']/s,
  );
});

test("single-source (b): grader.mjs carries no hardcoded four-outcome array literal", () => {
  // A re-hardcoded copy of the enum (in registry order) would reintroduce exactly this literal.
  const reintroduced = /\[\s*["']AFFIRM_SPEC["']\s*,\s*["']UPHOLD_REVIEW["']\s*,\s*["']SYNTHESIZE["']\s*,\s*["']PRD_BOUNDARY["']\s*\]/;
  const matches = graderSrc.match(new RegExp(reintroduced, "g")) || [];
  assert.equal(matches.length, 0, "grader.mjs must import SPEC_JUDGE_OUTCOMES, never re-hardcode it");
});

test("runtime value-equality: SPEC_JUDGE_OUTCOMES (imported the same way the grader does) is exactly the four-outcome set", () => {
  // A stronger single-source guarantee than the import-text scan above — this is the substantive
  // guard, in the fail-loud style of assertRegistryConsistent (grader.mjs).
  assert.deepEqual(SPEC_JUDGE_OUTCOMES, ["AFFIRM_SPEC", "UPHOLD_REVIEW", "SYNTHESIZE", "PRD_BOUNDARY"]);
});
