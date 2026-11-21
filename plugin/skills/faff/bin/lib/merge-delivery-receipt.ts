// === region:factory — format a completed merge-gate receipt for the default ship producer ===
const argv = require("./argv");
const { readStdinCapped, VALIDATE_MAX_BYTES }: {
  readStdinCapped(limit: number): { over: true } | { over: false; text: string };
  VALIDATE_MAX_BYTES: number;
} = require("./ratified-scope");

const usage = "usage: faff merge-gate delivery-receipt --merge-exit CODE [--precondition REASON] < merge-gate.json";
const spec = { flags: { "--merge-exit": { arity: 1 }, "--precondition": { arity: 1 } } };
const preconditionReason = /^not-ready:precondition:(push|token-scope|merge-method|actions-policy)\s+[—-]\s+[^\r\n]+;\s+remedy:\s*\S[^\r\n]*$/;

type Receipt = Record<string, unknown> & { verdict: "merge-ok" | "refuse"; merged: boolean; blockers: string[] };
type Outcome = { outcome: "shipped" | "not-ready" | "failed"; reason: string; corroborated: boolean };

function isReceipt(value: unknown): value is Receipt {
  return value !== null && typeof value === "object" &&
    "verdict" in value && (value.verdict === "merge-ok" || value.verdict === "refuse") &&
    "merged" in value && typeof value.merged === "boolean" &&
    "blockers" in value && Array.isArray(value.blockers) && value.blockers.every((b) => typeof b === "string");
}

function readReceipt(): Receipt | null {
  try {
    const raw = readStdinCapped(VALIDATE_MAX_BYTES);
    if (raw.over) return null;
    const body: unknown = JSON.parse(raw.text);
    return isReceipt(body) ? body : null;
  } catch {
    return null;
  }
}

function delivery(receipt: Receipt | null, exit: number, precondition: string | undefined): Outcome {
  if (receipt && exit === 0 && receipt.verdict === "merge-ok" && receipt.merged) {
    return { outcome: "shipped", reason: "", corroborated: true };
  }
  const rejected = receipt?.verdict === "refuse" && receipt.merged === false &&
    receipt.post_merge_state === "OPEN" && receipt.blockers.some((line) => line.startsWith("gh pr merge rejected:"));
  if (exit === 1 && rejected && precondition !== undefined) {
    return { outcome: "not-ready", reason: precondition, corroborated: false };
  }
  const reason = receipt === null ? "merge receipt unavailable" :
    receipt.blockers.find((line) => line.trim()) ?? "merge not confirmed by the receipt";
  return { outcome: "failed", reason, corroborated: false };
}

export function cmdDeliveryReceipt(args: string[]): number {
  const { values, errors } = argv.parseArgs(args, spec);
  if (errors.length) return argv.usageError(errors, usage);
  const code = values["--merge-exit"];
  const reason = values["--precondition"];
  if (typeof code !== "string" || !/^\d+$/.test(code) || Number(code) > 255 ||
      (reason !== undefined && (typeof reason !== "string" || !preconditionReason.test(reason)))) {
    process.stderr.write(usage + "\n");
    return 2;
  }

  const receipt = readReceipt();
  const outcome = delivery(receipt, Number(code), reason);
  process.stdout.write(`merge-gate exit: ${Number(code)}\n`);
  if (receipt) process.stdout.write(JSON.stringify(receipt) + "\n");
  process.stdout.write("```faff-contract:delivery-outcome\n" + JSON.stringify(outcome) + "\n```\n");
  return 0;
}
