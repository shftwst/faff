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
      const env = parseJudgementEnvelope(out.rawText, { expectedCaseId: c.id });
      const rr = grade(c, env);
      rr.tokens = out.tokens ?? rr.tokens ?? 0;
      rr.format = env.format; // FAFF-137: "compliant" | "noncompliant" — feeds format_adherence
      reps.push(rr);
    } catch (e) {
      // FAFF-139: the per-rep cfgDir is removed by the driver, so the errored-rep diagnostic is the
      // malformed-output snippet (the actual judgement text that failed to parse), not a dead path.
      if (e instanceof EnvelopeError) {
        const snippet = out.rawText ? out.rawText.slice(0, 300) : null;
        reps.push(erroredRep(out.transcript ?? snippet ?? e.message));
      } else throw e; // a real grader bug must surface, not masquerade as flakiness
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
    (byKind[cr.kind] ??= { accuracy: [], stability: [], format_adherence: [] });
    byKind[cr.kind].accuracy.push(cr.accuracy);
    byKind[cr.kind].stability.push(cr.stability);
    if (cr.format_adherence != null) byKind[cr.kind].format_adherence.push(cr.format_adherence); // FAFF-137
  }
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  return {
    status: incomplete ? "incomplete (ceiling)" : "complete",
    cases: caseResults,
    per_kind: Object.fromEntries(
      Object.entries(byKind).map(([k, v]) => [k, {
        accuracy: mean(v.accuracy),
        stability: mean(v.stability),
        format_adherence: v.format_adherence.length ? mean(v.format_adherence) : null, // FAFF-137
      }]),
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
    const fmt = m.format_adherence == null ? "n/a" : m.format_adherence.toFixed(2);
    console.log(`  ${kind.padEnd(11)} accuracy ${m.accuracy.toFixed(2)}  stability ${m.stability.toFixed(2)}  format ${fmt}`);
  }
  if (s.escalated_cases.length) console.log(`  escalated: ${s.escalated_cases.join(", ")}`);
  console.log(`  total tokens (est): ${s.total_cost_tokens}`);
}

// Resolve the local preset's base URL + model: --flag → env → hard error. NO localhost default —
// ollama is served over Tailscale, so a missing base URL is a fail-loud config error, not a default.
export function resolveLocalParams(argv) {
  const baseUrl = argFlag(argv, "--base-url") ?? process.env.FAFF_EVAL_LOCAL_BASE_URL ?? null;
  const model = argFlag(argv, "--model") ?? process.env.FAFF_EVAL_LOCAL_MODEL ?? null;
  if (!baseUrl) throw new Error("--driver local requires --base-url (or FAFF_EVAL_LOCAL_BASE_URL); no localhost default");
  if (!model) throw new Error("--driver local requires --model (or FAFF_EVAL_LOCAL_MODEL)");
  if (/localhost|127\.0\.0\.1/.test(baseUrl)) {
    console.warn("[run-evals] WARN: base URL points at localhost, but ollama is served over Tailscale — is this right?");
  }
  return { baseUrl, model };
}

// Resolve which skills the spawned run loads (FAFF-133): `--plugin-dir <path>` overrides the repo
// plugin; `--no-plugin` disables it for a vanilla skill-less baseline; otherwise undefined lets the
// preset default (the repo's own plugin + --bare) apply.
export function resolvePluginDir(argv) {
  const flag = argFlag(argv, "--plugin-dir");
  if (flag) return flag;
  if (argv.includes("--no-plugin")) return null;
  return undefined; // preset default = the repo plugin
}

// Select the driver from --driver (default frontier). `presets` is injected
// ({ frontierDriver, localDriver }) so this stays pure/testable — it never spawns. Both presets load
// the repo's canonical skills by default (FAFF-133), so frontier and local measure the same prose.
export function resolveDriver(argv, presets) {
  const which = argFlag(argv, "--driver") ?? "frontier";
  const bin = argFlag(argv, "--bin") ?? "claude";
  const pluginDir = resolvePluginDir(argv);
  if (which === "frontier") {
    if (argFlag(argv, "--base-url")) console.warn("[run-evals] WARN: --base-url is ignored for --driver frontier");
    return presets.frontierDriver({ bin, pluginDir });
  }
  if (which === "local") {
    const { baseUrl, model } = resolveLocalParams(argv);
    return presets.localDriver({ baseUrl, model, bin, pluginDir });
  }
  if (which === "ollama-direct") {
    // FAFF-144: direct /api/chat (no agent loop). think defaults OFF (the local-speed lever); --think to enable.
    const { baseUrl, model } = resolveLocalParams(argv);
    return presets.makeDirectOllamaDriver({ baseUrl, model, pluginDir, think: argv.includes("--think") });
  }
  throw new Error(`unknown --driver: ${which} (expected frontier|local|ollama-direct)`);
}

