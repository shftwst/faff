#!/usr/bin/env node
// Model-evaluation harness: score a model across the eval lanes and store the result.
//
//   node eval/run-model-eval.mjs --driver local --base-url URL --model M [--tier quick|full] [--lanes blackbox,live,format]
//   node eval/run-model-eval.mjs --driver frontier --model claude-opus-5-5 --effort medium --tier full
//   node eval/run-model-eval.mjs --from-captures .faff/eval-runs/RUN [RUN...] --model-id M --driver local [--ignore-kinds k1,k2] [--merge-result other/result.json]
// Both modes take --results-root DIR (default eval/results).
//
// Lanes: blackbox (the judgement sweep over eval/cases/), live (the live-driver kinds), format (producer
// output through faff's real parsers). Each finished kind is checkpointed under the work dir, so a
// killed run resumes with --resume. The stored result (result.json + README.md under
// eval/results/<model>/<date>/) records the model id, tier and rep counts, never the gateway URL or key.
//
// Local: URL, model and key come from --base-url / FAFF_EVAL_LOCAL_BASE_URL, --model /
// FAFF_EVAL_LOCAL_MODEL and FAFF_EVAL_LOCAL_API_KEY (or LOCAL_API_KEY). Importing this module spawns
// nothing; only calling runModelEval with a real driver does.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCases, mintCapturePath, mintRunId, resolveDriver, resolveEffort, resolveEvalModel, resolveLocalParams, runEvals } from "./run-evals.mjs";
import { mergePerKind, perKindFromRecords, rollupBySkill, slugForModel, storeResult } from "./lib/model-rollup.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

export const loadPlan = (path = join(HERE, "model-eval-plan.json")) => readJson(path);
export const loadRegistry = () => readJson(join(HERE, "seam-registry.json")).kinds;
export const loadRoles = () => readJson(join(HERE, "skill-roles.json")).roles;

export function repsForKind(plan, tier, kind) {
  const t = plan.tiers[tier];
  if (!t) throw new Error(`unknown tier "${tier}" (expected ${Object.keys(plan.tiers).join("|")})`);
  return t.kind_reps?.[kind] ?? t.reps;
}

// One kind's summary entry, from a runEvals/runLiveEvals summary. reps and min_reps_per_case come from the
// per-case rep lists, so a kind that escalated or errored is described as it ran.
export function kindEntry(summary, kind) {
  const crs = summary.cases.filter((c) => c.kind === kind);
  const reps = crs.map((c) => c.rep_results.length);
  return {
    ...summary.per_kind[kind],
    cases: crs.length,
    reps: reps.reduce((s, x) => s + x, 0),
    min_reps_per_case: Math.min(...reps),
    errored: crs.reduce((s, c) => s + (c.errored ?? 0), 0),
  };
}

function gitCommit() {
  try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim(); } catch { return "unknown"; }
}

export function buildResult({ meta, perKind, registry, roles, reference, format = null, skipped = [] }) {
  const rollup = rollupBySkill({ registry, perKind, reference: reference.per_kind, roles });
  return { schema: 1, meta, per_kind: perKind, rollup, format, skipped };
}

// The reference's per-kind numbers, plus any live kind whose committed result is a single pass rate
// (plan.reference_extra: [{ kind, file, accuracy: <field> }]).
function referenceInfo(plan, root) {
  const file = resolve(root, plan.reference);
  const baseline = readJson(file);
  const per_kind = { ...baseline.per_kind };
  for (const x of plan.reference_extra ?? []) {
    const r = readJson(resolve(root, x.file));
    per_kind[x.kind] = { accuracy: r[x.accuracy], stability: null, format_adherence: null };
  }
  return { per_kind, label: plan.reference_label, file: plan.reference, model: baseline.meta?.model ?? null, effort: baseline.meta?.effort ?? null, captured_at: baseline.meta?.captured_at ?? null };
}

// Checkpoints: one JSON per finished kind under <workDir>/kinds, so --resume skips what is done.
const ckptPath = (workDir, lane, kind) => join(workDir, "kinds", `${lane}-${kind}.json`);
function readCheckpoints(workDir) {
  const dir = join(workDir, "kinds");
  if (!existsSync(dir)) return {};
  return Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => { const c = readJson(join(dir, f)); return [`${c.lane}:${c.kind}`, c]; }));
}
function writeCheckpoint(workDir, lane, kind, entry) {
  mkdirSync(join(workDir, "kinds"), { recursive: true });
  writeFileSync(ckptPath(workDir, lane, kind), JSON.stringify({ lane, kind, entry }, null, 2));
}

