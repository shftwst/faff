"use strict";
// ===========================================================================
// === region:factory — run — FAFF-1435: the `faff run` verb dispatcher ===
//
// `faff run <verb>` groups the run-lifecycle commands that move beep-boop's run bracket from prose
// into code. An unknown or missing verb exits 2 with the registered verbs.
// ===========================================================================
Object.defineProperty(exports, "__esModule", { value: true });
const run_timing_1 = require("./run-timing");
const run_wave_mode_1 = require("./run-wave-mode");
const run_wave_consult_1 = require("./run-wave-consult");
const runSummary = require("./run-summary");
const runCheckpoint = require("./run-checkpoint");
const runOpen = require("./run-open");
const runClose = require("./run-close");
const runTrigger = require("./run-trigger");
const returnMap = require("./run-return-map");
const { cmdRunEntryPreflight } = require("./run-entry-preflight");
const VERBS = {
    timing: args => (0, run_timing_1.cmdTiming)(args),
    "wait-ready": args => (0, run_timing_1.cmdTiming)(args, true),
    summary: (args) => runSummary.cmdRunSummary(args),
    checkpoint: (args) => runCheckpoint.cmdRunCheckpoint(args),
    open: (args) => runOpen.cmdRunOpen(args),
    close: (args) => runClose.cmdRunClose(args),
    trigger: (args) => runTrigger.cmdRunTrigger(args),
    "return-map": (args) => returnMap.cmdRunReturnMap(args),
    reconcile: (args) => runSummary.cmdRunReconcile(args),
    preflight: cmdRunEntryPreflight,
    "wave-consult": run_wave_consult_1.cmdWaveConsult,
    "wave-mode": run_wave_mode_1.cmdWaveMode,
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
