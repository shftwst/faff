// FAFF-671/677 — guards eval/README.md against the corpus, baseline, and config it describes.
// Deterministic, zero-spawn: derives every number from loadCases(), BASE_REPS, MAX_REPS, and the
// committed baseline JSON, resolves the eval model in-process via loadConfig, and asserts each fact
// appears — formatted the way the README writes it — in the section that carries it. Containment,
// not position: numbers are not pinned to line numbers or surrounding wording, so an innocuous prose
// edit can't break it. It exists because the corpus grew from 79 to 84 case files over five days and
// nothing caught the README falling behind (FAFF-671); FAFF-677 widened it to the two other sections
// that repeat the rep-range and to the resolved-model line that drifted past CI in PR #518.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCases, BASE_REPS, MAX_REPS, EVAL_MODEL_FALLBACK } from "../eval/run-evals.mjs";
import { loadConfig } from "../plugin/skills/faff/bin/lib/config.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const EVAL_DIR = join(HERE, "..", "eval");
const README_PATH = join(EVAL_DIR, "README.md");
const BASELINE_PATH = join(EVAL_DIR, "baselines", "frontier.json");

// The three README sections that each restate the frontier-sweep rep-range. Matched as heading
// prefixes because the real headings carry FAFF-id suffixes (e.g. "## Running it (FAFF-131, …)").
const REP_RANGE_SECTIONS = ["## Re-baseline runbook", "## Proportionate gate", "## Running it"];

// Slice out one section by its heading prefix: from the prefix up to the next top-level (##) heading,
// or end of file if it's the last section. Scoping to the section — not the whole 194-line file — is
// what lets the synthetic-stale checks below actually fail: a bare whole-file containment check can
// pass on a coincidental match elsewhere (a line reference, a percentage, a date).
function sectionByHeading(readme, headingPrefix) {
  const start = readme.indexOf(headingPrefix);
  assert.notEqual(start, -1, `eval/README.md is missing the '${headingPrefix}' heading the guard scopes to`);
  const next = readme.indexOf("\n## ", start + 1);
  return next === -1 ? readme.slice(start) : readme.slice(start, next);
}

// The README writes numbers >= 1000 with a thousands separator (e.g. "1,580") and smaller numbers
// plain (e.g. "79", "29", "15"). Match the README's own convention so we compare like with like.
function formatReadmeNumber(n) {
  return n.toLocaleString("en-US");
}

// Pure containment check over a section's text. Returns which named facts are absent rather than
// throwing, so the synthetic-input proof below can assert on the report instead of catching.
function checkFactsInSection(sectionText, facts) {
  const missing = [];
  for (const [name, value] of Object.entries(facts)) {
    if (!sectionText.includes(formatReadmeNumber(value))) missing.push(name);
  }
  return { ok: missing.length === 0, missing };
}

// The runbook names three different model tokens in the same few lines — the current resolved model,
// the baked-in `claude-sonnet-4-6` fallback, and (historically) an old sweep's model. A bare
// contains-check would pass on any of them, so anchor on the unique phrase "currently returns" and
// capture the one token the prose calls current. The \s* spans the README:173→174 line break and
// indent between "returns" and the backtick. Returns null if the anchor phrase is absent.
function extractNamedModel(readme) {
  const m = readme.match(/currently returns\s*`([^`]+)`/);
  return m ? m[1] : null;
}

// Compare the README's named-current model to what config resolves. A null capture (the anchor
// reworded away) is a failure, not a vacuous pass — otherwise a prose edit could silently disarm the
// check.
function checkModel(readme, resolvedModel) {
  const named = extractNamedModel(readme);
  return { ok: named !== null && named === resolvedModel, named, resolved: resolvedModel };
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

function resolveEvalModelFromConfig() {
  const [cfg] = loadConfig(REPO_ROOT);
  return cfg.models?.eval ?? EVAL_MODEL_FALLBACK;
}

test("eval-readme-freshness: derived corpus/rep/gate numbers appear in the runbook section", () => {
  const facts = deriveFacts();
  const section = sectionByHeading(readFileSync(README_PATH, "utf8"), "## Re-baseline runbook");

  const { missing } = checkFactsInSection(section, facts);
  assert.deepEqual(
    missing,
    [],
    `eval/README.md's Re-baseline runbook section is missing derived fact(s) [${missing.join(", ")}] ` +
      `(loadCases()/BASE_REPS/MAX_REPS/eval/baselines/frontier.json say ` +
      `${missing.map((n) => `${n}=${formatReadmeNumber(facts[n])}`).join(", ")}). ` +
      `Update the runbook's numbered points (case/rep counts live in point 4, the gate gap lives in ` +
      `the section's opening paragraph) to match, or — if a fact moved because a ticket changed the ` +
      `corpus or baseline on purpose — that is this test doing its job.`,
  );
});

