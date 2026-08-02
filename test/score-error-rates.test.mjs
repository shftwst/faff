// FAFF-563 — the seeded-defect error-rate scorer's own tests. The scorer is DETERMINISTIC (a join of
// captured judgements to on-disk case labels + a re-derivation via the shipped deriveHoldoutAggregate +
// arithmetic + a rule-of-three bound), so its correctness is verified against SYNTHETIC judgements with
// KNOWN per-criterion classes — independent of, and far cheaper than, any real judge run. The pilot's
// real-judge run separately proves the loop closes; it never gates on the sensitivity rate (FAFF-625).
//
// These tests live in test/ (not eval/) because eval/ is excluded from the `node --test` globs — this is
// the CI-run home for the scorer's guarantees.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import {
  scoreErrorRates,
  rederiveAggregate,
  validateSeededCase,
  loadSeededCases,
  perCriterionClasses,
  SeededCaseError,
  DEFECT_CLASSES,
  OFFLINE_CAVEAT,
} from "../eval/score-error-rates.mjs";
import { renderFixturePrompt, criteriaFor } from "../eval/cli-driver.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, "..", "eval", "cases-pilot");
const SCORER = join(HERE, "..", "eval", "score-error-rates.mjs");

// The shared born-verifiable + prose spec_dod shape the synthetic cases use.
const SPEC_DOD = [
  { key: "k1", class: "scenario", text: "k1" },
  { key: "k2", class: "assertion", text: "k2" },
  { key: "kp", class: "prose", text: "kp" },
];

function seededCase(id, label, defect_class, expected_aggregate) {
  return { id, kind: "holdout-exercise", label, defect_class, expected_aggregate, fixture: { version: 1, spec_dod: SPEC_DOD, recordings: [] }, oracle: { closed_set: [] } };
}
function mapOf(cases) { return new Map(cases.map((c) => [c.id, c])); }
function record(case_id, classMap, rep = 0) {
  return { run_id: "run-test", ts: "t", case_id, kind: "holdout-exercise", rep, status: "graded", envelope: { case_id, "holdout-exercise": classMap } };
}

// ── Scenario 1 (WHAT / HOW): the scorer's counts match the values arithmetically implied by the known
//    per-criterion classes, and by_defect_class carries all four stratum keys. ──────────────────────────
test("scorer arithmetic matches the known per-criterion classes; all four strata keyed", () => {
  const cases = [
    seededCase("c-clean-ok", "clean", null, "meets-spec"),
    seededCase("c-clean-ff", "clean", null, "meets-spec"),
    seededCase("c-mc", "defective", "missed-criterion", "gaps"),
    seededCase("c-sw", "defective", "subtly-wrong", "gaps"),
    seededCase("c-wo", "defective", "working-but-off-spec", "gaps"),
    seededCase("c-sbe", "defective", "spec-satisfying-but-broken-elsewhere", "gaps"),
  ];
  const records = [
    record("c-clean-ok", { k1: "met", k2: "met", kp: "needs-human" }),   // born meets-spec → clean correct
    record("c-clean-ff", { k1: "met", k2: "unmet", kp: "needs-human" }), // born gaps → clean FALSE-FAIL
    record("c-mc", { k1: "met", k2: "met", kp: "needs-human" }),         // born meets-spec → defective FALSE-PASS
    record("c-sw", { k1: "unmet", k2: "met", kp: "needs-human" }),       // born gaps → defective caught
    record("c-wo", { k1: "met", k2: "met", kp: "needs-human" }),         // born meets-spec → defective FALSE-PASS
    record("c-sbe", { k1: "met", k2: "unmet", kp: "needs-human" }),      // born gaps → defective caught
  ];
  const r = scoreErrorRates(records, mapOf(cases), { driver: "mock", commit: "abc" });

  assert.equal(r.n_positive, 2);
  assert.equal(r.n_negative, 4);
  assert.equal(r.false_pass, 2);
  assert.equal(r.false_fail, 1);
  assert.equal(r.false_pass_rate, 0.5);
  assert.equal(r.false_fail_rate, 0.5);
  assert.equal(r.false_pass_upper_95, null); // false_pass > 0 ⇒ no fabricated bound
  assert.equal(r.reps, 1);
  assert.equal(r.driver, "mock");
  // all four strata present, each with the arithmetically-implied count
  assert.deepEqual(Object.keys(r.by_defect_class).sort(), [...DEFECT_CLASSES].sort());
  assert.deepEqual(r.by_defect_class["missed-criterion"], { n: 1, false_pass: 1, rate: 1 });
  assert.deepEqual(r.by_defect_class["subtly-wrong"], { n: 1, false_pass: 0, rate: 0 });
  assert.deepEqual(r.by_defect_class["working-but-off-spec"], { n: 1, false_pass: 1, rate: 1 });
  assert.deepEqual(r.by_defect_class["spec-satisfying-but-broken-elsewhere"], { n: 1, false_pass: 0, rate: 0 });
  // offline lane (holdout-exercise) carries the FAFF-317 caveat
  assert.equal(r.caveat, OFFLINE_CAVEAT);
});

