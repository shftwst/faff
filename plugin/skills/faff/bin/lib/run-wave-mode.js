"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmdWaveMode = cmdWaveMode;
exports.discoveredInWave = discoveredInWave;
// === region:factory — select convergence mode for a concrete run ===
const { parseArgs, usageError } = require("./argv");
const fs = require("node:fs");
const path = require("node:path");
const { mainWorktreeRoot, writeOwnerOnlyJson, findRoot, readLedger } = require("./shared-infra");
const { loadConfig } = require("./config");
const { resolveConvergence } = require("./config-resolve");
const usage = "usage: faff run wave-mode --run-dir DIR [--root DIR] [--converge | --no-converge] [--git-only]";
const spec = {
    positionals: { max: 0 },
    flags: { "--run-dir": { arity: 1 }, "--root": { arity: 1 }, "--converge": { arity: 0 },
        "--no-converge": { arity: 0 }, "--git-only": { arity: 0 } },
};
function cmdWaveMode(args) {
    const { values, errors } = parseArgs(args, spec);
    if (errors.length)
        return usageError(errors, usage);
    if (!values["--run-dir"] || (values["--converge"] && values["--no-converge"])) {
        process.stderr.write(usage + "\n");
        return 2;
    }
    try {
        const ledger = readLedger(values["--run-dir"]);
        if (typeof ledger !== "object" || ledger === null || !("level" in ledger) ||
            !["L1", "L2", "L3", "L4"].some(level => level === ledger.level)) {
            throw new Error("run ledger has no recognised level");
        }
        // The specified ledger is authoritative. In particular a different ambient run cannot supply its level.
        const fold = ledger.level === "L4" || Boolean(values["--converge"]) ||
            (!values["--no-converge"] && resolveConvergence(loadConfig(values["--root"] || findRoot())[0], {}) !== "false");
        const consult = fold || Boolean(values["--git-only"]);
        writeOwnerOnlyJson(path.join(values["--run-dir"], "wave-mode.json"), { run_id: path.basename(path.resolve(values["--run-dir"])), fold, consult });
        console.log(JSON.stringify({ fold, consult }));
        return 0;
    }
    catch (error) {
        process.stderr.write("faff run wave-mode: " + (error instanceof Error ? error.message : String(error)) + "\n");
        return 2;
    }
}
// Only a tracker-acknowledged contained create from this run can supplement its labels.
// Legacy events also counted deferred/self-intake filings, so their mere presence is insufficient.
function discoveredInWave(root, dir) {
    const found = new Set();
    if (!dir)
        return found;
    try {
        const actual = fs.realpathSync(dir);
        const parent = path.dirname(actual);
        const localRuns = path.join(fs.realpathSync(root), ".faff", "runs");
        if (parent !== localRuns) {
            const main = mainWorktreeRoot(root);
            if (!main || parent !== path.join(fs.realpathSync(main), ".faff", "runs"))
                return found;
        }
        const run = path.basename(actual);
        const mode = JSON.parse(fs.readFileSync(path.join(actual, "wave-mode.json"), "utf8"));
        const ledger = readLedger(actual);
        if (mode.run_id !== run || mode.fold !== true || ledger.run_id !== run || ledger.stop_reason)
            return found;
        const lines = fs.readFileSync(path.join(actual, "events.jsonl"), "utf8").trim().split("\n");
        let started = false;
        for (const line of lines) {
            const event = JSON.parse(line);
            if (event.run_id !== run || event.type === "run-end")
                return new Set();
            if (event.phase !== "run")
                continue;
            if (event.type === "run-start")
                started = true;
            if (started && event.type === "discovered-scope-filed" && event.data?.source === "contained"
                && typeof event.issue === "string")
                found.add(event.issue);
        }
        return found;
    }
    catch {
        return new Set();
    }
}
