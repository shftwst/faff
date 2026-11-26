"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// === region:factory — apply the existing eligibility and next kernels to a scoped prep batch ===
const run_wave_mode_1 = require("./run-wave-mode");
const argv = require("./argv");
const { findRoot } = require("./shared-infra");
const { readStdinCapped, VALIDATE_MAX_BYTES } = require("./ratified-scope");
const config = require("./config");
const eligible = require("./eligible");
function object(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function strings(value) {
    return Array.isArray(value) && value.every((label) => typeof label === "string");
}
function prepQueue(input, prefix, names, nextStep, discovered) {
    if (!object(input) || input.complete !== true || !Array.isArray(input.issues)) {
        throw new Error("expected complete:true and an ordered issues array");
    }
    const ids = new Set();
    const prep = [];
    const name = (role) => names[role] ?? `${prefix}-${role}`;
    const automate = name("automate");
    const parked = name("parked");
    const awaitingReview = name("awaiting-spec-review");
    for (const [index, row] of input.issues.entries()) {
        if (!object(row) || typeof row.id !== "string" || row.id === "" || row.id !== row.id.trim() ||
            typeof row.status !== "string" || typeof row.spec !== "string" ||
            !strings(row.labels) || typeof row.blocked !== "boolean" ||
            (row.awaiting_spec_review !== undefined && typeof row.awaiting_spec_review !== "boolean")) {
            throw new Error(`issues[${index}] has missing or invalid routing facts`);
        }
        const key = row.id.toLowerCase();
        if (ids.has(key))
            throw new Error(`duplicate issue at issues[${index}]`);
        ids.add(key);
        const normal = eligible.normalizeEligibilityLabels(row.labels, prefix, automate);
        const [step, reason] = nextStep({
            status: row.status, spec: row.spec, blocked: row.blocked,
            eligible: eligible.automationEligible(normal, "opt-in", true) || discovered.has(row.id),
            parked: row.labels.includes(parked), ifEligible: false,
            awaitingSpecReview: row.labels.includes(awaitingReview) || row.awaiting_spec_review === true,
        });
        if (step === "error")
            throw new Error(`issues[${index}]: ${reason}`);
        // The scope is the prep pass's unstarted and explicitly nominated stale Todo work.
        if (step === "prep" && !row.blocked && (row.status === "backlog" || row.status === "todo")) {
            prep.push(row.id);
        }
    }
    return prep;
}
const usage = "usage: faff next prep-queue [--root DIR] [--run-dir DIR] < facts.json";
const spec = { flags: { "--root": { arity: 1 }, "--run-dir": { arity: 1 } }, positionals: { min: 0, max: 0 } };
function cmdPrepQueue(args, nextStep) {
    const { values, errors } = argv.parseArgs(args, spec);
    if (errors.length)
        return argv.usageError(errors, usage);
    try {
        const root = values["--root"] ?? findRoot();
        const prefix = config.resolveLabelPrefix(root);
        const labels = config.resolveControlLabels(root);
        if (prefix.prefix === undefined || labels.names === undefined) {
            throw new Error(prefix.error ?? labels.error ?? "control labels could not be resolved");
        }
        const raw = readStdinCapped(VALIDATE_MAX_BYTES);
        if (raw.over)
            throw new Error("facts exceed one MiB");
        const input = JSON.parse(raw.text);
        process.stdout.write(JSON.stringify({ prep: prepQueue(input, prefix.prefix, labels.names, nextStep, (0, run_wave_mode_1.discoveredInWave)(root, values["--run-dir"] ?? process.env.FAFF_RUN_DIR)) }) + "\n");
        return 0;
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        process.stderr.write(`faff next prep-queue: ${reason}\n`);
        return 2;
    }
}
module.exports = { cmdPrepQueue };