// deps: { driver, runEvalsFn, liveRunner(kind, reps) -> summary | null, dockerAvailable(), formatRunner(samples) -> result | null, log }
export async function runModelEval({ model, tier = "quick", lanes = ["blackbox", "live", "format"], kinds = null, resume = false, workDir, resultsRoot = join(HERE, "results"), plan = loadPlan(), now = new Date(), deps }) {
  const registry = loadRegistry();
  const roles = loadRoles();
  const reference = referenceInfo(plan, REPO);
  const log = deps.log ?? (() => {});
  const done = resume ? readCheckpoints(workDir) : {};
  const perKind = {};
  const skipped = [];
  const keep = (lane, kind) => done[`${lane}:${kind}`]?.entry;

  if (lanes.includes("blackbox")) {
    const all = loadCases();
    const names = [...new Set(all.map((c) => c.kind))].filter((k) => !kinds || kinds.includes(k));
    for (const kind of names) {
      const prior = keep("blackbox", kind);
      if (prior) { perKind[kind] = prior; log(`blackbox ${kind}: resumed`); continue; }
      const reps = repsForKind(plan, tier, kind);
      log(`blackbox ${kind}: ${reps} reps per case`);
      const summary = await (deps.runEvalsFn ?? runEvals)({ cases: all.filter((c) => c.kind === kind), driver: deps.driver, baseReps: reps, maxReps: reps, judgementsPath: deps.capturePath ?? null });
      perKind[kind] = kindEntry(summary, kind);
      writeCheckpoint(workDir, "blackbox", kind, perKind[kind]);
    }
  }

  if (lanes.includes("live")) {
    for (const kind of plan.live_kinds.filter((k) => !kinds || kinds.includes(k))) {
      const prior = keep("live", kind);
      if (prior) { perKind[kind] = prior; log(`live ${kind}: resumed`); continue; }
      if (kind === "holdout-live" && !(await deps.dockerAvailable())) { skipped.push({ lane: "live", kind, reason: "docker is not available" }); log("live holdout-live: skipped, no docker"); continue; }
      const reps = repsForKind(plan, tier, kind);
      log(`live ${kind}: ${reps} reps per case`);
      const summary = await deps.liveRunner(kind, reps);
      perKind[kind] = kindEntry(summary, kind);
      writeCheckpoint(workDir, "live", kind, perKind[kind]);
    }
  }

  let format = null;
  if (lanes.includes("format")) {
    if (!deps.formatRunner) skipped.push({ lane: "format", kind: null, reason: deps.formatSkipReason ?? "no Messages API endpoint configured for this driver" });
    else { log("format lane"); format = await deps.formatRunner(plan.tiers[tier].format_samples); }
  }

  const meta = {
    model_id: model.id, driver: model.driver, effort: model.effort ?? null, tier,
    date: now.toISOString().slice(0, 10), commit: gitCommit(), lanes, reference: { label: reference.label, file: reference.file, model: reference.model, effort: reference.effort, captured_at: reference.captured_at },
  };
  const result = buildResult({ meta, perKind, registry, roles, reference, format, skipped });
  const dir = storeResult(result, { root: resultsRoot });
  return { result, dir };
}

