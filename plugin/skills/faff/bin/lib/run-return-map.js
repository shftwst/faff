"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmdRunReturnMap = cmdRunReturnMap;
// === region:factory — run-return-map: classify reconciled graft returns without effects ===
const argv = require("./argv");
function terminal(bucket, annotation = null) {
    return { action: "terminal", bucket, annotation };
}
const preAdmission = { action: "pre-admission", bucket: null, annotation: null };
const returns = new Map([
    ["shipped", terminal("shipped")],
    ["superseded-done", terminal("superseded")],
    ["pr-open-for-human", terminal("pr-open")],
    ["needs-human", terminal("parked")],
    ["retry-later", terminal("parked", "review_outage_pending")],
    ["built-but-not-admitted", terminal("parked", "build_review_dialogue_pending")],
    ["landing-resumable", terminal("pr-open", "landing_resumable")],
    ["parked", terminal("parked")],
    ["errored", terminal("errored")],
    ["pr-ready", { action: "merge-handoff", bucket: null, annotation: null }],
    ["ineligible", preAdmission],
    ["blocked", preAdmission],
    ["inadmissible", preAdmission],
    ["claimed-by-peer", preAdmission],
]);
function cmdRunReturnMap(args) {
    const usage = "usage: faff run return-map --outcome TOKEN";
    const { values, errors } = argv.parseArgs(args, { flags: { "--outcome": { arity: 1, enum: [...returns.keys()] } } });
    if (errors.length)
        return argv.usageError(errors, usage);
    const token = values["--outcome"];
    const plan = typeof token === "string" ? returns.get(token) : undefined;
    if (plan === undefined)
        return argv.usageError([{ code: "missing-flag", detail: "--outcome is required" }], usage);
    process.stdout.write(JSON.stringify(plan) + "\n");
    return 0;
}
