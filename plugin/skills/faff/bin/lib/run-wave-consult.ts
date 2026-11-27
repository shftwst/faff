// === region:factory — assemble wave inputs for the run termination kernel ===
import * as fs from "node:fs";
import * as path from "node:path";
const { parseArgs, usageError } = require("./argv");
const { dig, findRoot, readLedger, ensureOwnerOnlyDir, writeOwnerOnlyJson } = require("./shared-infra");
const { loadConfig } = require("./config");
const { mutateLedgerUnderLock } = require("./heartbeat");
import { stopReasonFor, readLedgerDigest } from "./run-stop-reason";
const { auditRun } = require("./runcheck");
const { readQueueInputs, deriveQueueState } = require("./queue-state");
const { computeRunDoneVerdict } = require("./run-done");
const { parseChecklist, buildCoverage } = require("./prd-checklist");
const { schemaCheck } = require("./contract-engine");
const { mintConsultCorrelationId, captureDecision } = require("./decision-capture");

const usage = "usage: faff run wave-consult --run-dir DIR --wave N --budget JSON (--git-only | --queue JSON) (--no-prd | --prd PATH | --coverage JSON) [--policy JSON] [--admitted-work yes|no | --non-convergence] [--root DIR]";
const spec = {
  positionals: { max: 0 },
  flags: { "--run-dir": { arity: 1 }, "--wave": { arity: 1 }, "--root": { arity: 1 },
    "--budget": { arity: 1 }, "--git-only": { arity: 0 }, "--queue": { arity: 1 },
    "--prd": { arity: 1 }, "--no-prd": { arity: 0 }, "--coverage": { arity: 1 },
    "--policy": { arity: 1 }, "--admitted-work": { arity: 1 }, "--non-convergence": { arity: 0 } },
};
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function decode(raw: string): unknown { return JSON.parse(raw); }

// Store the ordinal with the counter in one ledger write. A replay may repeat the same
// admission fact; an older or conflicting wave cannot revise the current boundary.
function recordProgress(root: string, dir: string, wave: number, admitted: boolean) {
  const raw = dig(loadConfig(root)[0], "convergence.max_waves") ?? 6;
  const limit = typeof raw === "string" && /^[1-9]\d*$/.test(raw) ? Number(raw) : raw;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("convergence.max_waves must be a positive integer");
  const owner = readLedger(dir)?.owner ?? {};
  let count = 0;
  const result = mutateLedgerUnderLock(dir, (ledger: unknown) => {
    if (!record(ledger) || ledger.run_id !== path.basename(dir) || ledger.stop_reason ||
        (record(ledger.owner) && ledger.owner.status !== "running")) {
      throw new Error("wave progress requires the active run ledger");
    }
    const previous = ledger.no_progress_waves ?? 0;
    if (typeof previous !== "number" || !Number.isSafeInteger(previous) || previous < 0) {
      throw new Error("invalid no_progress_waves in run ledger");
    }
    const last = ledger.last_progress_wave;
    if (last !== undefined) {
      if (typeof last !== "number" || !Number.isSafeInteger(last) || last < 1 || wave < last || wave > last + 1) {
        throw new Error("wave progress is out of sequence");
      }
      if (last === wave) {
        if (admitted !== (previous === 0)) throw new Error("conflicting admission for this wave");
        count = previous;
        return null;
      }
    }
    count = admitted ? 0 : previous + 1;
    if (!Number.isSafeInteger(count)) throw new Error("wave progress counter overflow");
    return { ...ledger, no_progress_waves: count, last_progress_wave: wave };
  }, owner);
  if (result.yielded) throw new Error("a newer owner holds this run");
  return { no_progress_waves: count, stalled: count >= limit,
    ledger_sha256_before: result.before_sha256, ledger_sha256_after: result.after_sha256 };
}

