"use strict";
// ===========================================================================
// === region:factory — tier — FAFF-417: deterministic prep-time build-tier classifier ===
// FAFF-411 measured that the self-rated `confidence` line on an attached spec is a
// near-constant (128/134 specs say `high`) while mechanical spec-structure signals
// (spec_lines, done_items, scenario_count) correlate with actual build shape. This
// module ports the FAFF-411 spike's pure classifier (records/spikes/2026-07-10-faff-411/
// tier.mjs) into the live CLI: `tier(features, params)` buckets an already-extracted
// feature vector into `mechanical | standard | complex`, `tierScore` exposes the raw
// weighted-linear score for --json inspectability, and `extractSpecFeatures` extracts
// the spec-native features from the attached spec's markdown text — byte-identical to
// records/spikes/2026-07-10-faff-411/analyze.mjs's corpus-extraction regexes, so
// calibration and runtime measure the same thing.
//
// PURE. tier()/tierScore()/extractSpecFeatures() do no I/O, no randomness, no tracker
// calls — same input always yields the same output. Only cmdTier (the CLI shell) does
// file I/O (`fs.readFileSync` on the caller-supplied spec-file path).
// ===========================================================================

const fs = require("node:fs");
const { parseArgs, usageError } = require("./argv");

// CALIBRATION PROVENANCE (FAFF-411/417): derived from
// records/spikes/2026-07-10-faff-411/analyze-output.json (n=142 rows with non-null
// spec_lines/done_items/scenario_count), by the procedure in the FAFF-417 spec §4
// "Calibration of the shipped default params":
//   1. w[k] = r_k / p50_k  (corpus correlation / corpus median of that feature)
//      r: spec_lines=0.557, done_items=0.346, scenario_count=0.338 (FAFF-411 RESULTS.md)
//      p50 (median over the 142 rows): spec_lines=100.5, done_items=7, scenario_count=1
//   2. cut.mechanical/standard = p33/p66 (linear-interpolated percentile) of the
//      composite score (Σ w[k]*feature[k] over the three spec-native features) over
//      the same 142 rows.
//   3. Priors preserve tier.mjs's proportions of the cut span (span = cut.standard -
//      cut.mechanical; tier.mjs: mechanical=8, standard=14, span=6):
//        confidence_adj = { high: 0, medium: 0.5*span, low: 1.33*span, default: 0.5*span }
//        w.gate_history = 0.83*span
// ONLY the three feature weights + the two cut points are corpus-derived. confidence_adj
// and gate_history are UN-TUNED JUDGEMENT PRIORS carried over from tier.mjs's proportions
// (RESULTS.md's explicit caveat) — FAFF-413 owns retuning them against live outcomes.
// Re-derived and asserted by test/tier-calibration.test.mjs on every CI run.
const DEFAULT_PREP_PARAMS = Object.freeze({
  w: Object.freeze({
    spec_lines: 0.00554228855721,       // r=0.557 / p50=100.5
    done_items: 0.0494285714286,        // r=0.346 / p50=7
    scenario_count: 0.338,              // r=0.338 / p50=1
    gate_history: 1.57826142303,        // JUDGEMENT PRIOR — 0.83 * span
  }),
  confidence_adj: Object.freeze({
    high: 0,
    medium: 0.950759893390,             // JUDGEMENT PRIOR — 0.5 * span
    low: 2.52902131642,                 // JUDGEMENT PRIOR — 1.33 * span
    default: 0.950759893390,            // JUDGEMENT PRIOR — 0.5 * span (unparseable/missing confidence)
  }),
  cut: Object.freeze({
    mechanical: 0.598525728500,         // p33 of the composite score over the 142-row corpus
    standard: 2.50004551528,            // p66 of the composite score over the 142-row corpus
  }),
});

