// FAFF-996 — born-verifiable regression test for the build-adjudication grade branch, the sibling of
// test/grader-spec-judge-discrimination.test.mjs one altitude down.
//
// Every oracle graded here is READ from the committed `oracles.json` (never transcribed as a
// literal), so an oracle-shape edit to that file turns this test red (the corpus-to-branch binding);
// only the rulings are test-supplied, since they simulate judge outputs, not oracle payloads. Reuses
// the free-to-run `grade()` drive pattern the spec-side sibling test uses — pure, no frontier calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { grade } from "../eval/grader.mjs";
import { BUILD_JUDGE_OUTCOMES } from "../plugin/skills/faff/bin/lib/contract-defs.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const SEAM_DIR = join(REPO, "plugin", "skills", "faffter-dark-adversarial-review", "eval", "build-judge-discrimination");
const GRADER_PATH = join(REPO, "eval", "grader.mjs");
const K = "build-adjudication";

const registry = JSON.parse(readFileSync(join(SEAM_DIR, "oracles.json"), "utf8"));

test("committed oracles.json is the build-adjudication corpus (2 cases)", () => {
  assert.equal(registry.grader_kind, K);
  assert.equal(registry.cases.length, 2);
});

// Bind each oracle FROM the committed file (never a hardcoded literal), matched by case_file.
const defectEntry = registry.cases.find((x) => x.case_file === "case-defect.json");
const falsePositiveEntry = registry.cases.find((x) => x.case_file === "case-false-positive.json");
const defectOracle = defectEntry && defectEntry.oracle;
const falsePositiveOracle = falsePositiveEntry && falsePositiveEntry.oracle;

test("corpus-to-branch binding: the committed pair's oracle shapes are what the branch expects", () => {
  assert.ok(defectOracle, "case-defect.json entry present in oracles.json");
  assert.ok(falsePositiveOracle, "case-false-positive.json entry present in oracles.json");
  assert.ok(Object.prototype.hasOwnProperty.call(defectOracle, "outcome_not"));
  assert.equal(defectOracle.outcome_not, "OVERTURN");
  assert.ok(Object.prototype.hasOwnProperty.call(falsePositiveOracle, "outcome"));
  assert.equal(falsePositiveOracle.outcome, "OVERTURN");
});

test("case-defect oracle (outcome_not: OVERTURN): PASS on a non-OVERTURN enum ruling", () => {
  const r = grade({ kind: K, oracle: defectOracle }, { ruling: "UPHOLD" });
  assert.equal(r.score, 1);
  assert.equal(r.graded, "PASS");
});

test("case-defect oracle: FAIL when the ruling equals the forbidden outcome", () => {
  const r = grade({ kind: K, oracle: defectOracle }, { ruling: "OVERTURN" });
  assert.equal(r.score, 0);
  assert.equal(r.graded, "FAIL");
});

test("case-defect oracle: an out-of-enum ruling FAILs — the enum-membership fold (never a vacuous PASS)", () => {
  const r = grade({ kind: K, oracle: defectOracle }, { ruling: "OVERTURNX" });
  assert.equal(r.score, 0);
  assert.equal(r.graded, "FAIL");
});

test("case-defect oracle: a null ruling FAILs, never throws", () => {
  assert.doesNotThrow(() => grade({ kind: K, oracle: defectOracle }, { ruling: null }));
  const r = grade({ kind: K, oracle: defectOracle }, { ruling: null });
  assert.equal(r.score, 0);
  assert.equal(r.graded, "FAIL");
});

test("case-false-positive oracle (outcome: OVERTURN): PASS when the ruling matches", () => {
  const r = grade({ kind: K, oracle: falsePositiveOracle }, { ruling: "OVERTURN" });
  assert.equal(r.score, 1);
  assert.equal(r.graded, "PASS");
});

test("case-false-positive oracle: an out-of-enum ruling FAILs, not a throw", () => {
  const r = grade({ kind: K, oracle: falsePositiveOracle }, { ruling: "BANANA" });
  assert.equal(r.score, 0);
  assert.equal(r.graded, "FAIL");
});

test("a malformed oracle (neither outcome nor outcome_not) FAILs cleanly, never throws", () => {
  assert.doesNotThrow(() => grade({ kind: K, oracle: {} }, { ruling: "OVERTURN" }));
  const r = grade({ kind: K, oracle: {} }, { ruling: "OVERTURN" });
  assert.equal(r.score, 0);
  assert.equal(r.graded, "FAIL");
});

// --- Single-source invariant (mirrors the spec-side sibling's §6 fold) ---

const graderSrc = readFileSync(GRADER_PATH, "utf8");

test("single-source (a): the grader imports BUILD_JUDGE_OUTCOMES from a specifier ending contract-defs.js", () => {
  assert.match(
    graderSrc,
    /import\s[^;]*\bBUILD_JUDGE_OUTCOMES\b[^;]*from\s*["'][^"']*contract-defs\.js["']/s,
  );
});

test("single-source (b): grader.mjs carries no hardcoded three-outcome array literal", () => {
  const reintroduced = /\[\s*["']OVERTURN["']\s*,\s*["']UPHOLD["']\s*,\s*["']PRODUCT_BOUNDARY["']\s*\]/;
  const matches = graderSrc.match(new RegExp(reintroduced, "g")) || [];
  assert.equal(matches.length, 0, "grader.mjs must import BUILD_JUDGE_OUTCOMES, never re-hardcode it");
});

test("runtime value-equality: BUILD_JUDGE_OUTCOMES (imported the same way the grader does) is exactly the three-outcome set", () => {
  assert.deepEqual(BUILD_JUDGE_OUTCOMES, ["OVERTURN", "UPHOLD", "PRODUCT_BOUNDARY"]);
});
