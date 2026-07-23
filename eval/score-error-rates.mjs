// FAFF-563 — the seeded-defect ERROR-RATE scorer for the code-blind holdout evaluator.
//
// WHAT: a deterministic read over a run's captured per-rep judgements
// (`.faff/eval-runs/<run-id>/judgements.jsonl`, streamed by run-evals.mjs — FAFF-320) that turns them
// into a false-pass / false-fail confusion measurement against a labelled corpus of SeededDefectCase
// fixtures. It answers the FAFF-563 question — how sensitive is the judge? — by counting how often the
// judge returns `meets-spec` on an implementation carrying a KNOWN injected spec violation (the cardinal
// false-pass) and how often it returns not-`meets-spec` on a genuinely clean one (the non-cardinal
// false-fail).
//
// NOT: a grader, and NOT an extension of the `per_kind` regression baseline. The regression gate
// (`diffAgainstBaseline`) stays byte-for-byte untouched — this is a SEPARATE read over the same captured
// judgements. It introduces no new grader KIND and no LLM seam: it is a join + a re-derivation of the
// judged aggregate + arithmetic + a rule-of-three bound. Because it is deterministic, its own correctness
// is checkable by a unit test over a SYNTHETIC judgements fixture with known per-criterion classes,
// independent of any real judge run (test/score-error-rates.test.mjs).
//
// THE MEASUREMENT BOUNDARY (teaching-to-the-test discipline — FAFF-547): the label / defect_class /
// expected_aggregate fields live ONLY on the SeededDefectCase fixtures on disk and only ever enter THIS
// scorer's process. They are NEVER carried in the judged stream (judgements.jsonl does not record them)
// and NEVER rendered into a judge prompt (asserted by test/score-error-rates.test.mjs). The scorer
// obtains ground truth by a SECOND pass — re-loading the fixtures and joining each judgement to its case
// by `case_id` — so the judge is scored against labels it never saw.
//
// eval/ is excluded from the `node --test` globs (like the rest of the harness), so this file is never
// imported by CI; its tests live in test/ and import it explicitly.
//
// Zero-dependency: node builtins + the shipped `deriveHoldoutAggregate` (the one canonical aggregate
// roll-up — reused, never re-invented).

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { deriveHoldoutAggregate } from "../plugin/skills/faff/bin/lib/contract-defs.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// The four corpus strata (FAFF-563 §3 taxonomy). The by_defect_class stratification is keyed on exactly
// these, so a production corpus (FAFF-625) inherits the strata from the format rather than re-inventing
// them, and a low aggregate can never hide a blind spot in one stratum.
export const DEFECT_CLASSES = [
  "missed-criterion",
  "subtly-wrong",
  "working-but-off-spec",
  "spec-satisfying-but-broken-elsewhere",
];

// Aggregates the corpus polarity constraints reference (mirrors HOLDOUT_AGGREGATES in contract-defs).
const CLEAN_EXPECTED = "meets-spec";
const DEFECTIVE_EXPECTED = new Set(["gaps", "fails"]);

// FAFF-317: the offline-proxy caveat, attached to any report whose scored cases are `holdout-exercise`
// kind — the recorded-surface lane cannot capture the live agentic loop, exactly as ADR-0029 labelled its
// diff-as-text caveat. Keeps the cheap offline number from being laundered as the live sensitivity rate.
export const OFFLINE_CAVEAT =
  "offline-proxy (holdout-exercise recordings): per FAFF-317 this measures the judge's criteria-mapping " +
  "+ met/unmet reasoning over a FIXED recorded surface, NOT the live agentic end-to-end sensitivity the " +
  "L4 trust story needs (FAFF-629). Do not cite as the live rate.";

export class SeededCaseError extends Error {}

