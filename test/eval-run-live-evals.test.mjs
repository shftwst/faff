// FAFF-163 — mock-model unit test for the live-driver frontier RUNNER (eval/run-live-evals.mjs).
//
// Runs under `node --test` (free, ZERO spawn): the runner is driven with a MOCK model (deterministic,
// no `claude -p`), through the REAL FAFF-93 harness (runSkill + mock-tracker + seeded repo) and the
// inherited reconciliationLiveDriver. Proves the wiring AC 1+2 ask for — the runner mirrors run-evals
// structure (K reps, adaptive escalation, aggregateCase/summarize/grade reused unchanged), the
// `reconciliation` adapter NORMALISES driveReconciliationCase's { record, bucket } into the rep loop's
// { env, tokens }, and the report renderer produces the committable table — without ever spawning a
// model. The real `claude -p` baseline (Part B) is the human-supervised sweep, recorded out-of-band.

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadFixture } from "./helpers/mock-tracker.mjs";
import { seedRepo } from "./helpers/seed-repo.mjs";
import { runSkill } from "./helpers/skill-harness.mjs";
import { LIVE_KINDS, runLiveEvals, renderBaselineMarkdown } from "../eval/run-live-evals.mjs";
import { loadLiveCases } from "../eval/run-evals.mjs";
import { BASE_REPS, MAX_REPS } from "../eval/run-evals.mjs";

// A minimal harness substrate (the seam-faithful listIssues read + a seeded repo). The reconciliation
// classification rides the injected fixture/oracle, not the tracker contents.
function substrate() {
  const tracker = loadFixture({ version: 1, issues: [{ id: "ISS-A", title: "anything", state: "Todo", stateCategory: "unstarted" }] });
  const repo = seedRepo({ commits: [{ message: "init", files: { "README.md": "x" } }] });
  return { tracker, repo };
}