export function cmdWaveConsult(args: string[]): number {
  const { values: v, errors } = parseArgs(args, spec);
  if (errors.length) return usageError(errors, usage);
  const admission = v["--admitted-work"];
  if (admission !== undefined && (!["yes", "no"].includes(admission) || v["--non-convergence"] ||
      !Number.isSafeInteger(Number(v["--wave"])))) return usageError([usage], usage);
  if (!v["--run-dir"] || !/^[1-9]\d*$/.test(v["--wave"] ?? "") || !v["--budget"] ||
      Boolean(v["--git-only"]) === Boolean(v["--queue"]) ||
      [v["--no-prd"], v["--prd"], v["--coverage"]].filter(Boolean).length !== 1 ||
      (v["--prd"] && !v["--git-only"]) || (v["--coverage"] && v["--git-only"])) return usageError([usage], usage);
  try {
    const root = path.resolve(v["--root"] || findRoot());
    const dir = path.resolve(v["--run-dir"]);
    const run = path.basename(dir);
    const wave: string = v["--wave"];
    const warnings: string[] = [];
    const budget = decode(v["--budget"]);
    if (budget !== null && !(record(budget) && Array.isArray(budget.breached) &&
        budget.breached.every(d => typeof d === "string") && ["stop", "escalate", "narrow", "none"].some(o => o === budget.outcome))) {
      throw new Error("expected the budget returned by the wave checkpoint");
    }
    if (budget === null) warnings.push("budget-unavailable");
    const policy = v["--policy"] ? decode(v["--policy"]) : null;
    let satisfied: boolean | null = null;
    if (v["--prd"]) {
      try {
        const coverage = buildCoverage(parseChecklist(fs.readFileSync(path.resolve(root, v["--prd"]), "utf8")));
        if (schemaCheck(coverage, "prd-coverage") || typeof coverage.satisfied !== "boolean") throw new Error("invalid coverage");
        satisfied = coverage.satisfied;
      } catch { warnings.push("coverage-unavailable"); }
    } else if (v["--coverage"]) {
      const coverage = decode(v["--coverage"]);
      if (!record(coverage) || typeof coverage.satisfied !== "boolean") throw new Error("coverage requires a boolean satisfied");
      satisfied = coverage.satisfied;
    }
    function capture(kernel: string, inputs: unknown, verdict: unknown, ordinal?: string): string {
      const id: string = mintConsultCorrelationId(root, run, "__run__", kernel, ordinal, true);
      captureDecision({ root, run: dir, issue: "__run__", kernel, normalised_inputs: inputs, verdict, correlationId: id });
      return id;
    }
    let queue: unknown;
    if (v["--git-only"]) {
      try {
        const inputs = readQueueInputs(root, dir);
        queue = deriveQueueState(inputs);
        capture("queue-state", inputs, queue);
      } catch { warnings.push("queue-unavailable"); }
    } else {
      queue = decode(v["--queue"]);
      if (!record(queue) || typeof queue.queue_empty !== "boolean" || typeof queue.all_parked !== "boolean") {
        throw new Error("queue requires boolean queue_empty and all_parked");
      }
    }
    let clean = false;
    try { clean = auditRun(dir).clean; } catch { warnings.push("ledger-unavailable"); }
    const progress = admission === undefined ? null : recordProgress(root, dir, Number(wave), admission === "yes");
    const signals = { queue_empty: record(queue) && queue.queue_empty === true,
      all_parked: record(queue) && queue.all_parked === true, ledger_clean: clean, prd_satisfied: satisfied,
      budget: budget ?? { breached: [], outcome: "none" }, inflection: "none", non_convergence: progress?.stalled ?? Boolean(v["--non-convergence"]) };
    const decision = computeRunDoneVerdict(signals, policy);
    const violation = schemaCheck(decision, "run-termination");
    if (violation) throw new Error(violation);
    const correlation_id = capture("run-done", signals, decision, wave);
    try {
      const waveDir = path.join(dir, "wave-" + wave);
      ensureOwnerOnlyDir(waveDir);
      writeOwnerOnlyJson(path.join(waveDir, "run-done.json"), { run_id: run, wave: Number(wave), verdict: decision.verdict,
        reason: decision.reason, stop_reason: stopReasonFor(decision.verdict, decision.reason), ledger_digest: readLedgerDigest(dir), correlation_id });
    } catch { warnings.push("run-done-record-unwritable"); }
    console.log(JSON.stringify({ verdict: decision.verdict, reason: decision.reason, correlation_id, warnings, ...(progress && { progress }) }));
    return 0;
  } catch (error) {
    process.stderr.write("faff run wave-consult: " + (error instanceof Error ? error.message : String(error)) + "\n");
    return 2;
  }
}
