"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmdPrepareProducer = cmdPrepareProducer;
// === region:factory — resolve a producer handoff before invoking its skill ===
const { parseArgs, usageError } = require("./argv");
const { DEFAULTS, DISPATCH_LANES, legacyTreeGuard, loadConfig } = require("./config");
const { resolveDispatch } = require("./dispatch");
const { dig, findRoot } = require("./shared-infra");
const { bundledSlotStatus, SLOT_TYPES } = require("./validate-adapters");
const usage = "usage: faff dispatch prepare-producer <lane> [--in-context | --fresh-adversarial] [--root DIR]";
const spec = {
    positionals: { min: 1, max: 1, name: "producer lane" },
    flags: { "--in-context": { arity: 0 }, "--fresh-adversarial": { arity: 0 }, "--root": { arity: 1 } },
};
function cmdPrepareProducer(args) {
    const { positionals, values, errors } = parseArgs(args, spec);
    if (errors.length)
        return usageError(errors, usage);
    const [lane] = positionals;
    if (!DISPATCH_LANES.includes(lane) || !Object.hasOwn(SLOT_TYPES, lane)) {
        return usageError([{ code: "invalid-value", detail: `no dispatchable producer slot ${lane}` }], usage);
    }
    const freshAdversarial = values["--fresh-adversarial"];
    if (freshAdversarial && (lane !== "spec_review" || values["--in-context"])) {
        return usageError([{ code: "invalid-value", detail: "--fresh-adversarial requires a fresh spec_review handoff" }], usage);
    }
    try {
        const root = values["--root"] || findRoot();
        const [config] = loadConfig(root);
        const key = "slots." + lane;
        const occupant = dig(config, key) ?? DEFAULTS[key];
        if (typeof occupant !== "string" || !occupant.trim())
            throw new Error(`invalid skill name for ${key}`);
        const validation = bundledSlotStatus(occupant.trim(), lane) === "bundled" ? "bundled" : "validate";
        if (values["--in-context"]) {
            console.log(JSON.stringify({ occupant, validation, transport: "in-context" }));
            return 0;
        }
        const legacy = legacyTreeGuard(root);
        if (legacy)
            throw new Error(legacy);
        const resolved = resolveDispatch(config, lane);
        if (resolved.error)
            throw new Error(resolved.error);
        const { model, effort } = resolved;
        let transport = model.startsWith("engine:") ? "engine" : "agent";
        if (freshAdversarial && occupant === "faffter-dark-spec-review" && validation === "bundled" &&
            model === "inherit" && effort === "inherit") {
            transport = "spec-review-cli";
        }
        console.log(JSON.stringify({ occupant, validation, transport, model, effort }));
        return 0;
    }
    catch (error) {
        process.stderr.write("faff dispatch prepare-producer: " + (error instanceof Error ? error.message : String(error)) + "\n");
        return 2;
    }
}
