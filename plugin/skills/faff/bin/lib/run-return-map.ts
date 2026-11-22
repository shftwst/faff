// === region:factory — run-return-map: classify reconciled graft returns without effects ===
const argv: {
  parseArgs(args: string[], spec: unknown): { values: Record<string, unknown>; errors: unknown[] };
  usageError(errors: unknown[], usage: string): number;
} = require("./argv");

type Bucket = "shipped" | "superseded" | "pr-open" | "parked" | "errored";
type Annotation = "review_outage_pending" | "build_review_dialogue_pending" | "landing_resumable";
type ReturnPlan =
  | { action: "terminal"; bucket: Bucket; annotation: Annotation | null }
  | { action: "merge-handoff" | "pre-admission"; bucket: null; annotation: null };

function terminal(bucket: Bucket, annotation: Annotation | null = null): ReturnPlan {
  return { action: "terminal", bucket, annotation };
}

const preAdmission: ReturnPlan = { action: "pre-admission", bucket: null, annotation: null };
const returns = new Map<string, ReturnPlan>([
  ["shipped", terminal("shipped")],
  ["superseded-done", terminal("superseded")],
  ["pr-open-for-human", terminal("pr-open")],
  ["needs-human", terminal("parked")],
  ["retry-later", terminal("parked", "review_outage_pending")],
  ["built-but-not-admitted", terminal("parked", "build_review_dialogue_pending")],
  ["landing-resumable", terminal("pr-open", "landing_resumable")],
  ["parked", terminal("parked")],
  ["errored", terminal("errored")],
  ["pr-ready", { action: "merge-handoff", bucket: null, annotation: null }],
  ["ineligible", preAdmission],
  ["blocked", preAdmission],
  ["inadmissible", preAdmission],
  ["claimed-by-peer", preAdmission],
]);

export function cmdRunReturnMap(args: string[]): number {
  const usage = "usage: faff run return-map --outcome TOKEN";
  const { values, errors } = argv.parseArgs(args, { flags: { "--outcome": { arity: 1, enum: [...returns.keys()] } } });
  if (errors.length) return argv.usageError(errors, usage);
  const token = values["--outcome"];
  const plan = typeof token === "string" ? returns.get(token) : undefined;
  if (plan === undefined) return argv.usageError([{ code: "missing-flag", detail: "--outcome is required" }], usage);
  process.stdout.write(JSON.stringify(plan) + "\n");
  return 0;
}