// A SeededDefectCase is an EvalCase with three additive label fields. Validate the constraints the format
// pins (FAFF-563 §3): defective ⇔ defect_class != null; clean ⇔ expected_aggregate == meets-spec.
export function validateSeededCase(c) {
  if (!c || typeof c !== "object") throw new SeededCaseError("seeded case must be an object");
  if (typeof c.id !== "string" || !c.id) throw new SeededCaseError("seeded case.id must be a non-empty string");
  if (c.label !== "clean" && c.label !== "defective") {
    throw new SeededCaseError(`seeded case ${c.id}: label must be "clean" or "defective" (got ${JSON.stringify(c.label)})`);
  }
  const defectClassNull = c.defect_class == null;
  if (c.label === "defective") {
    if (defectClassNull) throw new SeededCaseError(`seeded case ${c.id}: label "defective" requires a non-null defect_class`);
    if (!DEFECT_CLASSES.includes(c.defect_class)) {
      throw new SeededCaseError(`seeded case ${c.id}: defect_class ${JSON.stringify(c.defect_class)} not in {${DEFECT_CLASSES.join(", ")}}`);
    }
    if (!DEFECTIVE_EXPECTED.has(c.expected_aggregate)) {
      throw new SeededCaseError(`seeded case ${c.id}: defective expected_aggregate must be gaps|fails (got ${JSON.stringify(c.expected_aggregate)})`);
    }
  } else { // clean
    if (!defectClassNull) throw new SeededCaseError(`seeded case ${c.id}: label "clean" requires defect_class == null (got ${JSON.stringify(c.defect_class)})`);
    if (c.expected_aggregate !== CLEAN_EXPECTED) {
      throw new SeededCaseError(`seeded case ${c.id}: clean expected_aggregate must be "meets-spec" (got ${JSON.stringify(c.expected_aggregate)})`);
    }
  }
  return c;
}

// Load the SeededDefectCase fixtures from a cases directory: every *.json case carrying a `label` field
// (an ordinary EvalCase without one is skipped — it is not part of the corpus). Returns a
// `case_id -> SeededDefectCase` map. Each is validated; a constraint violation is fail-loud.
export function loadSeededCases(dir = join(HERE, "cases")) {
  const map = new Map();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    let c;
    try {
      c = JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch (e) {
      throw new SeededCaseError(`seeded case ${f}: not valid JSON: ${e.message}`);
    }
    if (!c || typeof c !== "object" || c.label == null) continue; // ordinary eval case — not corpus
    validateSeededCase(c);
    map.set(c.id, c);
  }
  return map;
}

// The per-criterion judged classes for a judgement record, read from the SAME top-level envelope field
// the grader reads (`env.holdout` for kind `holdout`; `env["holdout-exercise"]` for `holdout-exercise`) —
// a `{ "<criterion-key>": "met|unmet|needs-human" }` map. A missing/garbage envelope → null (the record
// is unscorable: an errored rep, or a parse failure). NEVER reads label fields (they are not in the
// stream by design).
export function perCriterionClasses(record) {
  const env = record && record.envelope;
  if (!env || typeof env !== "object") return null;
  const field = record.kind === "holdout" ? env.holdout : record.kind === "holdout-exercise" ? env["holdout-exercise"] : null;
  if (!field || typeof field !== "object" || Array.isArray(field)) return null;
  return field;
}

// Re-derive the judged aggregate for a case from its captured per-criterion classes, EXCLUDING prose
// criteria (FAFF-563 §4: prose is forced to needs-human by construction and is never the seeded defect,
// so it must not drag every aggregate to needs-human). The born-verifiable (scenario/assertion) subset is
// resolved from the case's own spec_dod; a born-verifiable criterion the judge did not classify is treated
// as `needs-human` (the judge could not confirm it — never silently dropped, which could fabricate a
// meets-spec from a partial map). Then rolls up via the shipped `deriveHoldoutAggregate` — the one
// canonical roll-up the holdout-verdict contract uses — so the scorer and the contract agree by
// construction. Returns { aggregate, judged_classes, born_verifiable_keys }.
export function rederiveAggregate(seededCase, judgedClassMap) {
  const specDod = (seededCase.fixture && Array.isArray(seededCase.fixture.spec_dod)) ? seededCase.fixture.spec_dod : [];
  const bornKeys = specDod.filter((d) => d && d.class !== "prose" && typeof d.key === "string").map((d) => d.key);
  const map = judgedClassMap || {};
  const judged = bornKeys.map((k) => (typeof map[k] === "string" ? map[k] : "needs-human"));
  return { aggregate: deriveHoldoutAggregate(judged), judged_classes: judged, born_verifiable_keys: bornKeys };
}

