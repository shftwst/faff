"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmdPrepareBuild = cmdPrepareBuild;
// === region:factory — prepare one build worker handoff from an ordered partition unit ===
const { parseArgs, usageError } = require("./argv");
const { readStdinCapped, VALIDATE_MAX_BYTES } = require("./ratified-scope");
const usage = "usage: faff dispatch prepare-build --executor sequential|parallel [--root DIR] < unit.json";
const spec = {
    flags: { "--executor": { arity: 1, enum: ["sequential", "parallel"] }, "--root": { arity: 1 } },
    positionals: { min: 0, max: 0 },
};
function object(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requiredText(value, field) {
    if (typeof value !== "string" || !value.trim())
        throw new Error(field + " must be a nonempty string");
    return value;
}
function rating(value, field) {
    return value == null ? null : requiredText(value, field).trim().toLowerCase();
}
function prepareBuild(unit, executor, root, resolve) {
    if (!object(unit) || !Array.isArray(unit.members) || !unit.members.length)
        throw new Error("expected a nonempty members array");
    if ("constraints" in unit)
        throw new Error("attach constraints only after the executor verifies the correction");
    const run_id = requiredText(unit.run_id, "run_id");
    const run_dir = requiredText(unit.run_dir, "run_dir");
    const session_id = requiredText(unit.session_id, "session_id");
    const issues = new Set();
    const tiers = ["mechanical", "standard", "complex"];
    const confidences = ["high", "medium"];
    let tier = null;
    let confidence = null;
    for (const member of unit.members) {
        if (!object(member))
            throw new Error("expected a partition member with an issue");
        const issue = requiredText(member.issue, "member.issue");
        if (issues.has(issue))
            throw new Error("duplicate issue " + issue);
        issues.add(issue);
        const nativeTier = rating(member["build-tier"], "build-tier");
        const suppliedTier = rating(member.tier, "tier");
        if (nativeTier && suppliedTier && nativeTier !== suppliedTier)
            throw new Error("conflicting tier fields for " + issue);
        const t = nativeTier ?? suppliedTier;
        // An explicitly unrecognised tier still consults by_tier.default in dispatch resolve.
        if (t && (!tier || tiers.indexOf(t) > tiers.indexOf(tier)))
            tier = t;
        const c = rating(member.confidence, "confidence");
        if (c && confidences.includes(c) && (!confidence || confidences.indexOf(c) > confidences.indexOf(confidence)))
            confidence = c;
    }
    const resolved = resolve(root, tier, confidence);
    if ("error" in resolved)
        throw new Error(resolved.error);
    return {
        dispatch: { issues: [...issues], run_id, run_dir, session_id, mode_signal: "autonomous", model: resolved.model,
            pr_ready_return: "Per issue, return build_claim_sha beside EvidenceReturn: the lease SHA acquired at Step 5, or null if unavailable." },
        agent_parameters: { run_in_background: executor === "parallel", ...(resolved.model === "inherit" ? {} : { model: resolved.model }) },
        effort_log: resolved.effort,
    };
}
function cmdPrepareBuild(args, resolve) {
    const { values, errors } = parseArgs(args, spec);
    if (errors.length || !values["--executor"])
        return usageError(errors, usage);
    try {
        const input = readStdinCapped(VALIDATE_MAX_BYTES);
        if (input.over)
            throw new Error("unit exceeds one MiB");
        const unit = JSON.parse(input.text);
        const prepared = prepareBuild(unit, values["--executor"], values["--root"], resolve);
        process.stdout.write(JSON.stringify(prepared) + "\n");
        return 0;
    }
    catch (err) {
        process.stderr.write("faff dispatch prepare-build: " + (err instanceof Error ? err.message : String(err)) + "\n");
        return 2;
    }
}
