// FAFF-1095 — the discrimination guard for the prd-readiness grader.
// Deterministic, zero frontier calls: the grader is pure. prd-readiness rides the shared env.verdict
// closed-set arm, so these tests prove the cases actually discriminate (a mis-graded verdict FAILs) and
// that the fixture-shape guard is on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { grade, validateCase } from "../eval/grader.mjs";

const CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "eval", "cases");
const KIND = "prd-readiness";

function loadKindCases() {
  return readdirSync(CASES_DIR)
    .filter((f) => f.startsWith(KIND) && f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(CASES_DIR, f), "utf8")))
    .sort((a, b) => a.id.localeCompare(b.id));
}

test("FAFF-1095 there are four cases: two admissible, two not-ready", () => {
  const cases = loadKindCases();
  assert.equal(cases.length, 4, "four prd-readiness cases ship");
  assert.equal(cases.filter((c) => c.oracle.closed_set[0] === "admissible").length, 2);
  assert.equal(cases.filter((c) => c.oracle.closed_set[0] === "not-ready").length, 2);
});

test("FAFF-1095 every case validates (fixture-shape guard: prd_body present)", () => {
  for (const c of loadKindCases()) {
    assert.doesNotThrow(() => validateCase(c), `case ${c.id} failed validateCase`);
    assert.ok(typeof c.fixture.prd_body === "string" && c.fixture.prd_body.length > 0,
      `case ${c.id}: fixture.prd_body missing or empty`);
  }
});

test("FAFF-1095 the cases discriminate: the oracle verdict PASSES, the other verdict FAILS", () => {
  for (const c of loadKindCases()) {
    const want = c.oracle.closed_set[0];
    const other = want === "admissible" ? "not-ready" : "admissible";
    assert.equal(grade(c, { verdict: want }).graded, "PASS", `${c.id}: ${want} should PASS`);
    assert.equal(grade(c, { verdict: other }).graded, "FAIL",
      `${c.id}: ${other} should FAIL — the case does not discriminate otherwise`);
  }
});

test("FAFF-1095 a missing env.verdict is a clean FAIL, never a crash", () => {
  for (const c of loadKindCases()) {
    assert.doesNotThrow(() => grade(c, {}));
    assert.equal(grade(c, {}).graded, "FAIL", `${c.id}: absent verdict must fail closed`);
  }
});