// Shallow-merge a caller-supplied params override with the defaults, so a caller can
// override just `cut` (or a single `w` key) without losing the rest — mirrors tier.mjs.
function mergeParams(params) {
  const p = params || {};
  return {
    ...DEFAULT_PREP_PARAMS,
    ...p,
    w: { ...DEFAULT_PREP_PARAMS.w, ...(p.w || {}) },
    confidence_adj: { ...DEFAULT_PREP_PARAMS.confidence_adj, ...(p.confidence_adj || {}) },
    cut: { ...DEFAULT_PREP_PARAMS.cut, ...(p.cut || {}) },
  };
}

// tierScore(features, params) -> number — pure, for --json inspectability.
// GENERALISATION (FAFF-417 vs the FAFF-411 spike): the score iterates `Object.keys(p.w)`
// generically — `score = Σ w[k]*features[k]` for every weight key present as a NUMBER on
// `features` — instead of hardcoding each feature name. This is the one deliberate change
// from tier.mjs's shape (spec §4): it lets the prep-native feature set (spec_lines,
// done_items, scenario_count, gate_history) and any future build-native parameterisation
// (FAFF-413) share one pure action surface. `gate_history` is a `w` key like the others —
// the "only contribute if present as a number" tolerance tier.mjs special-cased for it
// falls out of the generic `typeof features[k] === "number"` guard for free, so no
// gate_history-specific branch is needed. Confidence is NOT a `w` key — it stays a
// separate additive prior (`confidence_adj`), exactly as in the spike.
function tierScore(features, params) {
  const f = features || {};
  const p = mergeParams(params);
  let score = 0;
  for (const k of Object.keys(p.w)) {
    if (typeof f[k] === "number" && Number.isFinite(f[k])) score += f[k] * p.w[k];
  }
  const conf = typeof f.confidence === "string" ? f.confidence.toLowerCase() : "";
  score += conf in p.confidence_adj ? p.confidence_adj[conf] : p.confidence_adj.default;
  return score;
}

// tier(features, params) -> 'mechanical' | 'standard' | 'complex' — pure.
// score <= cut.mechanical => mechanical; score <= cut.standard => standard; else complex.
function tier(features, params) {
  const p = mergeParams(params);
  const score = tierScore(features, params);
  if (score <= p.cut.mechanical) return "mechanical";
  if (score <= p.cut.standard) return "standard";
  return "complex";
}

// ---------------------------------------------------------------------------
// extractSpecFeatures — byte-identical extraction to analyze.mjs :224-226 (the FAFF-411
// corpus-extraction regexes), so calibration and runtime measure the same signal.
// ---------------------------------------------------------------------------

function extractConfidence(text) {
  if (!text) return null;
  const m = text.match(/confidence:\s*\**\s*(high|medium|low)\b/i);
  return m ? m[1].toLowerCase() : null;
}

function countMatches(text, re) {
  if (!text) return 0;
  const m = text.match(re);
  return m ? m.length : 0;
}

// extractSpecFeatures(specText) -> TierFeatures — pure over the markdown text. Mirrors
// analyze.mjs's ternaries byte-for-byte: `specText ? ... : null` treats "" as falsy, so a
// present-but-empty string extracts identically to a genuinely absent/null specText — every
// field 0/null. gate_history is NOT extracted here — it is an optional CLI flag
// (--gate-history N) merged in separately by cmdTier (spec §3: "omitted => no contribution").
function extractSpecFeatures(specText) {
  return {
    spec_lines: specText ? specText.split("\n").length : null,
    done_items: countMatches(specText, /^\s*-\s*\[[ x]\]/gm),
    scenario_count: countMatches(specText, /^\s*[-*]?\s*(Given|GIVEN)\b/gm),
    confidence: extractConfidence(specText),
  };
}

// ---------------------------------------------------------------------------
// `faff tier <spec-file> [--gate-history N] [--json]` — read-only, pure over the extracted
// features. Missing file / non-numeric --gate-history => exit 2, usage-style stderr.
// ---------------------------------------------------------------------------

const TIER_SPEC = { flags: { "--selftest": { arity: 0 }, "--gate-history": { arity: 1 }, "--json": { arity: 0 } }, positionals: { min: 0, max: 1, name: "spec-file" } };
const TIER_USAGE = "usage: faff tier <spec-file> [--gate-history N] [--json]";

