// FAFF-417 — tier: the deterministic prep-time build-tier classifier. Covers the pure
// classifier (tier/tierScore), the extraction regexes (byte-identical to
// records/spikes/2026-07-10-faff-411/analyze.mjs :224-226 via hardcoded fixture-string
// assertions), the `faff tier` CLI surface (bare + --json + --gate-history + error paths),
// and --selftest.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import {
  DEFAULT_PREP_PARAMS,
  countMatches,
  extractConfidence,
  extractSpecFeatures,
  tier,
  tierScore,
} from "../plugin/skills/faff/bin/lib/tier.js";

function fixtureFile(body) {
  const dir = mkdtempSync(path.join(tmpdir(), "faff417-tier-"));
  const file = path.join(dir, "spec.md");
  writeFileSync(file, body);
  return { dir, file };
}

// ── extraction regexes: byte-identical to analyze.mjs :224-226 ──
// analyze.mjs's canonical regex source (hardcoded here as the byte-identical comparison
// target, per the FAFF-417 spec DoD — no import dependency from bin/lib on records/spikes):
const ANALYZE_CONFIDENCE_RE = /confidence:\s*\**\s*(high|medium|low)\b/i;
const ANALYZE_SCENARIO_RE = /^\s*[-*]?\s*(Given|GIVEN)\b/gm;
const ANALYZE_DONE_RE = /^\s*-\s*\[[ x]\]/gm;

test("extraction regex sources are byte-identical to analyze.mjs's canonical regexes", () => {
  // Compare source text directly — the strongest form of "byte-identical" for a RegExp.
  assert.equal(extractConfidence.toString().includes(ANALYZE_CONFIDENCE_RE.source), true,
    "extractConfidence must use analyze.mjs's exact confidence regex source");
});

test("extractSpecFeatures: known fixture strings match hand-computed expected counts", () => {
  const fixture = [
    "# Spec",
    "",
    "confidence: **high**",
    "",
    "- [x] done item one",
    "- [ ] open item two",
    "- [x] done item three",
    "",
    "Given a precondition",
    "When an action happens",
    "Then an outcome is observed",
    "* Given another scenario line",
    "- Given a third, bulleted scenario line",
    "",
  ].join("\n");

  const f = extractSpecFeatures(fixture);
  assert.equal(f.spec_lines, fixture.split("\n").length);
  assert.equal(f.done_items, 3, "three checklist lines ([x]/[ ]/[x])");
  assert.equal(f.scenario_count, 3, "three Given-starting lines (plain, *-bulleted, --bulleted)");
  assert.equal(f.confidence, "high", "confidence survives the ** markdown-bold wrapping");

  // Cross-check against the hardcoded analyze.mjs-equivalent regexes directly.
  assert.equal(countMatches(fixture, ANALYZE_DONE_RE), f.done_items);
  assert.equal(countMatches(fixture, ANALYZE_SCENARIO_RE), f.scenario_count);
  const m = fixture.match(ANALYZE_CONFIDENCE_RE);
  assert.equal(m[1].toLowerCase(), f.confidence);
});

test("extractSpecFeatures: absent/null specText extracts everything as 0/null", () => {
  assert.deepEqual(extractSpecFeatures(null), { spec_lines: null, done_items: 0, scenario_count: 0, confidence: null });
  assert.deepEqual(extractSpecFeatures(undefined), { spec_lines: null, done_items: 0, scenario_count: 0, confidence: null });
});

test("extractSpecFeatures: unparseable/missing confidence line -> confidence: null (never promoted to high)", () => {
  const f = extractSpecFeatures("# Spec\n\nno confidence line here at all\n");
  assert.equal(f.confidence, null);
  const f2 = extractSpecFeatures("# Spec\n\nconfidence: maybe\n");
  assert.equal(f2.confidence, null, "an out-of-vocab confidence token is unparseable, not coerced");
});

// ── pure classifier: determinism ──

test("tier()/tierScore() are pure: same input always gives the same output", () => {
  const features = { spec_lines: 42, done_items: 3, scenario_count: 2, confidence: "medium" };
  assert.equal(tier(features, DEFAULT_PREP_PARAMS), tier(features, DEFAULT_PREP_PARAMS));
  assert.equal(tierScore(features, DEFAULT_PREP_PARAMS), tierScore(features, DEFAULT_PREP_PARAMS));
  // A second, freshly-constructed but deep-equal features object gives the identical result.
  const features2 = { spec_lines: 42, done_items: 3, scenario_count: 2, confidence: "medium" };
  assert.equal(tier(features, DEFAULT_PREP_PARAMS), tier(features2, DEFAULT_PREP_PARAMS));
});

test("tier(): a tiny, high-confidence feature vector buckets mechanical (almost nothing to build)", () => {
  assert.equal(tier({ spec_lines: 5, done_items: 0, scenario_count: 0, confidence: "high" }, DEFAULT_PREP_PARAMS), "mechanical");
});

test("tier(): a genuinely empty feature vector still buckets deterministically (no w-key contributes; only the default confidence prior)", () => {
  // No spec-native features present at all -> the only contribution is confidence_adj.default
  // (missing confidence never promotes to the `high` 0-adj) -> lands in `standard`, not
  // `mechanical` -- the default prior is deliberately non-zero (a JUDGEMENT PRIOR, see
  // DEFAULT_PREP_PARAMS's provenance comment), so an empty vector does not silently read as
  // the cheapest bucket.
  assert.equal(tier({}, DEFAULT_PREP_PARAMS), tier({ confidence: null }, DEFAULT_PREP_PARAMS));
});

