// FAFF-130 — judgement-eval orchestrator.
//
// Loads EvalCases, drives K reps of faff-tidy via an INJECTABLE driver, grades each rep
// deterministically (grader.mjs), escalates wobbly cases toward ~50 reps, and aggregates
// per-case stability + accuracy + cost. The driver is a dependency so tests inject a mock
// (no frontier calls); the default is the real `claude -p` frontier driver, run by FAFF-131.
//
// eval/ is NOT matched by `node --test` globs, so CI never imports/runs this orchestrator.
// Zero-dependency: node builtins only.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { grade, aggregateCase, validateCase, hasDisagreement, erroredRep } from "./grader.mjs";
import { parseJudgementEnvelope, EnvelopeError } from "./envelope.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const BASE_REPS = 20;     // spec Decision 4 — ~88% power vs a 10% flip rate
export const MAX_REPS = 50;      // adaptive-escalation ceiling

export function loadCases(dir = join(HERE, "cases")) {
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((f) => validateCase(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

// Drive one case. `driver(evalCase, repIndex) -> Promise<{ rawText, tokens, transcript? }>`.
async function runCase(c, driver, { baseReps, maxReps }) {
  const base = Math.min(c.reps || baseReps, maxReps);
  const reps = [];
  let target = base;
  let escalated = false;
  for (let i = 0; i < target; i++) {
    let out;
    try {
      out = await driver(c, i);
    } catch (e) {
      reps.push(erroredRep(`driver-error:${e.message}`));
      continue;
    }
    try {
      const env = parseJudgementEnvelope(out.rawText);
      const rr = grade(c, env);
      rr.tokens = out.tokens ?? rr.tokens ?? 0;
      reps.push(rr);
    } catch (e) {
      if (e instanceof EnvelopeError) reps.push(erroredRep(out.transcript ?? e.message));
      else throw e; // a real grader bug must surface, not masquerade as flakiness
    }
    // Adaptive escalation: once the base reps are in, if they disagree, concentrate reps here.
    if (!escalated && i + 1 >= base && base < maxReps && hasDisagreement(reps)) {
      escalated = true;
      target = maxReps;
    }
  }
  return aggregateCase(c, reps, { escalated });
}

// Run all cases. `deadlineMs` (optional) is the wall-clock ceiling checked BETWEEN cases —
// when unset (the test path) no clock is read, so the orchestrator is deterministic.
export async function runEvals({ cases, driver, baseReps = BASE_REPS, maxReps = MAX_REPS, deadlineMs = null } = {}) {
  const results = [];
  let incomplete = false;
  for (const c of cases) {
    if (deadlineMs != null && Date.now() >= deadlineMs) { incomplete = true; break; }
    results.push(await runCase(c, driver, { baseReps, maxReps }));
  }
  return summarize(results, incomplete);
}

export function summarize(caseResults, incomplete = false) {
  const byKind = {};
  for (const cr of caseResults) {
    (byKind[cr.kind] ??= { accuracy: [], stability: [] });
    byKind[cr.kind].accuracy.push(cr.accuracy);
    byKind[cr.kind].stability.push(cr.stability);
  }
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  return {
    status: incomplete ? "incomplete (ceiling)" : "complete",
    cases: caseResults,
    per_kind: Object.fromEntries(
      Object.entries(byKind).map(([k, v]) => [k, { accuracy: mean(v.accuracy), stability: mean(v.stability) }]),
    ),
    total_cost_tokens: caseResults.reduce((s, cr) => s + cr.cost_tokens, 0),
    escalated_cases: caseResults.filter((cr) => cr.escalated).map((cr) => cr.case_id),
  };
}

function argFlag(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : null;
}

function printHeadline(s) {
  console.log(`\n=== judgement-eval headline (${s.status}) ===`);
  for (const [kind, m] of Object.entries(s.per_kind)) {
    console.log(`  ${kind.padEnd(11)} accuracy ${m.accuracy.toFixed(2)}  stability ${m.stability.toFixed(2)}`);
  }
  if (s.escalated_cases.length) console.log(`  escalated: ${s.escalated_cases.join(", ")}`);
  console.log(`  total tokens (est): ${s.total_cost_tokens}`);
}

// CLI — the REAL frontier run. Never triggered by a test import (process.argv[1] is the test file).
// `node eval/run-evals.mjs [--only <case-id>] [--reps N]`  (FAFF-131 supervised; needs claude -p).
async function main(argv) {
  const { makeFrontierDriver } = await import("./frontier-driver.mjs");
  const only = argFlag(argv, "--only");
  const repsArg = argFlag(argv, "--reps");
  let cases = loadCases();
  if (only) cases = cases.filter((c) => c.id === only);
  const summary = await runEvals({ cases, driver: makeFrontierDriver(), baseReps: repsArg ? Number(repsArg) : BASE_REPS });
  const reportDir = join(HERE, "report");
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "latest.json"), JSON.stringify(summary, null, 2));
  printHeadline(summary);
  return summary.status === "complete" ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith("run-evals.mjs")) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
