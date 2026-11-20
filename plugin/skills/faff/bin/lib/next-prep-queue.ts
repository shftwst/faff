// === region:factory — apply the existing eligibility and next kernels to a scoped prep batch ===
const argv = require("./argv");
const { findRoot } = require("./shared-infra");
const { readStdinCapped, VALIDATE_MAX_BYTES }: {
  readStdinCapped(limit: number): { over: true } | { over: false; text: string };
  VALIDATE_MAX_BYTES: number;
} = require("./ratified-scope");
const config: {
  resolveLabelPrefix(root: string): { prefix?: string; error?: string };
  resolveControlLabels(root: string): { names?: Record<string, string>; error?: string };
} = require("./config");
const eligible: {
  automationEligible(labels: string[], automationDefault: string, trackerPresent: boolean): boolean;
  normalizeEligibilityLabels(labels: string[], prefix: string, automateName?: string): string[];
} = require("./eligible");
type NextStep = (input: {
  status: string;
  spec: string;
  eligible: boolean;
  blocked: boolean;
  parked: boolean;
  ifEligible: boolean;
  awaitingSpecReview: boolean;
}) => [string, string];

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((label) => typeof label === "string");
}

function prepQueue(input: unknown, prefix: string, names: Record<string, string>, nextStep: NextStep): string[] {
  if (!object(input) || input.complete !== true || !Array.isArray(input.issues)) {
    throw new Error("expected complete:true and an ordered issues array");
  }
  const ids = new Set<string>();
  const prep: string[] = [];
  const name = (role: string) => names[role] ?? `${prefix}-${role}`;
  const automate = name("automate");
  const parked = name("parked");
  const awaitingReview = name("awaiting-spec-review");
  for (const [index, row] of input.issues.entries()) {
    if (!object(row) || typeof row.id !== "string" || row.id === "" || row.id !== row.id.trim() ||
        typeof row.status !== "string" || typeof row.spec !== "string" ||
        !strings(row.labels) || typeof row.blocked !== "boolean" ||
        (row.awaiting_spec_review !== undefined && typeof row.awaiting_spec_review !== "boolean")) {
      throw new Error(`issues[${index}] has missing or invalid routing facts`);
    }
    const key = row.id.toLowerCase();
    if (ids.has(key)) throw new Error(`duplicate issue at issues[${index}]`);
    ids.add(key);

    const normal = eligible.normalizeEligibilityLabels(row.labels, prefix, automate);
    const [step, reason] = nextStep({
      status: row.status, spec: row.spec, blocked: row.blocked,
      eligible: eligible.automationEligible(normal, "opt-in", true),
      parked: row.labels.includes(parked), ifEligible: false,
      awaitingSpecReview: row.labels.includes(awaitingReview) || row.awaiting_spec_review === true,
    });
    if (step === "error") throw new Error(`issues[${index}]: ${reason}`);

    // The scope is the prep pass's unstarted and explicitly nominated stale Todo work.
    if (step === "prep" && !row.blocked && (row.status === "backlog" || row.status === "todo")) {
      prep.push(row.id);
    }
  }
  return prep;
}

const usage = "usage: faff next prep-queue [--root DIR] < facts.json";
const spec = { flags: { "--root": { arity: 1 } }, positionals: { min: 0, max: 0 } };

function cmdPrepQueue(args: string[], nextStep: NextStep): number {
  const { values, errors } = argv.parseArgs(args, spec);
  if (errors.length) return argv.usageError(errors, usage);
  try {
    const root = values["--root"] ?? findRoot();
    const prefix = config.resolveLabelPrefix(root);
    const labels = config.resolveControlLabels(root);
    if (prefix.prefix === undefined || labels.names === undefined) {
      throw new Error(prefix.error ?? labels.error ?? "control labels could not be resolved");
    }
    const raw = readStdinCapped(VALIDATE_MAX_BYTES);
    if (raw.over) throw new Error("facts exceed one MiB");
    const input: unknown = JSON.parse(raw.text);
    process.stdout.write(JSON.stringify({ prep: prepQueue(input, prefix.prefix, labels.names, nextStep) }) + "\n");
    return 0;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`faff next prep-queue: ${reason}\n`);
    return 2;
  }
}

module.exports = { cmdPrepQueue };
