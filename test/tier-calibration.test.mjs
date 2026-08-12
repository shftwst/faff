// FAFF-417 — tier calibration re-derivation. Re-derives DEFAULT_PREP_PARAMS's three
// feature weights + two cut points from the committed corpus
// (records/spikes/2026-07-10-faff-411/analyze-output.json, a repo file — hermetic, no
// network) by the exact procedure in the FAFF-417 spec §4 "Calibration of the shipped
// default params", and asserts the re-derived values match the baked constants within a
// small epsilon. This is the CI guard against silent recalibration drift: if the corpus
// file's shape changes, or DEFAULT_PREP_PARAMS is hand-edited without re-running the
// derivation, this test fails loud.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PREP_PARAMS } from "../plugin/skills/faff/bin/lib/tier.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = join(HERE, "..", "records", "spikes", "2026-07-10-faff-411", "analyze-output.json");
const EPS = 1e-6;

// Fixed inputs to the derivation (FAFF-411 RESULTS.md's corpus-correlation analysis) — these
// are NOT re-derived from raw data here; they are a stated input to the calibration
// procedure, hardcoded in both the shipped module's provenance comment and here.
const R = { spec_lines: 0.557, done_items: 0.346, scenario_count: 0.338 };

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// Exact "linear" percentile method (idx = (p/100)*(n-1), interpolate floor/ceil) — the
// spec is explicit that a different percentile method (e.g. nearest-rank) will NOT
// reproduce the baked cut points, so this is pinned precisely.
function percentile(sortedArr, p) {
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sortedArr[lo] : sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

function loadCorpusRows() {
  const raw = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));
  return raw.rows.filter((r) => r.spec_lines != null && r.done_items != null && r.scenario_count != null);
}

test("corpus canary: analyze-output.json has exactly n=142 rows with non-null spec features", () => {
  const rows = loadCorpusRows();
  assert.equal(rows.length, 142, "the corpus file's shape must not have silently changed");
});

test("re-derived w[k] = r_k / p50_k matches DEFAULT_PREP_PARAMS.w within epsilon", () => {
  const rows = loadCorpusRows();
  const p50 = {
    spec_lines: median(rows.map((r) => r.spec_lines)),
    done_items: median(rows.map((r) => r.done_items)),
    scenario_count: median(rows.map((r) => r.scenario_count)),
  };
  for (const k of ["spec_lines", "done_items", "scenario_count"]) {
    const w = R[k] / p50[k];
    assert.ok(Math.abs(w - DEFAULT_PREP_PARAMS.w[k]) < EPS,
      `w.${k}: re-derived ${w} vs baked ${DEFAULT_PREP_PARAMS.w[k]}`);
  }
});

test("re-derived cut.mechanical/standard (p33/p66 linear-interpolated) matches DEFAULT_PREP_PARAMS.cut within epsilon", () => {
  const rows = loadCorpusRows();
  const p50 = {
    spec_lines: median(rows.map((r) => r.spec_lines)),
    done_items: median(rows.map((r) => r.done_items)),
    scenario_count: median(rows.map((r) => r.scenario_count)),
  };
  const w = {
    spec_lines: R.spec_lines / p50.spec_lines,
    done_items: R.done_items / p50.done_items,
    scenario_count: R.scenario_count / p50.scenario_count,
  };
  const scores = rows
    .map((r) => w.spec_lines * r.spec_lines + w.done_items * r.done_items + w.scenario_count * r.scenario_count)
    .sort((a, b) => a - b);
  const p33 = percentile(scores, 33);
  const p66 = percentile(scores, 66);
  assert.ok(Math.abs(p33 - DEFAULT_PREP_PARAMS.cut.mechanical) < EPS,
    `cut.mechanical: re-derived ${p33} vs baked ${DEFAULT_PREP_PARAMS.cut.mechanical}`);
  assert.ok(Math.abs(p66 - DEFAULT_PREP_PARAMS.cut.standard) < EPS,
    `cut.standard: re-derived ${p66} vs baked ${DEFAULT_PREP_PARAMS.cut.standard}`);
});

test("bucketing the corpus with the baked params holds each bucket between 20% and 47% of n=142", () => {
  const rows = loadCorpusRows();
  const w = DEFAULT_PREP_PARAMS.w;
  const cut = DEFAULT_PREP_PARAMS.cut;
  let mechanical = 0, standard = 0, complex_ = 0;
  for (const r of rows) {
    // score-only over the three spec-native features (no confidence_adj/gate_history —
    // matching how the cuts were derived, per the spec DoD).
    const score = w.spec_lines * r.spec_lines + w.done_items * r.done_items + w.scenario_count * r.scenario_count;
    if (score <= cut.mechanical) mechanical++;
    else if (score <= cut.standard) standard++;
    else complex_++;
  }
  const n = rows.length;
  for (const [label, count] of [["mechanical", mechanical], ["standard", standard], ["complex", complex_]]) {
    const pct = count / n;
    assert.ok(pct >= 0.20 && pct <= 0.47, `${label}: ${count}/${n} = ${(pct * 100).toFixed(1)}% not within [20%, 47%]`);
  }
  assert.equal(mechanical + standard + complex_, n);
});

// confidence_adj / w.gate_history are UN-TUNED JUDGEMENT PRIORS (span-proportional, not
// corpus-derived) — assert they still hold the documented span-proportional relationship to
// the (re-derived, corpus-derived) cut span, so a drifted edit to either is still caught.
test("confidence_adj / gate_history priors hold their documented span-proportional relationship", () => {
  const span = DEFAULT_PREP_PARAMS.cut.standard - DEFAULT_PREP_PARAMS.cut.mechanical;
  assert.ok(Math.abs(DEFAULT_PREP_PARAMS.confidence_adj.medium - 0.5 * span) < EPS);
  assert.ok(Math.abs(DEFAULT_PREP_PARAMS.confidence_adj.default - 0.5 * span) < EPS);
  assert.ok(Math.abs(DEFAULT_PREP_PARAMS.confidence_adj.low - 1.33 * span) < EPS);
  assert.equal(DEFAULT_PREP_PARAMS.confidence_adj.high, 0);
  assert.ok(Math.abs(DEFAULT_PREP_PARAMS.w.gate_history - 0.83 * span) < EPS);
});
