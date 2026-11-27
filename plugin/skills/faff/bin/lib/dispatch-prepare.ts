// === region:factory — prepare one build worker handoff from an ordered partition unit ===
const { parseArgs, usageError } = require("./argv");
const { readStdinCapped, VALIDATE_MAX_BYTES } = require("./ratified-scope");

const usage = "usage: faff dispatch prepare-build --executor sequential|parallel [--root DIR] < unit.json";
const spec = {
  flags: { "--executor": { arity: 1, enum: ["sequential", "parallel"] }, "--root": { arity: 1 } },
  positionals: { min: 0, max: 0 },
};
type ResolveBuild = (root: string | undefined, tier: string | null, confidence: string | null) =>
  { model: string; effort: string } | { error: string };

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(field + " must be a nonempty string");
  return value;
}

function rating(value: unknown, field: string): string | null {
  return value == null ? null : requiredText(value, field).trim().toLowerCase();
}

function prepareBuild(unit: unknown, executor: string, root: string | undefined, resolve: ResolveBuild) {
  if (!object(unit) || !Array.isArray(unit.members) || !unit.members.length) throw new Error("expected a nonempty members array");
  if ("constraints" in unit) throw new Error("attach constraints only after the executor verifies the correction");
  const run_id = requiredText(unit.run_id, "run_id");
  const run_dir = requiredText(unit.run_dir, "run_dir");
  const session_id = requiredText(unit.session_id, "session_id");
  const issues = new Set<string>();
  const tiers = ["mechanical", "standard", "complex"];
  const confidences = ["high", "medium"];
  let tier: string | null = null;
  let confidence: string | null = null;
  for (const member of unit.members) {
    if (!object(member)) throw new Error("expected a partition member with an issue");
    const issue = requiredText(member.issue, "member.issue");
    if (issues.has(issue)) throw new Error("duplicate issue " + issue);
    issues.add(issue);
    const nativeTier = rating(member["build-tier"], "build-tier");
    const suppliedTier = rating(member.tier, "tier");
    if (nativeTier && suppliedTier && nativeTier !== suppliedTier) throw new Error("conflicting tier fields for " + issue);
    const t = nativeTier ?? suppliedTier;
    // An explicitly unrecognised tier still consults by_tier.default in dispatch resolve.
    if (t && (!tier || tiers.indexOf(t) > tiers.indexOf(tier))) tier = t;
    const c = rating(member.confidence, "confidence");
    if (c && confidences.includes(c) && (!confidence || confidences.indexOf(c) > confidences.indexOf(confidence))) confidence = c;
  }
  const wave = unit.wave;
  if (wave !== undefined && (typeof wave !== "number" || !Number.isSafeInteger(wave) || wave < 1)) {
    throw new Error("wave must be a positive safe integer");
  }
  const resolved = resolve(root, tier, confidence);
  if ("error" in resolved) throw new Error(resolved.error);
  return {
    ...(wave === undefined ? {} : { description_tag: "faff-build-wave:" + wave }),
    dispatch: { issues: [...issues], run_id, run_dir, session_id, mode_signal: "autonomous", model: resolved.model },
    agent_parameters: { run_in_background: executor === "parallel", ...(resolved.model === "inherit" ? {} : { model: resolved.model }) },
    effort_log: resolved.effort,
  };
}

export function cmdPrepareBuild(args: string[], resolve: ResolveBuild): number {
  const { values, errors } = parseArgs(args, spec);
  if (errors.length || !values["--executor"]) return usageError(errors, usage);
  try {
    const input = readStdinCapped(VALIDATE_MAX_BYTES);
    if (input.over) throw new Error("unit exceeds one MiB");
    const unit: unknown = JSON.parse(input.text);
    const prepared = prepareBuild(unit, values["--executor"], values["--root"], resolve);
    process.stdout.write(JSON.stringify(prepared) + "\n");
    return 0;
  } catch (err) {
    process.stderr.write("faff dispatch prepare-build: " + (err instanceof Error ? err.message : String(err)) + "\n");
    return 2;
  }
}
