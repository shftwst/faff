// === region:factory — run a complete bundled spec-review lens batch ===
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { validLensSet, type ReviewOutput } from "./spec-review-results.ts";

const { parseArgs, usageError } = require("./argv");
const { SPEC_REVIEW_LENSES } = require("./review-vocab");
const { nextRoundNumber } = require("./spec-review-window");
const { readGovernanceConfig } = require("./budget");
const { heartbeatStaleSecs } = require("./runcheck");
const { sentryThresholds } = require("./sentry");
const { dig, findRoot } = require("./shared-infra");
const { DEFAULTS, fmt, loadConfig } = require("./config");
const { specReviewDir } = require("./spec-review-pin");
const { cmdInflightcheck } = require("./inflightcheck");
const { runRound, withRoundLock } = require("./spec-review-round");
const { DEFAULT_RENEWAL_SECS, defaultHeartbeatTick, makeLease, withHeartbeatRenewal } = require("./supervisor");
const usage = "usage: faff spec-review dispatch --dir DIR --spec FILE [--enabled-lenses CSV | --retry-lenses CSV] [--context FILE]... [--root DIR] [--turn-budget-secs SECONDS] [--run-dir DIR] [--record-round interactive|autonomous --issue ID]";
const flags = {
  "--record-round": { arity: 1, enum: ["interactive", "autonomous"] }, "--issue": { arity: 1 },
  "--dir": { arity: 1 }, "--spec": { arity: 1 }, "--context": { arity: 1, repeatable: true },
  "--enabled-lenses": { arity: 1 }, "--retry-lenses": { arity: 1 }, "--run-dir": { arity: 1 }, "--root": { arity: 1 }, "--turn-budget-secs": { arity: 1 },
};

type Outcome = { status: string; innerExit: number | null; signal: string | null };
type Target = { deadlineSec: number | null; graceSec: number; target: string[] };
type RunKillable = (target: Target, deps: {
  spawnFn: (cmd: string, args: string[], options: { detached: boolean }) => ReturnType<typeof spawn>;
  onSignal: (sig: NodeJS.Signals, handler: () => void) => void;
}) => Promise<Outcome>;

