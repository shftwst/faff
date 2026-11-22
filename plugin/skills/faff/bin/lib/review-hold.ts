// === region:factory — prepare a recoverable pre-PR build review hold ===
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

const { parseArgs } = require("./argv");
const config: {
  DEFAULTS: Record<string, string>;
  loadConfig(root: string): [unknown, ...unknown[]];
} = require("./config-core");
const infra: {
  dig(value: unknown, field: string): unknown;
  findRoot(): string;
} = require("./shared-infra");
const effects: {
  reviewProgressApplyOutageRetry(existing: Record<string, unknown>, issue: string, at: string): Record<string, unknown>;
} = require("./effects");

type Cause = "review-outage" | "build-review-dialogue";
type Prepared = { run_key: string; number: number; limit: number };
type Prior = {
  cause: Cause;
  dialogue?: { hold_count: number; fix_rounds_used: number; rebuttal_rounds_used: number };
  prepared?: Prepared;
};
type Receipt =
  | { action: "park"; reason: string; signal: "unavailable" | "needs-human"; clear_store: boolean }
  | { action: "stale"; reason: string }
  | { action: "hold"; role: "awaiting-review" | "awaiting-adjudication"; token: "retry-later" | "built-but-not-admitted"; notice: string };
type Plan = { stop: Receipt } | { prepared: Prepared } | {
  prepared: Prepared;
  sourceReview: Record<string, unknown>;
  reviewProgress: Record<string, unknown>;
};
type Stash = (input: {
  runDir: string;
  issue: string;
  cause: Cause;
  fixRoundsUsed: number | null;
  rebuttalRoundsUsed: number | null;
  storeRoot: string;
  prepare(input: { prior: Prior | null; src: string; dst: string }): Plan;
}) => { code: number; record?: Prior; plan?: Receipt; message?: string };

