// FAFF-625 — the teaching-to-the-test / rendered-prompt leakage assertion (FAFF-563 §4), extended over
// the WHOLE production corpus (eval/cases-seeded/), not just the five-case pilot. Proves the measurement
// boundary holds for every case the production error-rate run will actually score: the rendered judge
// prompt for a SeededDefectCase never carries its label / defect_class / expected_aggregate FIELD KEYS,
// and never carries the distinctive label/defect_class VALUES ("defective", the defect_class string).
//
// Offline / deterministic — renders prompts locally via the driver's own renderer; makes no frontier call.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { loadSeededCases, validateSeededCase } from "../eval/score-error-rates.mjs";
import { renderFixturePrompt, criteriaFor } from "../eval/cli-driver.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEEDED_DIR = join(HERE, "..", "eval", "cases-seeded");

test("leakage: no case in eval/cases-seeded/ leaks its label fields into the rendered judge prompt", () => {
  const seeded = loadSeededCases(SEEDED_DIR);
  const cases = [...seeded.values()];
  assert.ok(cases.length > 0, "corpus must be non-empty for this test to mean anything");

  const rubric = criteriaFor("holdout-exercise"); // the real, static judge rubric prose (shared across all cases)
  const failures = [];

  for (const c of cases) {
    validateSeededCase(c);
    const full = renderFixturePrompt(c, rubric); // the driver's ACTUAL prompt for this case
    const caseOnly = renderFixturePrompt(c, null); // the case-derived portion (no rubric)

    // Field KEYS must never be serialized into the prompt at all.
    for (const key of ["label", "defect_class", "expected_aggregate"]) {
      if (full.includes(key)) failures.push(`${c.id}: field key "${key}" leaked into the rendered prompt`);
    }
    // The label VALUE "defective" is never rubric vocabulary — its presence anywhere in the full prompt
    // is a leak, for every defective case.
    if (c.label === "defective" && full.includes("defective")) {
      failures.push(`${c.id}: label value "defective" leaked into the rendered prompt`);
    }
    // defect_class VALUE — same check, only meaningful for defective cases.
    if (c.defect_class && full.includes(c.defect_class)) {
      failures.push(`${c.id}: defect_class value "${c.defect_class}" leaked into the rendered prompt`);
    }
    // expected_aggregate's value CAN be rubric vocabulary (e.g. "gaps"/"meets-spec" are terms the rubric
    // itself uses) — the honest check isolates the CASE-DERIVED portion only, mirroring the pilot test.
    if (caseOnly.includes(c.expected_aggregate)) {
      failures.push(`${c.id}: expected_aggregate value "${c.expected_aggregate}" leaked via the case-derived prompt`);
    }
  }

  assert.deepEqual(failures, [], `leakage failures:\n${failures.join("\n")}`);
});