function printCompareTable(fr, lo) {
  console.log(`\n=== frontier vs local — per-kind accuracy/stability ===`);
  console.log(`  ${"kind".padEnd(11)} ${"frontier".padEnd(16)} local`);
  const kinds = [...new Set([...Object.keys(fr.per_kind), ...Object.keys(lo.per_kind)])].sort();
  for (const k of kinds) {
    const f = fr.per_kind[k] ?? { accuracy: 0, stability: 0 };
    const l = lo.per_kind[k] ?? { accuracy: 0, stability: 0 };
    const cell = (m) => `${m.accuracy.toFixed(2)}/${m.stability.toFixed(2)}`;
    console.log(`  ${k.padEnd(11)} ${cell(f).padEnd(16)} ${cell(l)}`);
  }
  console.log(`  tokens (est): frontier ${fr.total_cost_tokens}  local ${lo.total_cost_tokens}`);
}

// --compare: run BOTH presets over the same cases and tabulate. Real-model run (FAFF-131-class);
// the light affordance, not the measured study. Local params resolved up front so it fails before
// the (costly) frontier pass if the local side is underspecified.
async function compare(argv, presets) {
  const only = argFlag(argv, "--only");
  const repsArg = argFlag(argv, "--reps");
  const baseReps = repsArg ? Number(repsArg) : BASE_REPS;
  const bin = argFlag(argv, "--bin") ?? "claude";
  const pluginDir = resolvePluginDir(argv);
  const { baseUrl, model } = resolveLocalParams(argv); // fail-loud before any rep
  let cases = loadCases();
  if (only) cases = cases.filter((c) => c.id === only);
  const fr = await runEvals({ cases, driver: presets.frontierDriver({ bin, pluginDir }), baseReps });
  const lo = await runEvals({ cases, driver: presets.localDriver({ baseUrl, model, bin, pluginDir }), baseReps });
  const reportDir = join(HERE, "report");
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "compare.json"), JSON.stringify({ frontier: fr, local: lo }, null, 2));
  printCompareTable(fr, lo);
  return fr.status === "complete" && lo.status === "complete" ? 0 : 1;
}

// CLI — the REAL run. Never triggered by a test import (process.argv[1] is the test file).
// `node eval/run-evals.mjs [--driver frontier|local|ollama-direct] [--model M] [--base-url URL] [--think] [--plugin-dir P | --no-plugin] [--only ID] [--reps N]`
// `node eval/run-evals.mjs --compare [--model M] [--base-url URL] [--plugin-dir P | --no-plugin] [--only ID] [--reps N]`
// frontier/local = agentic `claude -p`; ollama-direct = direct /api/chat at local speed (FAFF-144).
// Loads the repo's canonical plugin by default (FAFF-133); --no-plugin runs a vanilla skill-less baseline.
async function main(argv) {
  const cliPresets = await import("./cli-driver.mjs"); // { frontierDriver, localDriver } — pure import, no spawn
  const { makeDirectOllamaDriver } = await import("./ollama-model.mjs"); // FAFF-144 — pure import, no socket
  const presets = { ...cliPresets, makeDirectOllamaDriver };
  if (argv.includes("--compare")) return compare(argv, presets);
  const only = argFlag(argv, "--only");
  const repsArg = argFlag(argv, "--reps");
  const driver = resolveDriver(argv, presets); // fail-loud before loadCases/runEvals if local underspecified
  let cases = loadCases();
  if (only) cases = cases.filter((c) => c.id === only);
  const summary = await runEvals({ cases, driver, baseReps: repsArg ? Number(repsArg) : BASE_REPS });
  const reportDir = join(HERE, "report");
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "latest.json"), JSON.stringify(summary, null, 2));
  printHeadline(summary);
  return summary.status === "complete" ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith("run-evals.mjs")) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => { console.error(`[run-evals] ${e.message}`); process.exitCode = 1; }); // e.g. --driver local with no base URL
}
