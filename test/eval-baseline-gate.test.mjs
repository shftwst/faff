// FAFF-169 — deterministic tests for the committed-baseline regression gate.
// Runs under `node --test` (free, zero frontier calls): diffAgainstBaseline is pure, and the
// committed baseline is read off disk. No model is invoked. The gate itself is human-run (frontier
// costs spend, eval/ is CI-excluded — ADR-0004); these tests cover the PURE comparator + the policy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { diffAgainstBaseline, toleranceFor, DEFAULT_POLICY, loadBaseline } from "../eval/run-evals.mjs";
import { CLOSED_SET_KINDS, BINARY_SETEQ_KINDS } from "../eval/grader.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(HERE, "..", "eval", "baselines", "frontier.json");

// A small baseline fixture exercising one of each grader-class + the warn-kind.
const baseline = {
  per_kind: {
    dupe:       { accuracy: 1.0,  stability: 1.0,  format_adherence: 1.0 }, // closed_set → tol 0
    ordering:   { accuracy: 1.0,  stability: 1.0,  format_adherence: 1.0 }, // ordering → tol 0
    gloss:      { accuracy: 0.99, stability: 0.99, format_adherence: 1.0 }, // free_text → tol 0.03
    confidence: { accuracy: 0.93, stability: 0.93, format_adherence: 1.0 }, // closed_set BUT warn-kind
  },
  policy: DEFAULT_POLICY,
};
const summary = (per_kind) => ({ status: "complete", per_kind });

test("toleranceFor: grader-class drives the tolerance (closed_set/ordering 0, free_text 0.03)", () => {
  assert.equal(toleranceFor("dupe"), 0);          // closed-set
  assert.equal(toleranceFor("confidence"), 0);    // closed-set (warn-ness is orthogonal, not a tolerance)
  assert.equal(toleranceFor("ordering"), 0);      // rank-correlation
  assert.equal(toleranceFor("gloss"), 0.03);      // free-text
  assert.equal(toleranceFor("shaping"), 0.03);    // free-text
  assert.equal(toleranceFor("decomposition"), 0.03);
});

// FAFF-692 — splittable/chain-gap/resolved-elsewhere are binary set-equality graders (score 0 or 1,
// no partial credit) that were mis-keyed to the free_text (0.03) band by falling through toleranceFor's
// default else-branch. They belong at the closed_set (0.0) tolerance instead — any drop is real.
test("toleranceFor: the three binary set-equality kinds resolve to 0.0, not the free-text 0.03", () => {
  assert.equal(toleranceFor("splittable"), 0);
  assert.equal(toleranceFor("chain-gap"), 0);
  assert.equal(toleranceFor("resolved-elsewhere"), 0);
  // the free-text band is unchanged for genuinely generative kinds
  assert.equal(toleranceFor("gloss"), 0.03);
  assert.equal(toleranceFor("shaping"), 0.03);
  assert.equal(toleranceFor("decomposition"), 0.03);
});

test("FAFF-692 invariant: BINARY_SETEQ_KINDS members are NOT in CLOSED_SET_KINDS (grade dispatch untouched)", () => {
  for (const kind of BINARY_SETEQ_KINDS) {
    assert.equal(CLOSED_SET_KINDS.has(kind), false, `${kind} must not be in CLOSED_SET_KINDS — it would silently repoint grade dispatch`);
  }
});

test("FAFF-692 invariant: none of the three binary set-equality kinds is in the active warn_kinds set", () => {
  for (const kind of BINARY_SETEQ_KINDS) {
    assert.equal(DEFAULT_POLICY.warn_kinds.includes(kind), false, `${kind} must not be a warn-kind — that would silently flip its gate result from "fail" back to "warn"`);
  }
});

// FAFF-692 gate-effect test, over a concrete hermetic fixture (not the committed frontier.json) —
// oracle pinned per the 2026-08-06 spec-review QA-lens major. format_adherence is left unset on both
// sides so the diffAgainstBaseline formatBad branch stays out of this assertion.
test("FAFF-692: a splittable accuracy drop of 0.02 now FAILS the gate (was absorbed as a warn at the old 0.03 tolerance)", () => {
  const hermeticBaseline = {
    per_kind: { splittable: { accuracy: 1.0, stability: 1.0 } },
    policy: DEFAULT_POLICY,
  };
  const r = diffAgainstBaseline(summary({ splittable: { accuracy: 0.98, stability: 1.0 } }), hermeticBaseline);
  const entry = r.kinds.find((k) => k.kind === "splittable");
  assert.equal(entry.status, "fail");
  assert.equal(r.failed, true);
  assert.equal(r.warned, false);
});

test("a closed-set accuracy drop FAILS the gate (tolerance 0)", () => {
  const r = diffAgainstBaseline(summary({ ...baseline.per_kind, dupe: { accuracy: 0.96, stability: 1.0, format_adherence: 1.0 } }), baseline);
  assert.equal(r.kinds.find((k) => k.kind === "dupe").status, "fail");
  assert.equal(r.failed, true);
});

test("a closed-set stability drop FAILS the gate", () => {
  const r = diffAgainstBaseline(summary({ ...baseline.per_kind, dupe: { accuracy: 1.0, stability: 0.95, format_adherence: 1.0 } }), baseline);
  assert.equal(r.kinds.find((k) => k.kind === "dupe").status, "fail");
  assert.equal(r.failed, true);
});