// ── Scenario 2 (HOW): a defective case whose known classes re-derive to meets-spec is counted as EXACTLY
//    one false_pass — computed from the derived aggregate, not asserted by fiat. ─────────────────────────
test("defective re-deriving to meets-spec ⇒ exactly one false_pass", () => {
  const c = seededCase("c-mc", "defective", "missed-criterion", "gaps");
  const rec = record("c-mc", { k1: "met", k2: "met", kp: "needs-human" });
  const r = scoreErrorRates([rec], mapOf([c]), {});
  assert.equal(r.n_negative, 1);
  assert.equal(r.false_pass, 1);
  assert.equal(r.by_defect_class["missed-criterion"].false_pass, 1);
  // sanity: the derivation itself is meets-spec, over the born-verifiable subset (prose excluded)
  assert.equal(rederiveAggregate(c, { k1: "met", k2: "met", kp: "needs-human" }).aggregate, "meets-spec");
});

// ── Scenario 3 (HOW): a working-but-off-spec case (targeted criterion met, adjacent unmet) re-derives to
//    gaps/fails — a partial pass NEVER re-derives to meets-spec — and is NOT counted as a false_pass. ────
test("working-but-off-spec re-derives to gaps/fails, not a false_pass", () => {
  const c = seededCase("c-wo", "defective", "working-but-off-spec", "gaps");
  const derived = rederiveAggregate(c, { k1: "met", k2: "unmet", kp: "needs-human" }).aggregate;
  assert.ok(derived === "gaps" || derived === "fails", `partial pass must not be meets-spec (got ${derived})`);
  const r = scoreErrorRates([record("c-wo", { k1: "met", k2: "unmet", kp: "needs-human" })], mapOf([c]), {});
  assert.equal(r.false_pass, 0);
  assert.equal(r.by_defect_class["working-but-off-spec"].false_pass, 0);
});

// ── Rule of three: 3/n_negative when false_pass == 0; null when > 0 (never a fabricated float). ─────────
test("false_pass_upper_95 is 3/n_negative on a zero-count, null otherwise", () => {
  const cases = [
    seededCase("d1", "defective", "missed-criterion", "gaps"),
    seededCase("d2", "defective", "subtly-wrong", "gaps"),
    seededCase("d3", "defective", "working-but-off-spec", "gaps"),
  ];
  // every defective caught (gaps) ⇒ false_pass 0 over 3 negatives ⇒ bound 3/3 = 1
  const clean = cases.map((c) => record(c.id, { k1: "met", k2: "unmet", kp: "needs-human" }));
  const rZero = scoreErrorRates(clean, mapOf(cases), {});
  assert.equal(rZero.false_pass, 0);
  assert.equal(rZero.false_pass_upper_95, 3 / 3);

  // one waved through ⇒ false_pass > 0 ⇒ no bound
  const withFp = [record("d1", { k1: "met", k2: "met", kp: "needs-human" }), clean[1], clean[2]];
  const rNonZero = scoreErrorRates(withFp, mapOf(cases), {});
  assert.equal(rNonZero.false_pass, 1);
  assert.equal(rNonZero.false_pass_upper_95, null);
});

