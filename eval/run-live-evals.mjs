// FAFF-163 — live-driver judgement-eval frontier RUNNER.
//
// The shared live-lane twin of run-evals.mjs's main(): drive K reps of a LIVE-DRIVER kind (cases in
// eval/cases-live/, driven through the FAFF-93 harness via runSkill + a per-kind live-driver) with the
// REAL `claude -p` model, grade each rep through the existing grader path, escalate wobbly cases toward
// MAX_REPS, aggregate per-case stability/accuracy/cost, and write the baseline report.
//
// Why a SEPARATE runner from run-evals.mjs (spec Decision 1): run-evals.mjs's main() drives ONLY
// loadCases() — the black-box `cases/` sweep through cli-driver's one-shot `claude -p`. It never calls
// loadLiveCases() or a live-driver, so the live-driver lane (reconciliation today, routing next) has no
// runner that records a real-model baseline. This file is that runner.
//
// ONE runner, not two (coordinated with FAFF-160): the runner owns the rep loop / escalation /
// aggregation / report write and is parameterised by a per-kind DRIVE ADAPTER registered in the open
// LIVE_KINDS registry. FAFF-163 registers ONLY `reconciliation`; FAFF-160 appends a `routing` entry
// (its own loader + driveRoutingCase) to the SAME registry — a small append, no core change.
//
// Every kind-agnostic primitive is REUSED unchanged from grader.mjs / run-evals.mjs (spec Decision 2):
// BASE_REPS / MAX_REPS / aggregateCase / summarize / grade / hasDisagreement / erroredRep. New code is
// only the LIVE_KINDS dispatch + the makeLiveModel wiring + the report writer.
//
// Config isolation is per-rep, INHERITED from makeLiveModel (FAFF-138 / spec Decision 3): makeLiveModel
// does its own per-call mkdtemp(CLAUDE_CONFIG_DIR) + forwardCredentials, so the recursive-`claude -p`/
// `~/.claude.json` race (ADR-0003) is already solved at the model layer. The runner injects the model
// and inherits isolation — it does NOT re-implement it.
//
// eval/ is NOT matched by `node --test` globs, so CI never imports/runs this orchestrator, and importing
// this module spawns nothing — only CALLING the real model fn (makeLiveModel) does. Tests inject a MOCK
// model (zero spawn) to prove the wiring. Zero-dependency: node builtins + repo siblings only.

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { grade, aggregateCase, hasDisagreement, erroredRep } from "./grader.mjs";
import { BASE_REPS, MAX_REPS, loadCases, loadLiveCases, summarize, assertNonEmptyCases } from "./run-evals.mjs";
import { driveReconciliationCase, driveRoutingCase, driveVerdictBuildCase, makeLiveModel } from "./live-driver.mjs";
import { frontierOpts } from "./cli-driver.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------------------------------
// LIVE_KINDS — the open per-kind drive-adapter registry (spec Decision 1).
//
// Each adapter is `{ loader, driveCase }`:
//   loader()                              -> Array<EvalCase>   (the cases for this kind, filtered)
//   driveCase(evalCase, { runSkill, tracker, repo, model, repIndex }) -> Promise<{ env, tokens }>
//
// `driveCase` NORMALISES the per-kind live-driver's native return into the rep-loop contract `{ env,
// tokens }` so runCase can call `grade(evalCase, env)` exactly as run-evals.mjs's runCase does after
// parseJudgementEnvelope. The asymmetry the adapter absorbs (spec Punt): reconciliation's
// driveReconciliationCase returns `{ record, bucket }` (already parsed + recorded through the harness),
// whereas grade wants an envelope-shaped `{ reconciliation: { id: label, … } }`. The adapter rebuilds
// that map from the recorded `bucket` (["c1:challenge", …] -> { c1: "challenge", … }) — the same
// `grade(c, { reconciliation: map })` shape the FAFF-154 dry-smoke already proves. FAFF-160's
// driveRoutingCase MUST adopt this same normalised `{ env, tokens }` return.
//
// The runner does NOT hard-code reconciliation's runSkill path (spec): the adapter owns it, so a sibling
// kind whose live cases drive differently registers its own adapter without touching the rep loop.
// ---------------------------------------------------------------------------------------------------

