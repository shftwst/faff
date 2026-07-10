// FAFF-411 spike scratch — PURE tier classifier.
//
// tier(features, params) -> bucket ∈ { 'mechanical' | 'standard' | 'complex' }
//
// This is the deterministic half of the (judgement-extract, deterministic-classify)
// split from the spec §3. Feature extraction (which may be judgement-based / cached)
// lives OUTSIDE this function; `tier` only maps an already-extracted mechanical
// feature vector to a build-tier bucket. Same inputs -> same bucket, always.
//
// Whether these mechanical features ALONE predict well enough to skip judgement is an
// OUTPUT of the spike (see RESULTS.md "determinism verdict"), not an assumption baked
// in here. The params below are the calibrated *seed* — the future controller
// (FAFF-413/417) owns re-tuning them; this function is the fixed action surface.
//
// NOT wired into bin/faff. Standalone scratch over the run-dirs.

/**
 * Feature vector (all fields optional except where a caller supplies them):
 *   file_count     {number}  files the build is expected to / did touch
 *   lines_changed  {number}  insertions + deletions
 *   modules        {number}  distinct top-level modules / dirs touched
 *   test_coverage  {number?} 0..1 fraction of changed surface under test (optional)
 *   dep_count      {number}  new/changed external dependencies
 *   confidence     {string}  spec self-rating: 'high' | 'medium' | 'low'
 *   gate_history   {number?} prior park/needs-human/failed-gate count for this issue (optional)
 */

export const DEFAULT_PARAMS = Object.freeze({
  // Per-feature weights. A weighted linear score, then two cut points bucket it.
  // CALIBRATION PROVENANCE: only file_count / lines_changed are data-driven — their
  // relative scale is fixed by the corpus diff tertiles (see the cut points below).
  // modules / dep_count / test_coverage_gap / gate_history are JUDGEMENT PRIORS, not
  // fit to data: the corpus carries no per-issue module / dep / coverage / gate-history
  // telemetry to calibrate against. FAFF-413/417 must treat these four as un-tuned
  // starting guesses, NOT corpus-derived, when they re-tune.
  w: Object.freeze({
    file_count: 1.0, // calibrated (corpus diff tertiles)
    lines_changed: 0.01, // calibrated — ~100 lines == 1 file of pressure
    modules: 2.0, // JUDGEMENT PRIOR — crossing module boundaries reads as complex
    dep_count: 3.0, // JUDGEMENT PRIOR — a new dependency reads as a complexity signal
    test_coverage_gap: 4.0, // JUDGEMENT PRIOR — (1 - coverage) * this; untested = risk
    gate_history: 5.0, // JUDGEMENT PRIOR — each prior gate failure bumps off "mechanical"
  }),
  // Confidence acts as an additive prior on the score (low confidence => push up).
  confidence_adj: Object.freeze({
    high: 0,
    medium: 3,
    low: 8,
    default: 3, // unknown/unparseable confidence is treated as medium-risk here
  }),
  // Cut points on the total score. score <= mechanical => mechanical;
  // score <= standard => standard; else complex.
  // CALIBRATED SEED (FAFF-411 Phase 1): these cut points — together with the
  // file_count / lines_changed weights above — are tuned to the corpus tertiles of the
  // actual built-issue diff distribution (n=148): p33 ≈ 4 files / 180 lines, p66 ≈ 6
  // files / 380 lines. The other four weights are judgement priors (see above), so this
  // calibration only holds while file_count/lines_changed dominate the score. See
  // RESULTS.md. FAFF-413/417 own re-tuning against live outcomes.
  cut: Object.freeze({
    mechanical: 8,
    standard: 14,
  }),
});

function num(x, dflt = 0) {
  return typeof x === 'number' && Number.isFinite(x) ? x : dflt;
}
function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/**
 * @returns {'mechanical'|'standard'|'complex'}
 */
export function tier(features = {}, params = {}) {
  // Shallow-merge so a caller can override just `cut` without losing `w`.
  const p = {
    ...DEFAULT_PARAMS,
    ...params,
    w: { ...DEFAULT_PARAMS.w, ...(params.w || {}) },
    confidence_adj: { ...DEFAULT_PARAMS.confidence_adj, ...(params.confidence_adj || {}) },
    cut: { ...DEFAULT_PARAMS.cut, ...(params.cut || {}) },
  };

  let score = 0;
  score += num(features.file_count) * p.w.file_count;
  score += num(features.lines_changed) * p.w.lines_changed;
  score += num(features.modules) * p.w.modules;
  score += num(features.dep_count) * p.w.dep_count;

  if (typeof features.test_coverage === 'number') {
    score += (1 - clamp01(features.test_coverage)) * p.w.test_coverage_gap;
  }

  const conf = typeof features.confidence === 'string' ? features.confidence.toLowerCase() : '';
  score += conf in p.confidence_adj ? p.confidence_adj[conf] : p.confidence_adj.default;

  if (typeof features.gate_history === 'number') {
    score += num(features.gate_history) * p.w.gate_history;
  }

  if (score <= p.cut.mechanical) return 'mechanical';
  if (score <= p.cut.standard) return 'standard';
  return 'complex';
}

/** Exposed for tests / RESULTS reproducibility: the raw score before bucketing. */
export function tierScore(features = {}, params = {}) {
  const p = {
    ...DEFAULT_PARAMS,
    ...params,
    w: { ...DEFAULT_PARAMS.w, ...(params.w || {}) },
    confidence_adj: { ...DEFAULT_PARAMS.confidence_adj, ...(params.confidence_adj || {}) },
    cut: { ...DEFAULT_PARAMS.cut, ...(params.cut || {}) },
  };
  let score = 0;
  score += num(features.file_count) * p.w.file_count;
  score += num(features.lines_changed) * p.w.lines_changed;
  score += num(features.modules) * p.w.modules;
  score += num(features.dep_count) * p.w.dep_count;
  if (typeof features.test_coverage === 'number') {
    score += (1 - clamp01(features.test_coverage)) * p.w.test_coverage_gap;
  }
  const conf = typeof features.confidence === 'string' ? features.confidence.toLowerCase() : '';
  score += conf in p.confidence_adj ? p.confidence_adj[conf] : p.confidence_adj.default;
  if (typeof features.gate_history === 'number') {
    score += num(features.gate_history) * p.w.gate_history;
  }
  return score;
}