// ── Format constraints (WHAT): defective ⇔ defect_class != null; clean ⇔ expected_aggregate meets-spec. ─
test("validateSeededCase enforces the label/defect_class/expected_aggregate constraints", () => {
  // valid
  validateSeededCase(seededCase("ok-c", "clean", null, "meets-spec"));
  validateSeededCase(seededCase("ok-d", "defective", "subtly-wrong", "gaps"));
  validateSeededCase(seededCase("ok-d2", "defective", "missed-criterion", "fails"));
  // defective must carry a defect_class
  assert.throws(() => validateSeededCase(seededCase("bad", "defective", null, "gaps")), SeededCaseError);
  // clean must NOT carry a defect_class
  assert.throws(() => validateSeededCase(seededCase("bad", "clean", "subtly-wrong", "meets-spec")), SeededCaseError);
  // clean's expected_aggregate must be meets-spec
  assert.throws(() => validateSeededCase(seededCase("bad", "clean", null, "gaps")), SeededCaseError);
  // defective's expected_aggregate must be gaps|fails
  assert.throws(() => validateSeededCase(seededCase("bad", "defective", "subtly-wrong", "meets-spec")), SeededCaseError);
  // unknown defect_class
  assert.throws(() => validateSeededCase(seededCase("bad", "defective", "not-a-class", "gaps")), SeededCaseError);
  // bad label
  assert.throws(() => validateSeededCase(seededCase("bad", "maybe", null, "meets-spec")), SeededCaseError);
});

// ── Unscorable reps (errored / no envelope) are skipped, never counted into the rates. ─────────────────
test("records without a usable per-criterion envelope are skipped", () => {
  const c = seededCase("c-mc", "defective", "missed-criterion", "gaps");
  const errored = { run_id: "r", case_id: "c-mc", kind: "holdout-exercise", rep: 0, status: "errored", envelope: null };
  assert.equal(perCriterionClasses(errored), null);
  const r = scoreErrorRates([errored], mapOf([c]), {});
  assert.equal(r.n_negative, 0);
  assert.equal(r.skipped, 1);
});

// ── Teaching-to-the-test (WHY, Scenario 4): the driver's rendered judge prompt for a SeededDefectCase
//    contains none of the case's label / defect_class / expected_aggregate VALUES, and the label FIELDS
//    are never serialized into it. Asserted over the RENDERED prompt, not merely the fixture JSON. ──────
test("leakage: the rendered judge prompt carries none of a case's label fields", () => {
  const raw = readFileSync(join(CASES_DIR, "holdout-seed-neg-spec-satisfying-but-broken-elsewhere-001.json"), "utf8");
  const c = JSON.parse(raw);
  validateSeededCase(c);
  assert.equal(c.label, "defective");
  assert.equal(c.defect_class, "spec-satisfying-but-broken-elsewhere");
  assert.equal(c.expected_aggregate, "gaps");

  const rubric = criteriaFor(c.kind);            // the real, static judge rubric prose
  const full = renderFixturePrompt(c, rubric);    // the driver's ACTUAL prompt
  const caseOnly = renderFixturePrompt(c, null);  // the case-derived portion (no rubric)

  // The label FIELD KEYS must never be serialized into the prompt (the "renderer forwarded the label
  // fields" failure) — checked over the FULL prompt, rubric included.
  for (const key of ["label", "defect_class", "expected_aggregate"]) {
    assert.ok(!full.includes(key), `field key "${key}" leaked into the rendered prompt`);
  }
  // The distinctive label + defect_class VALUES are absent even from the full prompt (they are not rubric
  // vocabulary — verified below).
  assert.ok(!rubric.includes("defective") && !rubric.includes(c.defect_class), "test premise: distinctive values are not rubric vocabulary");
  assert.ok(!full.includes("defective"), "label value leaked into the rendered prompt");
  assert.ok(!full.includes(c.defect_class), "defect_class value leaked into the rendered prompt");
  // expected_aggregate's value ("gaps") IS rubric vocabulary, so its presence in the full prompt would be
  // the static rubric, not a case leak. Isolate the case-derived portion and assert the value is absent
  // from THAT — the honest measurement-boundary check.
  assert.ok(rubric.includes(c.expected_aggregate), "test premise: the aggregate word is rubric vocabulary");
  assert.ok(!caseOnly.includes(c.expected_aggregate), "expected_aggregate value leaked via the case-derived prompt");
});

