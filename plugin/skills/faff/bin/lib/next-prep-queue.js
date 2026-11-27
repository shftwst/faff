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
function prepQueue(input, prefix, names, nextStep, discovered, plan) {
    if (!object(input) || input.complete !== true || !Array.isArray(input.issues)) {
        throw new Error("expected complete:true and an ordered issues array");
    }
    const ids = new Set();
    const candidates = new Map();
    const name = (role) => names[role] ?? `${prefix}-${role}`;
    const automate = name("automate");
    const parked = name("parked");
    const awaitingReview = name("awaiting-spec-review");
    for (const [index, row] of input.issues.entries()) {
        if (!object(row) || typeof row.id !== "string" || row.id === "" || row.id !== row.id.trim() ||
            typeof row.status !== "string" || typeof row.spec !== "string" ||
            !strings(row.labels) || typeof row.blocked !== "boolean" ||
            (row.open_blockers !== undefined && (!strings(row.open_blockers) || row.blocked !== (row.open_blockers.length > 0))) ||
            (row.awaiting_spec_review !== undefined && typeof row.awaiting_spec_review !== "boolean")) {
            throw new Error(`issues[${index}] has missing or invalid routing facts`);
        }
        const key = row.id.toLowerCase();
        if (ids.has(key))
            throw new Error(`duplicate issue at issues[${index}]`);
        ids.add(key);
        const normal = eligible.normalizeEligibilityLabels(row.labels, prefix, automate);
        const [step, reason] = nextStep({
            status: row.status, spec: row.spec, blocked: false,
            eligible: eligible.automationEligible(normal, "opt-in", true) || discovered.has(row.id),
            parked: row.labels.includes(parked), ifEligible: false,
            awaitingSpecReview: row.labels.includes(awaitingReview) || row.awaiting_spec_review === true,
        });
        if (step === "error")
            throw new Error(`issues[${index}]: ${reason}`);
        if (row.status !== "backlog" && row.status !== "todo")
            continue;
        if (step !== "prep" && !(step === "graft" && row.status === "todo"))
            continue;
        if (row.blocked && !strings(row.open_blockers))
            continue;
        candidates.set(key, {
            id: row.id, needsPrep: step === "prep",
            blockers: strings(row.open_blockers) ? row.open_blockers.map(id => id.toLowerCase()) : [],
        });
    }
    // Only chains rooted in runnable work can enter the wave. Cycles and
    // dependencies on missing or ineligible candidates stay outside it.
    const reachable = new Set();
    let previousSize;
    do {
        previousSize = reachable.size;
        for (const [key, row] of candidates) {
            if (!reachable.has(key) && row.blockers.every(id => reachable.has(id)))
                reachable.add(key);
        }
    } while (reachable.size !== previousSize);
    const members = Array.from(candidates.entries()).filter(([key, row]) => reachable.has(key) && row.needsPrep);
    const prep = members.map(([, row]) => row.id);
    if (!plan)
        return { prep };
    // A specced intermediate still carries its upstream prep dependencies.
    const waits = members.map(([, row]) => {
        const pending = [...row.blockers];
        const seen = new Set();
        const prerequisites = [];
        while (pending.length) {
            const id = pending.pop();
            if (seen.has(id))
                continue;
            seen.add(id);
            const blocker = candidates.get(id);
            if (blocker.needsPrep)
                prerequisites.push(blocker.id);
            else
                for (const upstream of blocker.blockers)
                    pending.push(upstream);
        }
        return [row.id, prerequisites];
    });
    return { prep, wait_for: Object.fromEntries(waits) };
}
const usage = "usage: faff next prep-queue [--plan] [--root DIR] [--run-dir DIR] < facts.json";
const spec = { flags: { "--plan": { arity: 0 }, "--root": { arity: 1 }, "--run-dir": { arity: 1 } }, positionals: { min: 0, max: 0 } };
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
        process.stdout.write(JSON.stringify(prepQueue(input, prefix.prefix, labels.names, nextStep, (0, run_wave_mode_1.discoveredInWave)(root, values["--run-dir"] ?? process.env.FAFF_RUN_DIR), Boolean(values["--plan"]))) + "\n");
        return 0;
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        process.stderr.write(`faff next prep-queue: ${reason}\n`);
        return 2;
    }
}
module.exports = { cmdPrepQueue };
