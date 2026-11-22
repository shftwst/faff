"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmdWaveConsult = cmdWaveConsult;
// === region:factory — assemble wave inputs for the run termination kernel ===
const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, usageError } = require("./argv");
const { findRoot } = require("./shared-infra");
const { auditRun } = require("./runcheck");
const { readQueueInputs, deriveQueueState } = require("./queue-state");
const { computeRunDoneVerdict } = require("./run-done");
const { parseChecklist, buildCoverage } = require("./prd-checklist");
const { schemaCheck } = require("./contract-engine");
const { mintConsultCorrelationId, captureDecision } = require("./decision-capture");
const usage = "usage: faff run wave-consult --run-dir DIR --wave N --budget JSON (--git-only | --queue JSON) (--no-prd | --prd PATH | --coverage JSON) [--policy JSON] [--non-convergence] [--root DIR]";
const spec = {
    positionals: { max: 0 },
    flags: { "--run-dir": { arity: 1 }, "--wave": { arity: 1 }, "--root": { arity: 1 },
        "--budget": { arity: 1 }, "--git-only": { arity: 0 }, "--queue": { arity: 1 },
        "--prd": { arity: 1 }, "--no-prd": { arity: 0 }, "--coverage": { arity: 1 },
        "--policy": { arity: 1 }, "--non-convergence": { arity: 0 } },
};
function record(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function decode(raw) { return JSON.parse(raw); }
function cmdWaveConsult(args) {
    const { values: v, errors } = parseArgs(args, spec);
    if (errors.length)
        return usageError(errors, usage);
    if (!v["--run-dir"] || !/^[1-9]\d*$/.test(v["--wave"] ?? "") || !v["--budget"] ||
        Boolean(v["--git-only"]) === Boolean(v["--queue"]) ||
        [v["--no-prd"], v["--prd"], v["--coverage"]].filter(Boolean).length !== 1 ||
        (v["--prd"] && !v["--git-only"]) || (v["--coverage"] && v["--git-only"]))
        return usageError([usage], usage);
    try {
        const root = path.resolve(v["--root"] || findRoot());
        const dir = path.resolve(v["--run-dir"]);
        const run = path.basename(dir);
        const wave = v["--wave"];
        const warnings = [];
        const budget = decode(v["--budget"]);
        if (budget !== null && !(record(budget) && Array.isArray(budget.breached) &&
            budget.breached.every(d => typeof d === "string") && ["stop", "escalate", "narrow", "none"].some(o => o === budget.outcome))) {
            throw new Error("expected the budget returned by the wave checkpoint");
        }
        if (budget === null)
            warnings.push("budget-unavailable");
        const policy = v["--policy"] ? decode(v["--policy"]) : null;
        let satisfied = null;
        if (v["--prd"]) {
            try {
                const coverage = buildCoverage(parseChecklist(fs.readFileSync(path.resolve(root, v["--prd"]), "utf8")));
                if (schemaCheck(coverage, "prd-coverage") || typeof coverage.satisfied !== "boolean")
                    throw new Error("invalid coverage");
                satisfied = coverage.satisfied;
            }
            catch {
                warnings.push("coverage-unavailable");
            }
        }
        else if (v["--coverage"]) {
            const coverage = decode(v["--coverage"]);
            if (!record(coverage) || typeof coverage.satisfied !== "boolean")
                throw new Error("coverage requires a boolean satisfied");
            satisfied = coverage.satisfied;
        }
        function capture(kernel, inputs, verdict, ordinal) {
            const id = mintConsultCorrelationId(root, run, "__run__", kernel, ordinal, true);
            captureDecision({ root, run: dir, issue: "__run__", kernel, normalised_inputs: inputs, verdict, correlationId: id });
            return id;
        }
        let queue;
        if (v["--git-only"]) {
            try {
                const inputs = readQueueInputs(root, dir);
                queue = deriveQueueState(inputs);
                capture("queue-state", inputs, queue);
            }
            catch {
                warnings.push("queue-unavailable");
            }
        }
        else {
            queue = decode(v["--queue"]);
            if (!record(queue) || typeof queue.queue_empty !== "boolean" || typeof queue.all_parked !== "boolean") {
                throw new Error("queue requires boolean queue_empty and all_parked");
            }
        }
        let clean = false;
        try {
            clean = auditRun(dir).clean;
        }
        catch {
            warnings.push("ledger-unavailable");
        }
        const signals = { queue_empty: record(queue) && queue.queue_empty === true,
            all_parked: record(queue) && queue.all_parked === true, ledger_clean: clean, prd_satisfied: satisfied,
            budget: budget ?? { breached: [], outcome: "none" }, inflection: "none", non_convergence: Boolean(v["--non-convergence"]) };
        const decision = computeRunDoneVerdict(signals, policy);
        const violation = schemaCheck(decision, "run-termination");
        if (violation)
            throw new Error(violation);
        const correlation_id = capture("run-done", signals, decision, wave);
        console.log(JSON.stringify({ verdict: decision.verdict, reason: decision.reason, correlation_id, warnings }));
        return 0;
    }
    catch (error) {
        process.stderr.write("faff run wave-consult: " + (error instanceof Error ? error.message : String(error)) + "\n");
        return 2;
    }
}
