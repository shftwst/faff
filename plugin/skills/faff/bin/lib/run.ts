// ===========================================================================
// === region:factory — run — FAFF-1435: the `faff run` verb dispatcher ===
//
// `faff run <verb>` groups the run-lifecycle commands that move beep-boop's run bracket from prose
// into code. It registers `summary` (FAFF-1435), `checkpoint` (FAFF-1436), and `open` and `close`
// (FAFF-1437) and `trigger` (FAFF-1418). An unknown or missing verb exits 2 with a usage line naming the registered verbs.
// ===========================================================================

interface RunSummaryApi {
  cmdRunSummary(args: string[]): number;
}
interface RunCheckpointApi {
  cmdRunCheckpoint(args: string[]): number;
}
interface RunOpenApi {
  cmdRunOpen(args: string[]): number;
}
interface RunCloseApi {
  cmdRunClose(args: string[]): number;
}
interface RunTriggerApi {
  cmdRunTrigger(args: string[]): number;
}

const runSummary: RunSummaryApi = require("./run-summary");
const runCheckpoint: RunCheckpointApi = require("./run-checkpoint");
const runOpen: RunOpenApi = require("./run-open");
const runClose: RunCloseApi = require("./run-close");
const runTrigger: RunTriggerApi = require("./run-trigger");

const VERBS: { [verb: string]: (args: string[]) => number } = {
  summary: (args) => runSummary.cmdRunSummary(args),
  checkpoint: (args) => runCheckpoint.cmdRunCheckpoint(args),
  open: (args) => runOpen.cmdRunOpen(args),
  close: (args) => runClose.cmdRunClose(args),
  trigger: (args) => runTrigger.cmdRunTrigger(args),
};

const RUN_USAGE = `usage: faff run <verb> [args...] — registered verbs: ${Object.keys(VERBS).join(", ")}`;

function cmdRun(args: string[]): number {
  const verb = args[0];
  const handler = verb === undefined ? undefined : VERBS[verb];
  if (handler === undefined) {
    process.stderr.write(`faff run: ${verb === undefined ? "missing verb" : `unknown verb '${verb}'`}\n${RUN_USAGE}\n`);
    return 2;
  }
  return handler(args.slice(1));
}

module.exports = { cmdRun, RUN_USAGE };