// ── Pilot corpus (HOW): the on-disk seeded fixtures validate, span ≥1 clean + ≥1 defective per stratum,
//    and load cleanly through the scorer's second-pass loader. ──────────────────────────────────────────
test("the pilot corpus validates and spans all four strata (≥1 clean, ≥1 defective per stratum)", () => {
  const seeded = loadSeededCases(CASES_DIR);
  const vals = [...seeded.values()].filter((c) => c.id.startsWith("holdout-seed-"));
  assert.ok(vals.length >= 5, `expected ≥5 pilot fixtures, got ${vals.length}`);
  const clean = vals.filter((c) => c.label === "clean");
  const defective = vals.filter((c) => c.label === "defective");
  assert.ok(clean.length >= 1, "pilot needs ≥1 clean fixture");
  for (const dc of DEFECT_CLASSES) {
    assert.ok(defective.some((c) => c.defect_class === dc), `pilot missing a defective fixture for stratum ${dc}`);
  }
});

// ── Integration smoke (HOW, DoD): run-evals → judgements.jsonl → score-error-rates → ErrorRateReport
//    closes the loop over the pilot fixtures with a MOCK driver's KNOWN aggregates (deterministic, never
//    bills the frontier). Two mock judges: a perfect one (loop closes, polarity classified, no false-
//    pass) and an INSENSITIVE one (every defect waved through) — proving a high false-pass count is a
//    valid, reportable outcome that the pilot does NOT gate on. Drives the actual CLI end to end. ────────
test("smoke: the score-error-rates CLI closes the loop over the pilot corpus (mock driver)", () => {
  const seeded = loadSeededCases(CASES_DIR);
  const pilot = [...seeded.values()].filter((c) => c.id.startsWith("holdout-seed-"));
  const nClean = pilot.filter((c) => c.label === "clean").length;
  const nDefective = pilot.filter((c) => c.label === "defective").length;

  // ground-truth per-criterion map from a case's oracle closed_set (the "perfect judge")
  const truthMap = (c) => Object.fromEntries(c.oracle.closed_set.map((p) => { const i = p.lastIndexOf(":"); return [p.slice(0, i), p.slice(i + 1)]; }));
  // insensitive judge: force every born-verifiable criterion to "met" (waves defects through)
  const blindMap = (c) => Object.fromEntries(c.fixture.spec_dod.filter((d) => d.class !== "prose").map((d) => [d.key, "met"]));

  const tmp = mkdtempSync(join(tmpdir(), "faff-563-smoke-"));
  try {
    // ---- perfect judge ----
    const perfectLines = pilot.map((c) => JSON.stringify(record(c.id, truthMap(c))) + "\n").join("");
    const perfectPath = join(tmp, "perfect.jsonl");
    writeFileSync(perfectPath, perfectLines);
    const p = spawnSync(process.execPath, [SCORER, perfectPath, "--cases-dir", CASES_DIR, "--driver", "mock"], { encoding: "utf8" });
    assert.equal(p.status, 0, p.stderr);
    const rp = JSON.parse(p.stdout);
    assert.equal(rp.n_positive, nClean);
    assert.equal(rp.n_negative, nDefective);
    assert.equal(rp.false_pass, 0, "a correct judge over ground-truth recordings waves nothing through");
    assert.equal(rp.false_fail, 0, "a correct judge parks no clean case");
    assert.equal(rp.false_pass_upper_95, 3 / nDefective); // zero-count ⇒ rule-of-three bound reported
    assert.deepEqual(Object.keys(rp.by_defect_class).sort(), [...DEFECT_CLASSES].sort());
    assert.equal(rp.driver, "mock");
    assert.ok(rp.caveat && rp.caveat.includes("FAFF-317"), "offline lane records the FAFF-317 caveat");

    // ---- insensitive judge: a high false-pass count is a valid, reportable pilot outcome ----
    const blindLines = pilot.map((c) => JSON.stringify(record(c.id, c.label === "defective" ? blindMap(c) : truthMap(c))) + "\n").join("");
    const blindPath = join(tmp, "blind.jsonl");
    writeFileSync(blindPath, blindLines);
    const b = spawnSync(process.execPath, [SCORER, blindPath, "--cases-dir", CASES_DIR], { encoding: "utf8" });
    assert.equal(b.status, 0, b.stderr);
    const rb = JSON.parse(b.stdout);
    assert.equal(rb.false_pass, nDefective, "the insensitive judge is counted, not asserted-away");
    assert.equal(rb.false_pass_rate, 1);
    assert.equal(rb.false_pass_upper_95, null); // non-zero count ⇒ no fabricated bound
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
