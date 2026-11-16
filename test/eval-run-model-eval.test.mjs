import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kindEntry, loadPlan, repsForKind, resultFromCaptures, runModelEval } from "../eval/run-model-eval.mjs";

const plan = loadPlan();
const MODEL = { id: "Org/Test-Model", driver: "local", effort: null };

// A summary shaped like runEvals/runLiveEvals output: one case per kind, `n` reps each.
const fakeSummary = (kind, n, { accuracy = 1, errored = 0 } = {}) => ({
  cases: [{ kind, case_id: `${kind}-001`, rep_results: Array.from({ length: n }, () => ({})), errored }],
  per_kind: { [kind]: { accuracy, stability: 1, format_adherence: 1 } },
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "model-eval-"));
  return { workDir: join(dir, "work"), resultsRoot: join(dir, "results"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("repsForKind: a kind override beats the tier default; an unknown tier throws", () => {
  assert.equal(repsForKind(plan, "quick", "dupe"), plan.tiers.quick.reps);
  assert.equal(repsForKind(plan, "quick", "refutation-spec"), plan.tiers.quick.kind_reps["refutation-spec"]);
  assert.equal(repsForKind(plan, "full", "dupe"), 20);
  assert.throws(() => repsForKind(plan, "huge", "dupe"), /unknown tier/);
});

test("kindEntry reports cases, total reps, the smallest rep count and errored reps", () => {
  const s = { cases: [{ kind: "k", rep_results: [1, 2, 3], errored: 1 }, { kind: "k", rep_results: [1, 2], errored: 0 }, { kind: "other", rep_results: [1], errored: 0 }], per_kind: { k: { accuracy: 0.5, stability: 1, format_adherence: null } } };
  assert.deepEqual(kindEntry(s, "k"), { accuracy: 0.5, stability: 1, format_adherence: null, cases: 2, reps: 5, min_reps_per_case: 2, errored: 1 });
});

test("runModelEval: runs each black-box kind at its tier reps, stores the result, and names unmeasured kinds", async () => {
  const t = setup();
  try {
    const calls = [];
    const runEvalsFn = async ({ cases, baseReps, maxReps }) => { const kind = cases[0].kind; calls.push({ kind, baseReps, maxReps }); return fakeSummary(kind, baseReps); };
    const { result, dir } = await runModelEval({
      model: MODEL, tier: "quick", lanes: ["blackbox"], kinds: ["dupe", "refutation-spec"], workDir: t.workDir, resultsRoot: t.resultsRoot,
      now: new Date("2026-03-04T00:00:00Z"), deps: { runEvalsFn, driver: () => {} },
    });
    assert.deepEqual(calls.map((c) => [c.kind, c.baseReps, c.maxReps]).sort(), [["dupe", 5, 5], ["refutation-spec", 3, 3]]);
    assert.equal(result.per_kind.dupe.reps, 5);
    assert.equal(result.meta.date, "2026-03-04");
    assert.ok(dir.endsWith(join("org-test-model", "2026-03-04")));
    assert.ok(existsSync(join(dir, "result.json")) && existsSync(join(dir, "README.md")));
    assert.ok(result.rollup.unmeasured.some((u) => u.kind === "reconciliation"), "kinds this run did not cover are listed, not silently absent");
    const stored = readFileSync(join(dir, "result.json"), "utf8");
    assert.doesNotMatch(stored, /https?:\/\//, "no gateway URL is stored");
  } finally { t.cleanup(); }
});

test("runModelEval: --resume reuses finished kinds and runs only the rest", async () => {
  const t = setup();
  try {
    let calls = [];
    const mk = () => async ({ cases, baseReps }) => { calls.push(cases[0].kind); return fakeSummary(cases[0].kind, baseReps); };
    const base = { model: MODEL, tier: "quick", lanes: ["blackbox"], workDir: t.workDir, resultsRoot: t.resultsRoot, deps: { runEvalsFn: mk(), driver: () => {} } };
    await runModelEval({ ...base, kinds: ["dupe"] });
    calls = [];
    const { result } = await runModelEval({ ...base, kinds: ["dupe", "vague"], resume: true });
    assert.deepEqual(calls, ["vague"]);
    assert.ok(result.per_kind.dupe && result.per_kind.vague);
    assert.equal(readdirSync(join(t.workDir, "kinds")).length, 2);
  } finally { t.cleanup(); }
});

test("runModelEval: live lane skips holdout-live without docker and records why; the others run", async () => {
  const t = setup();
  try {
    const ran = [];
    const liveRunner = async (kind, reps) => { ran.push([kind, reps]); return fakeSummary(kind, reps); };
    const { result } = await runModelEval({
      model: MODEL, tier: "quick", lanes: ["live"], workDir: t.workDir, resultsRoot: t.resultsRoot,
      deps: { liveRunner, dockerAvailable: async () => false },
    });
    assert.deepEqual(ran.map((r) => r[0]), ["reconciliation", "verdict-build", "finding-identity"]);
    assert.deepEqual(result.skipped, [{ lane: "live", kind: "holdout-live", reason: "docker is not available" }]);
    assert.ok(result.per_kind["finding-identity"]);
  } finally { t.cleanup(); }
});

test("runModelEval: the format lane is skipped with its reason when no endpoint is configured, and stored when it runs", async () => {
  const t = setup();
  try {
    const skipped = await runModelEval({ model: MODEL, tier: "quick", lanes: ["format"], workDir: t.workDir, resultsRoot: t.resultsRoot, deps: { formatSkipReason: "needs an API key" } });
    assert.equal(skipped.result.format, null);
    assert.equal(skipped.result.skipped[0].reason, "needs an API key");
    const ran = await runModelEval({ model: MODEL, tier: "full", lanes: ["format"], workDir: t.workDir, resultsRoot: t.resultsRoot, deps: { formatRunner: async (n) => ({ producers: [{ producer: "spec", samples: n, passed: n, failures: {}, note: null }] }) } });
    assert.equal(ran.result.format.producers[0].samples, plan.tiers.full.format_samples);
    assert.match(readFileSync(join(ran.dir, "README.md"), "utf8"), /Producer output through the real parsers/);
  } finally { t.cleanup(); }
});

test("resultFromCaptures rebuilds a stored result from raw judgement files and honours the ignore list", () => {
  const t = setup();
  try {
    mkdirSync(t.workDir, { recursive: true });
    const a = join(t.workDir, "runA"); const b = join(t.workDir, "runB");
    mkdirSync(a); mkdirSync(b);
    const line = (kind, id, score) => JSON.stringify({ kind, case_id: id, score, signature: "s", graded: score ? "PASS" : "FAIL", envelope: { format: "compliant" } });
    writeFileSync(join(a, "judgements.jsonl"), [line("dupe", "dupe-001", 1), line("dupe", "dupe-001", 1), line("refutation-spec", "refutation-spec-001", 1)].join("\n") + "\n");
    writeFileSync(join(b, "judgements.jsonl"), [line("refutation-spec", "refutation-spec-001", 0), line("refutation-spec", "refutation-spec-001", 0)].join("\n") + "\n");
    const { result, dir } = resultFromCaptures({ captureDirs: [a, b], ignoreKindsByDir: { [a]: ["refutation-spec"] }, model: MODEL, notes: "rebuilt", resultsRoot: t.resultsRoot, now: new Date("2026-05-06T00:00:00Z") });
    assert.equal(result.per_kind.dupe.accuracy, 1);
    assert.equal(result.per_kind["refutation-spec"].accuracy, 0, "the ignored kind comes from the second capture only");
    assert.equal(result.per_kind["refutation-spec"].reps, 2);
    assert.equal(result.meta.notes, "rebuilt");
    assert.deepEqual(result.meta.captures, ["runA", "runB"]);
    assert.ok(existsSync(join(dir, "result.json")));
  } finally { t.cleanup(); }
});