// Build a stored result from raw judgement captures a sweep already wrote (a killed sweep has no summary).
export function resultFromCaptures({ captureDirs, ignoreKindsByDir = {}, model, tier = "captured", lanes = ["blackbox"], notes = null, plan = loadPlan(), now = new Date(), resultsRoot = join(HERE, "results"), format = null, extraPerKind = {}, skipped = [] }) {
  const parts = captureDirs.map((dir) => {
    const records = readFileSync(join(dir, "judgements.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    return perKindFromRecords(records, { ignoreKinds: ignoreKindsByDir[dir] ?? [] });
  });
  const perKind = mergePerKind(...parts, extraPerKind);
  const reference = referenceInfo(plan, REPO);
  const meta = {
    model_id: model.id, driver: model.driver, effort: model.effort ?? null, tier,
    date: now.toISOString().slice(0, 10), commit: gitCommit(), lanes,
    reference: { label: reference.label, file: reference.file, model: reference.model, effort: reference.effort, captured_at: reference.captured_at },
    captures: captureDirs.map((d) => d.split("/").pop()), ...(notes ? { notes } : {}),
  };
  const result = buildResult({ meta, perKind, registry: loadRegistry(), roles: loadRoles(), reference, format, skipped });
  return { result, dir: storeResult(result, { root: resultsRoot }) };
}

// ------------------------------------------------------------------------------------------------ CLI

function flag(argv, name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }
function flags(argv, name) { const out = []; for (let i = 0; i < argv.length; i++) if (argv[i] === name) { for (let j = i + 1; j < argv.length && !argv[j].startsWith("--"); j++) out.push(argv[j]); } return out; }

async function cliMain(argv) {
  const driverName = flag(argv, "--driver") ?? "frontier";
  const tier = flag(argv, "--tier") ?? "quick";
  const lanes = (flag(argv, "--lanes") ?? "blackbox,live,format").split(",");
  const kinds = flag(argv, "--kinds")?.split(",") ?? null;
  const resume = argv.includes("--resume");

  if (argv.includes("--from-captures")) {
    const dirs = flags(argv, "--from-captures").map((d) => resolve(d));
    const modelId = flag(argv, "--model-id");
    if (!modelId) throw new Error("--from-captures requires --model-id");
    const ignore = flag(argv, "--ignore-kinds")?.split(",") ?? [];
    const mergeFile = flag(argv, "--merge-result");
    const merged = mergeFile ? readJson(mergeFile) : null;
    const { dir } = resultFromCaptures({
      captureDirs: dirs, ignoreKindsByDir: Object.fromEntries(dirs.map((d, i) => [d, i === 0 ? ignore : []])),
      model: { id: modelId, driver: driverName, effort: flag(argv, "--effort") ?? null }, tier: flag(argv, "--tier") ?? "captured",
      notes: flag(argv, "--notes") ?? null, lanes: merged ? [...new Set(["blackbox", ...merged.meta.lanes])] : ["blackbox"],
      format: merged?.format ?? null, extraPerKind: merged?.per_kind ?? {}, skipped: merged?.skipped ?? [],
      ...(flag(argv, "--results-root") ? { resultsRoot: resolve(flag(argv, "--results-root")) } : {}),
    });
    console.log(`stored ${dir}`);
    return 0;
  }

  const cliPresets = await import("./cli-driver.mjs");
  let model;
  if (driverName === "local") { const p = resolveLocalParams(argv); model = { id: p.model, driver: "local", effort: flag(argv, "--effort") ? resolveEffort(argv) : null }; }
  else { model = { id: resolveEvalModel(argv), driver: "frontier", effort: resolveEffort(argv) }; }
  const runId = mintRunId();
  const workDir = resolve(flag(argv, "--work-dir") ?? join(REPO, ".faff", "eval-runs", `model-eval-${slugForModel(model.id)}-${tier}`));
  mkdirSync(workDir, { recursive: true });
  console.log(`[run-model-eval] ${model.id} · driver ${model.driver}${model.effort ? ` · effort ${model.effort}` : ""} · tier ${tier} · work dir ${workDir}`);

  const deps = { log: (m) => console.log(`[run-model-eval] ${m}`), capturePath: mintCapturePath(runId) };
  if (lanes.includes("blackbox")) deps.driver = resolveDriver(argv, cliPresets);

  if (lanes.includes("live")) {
    const { resolveLiveModelOpts, makeLiveCtx, runLiveEvals } = await import("./run-live-evals.mjs");
    const { makeLiveModel } = await import("./live-driver.mjs");
    const live = resolveLiveModelOpts(argv);
    deps.liveRunner = async (kind, reps) => {
      const { ctx, teardown } = await makeLiveCtx({ model: makeLiveModel(live.opts) });
      try { return await runLiveEvals({ kind, ctx, baseReps: reps, maxReps: reps }); } finally { teardown(); }
    };
    deps.dockerAvailable = async () => { try { execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "ignore" }); return true; } catch { return false; } };
  }

  if (lanes.includes("format")) {
    const { makeMessagesCompleter, runFormatCheck } = await import("./format-check.mjs");
    let endpoint = null;
    if (driverName === "local") { const p = resolveLocalParams(argv); endpoint = { baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model }; }
    else if (process.env.ANTHROPIC_API_KEY) endpoint = { baseUrl: "https://api.anthropic.com", apiKey: process.env.ANTHROPIC_API_KEY, model: model.id };
    if (endpoint) deps.formatRunner = (samples) => runFormatCheck({ complete: makeMessagesCompleter(endpoint), samples });
    else deps.formatSkipReason = "the frontier lane signs in with OAuth; the format lane needs an API key (set ANTHROPIC_API_KEY)";
  }

  const { result, dir } = await runModelEval({ model, tier, lanes, kinds, resume, workDir, deps, ...(flag(argv, "--results-root") ? { resultsRoot: resolve(flag(argv, "--results-root")) } : {}) });
  console.log(`[run-model-eval] stored ${dir}`);
  for (const s of result.skipped) console.log(`[run-model-eval] skipped ${s.lane}${s.kind ? ` ${s.kind}` : ""}: ${s.reason}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  cliMain(process.argv.slice(2)).then((c) => { process.exitCode = c; }).catch((e) => { console.error(`[run-model-eval] ${e.message}`); process.exitCode = 1; });
}