// The core scorer. Given the parsed judgement records and a `case_id -> SeededDefectCase` map, produce an
// ErrorRateReport. Pure over its inputs (metadata like driver/commit/model is threaded in by the caller).
//
// Polarity (FAFF-563 §4): for a DEFECTIVE case a re-derived `meets-spec` is a FALSE-PASS (the cardinal
// failure — a broken feature the judge waved through); for a CLEAN case a re-derived NON-`meets-spec` is a
// FALSE-FAIL (non-cardinal — it merely parks a human). Each scorable judgement RECORD is one trial (so K
// reps of a case contribute K trials), matching the rule-of-three denominator.
export function scoreErrorRates(records, seededById, meta = {}) {
  const by_defect_class = {};
  for (const dc of DEFECT_CLASSES) by_defect_class[dc] = { n: 0, false_pass: 0, rate: null };

  let n_positive = 0, n_negative = 0, false_pass = 0, false_fail = 0, skipped = 0;
  const repSet = new Set();
  let sawExercise = false, run_id = null;

  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    const seeded = seededById.get(rec.case_id);
    if (!seeded) continue;                       // ordinary eval case — not part of the corpus
    if (run_id == null && typeof rec.run_id === "string") run_id = rec.run_id;
    if (rec.kind === "holdout-exercise") sawExercise = true;

    const classes = perCriterionClasses(rec);
    if (classes == null) { skipped++; continue; } // unscorable rep (errored / parse-failed) — never counted
    if (typeof rec.rep === "number") repSet.add(rec.rep);

    const { aggregate } = rederiveAggregate(seeded, classes);
    if (seeded.label === "defective") {
      n_negative++;
      const dc = by_defect_class[seeded.defect_class] || (by_defect_class[seeded.defect_class] = { n: 0, false_pass: 0, rate: null });
      dc.n++;
      if (aggregate === "meets-spec") { false_pass++; dc.false_pass++; }
    } else { // clean
      n_positive++;
      if (aggregate !== "meets-spec") false_fail++;
    }
  }

  for (const dc of Object.values(by_defect_class)) dc.rate = dc.n > 0 ? dc.false_pass / dc.n : null;

  const reps = repSet.size > 0 ? Math.max(...repSet) + 1 : 0;

  return {
    n_positive,
    n_negative,
    false_pass,
    false_fail,
    // false-pass is reported FIRST and weighted ahead of false-fail — the cardinal-failure principle.
    false_pass_rate: n_negative > 0 ? false_pass / n_negative : null,
    false_fail_rate: n_positive > 0 ? false_fail / n_positive : null,
    // Rule of three: a zero-count over n trials bounds the true rate at ~3/n (95%). Reported ONLY when the
    // count is zero AND there are negatives to bound — so a zero-count is never misread as a proven-zero
    // rate; a non-zero count carries `null`, never a fabricated float.
    false_pass_upper_95: (false_pass === 0 && n_negative > 0) ? 3 / n_negative : null,
    by_defect_class,
    reps,
    skipped,
    driver: meta.driver ?? "unknown",
    caveat: sawExercise ? OFFLINE_CAVEAT : null,
    run_id: meta.run_id ?? run_id,
    captured_at: meta.captured_at ?? new Date().toISOString(),
    commit: meta.commit ?? null,
    model: meta.model ?? null,
  };
}

// Parse a judgements.jsonl file into an array of records (blank lines skipped; a malformed line is
// fail-loud, since a silently-dropped judgement would understate the denominator).
export function loadJudgements(path) {
  const text = readFileSync(path, "utf8");
  const out = [];
  let ln = 0;
  for (const line of text.split("\n")) {
    ln++;
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch (e) {
      throw new SeededCaseError(`${path}:${ln}: malformed judgement line: ${e.message}`);
    }
  }
  return out;
}

function argVal(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

export function main(argv = process.argv.slice(2)) {
  const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
  const judgementsPath = positional[0];
  if (!judgementsPath) {
    process.stderr.write(
      "usage: node eval/score-error-rates.mjs <judgements.jsonl> [--cases-dir <dir>] [--driver <name>] [--model <id>]\n"
    );
    process.exit(2);
  }
  const casesDir = argVal(argv, "--cases-dir") || join(HERE, "cases");
  const driver = argVal(argv, "--driver") || "unknown";
  const model = argVal(argv, "--model");

  let commit = null;
  try { commit = execSync("git rev-parse --short HEAD", { cwd: HERE, encoding: "utf8" }).trim() || null; } catch { commit = null; }

  const records = loadJudgements(judgementsPath);
  const seededById = loadSeededCases(casesDir);
  const report = scoreErrorRates(records, seededById, { driver, model, commit });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  return report;
}

// Run as a CLI only when invoked directly (never on import — the tests import the pure functions).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