const usage = "faff resume-store prepare-hold --run-dir DIR --issue ID --cause review-outage|build-review-dialogue --mode interactive|autonomous [--resumed] [--fix-rounds-used N --rebuttal-rounds-used N] [--store-root DIR] [--root DIR]";
const flags = {
  "--run-dir": { arity: 1 }, "--issue": { arity: 1 }, "--cause": { arity: 1 }, "--mode": { arity: 1 },
  "--resumed": { arity: 0 }, "--fix-rounds-used": { arity: 1 }, "--rebuttal-rounds-used": { arity: 1 },
  "--store-root": { arity: 1 }, "--root": { arity: 1 },
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readCheckpoint(file: string): Record<string, unknown> | null {
  let raw: string;
  try {
    if (!lstatSync(file).isFile()) throw new Error(`expected a regular file at ${file}`);
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if (record(error) && error.code === "ENOENT") return null;
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!record(parsed)) throw new Error(`invalid checkpoint at ${file}`);
  return parsed;
}

function count(raw: unknown, label: string): number {
  if ((typeof raw !== "number" && typeof raw !== "string") || !/^\d+$/.test(String(raw)) ||
      !Number.isSafeInteger(Number(raw))) throw new Error(`${label} must be a non-negative safe integer`);
  return Number(raw);
}

function outageRetries(progress: Record<string, unknown> | null, issue: string): number {
  if (!progress) return 0;
  if (progress.issue !== issue) throw new Error("review progress belongs to another issue");
  return progress.outage_retries === undefined ? 0 : count(progress.outage_retries, "outage_retries");
}

function completedBuild(file: string, issue: string): boolean {
  const checkpoint = readCheckpoint(file);
  const build = checkpoint?.build;
  return checkpoint?.issue === issue && record(build) && build.status === "complete" &&
    typeof build.branch === "string" && build.branch !== "" && typeof build.diff_hash === "string" && build.diff_hash !== "";
}

function hold(cause: Cause, { number, limit }: Prepared): Receipt {
  if (cause === "review-outage") return {
    action: "hold", role: "awaiting-review", token: "retry-later",
    notice: `provider unavailable; build held; attempt ${number}/${limit}; auto-resumes next drain`,
  };
  return {
    action: "hold", role: "awaiting-adjudication", token: "built-but-not-admitted",
    notice: `build-review dialogue pending; held (${number}/${limit}); auto-resumes next drain`,
  };
}

function park(cause: Cause, reason: string, clearStore = true): Receipt {
  return { action: "park", reason, signal: cause === "review-outage" ? "unavailable" : "needs-human", clear_store: clearStore };
}

function emit(receipt: Receipt): number {
  process.stdout.write(JSON.stringify(receipt) + "\n");
  return 0;
}

export function cmdPrepareReviewHold(args: string[], stash: Stash, parentFile: string): number {
  try {
    const { values, errors } = parseArgs(args, { flags, positionals: { min: 0, max: 0 } });
    const issue = values["--issue"], suppliedDir = values["--run-dir"], cause = values["--cause"], mode = values["--mode"];
    if (errors.length || typeof issue !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(issue) || issue.includes("..") ||
        typeof suppliedDir !== "string" || !suppliedDir || (cause !== "review-outage" && cause !== "build-review-dialogue") ||
        (mode !== "autonomous" && mode !== "interactive")) throw new Error(usage);
    const fix = values["--fix-rounds-used"], rebuttal = values["--rebuttal-rounds-used"];
    if ((fix === undefined) !== (rebuttal === undefined)) throw new Error("supply both dialogue counters together");
    const fixRoundsUsed = fix === undefined ? null : count(fix, "--fix-rounds-used");
    const rebuttalRoundsUsed = rebuttal === undefined ? null : count(rebuttal, "--rebuttal-rounds-used");
    if (mode === "interactive") return emit(park(cause, "interactive-review", false));

    const root = resolve(values["--root"] ?? infra.findRoot());
    const runDir = realpathSync(suppliedDir);
    const storeRoot = resolve(values["--store-root"] ?? join(root, ".faff", "resume"));
    if (storeRoot === runDir) throw new Error("resume store and source run directory must be distinct");
    const runKey = createHash("sha256").update(runDir).digest("hex");
    const stale = (reason: string): Plan => ({ stop: { action: "stale", reason } });
    const result = stash({
      runDir, issue, cause, fixRoundsUsed, rebuttalRoundsUsed, storeRoot,
      prepare({ prior, src, dst }): Plan {
        if (prior?.prepared?.run_key === runKey) {
          if (prior.cause !== cause || (prior.dialogue &&
              (prior.dialogue.fix_rounds_used !== fixRoundsUsed || prior.dialogue.rebuttal_rounds_used !== rebuttalRoundsUsed))) {
            return stale("hold already prepared with different inputs");
          }
          if (!completedBuild(join(dst, "build-progress.json"), issue)) {
            return { stop: park(cause, "published-build-checkpoint-missing") };
          }
          if (cause === "review-outage" &&
              outageRetries(readCheckpoint(join(dst, "review-progress.json")), issue) !== prior.prepared.number) {
            return { stop: park(cause, "published-outage-counter-missing-or-changed") };
          }
          return { stop: hold(cause, prior.prepared) };
        }

        const parent = readCheckpoint(join(src, parentFile));
        if (parent && (parent.issue !== issue || typeof parent.run_key !== "string")) {
          throw new Error("invalid restored hold binding");
        }
        const storedBuild = !prior && (parent || values["--resumed"])
          ? readCheckpoint(join(dst, "build-progress.json")) : null;
        if ((parent || values["--resumed"]) && !prior && !storedBuild) {
          return { stop: park(cause, "resumed-hold-missing") };
        }
        if ((parent || prior?.prepared) && parent?.run_key !== prior?.prepared?.run_key) {
          return stale("the restored hold has been superseded or was never restored into this run");
        }
        if (readCheckpoint(join(src, "review-verdict.json"))) {
          return { stop: park(cause, "terminal-review-verdict-present", false) };
        }

        if (!completedBuild(join(src, "build-progress.json"), issue)) {
          return { stop: park(cause, "no-build-checkpoint") };
        }
        const existing = readCheckpoint(join(src, "review-progress.json"));
        const retries = outageRetries(existing, issue);
        if (prior?.prepared) {
          const carried = readCheckpoint(join(dst, "review-progress.json"));
          if (outageRetries(carried, issue) !== retries) return stale("restored outage counter disagrees with the current hold");
        }
        const key = cause === "review-outage" ? "graft.review_outage_retry_limit" : "graft.build_review_hold_limit";
        const [data] = config.loadConfig(root);
        const limit = count(infra.dig(data, key) ?? config.DEFAULTS[key], key);
        const used = cause === "review-outage" ? retries : prior?.dialogue?.hold_count ?? 0;
        if (used >= limit) return { stop: park(cause, cause === "review-outage" ? "review-outage-retries-exhausted" : "build-review-holds-exhausted") };
        const prepared = { run_key: runKey, number: used + 1, limit };
        if (cause === "build-review-dialogue") return { prepared };
        if (!existing) return { stop: park(cause, "no-review-checkpoint") };
        return { prepared, sourceReview: existing, reviewProgress: effects.reviewProgressApplyOutageRetry(existing, issue, new Date().toISOString()) };
      },
    });
    if (result.message) process.stderr.write(`faff resume-store prepare-hold: ${result.message}\n`);
    if (result.code !== 0) return result.code;
    if (result.plan) return emit(result.plan);
    if (!result.record?.prepared) throw new Error("stash returned no prepared receipt");
    return emit(hold(cause, result.record.prepared));
  } catch (error) {
    process.stderr.write("faff resume-store prepare-hold: " + (error instanceof Error ? error.message : "invalid hold") + "\n");
    return 2;
  }
}