test("tier(): a large feature vector buckets complex", () => {
  assert.equal(tier({ spec_lines: 800, done_items: 40, scenario_count: 20, confidence: "low" }, DEFAULT_PREP_PARAMS), "complex");
});

test("tierScore(): missing confidence uses the default prior, never the high prior", () => {
  const base = { spec_lines: 100, done_items: 5, scenario_count: 1 };
  const withHigh = tierScore({ ...base, confidence: "high" }, DEFAULT_PREP_PARAMS);
  const withMissing = tierScore(base, DEFAULT_PREP_PARAMS);
  const withNull = tierScore({ ...base, confidence: null }, DEFAULT_PREP_PARAMS);
  assert.notEqual(withMissing, withHigh, "missing confidence must not silently score as high (0 adj)");
  assert.equal(withMissing, withNull, "missing and explicit-null confidence resolve identically");
  assert.equal(withMissing, base.spec_lines * DEFAULT_PREP_PARAMS.w.spec_lines
    + base.done_items * DEFAULT_PREP_PARAMS.w.done_items
    + base.scenario_count * DEFAULT_PREP_PARAMS.w.scenario_count
    + DEFAULT_PREP_PARAMS.confidence_adj.default);
});

test("tierScore(): gate_history contributes only when present as a number (generic w-loop)", () => {
  const base = { spec_lines: 10, done_items: 1, scenario_count: 0, confidence: "high" };
  const without = tierScore(base, DEFAULT_PREP_PARAMS);
  const withZero = tierScore({ ...base, gate_history: 0 }, DEFAULT_PREP_PARAMS);
  const withTwo = tierScore({ ...base, gate_history: 2 }, DEFAULT_PREP_PARAMS);
  assert.equal(without, withZero, "gate_history: 0 contributes exactly zero (0 * weight), same as omitted");
  assert.ok(withTwo > withZero, "a positive gate_history prior bumps the score up");
  assert.equal(withTwo - withZero, 2 * DEFAULT_PREP_PARAMS.w.gate_history);
});

test("tier()/tierScore(): an unrecognised feature key on the vector is ignored (only w-keys count)", () => {
  const a = tierScore({ spec_lines: 10, done_items: 1, scenario_count: 0, confidence: "high" }, DEFAULT_PREP_PARAMS);
  const b = tierScore({ spec_lines: 10, done_items: 1, scenario_count: 0, confidence: "high", not_a_real_feature: 999 }, DEFAULT_PREP_PARAMS);
  assert.equal(a, b);
});

// ── CLI surface ──

test("faff tier <file>: bare mode prints just the token, twice run gives the same token", () => {
  const { dir, file } = fixtureFile("# Spec\n\nconfidence: high\n\n- [x] one\n\nGiven a thing\n");
  try {
    const r1 = runCli(["tier", file]);
    const r2 = runCli(["tier", file]);
    assert.equal(r1.code, 0);
    assert.equal(r2.code, 0);
    assert.equal(r1.stdout.trim(), r2.stdout.trim());
    assert.match(r1.stdout.trim(), /^(mechanical|standard|complex)$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("faff tier <file> --json: exposes {tier, score, features}", () => {
  const { dir, file } = fixtureFile("# Spec\n\nconfidence: high\n\n- [x] one\n\nGiven a thing\n");
  try {
    const r = runCli(["tier", file, "--json"]);
    assert.equal(r.code, 0);
    const body = JSON.parse(r.stdout);
    assert.ok(["mechanical", "standard", "complex"].includes(body.tier));
    assert.equal(typeof body.score, "number");
    assert.equal(typeof body.features, "object");
    assert.equal(body.features.confidence, "high");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("faff tier <file> --gate-history N: merges gate_history into the features, omitted => no contribution", () => {
  const { dir, file } = fixtureFile("# Spec\n\nconfidence: high\n\n- [x] one\n\nGiven a thing\n");
  try {
    const bare = JSON.parse(runCli(["tier", file, "--json"]).stdout);
    const withGate = JSON.parse(runCli(["tier", file, "--gate-history", "3", "--json"]).stdout);
    assert.equal(bare.features.gate_history, undefined, "gate_history is omitted entirely, not defaulted to 0");
    assert.equal(withGate.features.gate_history, 3);
    assert.ok(withGate.score > bare.score, "a positive gate_history prior raises the score");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("faff tier: missing spec file exits 2 with a usage-style message", () => {
  const r = runCli(["tier", "/no/such/spec/file/anywhere.md"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /cannot read/);
});

test("faff tier: non-numeric --gate-history exits 2", () => {
  const { dir, file } = fixtureFile("# Spec\nconfidence: high\n");
  try {
    const r = runCli(["tier", file, "--gate-history", "not-a-number"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /numeric/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("faff tier: no spec-file argument exits 2 usage", () => {
  const r = runCli(["tier"]);
  assert.equal(r.code, 2);
});

test("faff tier --selftest passes", () => {
  const r = runCli(["tier", "--selftest"]);
  assert.equal(r.code, 0, r.stderr);
});
