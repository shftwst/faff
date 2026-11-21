"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmdWaveMode = cmdWaveMode;
// === region:factory — select convergence mode for a concrete run ===
const { parseArgs, usageError } = require("./argv");
const { findRoot, readLedger } = require("./shared-infra");
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
        console.log(JSON.stringify({ fold, consult }));
        return 0;
    }
    catch (error) {
        process.stderr.write("faff run wave-mode: " + (error instanceof Error ? error.message : String(error)) + "\n");
        return 2;
    }
}