function cmdTier(args) {
  if (args.includes("--selftest")) return tierSelftest();
  const { values, positionals, errors } = parseArgs(args, TIER_SPEC);
  if (errors.length) return usageError(errors, TIER_USAGE);
  const specFile = positionals[0];
  if (!specFile) return usageError([{ code: "too-few-positionals", detail: "spec-file is required" }], TIER_USAGE);

  let specText;
  try {
    specText = fs.readFileSync(specFile, "utf8");
  } catch (e) {
    process.stderr.write(`faff tier: cannot read ${specFile} (${e.message})\n`);
    return 2;
  }

  const features = extractSpecFeatures(specText);
  if (values["--gate-history"] !== undefined) {
    const n = Number(values["--gate-history"]);
    if (!Number.isFinite(n)) {
      process.stderr.write(`faff tier: --gate-history must be numeric, got "${values["--gate-history"]}"\n`);
      return 2;
    }
    features.gate_history = n;
  }

  const t = tier(features, DEFAULT_PREP_PARAMS);
  if (values["--json"]) {
    console.log(JSON.stringify({ tier: t, score: tierScore(features, DEFAULT_PREP_PARAMS), features }));
  } else {
    console.log(t);
  }
  return 0;
}

// Selftest — a real in-process smoke test: determinism (two calls give the same result),
// a tiny/high-confidence fixture buckets mechanical, and an unparseable confidence produces
// the `default` prior, never the `high` prior.
function tierSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { console.log(`FAIL ${name}`); fail++; } else console.log(`ok   ${name}`); };

  const fixture = "# Spec\n\n- [x] one done item\n\nGiven a thing\nWhen it happens\nThen it works\n\nconfidence: high\n";
  const f1 = extractSpecFeatures(fixture);
  const f2 = extractSpecFeatures(fixture);
  ok("extractSpecFeatures is deterministic (same input -> same output)", JSON.stringify(f1) === JSON.stringify(f2));
  ok("tier is deterministic (same input -> same output)", tier(f1, DEFAULT_PREP_PARAMS) === tier(f2, DEFAULT_PREP_PARAMS));
  ok("tierScore is deterministic (same input -> same output)", tierScore(f1, DEFAULT_PREP_PARAMS) === tierScore(f2, DEFAULT_PREP_PARAMS));
  ok("tiny high-confidence fixture buckets mechanical", tier(f1, DEFAULT_PREP_PARAMS) === "mechanical");

  const noConf = { spec_lines: 10, done_items: 0, scenario_count: 0 };
  const highConf = { spec_lines: 10, done_items: 0, scenario_count: 0, confidence: "high" };
  ok("unparseable/missing confidence uses the default prior, not the high prior (score differs)",
    tierScore(noConf, DEFAULT_PREP_PARAMS) !== tierScore(highConf, DEFAULT_PREP_PARAMS));
  ok("missing confidence == null confidence (both hit the default prior)",
    tierScore(noConf, DEFAULT_PREP_PARAMS) === tierScore({ ...noConf, confidence: null }, DEFAULT_PREP_PARAMS));

  ok("extractSpecFeatures(null) extracts everything as 0/null",
    JSON.stringify(extractSpecFeatures(null)) === JSON.stringify({ spec_lines: null, done_items: 0, scenario_count: 0, confidence: null }));
  // "" is falsy under the analyze.mjs ternary (specText ? … : null) — an empty string
  // extracts identically to a null/absent specText (spec_lines: null), byte-for-byte.
  ok("extractSpecFeatures('') matches extractSpecFeatures(null) (byte-identical ternary)",
    JSON.stringify(extractSpecFeatures("")) === JSON.stringify(extractSpecFeatures(null)));

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (tier classifier, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  DEFAULT_PREP_PARAMS,
  cmdTier,
  countMatches,
  extractConfidence,
  extractSpecFeatures,
  tier,
  tierScore,
  tierSelftest,
};