// Rebuild the envelope-shaped { id: label } reconciliation map from a recorded `id:label` bucket.
function reconciliationEnvFromBucket(bucket) {
  const map = {};
  for (const pair of bucket || []) {
    const i = pair.indexOf(":");
    if (i === -1) continue; // a malformed entry is dropped -> the grader scores a clean miss, never throws
    map[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return { reconciliation: map };
}

export const LIVE_KINDS = {
  reconciliation: {
    loader: () => loadLiveCases().filter((c) => c.kind === "reconciliation"),
    async driveCase(evalCase, { runSkill, tracker, repo, model }) {
      const { record, bucket } = await driveReconciliationCase(evalCase, { runSkill, tracker, repo, model });
      const env = reconciliationEnvFromBucket(bucket);
      // Token accounting: the harness DecisionRecord may carry a usage tally; default 0 (the live model
      // estimates tokens out-of-band — accuracy/stability are the load-bearing baseline signals).
      const tokens = (record && (record.tokens ?? record.usage?.output_tokens)) || 0;
      return { env, tokens };
    },
  },
  // FAFF-160 — the routing live-driver adapter (the one append FAFF-163 left this registry open for).
  // Unlike reconciliation (cases-live/ ThreadFixtures), routing's assembled fixtures-of-findings already
  // live in `cases/routing-*.json` (FAFF-149's black-box lane), and the live-driver consumes that SAME
  // fixture+oracle — so the loader reads `loadCases()` (the `cases/` reader), never loadLiveCases(): the
  // two lanes share the one oracle, never duplicated into cases-live/ (spec §2 OUT OF SCOPE). driveCase
  // normalises driveRoutingCase's `{ record, verdict }` into the rep-loop's `{ env: { verdict }, tokens }`
  // so grade(evalCase, env) runs the existing FAFF-149 single-element-set routing path unchanged.
  routing: {
    loader: () => loadCases().filter((c) => c.kind === "routing"),
    async driveCase(evalCase, { runSkill, tracker, repo, model }) {
      const { record, verdict } = await driveRoutingCase(evalCase, { runSkill, tracker, repo, model });
      // A missing/out-of-enum verdict is forwarded verbatim (null when absent) — grade scores a clean
      // FAIL via setEqual, never a throw (the eval-side fail-safe, the confidence/routing stance).
      const env = { verdict };
      const tokens = (record && (record.tokens ?? record.usage?.output_tokens)) || 0;
      return { env, tokens };
    },
  },
  // FAFF-155 — the verdict-build live-driver adapter (the carved baseline becomes a pure re-run later).
  // Unlike routing (cases/), verdict-build's BuildFixtures live in `cases-live/` (a non-backlog shape the
  // black-box CLI driver has no render branch for — the reconciliation lane). driveVerdictBuildCase
  // returns `{ record, bucket }` (a single-element `verdict-build` bucket); the adapter normalises the
  // bucket's lone verdict into the rep-loop's `{ env: { verdict }, tokens }` so grade(evalCase, env) runs
  // the existing single-element-set verdict-build path unchanged.
  "verdict-build": {
    loader: () => loadLiveCases().filter((c) => c.kind === "verdict-build"),
    async driveCase(evalCase, { runSkill, tracker, repo, model }) {
      const { record, bucket } = await driveVerdictBuildCase(evalCase, { runSkill, tracker, repo, model });
      // A missing verdict → bucket [] → verdict null; an out-of-enum verdict is the verbatim token —
      // grade scores a clean FAIL via setEqual, never a throw (the routing/confidence fail-safe stance).
      const env = { verdict: bucket[0] ?? null };
      const tokens = (record && (record.tokens ?? record.usage?.output_tokens)) || 0;
      return { env, tokens };
    },
  },
};

// Drive one live case for K reps via the kind adapter, normalising each rep to a graded RepResult.
// Mirrors run-evals.mjs runCase: base reps, then adaptive escalation to maxReps on cross-rep
// disagreement. An adapter / model error becomes an erroredRep (lowers stability), never a crash.
async function runLiveCase(c, adapter, ctx, { baseReps, maxReps }) {
  const base = Math.min(c.reps || baseReps, maxReps);
  const reps = [];
  let target = base;
  let escalated = false;
  for (let i = 0; i < target; i++) {
    try {
      const { env, tokens } = await adapter.driveCase(c, { ...ctx, repIndex: i });
      const rr = grade(c, env);
      rr.tokens = tokens ?? rr.tokens ?? 0;
      // The live-driver path records a structured bucket (not an envelope text), so there is no
      // format-tag to score — format_adherence is n/a for the live lane (aggregateCase yields null).
      reps.push(rr);
    } catch (e) {
      reps.push(erroredRep(`live-drive-error:${e.message}`));
    }
    if (!escalated && i + 1 >= base && base < maxReps && hasDisagreement(reps)) {
      escalated = true;
      target = maxReps;
    }
  }
  return aggregateCase(c, reps, { escalated });
}

// Run all cases for one live kind. `ctx` carries the injected harness ports + the model.
export async function runLiveEvals({ kind, ctx, only = null, baseReps = BASE_REPS, maxReps = MAX_REPS } = {}) {
  const adapter = LIVE_KINDS[kind];
  if (!adapter) throw new Error(`unknown live kind: ${kind} (registered: ${Object.keys(LIVE_KINDS).join(", ") || "none"})`);
  if (typeof ctx?.runSkill !== "function") throw new Error("runLiveEvals requires ctx.runSkill (the FAFF-93 harness)");
  if (typeof ctx?.model !== "function") throw new Error("runLiveEvals requires ctx.model (a mock in CI; makeLiveModel for real)");
  let cases = adapter.loader();
  const loadedCount = cases.length; // FAFF-691 — pre-filter count: a --kind with no fixtures vs an --only no-match
  if (only) cases = cases.filter((c) => c.id === only);
  // FAFF-691 — this is the second paid frontier runner; a zero-case run is the identical hollow green.
  // Refuse BEFORE the runLiveCase rep loop so the injected model is never called (zero spend). The throw
  // rides main's finally { repo.teardown() } and the top-level catch → [run-live-evals] … + exit 1.
  assertNonEmptyCases(cases, { entry: `--kind ${kind}`, only, casesDir: null, kind, loadedCount });
  const results = [];
  for (const c of cases) results.push(await runLiveCase(c, adapter, ctx, { baseReps, maxReps }));
  return summarize(results);
}

// ----------------------------- report writers (the live baseline record) -----------------------------

function argFlag(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : null;
}

function printHeadline(kind, s) {
  console.log(`\n=== live judgement-eval headline (${kind} · ${s.status}) ===`);
  for (const [k, m] of Object.entries(s.per_kind)) {
    console.log(`  ${k.padEnd(14)} accuracy ${m.accuracy.toFixed(2)}  stability ${m.stability.toFixed(2)}`);
  }
  if (s.escalated_cases.length) console.log(`  escalated: ${s.escalated_cases.join(", ")}`);
  console.log(`  total tokens (est): ${s.total_cost_tokens}`);
}

// The committable Markdown baseline: per-case table + per-comment label breakdown + a config-isolation
// line (FAFF-156 format). NOTE: eval/report/ is whole-dir gitignored (verified at build — spec Decision
// 5), so this .md is ALSO ignored there; the committable record is the ADR 0004 addendum. This writer
// produces the table text the addendum embeds (and the gitignored .md, for the operator's convenience).
export function renderBaselineMarkdown(kind, summary, when = new Date().toISOString()) {
  const lines = [];
  lines.push(`# FAFF-163 ${kind} live-driver frontier baseline (K=${BASE_REPS} base, adaptive→${MAX_REPS}) — ${when}`);
  lines.push(`Driver: frontier (claude -p) via reconciliationLiveDriver + runSkill(faff-prep). Config-isolated per rep (makeLiveModel: CLAUDE_CONFIG_DIR + forwarded creds, FAFF-138).`);
  lines.push("");
  lines.push("| case | kind | accuracy | stability | reps | escalated |");
  lines.push("|---|---|---|---|---|---|");
  for (const cr of summary.cases) {
    const reps = cr.rep_results ? cr.rep_results.length : "?";
    lines.push(`| ${cr.case_id} | ${cr.kind} | ${cr.accuracy.toFixed(2)} | ${cr.stability.toFixed(2)} | ${reps} | ${cr.escalated ? 1 : 0} |`);
  }
  lines.push("");
  lines.push("## Per-comment label breakdown (modal predicted vs oracle)");
  lines.push("");
  lines.push("| case | comment | oracle | modal-predicted | stable |");
  lines.push("|---|---|---|---|---|");
  for (const cr of summary.cases) {
    const breakdown = perCommentBreakdown(cr);
    for (const row of breakdown) {
      lines.push(`| ${cr.case_id} | ${row.id} | ${row.oracle} | ${row.predicted} | ${row.stable ? "yes" : "NO"} |`);
    }
  }
  lines.push("");
  lines.push("Config isolation OK — parent ~/.claude.json untouched (per-rep CLAUDE_CONFIG_DIR).");
  return lines.join("\n");
}

// Derive a per-comment (oracle vs modal-predicted) breakdown from a case's rep signatures. Each rep's
// signature is the sorted JSON of its predicted `id:label` set; the modal signature is the most common.
function perCommentBreakdown(caseResult) {
  const sigCounts = {};
  for (const r of caseResult.rep_results || []) sigCounts[r.signature] = (sigCounts[r.signature] || 0) + 1;
  const modalSig = Object.entries(sigCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "[]";
  let modalSet = [];
  try { modalSet = JSON.parse(modalSig); } catch { modalSet = []; }
  const predictedMap = {};
  for (const pair of modalSet) {
    const i = String(pair).indexOf(":");
    if (i !== -1) predictedMap[String(pair).slice(0, i)] = String(pair).slice(i + 1);
  }
  // The oracle is on the case; rep_results don't carry it, so reconstruct from the case object when
  // present (the CLI run has it; the unit test asserts table shape, not oracle content).
  const oracleSet = caseResult._oracle_closed_set || [];
  const rows = [];
  for (const pair of oracleSet) {
    const i = pair.indexOf(":");
    const id = i === -1 ? pair : pair.slice(0, i);
    const oracle = i === -1 ? "?" : pair.slice(i + 1);
    const predicted = predictedMap[id] ?? "(none)";
    rows.push({ id, oracle, predicted, stable: sigCounts[modalSig] === (caseResult.rep_results || []).length });
  }
  return rows;
}

// CLI — the REAL run (human-supervised; spawns claude -p). Never triggered by a test import.
// `node eval/run-live-evals.mjs --kind reconciliation [--reps N] [--only ID] [--plugin-dir P | --no-plugin] [--bin claude]`
async function main(argv) {
  const kind = argFlag(argv, "--kind") ?? "reconciliation";
  const only = argFlag(argv, "--only");
  const repsArg = argFlag(argv, "--reps");
  const bin = argFlag(argv, "--bin") ?? "claude";
  let pluginDir;
  const pdFlag = argFlag(argv, "--plugin-dir");
  if (pdFlag) pluginDir = pdFlag;
  else if (argv.includes("--no-plugin")) pluginDir = null;
  else pluginDir = undefined; // preset default = the repo plugin

  // The real harness ports (imported here, NOT at module top, so eval/ stays free of test-helper deps
  // for `node --test` and the unit test injects its own mocks). makeLiveModel owns per-rep isolation.
  const { runSkill } = await import("../test/helpers/skill-harness.mjs");
  const { loadFixture } = await import("../test/helpers/mock-tracker.mjs");
  const { seedRepo } = await import("../test/helpers/seed-repo.mjs");
  const tracker = loadFixture({ version: 1, issues: [{ id: "ISS-A", title: "anything", state: "Todo", stateCategory: "unstarted" }] });
  const repo = seedRepo({ commits: [{ message: "init", files: { "README.md": "x" } }] });
  // FAFF-160 — build the frontier model via frontierOpts (NOT bare opts): frontierOpts sets
  // forwardCreds:true + bare:false, so makeLiveModel's per-rep forwardCredentials actually copies the
  // OAuth `.credentials.json` into the isolated CLAUDE_CONFIG_DIR. Without it, `forwardCreds` defaulted
  // falsy and every rep landed "Not logged in" in the isolated dir (the FAFF-138 gap the live-runner
  // path missed — the proven cli-driver frontierDriver already wraps frontierOpts; this matches it).
  const model = makeLiveModel(frontierOpts({ bin, pluginDir }));

  try {
    const summary = await runLiveEvals({ kind, ctx: { runSkill, tracker, repo, model }, only, baseReps: repsArg ? Number(repsArg) : BASE_REPS });
    // Attach each case's oracle so the per-comment breakdown can render (CLI-only enrichment).
    const cases = LIVE_KINDS[kind].loader();
    for (const cr of summary.cases) {
      const c = cases.find((x) => x.id === cr.case_id);
      if (c) cr._oracle_closed_set = c.oracle?.closed_set ?? [];
    }
    const reportDir = join(HERE, "report");
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, `${kind}-live-baseline.json`), JSON.stringify(summary, null, 2));
    writeFileSync(join(reportDir, `FAFF-163-${kind}-baseline.md`), renderBaselineMarkdown(kind, summary));
    printHeadline(kind, summary);
    console.log(`\nReports written:\n  eval/report/${kind}-live-baseline.json (gitignored summarize dump)\n  eval/report/FAFF-163-${kind}-baseline.md (gitignored — copy the table into docs/adr/0004 addendum)`);
    return summary.status === "complete" ? 0 : 1;
  } finally {
    try { repo.teardown?.(); } catch { /* best-effort */ }
  }
}

if (process.argv[1] && process.argv[1].endsWith("run-live-evals.mjs")) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => { console.error(`[run-live-evals] ${e.message}`); process.exitCode = 1; });
}
