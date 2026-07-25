// FAFF-625 — the integration smoke test (spec §8 "Integration smoke test"): drives 1 clean + 1
// defective corpus case through runEvals with an INJECTED mock driver (runEvals is driver-injectable —
// the FAFF-563 test pattern; the CLI has no mock flag), cases loaded from eval/cases-seeded, reps 1,
// judgements written to a temp path, then scored with --cases-dir eval/cases-seeded. Proves the pipeline
// closes end to end over the PRODUCTION corpus (not just the pilot) — deterministic, offline, zero
// frontier spend. The real frontier sweep is the production run itself (spec §4 HOW) — NOT run here and
// NOT run by this build (see the ADR: no live frontier access/budget was exercised in this autonomous
// build; the offline-proxy MACHINERY + corpus are what this ticket ships).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { runEvals, loadCases } from "../eval/run-evals.mjs";
import { loadSeededCases, OFFLINE_CAVEAT } from "../eval/score-error-rates.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const SEEDED_DIR = join(REPO_ROOT, "eval", "cases-seeded");
const SCORER = join(REPO_ROOT, "eval", "score-error-rates.mjs");

// A minimal mock driver returning a KNOWN, deterministic envelope per case — the ground-truth mapping
// from each case's own oracle (a "perfect judge"), mirroring test/score-error-rates.test.mjs's pattern.
function perfectMockDriver() {
  return async (c) => {
    const classes = Object.fromEntries(
      c.oracle.closed_set.map((pair) => {
        const i = pair.lastIndexOf(":");
        return [pair.slice(0, i), pair.slice(i + 1)];
      }),
    );
    const envelope = { case_id: c.id, "holdout-exercise": classes };
    // the parser requires the faff-eval:judgement fenced block (eval/envelope.mjs) — a raw JSON blob
    // is NOT recognised (mirrors how a real driver's output is fenced).
    const rawText = "```faff-eval:judgement\n" + JSON.stringify(envelope) + "\n```";
    return { rawText, tokens: 10 };
  };
}

test("smoke: runEvals + score-error-rates closes the loop over the production corpus (mock driver, 1 clean + 1 defective)", async () => {
  const seeded = loadSeededCases(SEEDED_DIR);
  const all = [...seeded.values()];
  const cleanCase = all.find((c) => c.label === "clean");
  const defectiveCase = all.find((c) => c.label === "defective");
  assert.ok(cleanCase, "corpus must contain at least one clean case");
  assert.ok(defectiveCase, "corpus must contain at least one defective case");

  // Load these two cases through the SAME loadCases(dir) path the real sweep uses (validateCase applied).
  const cases = loadCases(SEEDED_DIR).filter((c) => c.id === cleanCase.id || c.id === defectiveCase.id);
  assert.equal(cases.length, 2);

  const tmp = mkdtempSync(join(tmpdir(), "faff-625-smoke-"));
  try {
    const judgementsPath = join(tmp, "judgements.jsonl");
    const summary = await runEvals({ cases, driver: perfectMockDriver(), baseReps: 1, judgementsPath });
    assert.equal(summary.status, "complete");

    const r = spawnSync(process.execPath, [SCORER, judgementsPath, "--cases-dir", SEEDED_DIR, "--driver", "mock"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);

    assert.equal(report.n_positive, 1);
    assert.equal(report.n_negative, 1);
    assert.deepEqual(Object.keys(report.by_defect_class).sort(), ["missed-criterion", "spec-satisfying-but-broken-elsewhere", "subtly-wrong", "working-but-off-spec"]);
    assert.ok(report.caveat && report.caveat === OFFLINE_CAVEAT, "offline lane records the FAFF-317 caveat verbatim");
    // false_pass matches the mock's known aggregate: a perfect judge over its own case's oracle never
    // false-passes the seeded defect.
    assert.equal(report.false_pass, 0);
    assert.equal(report.by_defect_class[defectiveCase.defect_class].n, 1);
    assert.equal(report.by_defect_class[defectiveCase.defect_class].false_pass, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
