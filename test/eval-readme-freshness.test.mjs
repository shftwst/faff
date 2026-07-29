// FAFF-671 — guards eval/README.md's "Re-baseline runbook" arithmetic against the corpus and
// baseline it describes. Deterministic, zero-spawn: derives every number from loadCases(),
// BASE_REPS, MAX_REPS, and the committed baseline JSON, and asserts each appears — formatted the
// way the README writes numbers — somewhere in the runbook section's text. Containment, not
// position: this does not pin numbers to line numbers or surrounding wording, so an innocuous
// prose edit elsewhere in the runbook can't break it. It exists because the corpus grew from 79
// to 84 case files over five days and nothing caught the README falling five files behind — see
// FAFF-671.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCases, BASE_REPS, MAX_REPS } from "../eval/run-evals.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = join(HERE, "..", "eval");
const README_PATH = join(EVAL_DIR, "README.md");
const BASELINE_PATH = join(EVAL_DIR, "baselines", "frontier.json");

// Scoped to the runbook section, not the whole 194-line file — a bare whole-file containment
// check can pass on a coincidental match elsewhere (a line reference, a percentage, a date).
// Scoping to this section is what lets the "deliberately break it" check below actually fail.
function runbookSection(readme) {
  const start = readme.indexOf("## Re-baseline runbook");
  assert.notEqual(start, -1, "eval/README.md is missing the '## Re-baseline runbook' heading the guard scopes to");
  // Up to the next top-level (##) heading, or end of file if this is the last section.
  const next = readme.indexOf("\n## ", start + 1);
  return next === -1 ? readme.slice(start) : readme.slice(start, next);
}

// The README writes numbers >= 1000 with a thousands separator (e.g. "1,680"), and smaller
// numbers plain (e.g. "84", "29", "15"). Match the README's own convention so the assertion is
// comparing like with like.
function formatReadmeNumber(n) {
  return n.toLocaleString("en-US");
}

function deriveFacts() {
  const cases = loadCases();
  const caseCount = cases.length;
  const kindCount = new Set(cases.map((c) => c.kind)).size;
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const baselineKinds = Object.keys(baseline.per_kind).length;
  return {
    case_count: caseCount,
    kind_count: kindCount,
    base_total: caseCount * BASE_REPS,
    worst_total: caseCount * MAX_REPS,
    gate_gap: kindCount - baselineKinds,
  };
}

test("eval-readme-freshness: derived corpus/rep/gate numbers appear in the runbook section", () => {
  const facts = deriveFacts();
  const section = runbookSection(readFileSync(README_PATH, "utf8"));

  for (const [name, value] of Object.entries(facts)) {
    const formatted = formatReadmeNumber(value);
    assert.ok(
      section.includes(formatted),
      `eval/README.md's Re-baseline runbook section does not contain "${formatted}" for derived fact ` +
        `${name} (loadCases()/BASE_REPS/MAX_REPS/eval/baselines/frontier.json say ${formatted}). ` +
        `Update the runbook's numbered points (case/rep counts live in point 4, the gate gap lives ` +
        `in the section's opening paragraph) to match, or — if this fact moved because a ticket ` +
        `changed the corpus or baseline on purpose — that is this test doing its job.`,
    );
  }
});

test("eval-readme-freshness: base and worst rep totals are case_count * BASE_REPS / MAX_REPS", () => {
  // Guards the arithmetic itself, independent of what the README says — if BASE_REPS or MAX_REPS
  // ever change, this still holds without editing the test.
  const facts = deriveFacts();
  assert.equal(facts.base_total, facts.case_count * BASE_REPS);
  assert.equal(facts.worst_total, facts.case_count * MAX_REPS);
});