test("eval-readme-freshness: base and worst rep totals are case_count * BASE_REPS / MAX_REPS", () => {
  // Guards the arithmetic itself, independent of what the README says — if BASE_REPS or MAX_REPS
  // ever change, this still holds without editing the test.
  const facts = deriveFacts();
  assert.equal(facts.base_total, facts.case_count * BASE_REPS);
  assert.equal(facts.worst_total, facts.case_count * MAX_REPS);
});

test("eval-readme-freshness: the rep-range appears in every section that restates it", () => {
  // FAFF-677 — the base/worst totals are copied verbatim into three sections. FAFF-671 only guarded
  // the runbook; the "Proportionate gate" and "Running it" copies drifted with nothing catching them.
  const facts = deriveFacts();
  const readme = readFileSync(README_PATH, "utf8");
  const repRange = { base_total: facts.base_total, worst_total: facts.worst_total };

  for (const heading of REP_RANGE_SECTIONS) {
    const section = sectionByHeading(readme, heading);
    const { missing } = checkFactsInSection(section, repRange);
    assert.deepEqual(
      missing,
      [],
      `eval/README.md's '${heading}' section is missing rep-range value(s) ` +
        `[${missing.map((n) => `${n}=${formatReadmeNumber(facts[n])}`).join(", ")}]. ` +
        `Every section that quotes the frontier sweep's cost must carry the same figures — update ` +
        `this one, or if the corpus genuinely changed, update all three.`,
    );
  }
});

test("eval-readme-freshness: the runbook's named-current model matches models.eval", () => {
  // FAFF-677 — the resolved-model prose drifted to `claude-opus-5` while config returned
  // `claude-opus-4-8`, and the number-only guard never saw it (hand-fixed in PR #518). Resolve the
  // model in-process (zero-spawn) and compare it to the token the prose calls current.
  const readme = readFileSync(README_PATH, "utf8");
  const { ok, named, resolved } = checkModel(readme, resolveEvalModelFromConfig());
  assert.ok(
    ok,
    `eval/README.md's runbook names the current eval model as ${named === null ? "«no `currently returns \\`…\\`` token found»" : `\`${named}\``}, ` +
      `but config resolves models.eval to \`${resolved}\`. Update the "currently returns \`…\`" line ` +
      `to \`${resolved}\` (or fix models.eval in .faffrc.yaml), whichever is wrong.`,
  );
});

test("eval-readme-freshness: the assert helpers report failure on deliberately-stale synthetic input", () => {
  // FAFF-677 — a durable, repeatable proof that the guard's containment logic actually fails on stale
  // input. FAFF-671 demonstrated this once by hand-reverting a figure; that proof didn't survive the
  // merge. These feed synthetic strings straight to the pure helpers — no real files, no spawns.

  // (a) A section missing a derived number is reported, naming the absent fact.
  const staleSection = "## Running it\n> 79 cases × K=20 base ≈ 1,600 reps, escalating toward 4,000.";
  const factCheck = checkFactsInSection(staleSection, { base_total: 1580, worst_total: 3950 });
  assert.equal(factCheck.ok, false, "checkFactsInSection should fail when the section omits a derived number");
  assert.deepEqual(
    factCheck.missing,
    ["base_total", "worst_total"],
    "checkFactsInSection should name every absent fact",
  );

  // (b) A README whose named-current token differs from the resolved model is reported, naming the
  // stale token.
  const staleModelReadme = "The model … currently returns\n`claude-opus-5`, so that is what a plain run gets.";
  const modelCheck = checkModel(staleModelReadme, "claude-opus-4-8");
  assert.equal(modelCheck.ok, false, "checkModel should fail when the named token differs from the resolved model");
  assert.equal(modelCheck.named, "claude-opus-5", "checkModel should surface the stale README token");
  assert.equal(modelCheck.resolved, "claude-opus-4-8", "checkModel should surface the resolved model");

  // (c) The regex captures across the real line-break-and-indent between "returns" and the backtick,
  // not just when they're adjacent — the shape that actually lives in the README.
  const wrappedReadme = "In this repo `models.eval` is set and currently returns\n   `claude-opus-4-8`, so that is what a plain run gets.";
  assert.equal(
    extractNamedModel(wrappedReadme),
    "claude-opus-4-8",
    "extractNamedModel must span the line break between 'returns' and the backtick",
  );

  // (d) A reworded runbook that drops the anchor phrase captures null — which checkModel treats as a
  // failure, never a vacuous pass.
  assert.equal(extractNamedModel("The model resolves to whatever config says."), null);
  assert.equal(checkModel("The model resolves to whatever config says.", "claude-opus-4-8").ok, false);
});
