// === region:factory — project evaluator criteria and read the writer's existing receipt ===
const argv = require("./argv");
const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const { findRoot }: { findRoot(): string } = require("./shared-infra");
const writer: {
  isSafeHoldoutKey(key: unknown): key is string;
  resolveContained(base: string, relative: string): string | null;
} = require("./holdout-record");
const contract: {
  contractHoldoutVerdict(input: unknown, options: { requireSpawnerAttested: boolean }): {
    contractData?: { aggregate: string; violations: string[]; spawner_attested?: boolean };
  };
} = require("./contract-defs-evidence");

type Criterion = { id: string; text: string; class: string; holdout: boolean; verification_tier: string };
type Classify = (text: string) => {
  criteria: Criterion[]; judged_count: number; integration_count: number; delegated_count: number;
};

const criteriaUsage = "usage: faff holdout criteria --spec FILE [--counts]";
export const HOLDOUT_CRITERIA_SPEC = { flags: { "--spec": { arity: 1 }, "--counts": { arity: 0 } } };

export function cmdHoldoutCriteria(args: string[], classify: Classify): number {
  const { values, errors } = argv.parseArgs(args, HOLDOUT_CRITERIA_SPEC);
  if (errors.length || !values["--spec"] || values["--spec"] === "-") return argv.usageError(errors, criteriaUsage);
  try {
    const source = fs.readFileSync(values["--spec"], "utf8");
    const { criteria, judged_count, integration_count, delegated_count } = classify(source);
    const result = values["--counts"] ? { judged_count, integration_count, delegated_count } : {
      criteria: criteria.filter((row) => row.verification_tier === "running-stack")
        .map(({ id, text, class: kind, holdout }) => ({
          id, text, class: kind, holdout,
          ...(kind === "prose" ? {
            verdict: "needs-human", evidence_present: false,
            reason: "prose scenario: no machine check and no delegate verifier", reason_code: "human-only",
          } : {}),
        })),
    };
    process.stdout.write(JSON.stringify(result) + "\n");
    return 0;
  } catch {
    process.stderr.write("faff holdout criteria: could not read or classify the full spec\n");
    return 2;
  }
}

type ResolveRunDir = (root: string, runDir: string) => string | null;
type Boundary = (runDir: string) => { dispatch: "absent" | "indeterminate" | "dispatched"; cage: boolean };

const receiptUsage = "usage: faff holdout receipt --key KEY --run-dir DIR --writer-exit CODE [--caged] [--root DIR]";
export const HOLDOUT_RECEIPT_SPEC = { flags: {
  "--key": { arity: 1 }, "--run-dir": { arity: 1 }, "--writer-exit": { arity: 1 }, "--caged": { arity: 0 }, "--root": { arity: 1 },
} };

function failed(reason: string): number {
  process.stdout.write(JSON.stringify({ aggregate: "needs-human", reason }) + "\n");
  return 1;
}

export function cmdHoldoutReceipt(args: string[], resolveRunDir: ResolveRunDir, boundary: Boundary): number {
  const { values, errors } = argv.parseArgs(args, HOLDOUT_RECEIPT_SPEC);
  if (errors.length) return argv.usageError(errors, receiptUsage);
  const key: unknown = values["--key"];
  const suppliedDir = values["--run-dir"];
  const exit = values["--writer-exit"];
  if (!writer.isSafeHoldoutKey(key) || !suppliedDir || typeof exit !== "string" || !/^\d+$/.test(exit)) {
    process.stderr.write(receiptUsage + "\n");
    return 2;
  }
  if (Number(exit) !== 0) return failed("writer-failed");
  try {
    const root = values["--root"] ?? findRoot();
    const runDir = resolveRunDir(root, suppliedDir);
    if (runDir === null || !fs.statSync(runDir, { throwIfNoEntry: false })?.isDirectory()) return failed("run-unavailable");
    const intent = boundary(runDir);
    if (intent.dispatch === "indeterminate") return failed("invalid-lane-boundary");
    const store = writer.resolveContained(path.join(root, ".faff", "holdout"), `${key}.json`);
    if (store === null) return failed("record-unavailable");
    const storeBytes = fs.readFileSync(store);
    const requireSpawnerAttested = values["--caged"] === true || intent.cage;
    if (requireSpawnerAttested) {
      const record = writer.resolveContained(runDir, path.join(key, "holdout.json"));
      if (record === null) return failed("record-unavailable");
      if (!storeBytes.equals(fs.readFileSync(record))) return failed("record-copies-differ");
    }
    const doc: unknown = JSON.parse(storeBytes.toString("utf8"));
    if (!doc || typeof doc !== "object" || !("issue" in doc) || doc.issue !== key) {
      return failed("record-key-mismatch");
    }
    const { contractData } = contract.contractHoldoutVerdict(doc, { requireSpawnerAttested });
    if (!contractData || contractData.violations.length !== 0) return failed("record-refused");
    process.stdout.write(JSON.stringify({ aggregate: contractData.aggregate, spawner_attested: contractData.spawner_attested === true }) + "\n");
    return 0;
  } catch {
    return failed("record-unavailable");
  }
}