// Parse a case's oracle closed_set (["c1:challenge", …]) into the { id: label } map a model emits.
function oracleMap(c) {
  const m = {};
  for (const pair of c.oracle.closed_set) {
    const i = pair.indexOf(":");
    m[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return m;
}

// A mock model that returns a fixed reconciliation envelope (the per-rep `claude -p` stand-in, zero spawn).
function reconModel(labelMap) {
  return async () => "```faff-eval:judgement\n" + JSON.stringify({ case_id: "live", reconciliation: labelMap }) + "\n```";
}

// --- the open registry holds reconciliation and leaves the kind list extensible (FAFF-160) ---
test("LIVE_KINDS registers reconciliation with a { loader, driveCase } adapter, open for FAFF-160", () => {
  assert.ok(LIVE_KINDS.reconciliation, "reconciliation adapter is registered");
  assert.equal(typeof LIVE_KINDS.reconciliation.loader, "function");
  assert.equal(typeof LIVE_KINDS.reconciliation.driveCase, "function");
  // the loader returns ONLY reconciliation cases from cases-live/
  const cases = LIVE_KINDS.reconciliation.loader();
  assert.ok(cases.length >= 1, "loader returns the committed reconciliation cases");
  assert.ok(cases.every((c) => c.kind === "reconciliation"));
  // routing is NOT registered by FAFF-163 (left for FAFF-160) — the registry is open, not pre-filled
  assert.ok(!("routing" in LIVE_KINDS), "FAFF-163 leaves LIVE_KINDS open; FAFF-160 appends routing");
});

// --- happy path: a correct mock model yields accuracy 1.0 / stability 1.0 across every committed case ---
test("runLiveEvals drives every reconciliation case via the harness + mock model and grades PASS", async (t) => {
  // one model that returns the right labels per the case it is currently driving: the driver passes the
  // case's own fixture, so a per-case correct map needs the case id — instead drive case-by-case via --only.
  const summary = { cases: [], per_kind: {}, total_cost_tokens: 0, escalated_cases: [], status: "complete" };
  for (const c of loadLiveCases().filter((x) => x.kind === "reconciliation")) {
    const { tracker, repo } = substrate();
    t.after(() => repo.teardown());
    const s = await runLiveEvals({
      kind: "reconciliation",
      only: c.id,
      ctx: { runSkill, tracker, repo, model: reconModel(oracleMap(c)) },
      baseReps: 3, // small K — deterministic mock, no need for the full 20
    });
    assert.equal(s.cases.length, 1, `${c.id} drove exactly one case`);
    const cr = s.cases[0];
    assert.equal(cr.case_id, c.id);
    assert.equal(cr.accuracy, 1, `${c.id} grades PASS against its own oracle`);
    assert.equal(cr.stability, 1, `${c.id} is stable (deterministic mock)`);
    assert.equal(cr.escalated, false, "a stable case never escalates");
    summary.cases.push(cr);
  }
  assert.ok(summary.cases.length >= 1, "drove the committed reconciliation set");
});

// --- the adapter NORMALISES { record, bucket } -> { env, tokens } so grade() runs the existing path ---
test("the reconciliation adapter normalises driveReconciliationCase's bucket into a gradeable env", async (t) => {
  const c = loadLiveCases().find((x) => x.kind === "reconciliation");
  const { tracker, repo } = substrate();
  t.after(() => repo.teardown());
  const { env, tokens } = await LIVE_KINDS.reconciliation.driveCase(c, {
    runSkill, tracker, repo, model: reconModel(oracleMap(c)),
  });
  // env is envelope-shaped { reconciliation: { id: label } } — the exact shape grade() reads
  assert.ok(env && typeof env.reconciliation === "object", "env carries a reconciliation map");
  assert.deepEqual(env.reconciliation, oracleMap(c), "the recorded bucket rebuilt the id:label map");
  assert.equal(typeof tokens, "number", "tokens is a number (0 when the record carries no tally)");
});

// --- a WRONG label -> a clean FAIL (accuracy 0), no throw (fail-safe through the runner) ---
test("a wrong mock label yields accuracy 0 with no throw (rep-loop fail-safe)", async (t) => {
  const c = loadLiveCases().find((x) => x.kind === "reconciliation");
  const { tracker, repo } = substrate();
  t.after(() => repo.teardown());
  const m = oracleMap(c);
  const firstId = Object.keys(m)[0];
  const wrong = { ...m, [firstId]: m[firstId] === "noise" ? "challenge" : "noise" };
  const s = await runLiveEvals({
    kind: "reconciliation",
    only: c.id,
    ctx: { runSkill, tracker, repo, model: reconModel(wrong) },
    baseReps: 3,
  });
  assert.equal(s.cases[0].accuracy, 0, "a wrong label fails the oracle");
  assert.equal(s.cases[0].stability, 1, "still stable — the mock is deterministic");
});

// --- adaptive escalation: a flip-flopping model trips escalation to MAX_REPS ---
test("a disagreeing model escalates the case toward MAX_REPS (mirrors run-evals)", async (t) => {
  const c = loadLiveCases().find((x) => x.kind === "reconciliation");
  const { tracker, repo } = substrate();
  t.after(() => repo.teardown());
  const m = oracleMap(c);
  const firstId = Object.keys(m)[0];
  const flip = { ...m, [firstId]: m[firstId] === "noise" ? "challenge" : "noise" };
  let n = 0;
  const flakyModel = async () => {
    // alternate correct / wrong each rep to force a cross-rep disagreement after base reps
    const map = (n++ % 2 === 0) ? m : flip;
    return "```faff-eval:judgement\n" + JSON.stringify({ case_id: "live", reconciliation: map }) + "\n```";
  };
  const s = await runLiveEvals({
    kind: "reconciliation",
    only: c.id,
    ctx: { runSkill, tracker, repo, model: flakyModel },
    baseReps: 4,
    maxReps: 8,
  });
  const cr = s.cases[0];
  assert.equal(cr.escalated, true, "disagreement after base reps triggers escalation");
  assert.equal(cr.rep_results.length, 8, "escalated to maxReps");
  assert.ok(cr.stability < 1, "a flip-flopping model is not stable");
});

// --- a model error becomes an erroredRep, not a crash (run-level fail-safe) ---
test("a model throw becomes an erroredRep and lowers stability, never crashing the run", async (t) => {
  const c = loadLiveCases().find((x) => x.kind === "reconciliation");
  const { tracker, repo } = substrate();
  t.after(() => repo.teardown());
  const boom = async () => { throw new Error("simulated claude -p failure"); };
  const s = await runLiveEvals({
    kind: "reconciliation",
    only: c.id,
    ctx: { runSkill, tracker, repo, model: boom },
    baseReps: 2,
  });
  const cr = s.cases[0];
  assert.equal(cr.errored, 2, "both reps errored");
  assert.equal(cr.accuracy, 0, "no rep passed");
});

// --- input guards: unknown kind, missing harness, missing model ---
test("runLiveEvals guards its inputs", async () => {
  await assert.rejects(runLiveEvals({ kind: "nope", ctx: { runSkill, model: async () => "" } }), /unknown live kind/);
  await assert.rejects(runLiveEvals({ kind: "reconciliation", ctx: { model: async () => "" } }), /requires ctx\.runSkill/);
  await assert.rejects(runLiveEvals({ kind: "reconciliation", ctx: { runSkill } }), /requires ctx\.model/);
});

// --- the report renderer produces the committable table (per-case + per-comment breakdown + isolation) ---
test("renderBaselineMarkdown emits the FAFF-156-format table with a per-comment breakdown", () => {
  const summary = {
    status: "complete",
    cases: [{
      case_id: "reconciliation-001", kind: "reconciliation", accuracy: 1, stability: 1, escalated: false,
      rep_results: [{ signature: JSON.stringify(["c1:challenge", "c2:resolution"]) }],
      _oracle_closed_set: ["c1:challenge", "c2:resolution"],
    }],
    per_kind: { reconciliation: { accuracy: 1, stability: 1 } },
    total_cost_tokens: 0, escalated_cases: [],
  };
  const md = renderBaselineMarkdown("reconciliation", summary, "2026-06-16T00:00Z");
  assert.match(md, /FAFF-163 reconciliation live-driver frontier baseline/);
  assert.match(md, /\| reconciliation-001 \| reconciliation \| 1\.00 \| 1\.00 \|/);
  assert.match(md, /Per-comment label breakdown/);
  assert.match(md, /\| reconciliation-001 \| c1 \| challenge \| challenge \| yes \|/);
  assert.match(md, /Config isolation OK/);
});

// --- BASE_REPS / MAX_REPS are reused unchanged from run-evals (no new constants) ---
test("the runner reuses run-evals' BASE_REPS / MAX_REPS unchanged", () => {
  assert.equal(BASE_REPS, 20);
  assert.equal(MAX_REPS, 50);
});