test("a within-tolerance free-text dip PASSES (gloss 0.99 → 0.97, tol 0.03)", () => {
  const r = diffAgainstBaseline(summary({ ...baseline.per_kind, gloss: { accuracy: 0.97, stability: 0.97, format_adherence: 1.0 } }), baseline);
  assert.equal(r.kinds.find((k) => k.kind === "gloss").status, "pass");
  assert.equal(r.failed, false);
});

test("a free-text drop BEYOND tolerance FAILS (gloss 0.99 → 0.90)", () => {
  const r = diffAgainstBaseline(summary({ ...baseline.per_kind, gloss: { accuracy: 0.90, stability: 0.90, format_adherence: 1.0 } }), baseline);
  assert.equal(r.kinds.find((k) => k.kind === "gloss").status, "fail");
  assert.equal(r.failed, true);
});

test("a confidence regression WARNS, never FAILS (warn-kind override)", () => {
  const r = diffAgainstBaseline(summary({ ...baseline.per_kind, confidence: { accuracy: 0.85, stability: 0.85, format_adherence: 1.0 } }), baseline);
  assert.equal(r.kinds.find((k) => k.kind === "confidence").status, "warn");
  assert.equal(r.warned, true);
  assert.equal(r.failed, false); // a warn-kind never fails the gate
});

test("a baseline kind MISSING from the run FAILS (silently dropped kind is a regression)", () => {
  const { dupe, ...withoutDupe } = baseline.per_kind; // run omits dupe
  const r = diffAgainstBaseline(summary(withoutDupe), baseline);
  const d = r.kinds.find((k) => k.kind === "dupe");
  assert.equal(d.status, "fail");
  assert.match(d.reason, /dropped/);
  assert.equal(r.failed, true);
});

test("a format_adherence drop below 1.00 FAILS", () => {
  const r = diffAgainstBaseline(summary({ ...baseline.per_kind, dupe: { accuracy: 1.0, stability: 1.0, format_adherence: 0.9 } }), baseline);
  assert.equal(r.kinds.find((k) => k.kind === "dupe").status, "fail");
});

test("an improvement PASSES and is never gated", () => {
  const r = diffAgainstBaseline(summary({ ...baseline.per_kind, gloss: { accuracy: 1.0, stability: 1.0, format_adherence: 1.0 } }), baseline);
  assert.equal(r.kinds.find((k) => k.kind === "gloss").status, "pass");
  assert.equal(r.failed, false);
});

test("a NEW (un-baselined) kind is informational, not a fail", () => {
  const r = diffAgainstBaseline(summary({ ...baseline.per_kind, newkind: { accuracy: 0.5, stability: 0.5, format_adherence: 1.0 } }), baseline);
  assert.deepEqual(r.new_kinds, ["newkind"]);
  assert.equal(r.failed, false);
});

test("a clean run (all at baseline) PASSES with no warns", () => {
  const r = diffAgainstBaseline(summary(baseline.per_kind), baseline);
  assert.equal(r.failed, false);
  assert.equal(r.warned, false);
});

test("diffAgainstBaseline fails loud on a baseline with no per_kind", () => {
  assert.throws(() => diffAgainstBaseline(summary(baseline.per_kind), { policy: {} }), /per_kind/);
});

test("loadBaseline fails loud on a missing file", () => {
  assert.throws(() => loadBaseline(join(HERE, "does-not-exist.json")), /cannot read baseline/);
});

// --- the COMMITTED baseline is well-formed and self-consistent ---
test("the committed eval/baselines/frontier.json is valid + carries policy", () => {
  const b = loadBaseline(BASELINE_PATH);
  assert.ok(b.per_kind && Object.keys(b.per_kind).length >= 12, "expected the frontier kinds");
  assert.ok(b.policy && Array.isArray(b.policy.warn_kinds), "expected a policy.warn_kinds");
  assert.ok(b.policy.warn_kinds.includes("confidence"), "confidence is the warn-kind");
  // every per_kind entry has the three fields the gate reads
  for (const [k, m] of Object.entries(b.per_kind)) {
    assert.equal(typeof m.accuracy, "number", `${k}.accuracy`);
    assert.equal(typeof m.stability, "number", `${k}.stability`);
  }
});

test("the committed baseline gates cleanly against itself (no self-regression)", () => {
  const b = loadBaseline(BASELINE_PATH);
  const r = diffAgainstBaseline(summary(b.per_kind), b);
  assert.equal(r.failed, false);
  assert.equal(r.warned, false);
});

// --- regression guard: the FRONTIER judgement gate is NOT wired into CI (it's human-run; frontier
// costs spend — ADR-0004). Scoped to the frontier gate specifically: the free, deterministic
// prompt-SIZE gate (FAFF-171: size-census.mjs --gate --against prompt-size.json) legitimately DOES
// run in CI, so this guard targets run-evals.mjs / the frontier baseline, not a bare --against. ---
test("the frontier judgement gate is not referenced in validate.yml (human-run, not CI — ADR-0004)", () => {
  const ci = readFileSync(join(HERE, "..", ".github", "workflows", "validate.yml"), "utf8");
  assert.equal(/run-evals\.mjs|baselines\/frontier/.test(ci), false, "the human-run frontier judgement gate must not be a CI step (the free size gate may be)");
});
