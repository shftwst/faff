// FAFF-1007 — the safety-property guard for the park-reconsider-classification grader.
// Deterministic, zero frontier calls: the grader is pure. The one property this KIND's gate must
// enforce is that no scope/taste/architecture park is ever graded `machine`. These tests fail loud
// if a wiring regression let a `human`-oracle case pass on a `machine` prediction.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { grade, validateCase } from "../eval/grader.mjs";

const CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "eval", "cases");
const KIND = "park-reconsider-classification";

function loadKindCases() {
  return readdirSync(CASES_DIR)
    .filter((f) => f.startsWith(KIND) && f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(CASES_DIR, f), "utf8")))
    .sort((a, b) => a.id.localeCompare(b.id));
}

test("FAFF-1007 there are four cases: three human (scope/taste/architecture) and one machine", () => {
  const cases = loadKindCases();
  assert.equal(cases.length, 4, "four park-reconsider-classification cases ship");
  const human = cases.filter((c) => c.oracle.closed_set[0] === "human");
  const machine = cases.filter((c) => c.oracle.closed_set[0] === "machine");
  assert.equal(human.length, 3, "three human cases (scope, taste, architecture)");
  assert.equal(machine.length, 1, "one machine case (the reproduced config-fault)");
});

test("FAFF-1007 every case validates (fixture-shape guard: issue + park present)", () => {
  for (const c of loadKindCases()) {
    assert.doesNotThrow(() => validateCase(c), `case ${c.id} failed validateCase`);
    assert.ok(c.fixture.issue, `case ${c.id}: fixture.issue missing`);
    assert.ok(c.fixture.park, `case ${c.id}: fixture.park missing`);
  }
});

test("FAFF-1007 safety property: a human-oracle case graded `machine` FAILS the gate", () => {
  for (const c of loadKindCases().filter((c) => c.oracle.closed_set[0] === "human")) {
    assert.equal(grade(c, { reconsider: "human" }).graded, "PASS", `${c.id}: human should PASS`);
    assert.equal(grade(c, { reconsider: "machine" }).graded, "FAIL",
      `${c.id}: a scope/taste/architecture park graded machine MUST FAIL the gate`);
  }
});

test("FAFF-1007 the machine case grades on its own field: machine PASSES, human FAILS", () => {
  const machine = loadKindCases().find((c) => c.oracle.closed_set[0] === "machine");
  assert.equal(grade(machine, { reconsider: "machine" }).graded, "PASS", "machine should PASS");
  assert.equal(grade(machine, { reconsider: "human" }).graded, "FAIL", "machine case graded human should FAIL");
});

test("FAFF-1007 a missing env.reconsider is a clean FAIL, never a crash", () => {
  for (const c of loadKindCases()) {
    assert.doesNotThrow(() => grade(c, {}));
    assert.equal(grade(c, {}).graded, "FAIL", `${c.id}: absent reconsider must fail closed`);
  }
});
