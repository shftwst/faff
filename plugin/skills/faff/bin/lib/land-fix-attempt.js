"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmdLandFixAttempt = cmdLandFixAttempt;
// === region:factory — bind and record a landing fix attempt ===
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const land_assess_fix_1 = require("./land-assess-fix");
const { parseArgs } = require("./argv");
const effects = require("./effects");
const evidence = require("./evidence");
const anchor = "landing-progress.json";
const usage = "faff land fix-attempt <status|begin|submit|assess> --run-dir DIR --issue ID --pr N --mode shadow|unattended";
const bindingFlags = { "--run-dir": { arity: 1 }, "--issue": { arity: 1 }, "--pr": { arity: 1 }, "--mode": { arity: 1 } };
const useAttempt = { "--attempt": { arity: 1 } };
const commandFlags = {
    status: bindingFlags,
    begin: { ...bindingFlags, "--before": { arity: 1 }, "--next": { arity: 1 } },
    submit: { ...bindingFlags, ...useAttempt, "--pushed": { arity: 1 }, "--no-push": { arity: 0 }, "--tried": { arity: 1 } },
    assess: { ...bindingFlags, ...useAttempt, "--after": { arity: 1 } },
};
const sha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
function checkKey(name) {
    return (0, node_crypto_1.createHash)("sha256").update(name).digest("hex");
}
function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function progressFor(value, issue) {
    if (!record(value) || value.issue !== issue || typeof value.fix_cycles !== "number" ||
        !Number.isSafeInteger(value.fix_cycles) || value.fix_cycles < 0 || value.fix_cycles > 3 ||
        !Array.isArray(value.history) || value.history.length !== value.fix_cycles)
        return false;
    const schema = evidence.validateEvidenceDocument(anchor, { schema_version: 1, ...value });
    if (schema.unavailable || schema.violations.length)
        return false;
    const ids = [];
    for (const [index, row] of value.history.entries()) {
        if (!record(row) || row.cycle !== index + 1)
            return false;
        if (typeof row.attempt_id === "string")
            ids.push(row.attempt_id);
    }
    if (new Set(ids).size !== ids.length)
        return false;
    const active = value.attempt;
    if (!record(active))
        return active === undefined;
    if (typeof active.pr !== "number" || !Number.isSafeInteger(active.pr) || active.pr <= 0)
        return false;
    if (!Array.isArray(active.failing_checks) || !Array.isArray(active.check_keys) ||
        active.failing_checks.length !== active.check_keys.length ||
        (active.failing_checks.length === 0) !== (active.kind === "conflict"))
        return false;
    if ((active.outcome === "recorded") !== ids.includes(String(active.id)))
        return false;
    if (active.outcome !== undefined && !record(active.implementation))
        return false;
    if (record(active.implementation) && active.implementation.pushed === null && active.outcome !== "recorded")
        return false;
    return !(value.fix_cycles === 3 && active.outcome === undefined);
}
function readProgress(file, issue) {
    let raw;
    try {
        raw = (0, node_fs_1.readFileSync)(file, "utf8");
    }
    catch (error) {
        if (record(error) && error.code === "ENOENT")
            return null;
        throw error;
    }
    const value = JSON.parse(raw);
    if (!progressFor(value, issue))
        throw new Error("corrupt or foreign landing-progress.json");
    return value;
}
function receipt(progress, forStatus = false) {
    const attempt = progress?.attempt;
    if (progress && progress.fix_cycles >= 3) {
        return { action: "hard-park", fix_cycles: progress.fix_cycles, history: progress.history };
    }
    if (!attempt)
        return { action: "observe" };
    if (attempt.outcome === "recorded" || attempt.outcome === "continue") {
        return { action: forStatus ? "observe" : "continue", next: attempt.id, fix_cycles: progress.fix_cycles };
    }
    if (attempt.outcome)
        return { action: attempt.outcome, attempt: attempt.id };
    if (!attempt.implementation)
        return { action: "await-result", attempt: attempt.id };
    return { action: "observe-again", attempt: attempt.id, pushed: attempt.implementation.pushed };
}
function emit(value) {
    process.stdout.write(JSON.stringify(value) + "\n");
    return 0;
}
function cmdLandFixAttempt(args) {
    const verb = args[0];
    try {
        if (verb !== "status" && verb !== "begin" && verb !== "submit" && verb !== "assess")
            throw new Error(usage);
        const { values, errors } = parseArgs(args.slice(1), { flags: commandFlags[verb], positionals: { min: 0, max: 0 } });
        const dir = values["--run-dir"], issue = values["--issue"], mode = values["--mode"];
        const pr = Number(values["--pr"]);
        if (errors.length || typeof dir !== "string" || !dir || typeof issue !== "string" ||
            !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(issue) || issue.includes("..") ||
            !/^\d+$/.test(values["--pr"] ?? "") || !Number.isSafeInteger(pr) || pr <= 0 ||
            (mode !== "shadow" && mode !== "unattended"))
            throw new Error(usage);
        const file = effects.landingProgressPath(dir, issue);
        const operate = () => {
            const prior = readProgress(file, issue);
            const active = prior?.attempt;
            if (active && (active.pr !== pr || active.mode !== mode))
                throw new Error("landing fix is bound to a different PR or mode");
            if (verb === "status")
                return emit(receipt(prior, true));
            const now = new Date().toISOString();
            const progress = prior ?? { issue, fix_cycles: 0, last_head_sha: null, history: [], updated_at: now };
            const save = (next, result) => {
                const code = effects.writeRunState("land fix-attempt", anchor, file, prior, next, undefined, { quiet: true });
                return code === 0 ? emit(result) : 2;
            };
            if (verb === "begin") {
                if (!values["--before"])
                    throw new Error("begin requires --before FILE");
                if (progress.fix_cycles >= 3 || (active && !active.outcome) ||
                    active?.outcome === "park-shadow" || active?.outcome === "superseded")
                    return emit(receipt(progress));
                const previous = values["--next"];
                if (active && !previous)
                    return emit(receipt(progress));
                if (previous !== active?.id)
                    throw new Error("begin --next must match the last completed attempt");
                const before = (0, land_assess_fix_1.readFixObservation)(values["--before"]);
                const head = before.head_sha, kind = before.reason;
                if (before.issue !== issue || before.pr !== pr || before.token !== "needs-fix" ||
                    typeof head !== "string" || !sha.test(head) || (kind !== "conflict" && kind !== "regression")) {
                    throw new Error("before must be a fixable observation for this PR and issue on a known head");
                }
                const checks = kind === "regression" ? (0, land_assess_fix_1.failedChecks)(before) : [];
                const attempt = { id: (0, node_crypto_1.randomUUID)(), pr, mode, kind, head_sha: head, failing_checks: checks, check_keys: checks.map(checkKey) };
                return save({ ...progress, attempt, updated_at: now }, { action: "implement", attempt: attempt.id, kind, head_sha: head });
            }
            const id = values["--attempt"];
            if (!active || !id || id !== active.id)
                throw new Error("attempt does not match the current landing fix");
            const before = { issue, pr, token: "needs-fix", reason: active.kind, head_sha: active.head_sha, failing_checks: active.failing_checks };
            const finish = (implementation, outcome, failure) => {
                const attempt = { ...active, implementation, outcome };
                const next = failure ? effects.landingProgressApplyFixCycle(progress, issue, active.kind, failure.failing_checks, implementation.tried, failure.head_sha, now) : { ...progress };
                if (failure) {
                    const row = next.history.at(-1);
                    if (!row)
                        throw new Error("failed attempt did not produce a history entry");
                    row.attempt_id = id;
                }
                next.attempt = attempt;
                next.updated_at = now;
                return save(next, receipt(next));
            };
            if (verb === "submit") {
                const pushed = values["--pushed"];
                const noPush = values["--no-push"] === true;
                if (Boolean(pushed) === noPush || (pushed && !sha.test(pushed)))
                    throw new Error("submit requires exactly one of --pushed SHA or --no-push");
                const implementation = {
                    pushed: pushed || null,
                    tried: typeof values["--tried"] === "string" ? values["--tried"].split(",").map((part) => part.trim()).filter(Boolean) : [],
                };
                if (active.implementation) {
                    if (active.implementation.pushed !== implementation.pushed)
                        throw new Error("the attempt already has a different push receipt");
                    return emit(receipt(progress));
                }
                if (implementation.pushed === null) {
                    return finish(implementation, "recorded", { head_sha: active.head_sha, failing_checks: active.failing_checks });
                }
                const next = { ...progress, attempt: { ...active, implementation }, updated_at: now };
                return save(next, receipt(next));
            }
            if (!values["--after"])
                throw new Error("assess requires --after FILE");
            const implementation = active.implementation;
            if (!implementation?.pushed)
                throw new Error("assess requires a stored pushed head");
            const after = (0, land_assess_fix_1.readFixObservation)(values["--after"]);
            if (after.issue !== issue || after.pr !== pr)
                throw new Error("after refers to a different PR or issue");
            if (active.outcome)
                return emit(receipt(progress));
            if (after.token !== "errored" && typeof after.head_sha === "string" && sha.test(after.head_sha) &&
                after.head_sha !== implementation.pushed)
                return finish(implementation, "superseded");
            const result = (0, land_assess_fix_1.assessLandingFix)(mode, before, implementation.pushed, after, name => active.check_keys.includes(checkKey(name)));
            if (result.action === "observe-again" || result.action === "landing-resumable") {
                return emit({ action: result.action, attempt: id, pushed: implementation.pushed });
            }
            if (result.action === "record-failed") {
                return finish(implementation, "recorded", { head_sha: implementation.pushed, failing_checks: result.failing_checks ?? [] });
            }
            if (result.action === "continue" || result.action === "park-shadow")
                return finish(implementation, result.action);
            throw new Error("unhandled landing fix assessment");
        };
        return verb === "status" ? operate() : effects.withLandingProgressLock(file, operate);
    }
    catch (error) {
        process.stderr.write("land fix-attempt: " + (error instanceof Error ? error.message : "invalid attempt") + "\n");
        return 2;
    }
}
