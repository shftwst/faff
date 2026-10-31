"use strict";
// ===========================================================================
// === region:factory — run — FAFF-1435: the `faff run` verb dispatcher ===
//
// `faff run <verb>` groups the run-lifecycle commands that move beep-boop's run bracket from prose
// into code. It registers `summary` (FAFF-1435) and `checkpoint` (FAFF-1436); FAFF-1437 (`open`,
// `close`) extends the verb table. An unknown or missing verb exits 2 with a usage line naming the
// registered verbs.
// ===========================================================================
Object.defineProperty(exports, "__esModule", { value: true });
const runSummary = require("./run-summary");
const runCheckpoint = require("./run-checkpoint");
const VERBS = {
    summary: (args) => runSummary.cmdRunSummary(args),
    checkpoint: (args) => runCheckpoint.cmdRunCheckpoint(args),
};
const RUN_USAGE = `usage: faff run <verb> [args...] — registered verbs: ${Object.keys(VERBS).join(", ")}`;
function cmdRun(args) {
    const verb = args[0];
    const handler = verb === undefined ? undefined : VERBS[verb];
    if (handler === undefined) {
        process.stderr.write(`faff run: ${verb === undefined ? "missing verb" : `unknown verb '${verb}'`}\n${RUN_USAGE}\n`);
        return 2;
    }
    return handler(args.slice(1));
}
module.exports = { cmdRun, RUN_USAGE };