async function runFanOut(args: string[], out: number, seconds: number | undefined, runDir: string | undefined, supervise: RunKillable): Promise<Outcome> {
  const stdio: ["ignore", number, "inherit"] = ["ignore", out, "inherit"];
  const handlers = new Map<NodeJS.Signals, () => void>();
  try {
    const wait = () => supervise({ deadlineSec: seconds ?? null, graceSec: 0, target: [process.execPath, ...args] }, {
      spawnFn: (cmd, argv, options) => spawn(cmd, argv, { ...options, stdio }),
      onSignal: (sig, handler) => { handlers.set(sig, handler); process.on(sig, handler); },
    });
    if (!runDir || seconds === undefined) return await wait();
    const config = readGovernanceConfig(findRoot(runDir));
    const stall = sentryThresholds(config).stall_window_secs;
    const producerMax = Number(config.producer_tick_max_secs);
    const renewalSecs = Math.min(DEFAULT_RENEWAL_SECS, stall / 3, heartbeatStaleSecs() / 3,
      producerMax > 0 ? producerMax : DEFAULT_RENEWAL_SECS);
    const lease = makeLease({ name: "spec-review", run_dir: runDir, deadline_secs: seconds });
    defaultHeartbeatTick(runDir);
    return await withHeartbeatRenewal(lease, wait, { renewalSecs });
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}

type Recorder = (args: string[], enabledLenses: string[], retainVotes?: (entries: unknown[]) => string | void, consume?: ReviewOutput) => number;
type Finish = (round: number, recordArgs: string[], retainVotes?: (entries: unknown[]) => string) => number;

export async function cmdDispatch(argv: string[], faff: string, fanOut: string, supervise: RunKillable, recorder: Recorder): Promise<number> {
  const { values, errors } = parseArgs(argv, { flags, positionals: { min: 0, max: 0 } });
  const dir: string = values["--dir"], spec: string = values["--spec"];
  if (errors.length) return usageError(errors, usage);
  const mode = values["--record-round"];
  let budget = values["--turn-budget-secs"];
  if (mode && budget === undefined) {
    const key = "prep.spec_review_turn_budget_secs";
    const [config] = loadConfig(values["--root"] ?? findRoot());
    budget = fmt(dig(config, key) ?? DEFAULTS[key]);
  }
  const seconds = budget === undefined ? undefined : Number(budget);
  if (!dir || !spec || (seconds !== undefined && (!Number.isFinite(seconds) || seconds <= 0 || seconds * 1000 > 2147483647))) {
    return usageError([{ code: "bad-value", detail: "provide a directory, spec, and a valid positive budget when supplied" }], usage);
  }
  const runDir: string | undefined = values["--run-dir"];
  if (runDir !== undefined && (!runDir || seconds === undefined || !existsSync(join(runDir, "run-ledger.json")) ||
      resolve(dir) !== resolve(specReviewDir(basename(dirname(resolve(dir))), runDir)))) {
    return usageError([{ code: "bad-value", detail: "--run-dir requires its own issue/spec-review directory, run ledger and a turn budget" }], usage);
  }
  const retry: string | undefined = values["--retry-lenses"];
  if (retry !== undefined && values["--enabled-lenses"] !== undefined) {
    return usageError([{ code: "bad-value", detail: "choose a fresh selection or a retry subset" }], usage);
  }
  const lenses: string[] = (retry ?? values["--enabled-lenses"])?.split(",").map((lens: string) => lens.trim()) ?? SPEC_REVIEW_LENSES;
  if (!validLensSet(lenses)) {
    return usageError([{ code: "bad-value", detail: "select a nonempty, distinct set of review lenses" }], usage);
  }
  const args = ["--dir", dir, "--spec", spec, "--lenses", lenses.join(",")];
  for (const file of values["--context"] ?? []) args.push("--context", file);
  if (values["--root"]) args.push("--root", values["--root"]);
  const issue = values["--issue"];
  if (mode === undefined && issue === undefined) {
    return dispatchBatch(args, dir, lenses, seconds, runDir, retry !== undefined, faff, fanOut, supervise,
      (_round, recordArgs, retainVotes) => recorder(recordArgs, lenses, retainVotes));
  }
  const root = values["--root"] ?? findRoot();
  if (!mode || typeof issue !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(issue) ||
      retry !== undefined || seconds === undefined || (!runDir && process.env.FAFF_RUN_DIR) ||
      resolve(dir) !== (runDir ? resolve(specReviewDir(issue, runDir)) : resolve(root, specReviewDir(issue)))) {
    return usageError([{ code: "bad-value", detail: "--record-round requires a fresh bounded selection, its --issue and its spec-review directory; pass the exact --run-dir under a run" }], usage);
  }

  // A prep dispatch for the same issue can already have its own marker in this owner's scope.
  const marker = ["--root", root, "--key", `spec-review.${issue}.${process.pid}`];
  const owner = runDir ? { ...process.env, FAFF_RUN_DIR: runDir } : process.env;
  const opened = cmdInflightcheck(["--open", ...marker, "--describe", "spec-review"], owner);
  if (opened !== 0) return opened;
  try {
    const finish: Finish = (round, recordArgs, retainVotes) => withRoundLock(dir, () => {
      if (nextRoundNumber(dir) !== round) {
        process.stderr.write(`spec-review dispatch: another caller advanced round ${round}; this batch was not recorded\n`);
        return 2;
      }
      let retryFile: string | undefined;
      const saveVotes = retainVotes && ((entries: unknown[]) => { retryFile = retainVotes(entries); });
      return recorder(recordArgs, lenses, saveVotes, (verdictText, served) => {
        const decision = runRound({
          issue, dir, verdictText, mode, occupant: "adversarial", served: served ? "any" : "none",
          runDir: runDir ?? null, root, appetite: null, retryLimit: null, retryEntries: retryFile,
        });
        process.stdout.write(JSON.stringify(decision) + "\n");
      });
    });
    return await dispatchBatch(args, dir, lenses, seconds, runDir, false, faff, fanOut, supervise, finish);
  } finally {
    cmdInflightcheck(["--close", ...marker], owner);
  }
}

async function dispatchBatch(args: string[], dir: string, lenses: string[], seconds: number | undefined,
  runDir: string | undefined, retry: boolean, faff: string, fanOut: string, supervise: RunKillable, finish: Finish): Promise<number> {
  const prepared = spawnSync(process.execPath, [faff, "spec-review", "prepare-requests", ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
  });
  if (prepared.error || prepared.signal) throw prepared.error ?? new Error("request preparation interrupted");
  let descriptor;
  try { descriptor = JSON.parse(prepared.stdout); } catch { /* Use the ordinary no-results path. */ }
  const round = Number.isSafeInteger(descriptor?.round) && descriptor.round > 0 ? descriptor.round : nextRoundNumber(dir);
  const recordArgs = ["--dir", dir, "--round", String(round)];
  if (retry) recordArgs.push("--receipts-only");
  const noResults = () => {
    const code = finish(round, [...recordArgs, "--no-results"]);
    if (!code) process.stderr.write(`spec-review: served 0/${lenses.length} lenses\n`);
    return code;
  };
  if (prepared.status !== 0 || typeof descriptor?.requests_path !== "string" ||
      typeof descriptor.backends_path !== "string" || typeof descriptor.strategy !== "string") return noResults();

  // prepare-requests owns this private scratch directory. Both handoff files survive a recording failure.
  const scratch = dirname(descriptor.requests_path);
  const results = join(scratch, "results.json");
  let keep = true;
  try {
    process.stderr.write("spec-review dispatch: round " + round + " prepared in " + scratch + "\n");
    const fd = openSync(results, "wx", 0o600);
    let outcome;
    try {
      outcome = await runFanOut([fanOut, "--requests", descriptor.requests_path, "--strategy", descriptor.strategy], fd, seconds, runDir, supervise);
    } finally { closeSync(fd); }
    if (outcome.status === "killed-deadline" || outcome.status === "killed-abort" || outcome.signal) {
      keep = false;
      return outcome.status === "killed-deadline" ? 124 : 130;
    }
    const complete = outcome.status === "exited" && outcome.innerExit === 0;
    if (complete && readFileSync(results, "utf8").trim().length > 0) {
      let savedVotes = false;
      const status = finish(round, [...recordArgs, "--results", results, "--backends-json", descriptor.backends_path, "--strategy", descriptor.strategy], entries => {
        const votes = join(scratch, "retry-entries.json");
        writeFileSync(votes, JSON.stringify(entries) + "\n", { flag: "wx", mode: 0o600 });
        savedVotes = true;
        process.stderr.write("spec-review dispatch: carry prior lens entries from " + votes + "\n");
        return votes;
      });
      keep = status !== 0 || savedVotes;
      return status;
    }
    const status = noResults();
    keep = status !== 0;
    return status;
  } finally {
    if (keep) process.stderr.write("spec-review dispatch: retained prepared requests and results for recovery in " + scratch + "\n");
    else rmSync(scratch, { recursive: true, force: true });
  }
}
