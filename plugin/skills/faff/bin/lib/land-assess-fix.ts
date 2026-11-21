// === region:factory — classify a landing fix from the observations on either side of it ===
import { readFileSync } from "node:fs";

const { parseArgs } = require("./argv");
const usage = "faff land assess-fix --mode shadow|unattended --before FILE [--pushed SHA --after FILE]";
const flags = { "--mode": { arity: 1 }, "--before": { arity: 1 }, "--pushed": { arity: 1 }, "--after": { arity: 1 } };
export type FixObservation = Record<string, unknown>;

export function readFixObservation(file: string): FixObservation {
  const row: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof row !== "object" || row === null || !("issue" in row) || typeof row.issue !== "string" || !row.issue ||
      !("pr" in row) || typeof row.pr !== "number" || !Number.isSafeInteger(row.pr) || row.pr <= 0 || !("token" in row)) {
    throw new Error("expected a land --json observation with an issue and PR");
  }
  return { ...row };
}

export function observedFailingChecks(runs: unknown, head: string): string[] | null {
  if (!Array.isArray(runs)) return null;
  for (const row of runs) {
    if (!row || row.head_sha !== head || typeof row.name !== "string" || !row.name || typeof row.status !== "string") return null;
    if (row.status === "completed" && typeof row.conclusion !== "string") return null;
  }
  const { failingCheckNames } = require("./ci-triage");
  return [...new Set<string>(failingCheckNames(runs))].sort();
}

export function failedChecks(row: FixObservation): string[] {
  const names = row.failing_checks;
  if (!Array.isArray(names) || !names.length || !names.every((name): name is string => typeof name === "string" && name.length > 0)) {
    throw new Error("missing failing checks for the regression head; capture land --json --fix-checks");
  }
  return [...new Set(names)].sort();
}

export function assessLandingFix(mode: string, before: FixObservation, pushed: string | undefined, after: FixObservation | null, sameCheck?: (name: string) => boolean) {
  if (mode !== "shadow" && mode !== "unattended") throw new Error(usage);
  const kind = before.reason;
  if (before.token !== "needs-fix" || (kind !== "conflict" && kind !== "regression") || typeof before.head_sha !== "string" || !before.head_sha) {
    throw new Error("the before observation must be a fixable conflict or regression on a known head");
  }
  const previous = kind === "conflict" ? [] : failedChecks(before);
  if (!after) return { action: "record-failed", kind, head_sha: before.head_sha, failing_checks: previous };
  if (before.issue !== after.issue || before.pr !== after.pr) throw new Error("observations refer to different issues or PRs");
  if (after.token === "pending") return { action: "observe-again" };
  if (after.token === "landing-resumable") return { action: "landing-resumable" };
  if (after.token === "errored") throw new Error("land observation errored");
  if (after.head_sha !== pushed) throw new Error("terminal observation is not on the pushed head");
  switch (after.token) {
    case "needs-fix": {
      if (after.reason !== "regression" && after.reason !== "conflict") throw new Error("unknown fix reason");
      if (after.reason !== kind) break;
      const failing = kind === "regression" ? failedChecks(after) : [];
      if (kind === "conflict" || failing.some(sameCheck ?? (name => previous.includes(name)))) {
        return { action: "record-failed", kind, head_sha: pushed, failing_checks: failing };
      }
      break;
    }
    case "ready":
    case "needs-judgement":
    case "leave-for-human":
      break;
    default: throw new Error("expected a terminal land token, pending or landing-resumable");
  }
  return { action: mode === "shadow" ? "park-shadow" : "continue" };
}

export function cmdLandAssessFix(args: string[]): number {
  const { values, errors } = parseArgs(args, { flags, positionals: { min: 0, max: 0 } });
  try {
    if (errors.length || !values["--before"] || !values["--mode"] || Boolean(values["--pushed"]) !== Boolean(values["--after"])) throw new Error(usage);
    const before = readFixObservation(values["--before"]);
    const after = values["--after"] ? readFixObservation(values["--after"]) : null;
    const result = assessLandingFix(values["--mode"], before, values["--pushed"], after);
    process.stdout.write(JSON.stringify(result) + "\n");
    return 0;
  } catch (error) {
    process.stderr.write("land assess-fix: " + (error instanceof Error ? error.message : "invalid observation") + "\n");
    return 2;
  }
}
