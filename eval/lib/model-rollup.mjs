// Model-evaluation roll-up: turn per-kind results into a by-skill table, and store it.
// Pure functions plus one writer. Per-kind numbers come from the same aggregateCase/aggregateKind the
// sweep uses, so a result rebuilt from raw captures matches what a completed sweep would have printed.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aggregateCase } from "../grader.mjs";
import { aggregateKind } from "../run-evals.mjs";

const round = (x, n = 3) => (x == null ? null : Number(x.toFixed(n)));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

// Raw judgement records (the per-rep JSONL a sweep captures) -> per-kind results.
// `ignoreKinds` drops kinds a caller measured in another run (e.g. a partial first attempt).
export function perKindFromRecords(records, { ignoreKinds = [] } = {}) {
  const byCase = new Map();
  for (const r of records) {
    if (ignoreKinds.includes(r.kind)) continue;
    const key = `${r.kind}\u0000${r.case_id}`;
    if (!byCase.has(key)) byCase.set(key, { id: r.case_id, kind: r.kind, reps: [] });
    byCase.get(key).reps.push({ signature: r.signature, score: r.score, format: r.envelope?.format, graded: r.graded, tokens: 0 });
  }
  const byKind = {};
  for (const { id, kind, reps } of byCase.values()) (byKind[kind] ??= []).push({ ...aggregateCase({ id, kind }, reps), reps: reps.length });
  const perKind = {};
  for (const [kind, crs] of Object.entries(byKind)) {
    const reps = crs.map((c) => c.reps);
    perKind[kind] = {
      ...aggregateKind(crs),
      cases: crs.length,
      reps: reps.reduce((s, x) => s + x, 0),
      min_reps_per_case: Math.min(...reps),
      errored: crs.reduce((s, c) => s + c.errored, 0),
    };
  }
  return perKind;
}

// Merge per-kind results from several lanes or runs. A kind appearing twice keeps the later one.
export function mergePerKind(...parts) {
  return Object.assign({}, ...parts);
}

export function slugForModel(modelId) {
  return String(modelId).toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

// registry: seam-registry.json `kinds`; roles: skill-roles.json `roles`; reference: a baseline's per_kind.
// Deltas compare only kinds present in both the model and the reference, so a skill with an
// unmeasured kind is never scored against a number it did not earn.
export function rollupBySkill({ registry, perKind, reference = {}, roles = {} }) {
  const bySkill = {};
  const unmeasured = [];
  for (const [kind, meta] of Object.entries(registry)) {
    if (!perKind[kind]) { unmeasured.push({ kind, skill: meta.surface, status: meta.status }); continue; }
    (bySkill[meta.surface] ??= []).push(kind);
  }
  const rows = Object.entries(bySkill).map(([skill, kinds]) => {
    const shared = kinds.filter((k) => reference[k]);
    const accuracy = mean(kinds.map((k) => perKind[k].accuracy));
    const refAccuracy = shared.length ? mean(shared.map((k) => reference[k].accuracy)) : null;
    const modelOnShared = shared.length ? mean(shared.map((k) => perKind[k].accuracy)) : null;
    const weakest = [...kinds].sort((a, b) => perKind[a].accuracy - perKind[b].accuracy)[0];
    const fmt = kinds.map((k) => perKind[k].format_adherence).filter((x) => x != null);
    const refFmt = shared.map((k) => reference[k].format_adherence).filter((x) => x != null);
    return {
      skill,
      role: roles[skill] ?? "unclassified",
      kinds,
      accuracy: round(accuracy),
      reference_accuracy: round(refAccuracy),
      delta: modelOnShared == null ? null : round(modelOnShared - refAccuracy),
      format_adherence: round(mean(fmt)),
      reference_format_adherence: round(mean(refFmt)),
      reps: kinds.reduce((s, k) => s + (perKind[k].reps ?? 0), 0),
      min_reps_per_case: Math.min(...kinds.map((k) => perKind[k].min_reps_per_case ?? Infinity)),
      weakest_kind: weakest,
      weakest_accuracy: round(perKind[weakest].accuracy),
    };
  });
  rows.sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0) || a.skill.localeCompare(b.skill));
  const total = (rs) => {
    const kinds = rs.flatMap((r) => r.kinds);
    const shared = kinds.filter((k) => reference[k]);
    return {
      skills: rs.length,
      kinds: kinds.length,
      accuracy: round(mean(kinds.map((k) => perKind[k].accuracy))),
      reference_accuracy: round(mean(shared.map((k) => reference[k].accuracy))),
      delta: shared.length ? round(mean(shared.map((k) => perKind[k].accuracy)) - mean(shared.map((k) => reference[k].accuracy))) : null,
      reps: rs.reduce((s, r) => s + r.reps, 0),
    };
  };
  const roleNames = [...new Set(rows.map((r) => r.role))].sort();
  return {
    rows,
    by_role: Object.fromEntries(roleNames.map((role) => [role, total(rows.filter((r) => r.role === role))])),
    all: total(rows),
    unmeasured,
  };
}

const THIN_REPS = 10;
const num = (x) => (x == null ? "n/a" : x.toFixed(3));
const signed = (x) => (x == null ? "n/a" : `${x >= 0 ? "+" : ""}${x.toFixed(3)}`);

export function renderResultMarkdown(result) {
  const { meta, rollup } = result;
  const L = [];
  L.push(`# ${meta.model_id}: model evaluation result`, "");
  L.push(`- Date: ${meta.date}`, `- Driver: ${meta.driver}${meta.effort ? `, effort ${meta.effort}` : ""}`, `- Tier: ${meta.tier}`, `- Commit: ${meta.commit}`);
  L.push(`- Reference: ${meta.reference.label}`, `- Lanes: ${meta.lanes.join(", ")}`);
  if (meta.notes) L.push(`- Notes: ${meta.notes}`);
  L.push("", "Accuracy is the mean over a skill's eval kinds, each kind the mean of its cases' accuracy. Deltas compare only kinds the reference also measured.", "");
  L.push("## By role", "", "| role | skills | kinds | model | reference | delta | reps |", "|---|---|---|---|---|---|---|");
  for (const [role, t] of Object.entries(rollup.by_role)) L.push(`| ${role} | ${t.skills} | ${t.kinds} | ${num(t.accuracy)} | ${num(t.reference_accuracy)} | ${signed(t.delta)} | ${t.reps} |`);
  L.push(`| **all** | ${rollup.all.skills} | ${rollup.all.kinds} | ${num(rollup.all.accuracy)} | ${num(rollup.all.reference_accuracy)} | ${signed(rollup.all.delta)} | ${rollup.all.reps} |`, "");
  L.push("## By skill", "", "Sorted from the largest deficit to the largest lead. A `*` after the reps marks a skill with a kind run at fewer than " + THIN_REPS + " reps per case.", "");
  L.push("| skill | role | kinds | model | reference | delta | format (model / ref) | reps | weakest kind |", "|---|---|---|---|---|---|---|---|---|");
  for (const r of rollup.rows) {
    const thin = r.min_reps_per_case < THIN_REPS ? "*" : "";
    L.push(`| ${r.skill} | ${r.role} | ${r.kinds.length} | ${num(r.accuracy)} | ${num(r.reference_accuracy)} | ${signed(r.delta)} | ${num(r.format_adherence)} / ${num(r.reference_format_adherence)} | ${r.reps}${thin} | ${r.weakest_kind} ${num(r.weakest_accuracy)} |`);
  }
  L.push("");
  if (rollup.unmeasured.length) {
    L.push("## Not measured", "", "These kinds are registered but have no result in this run.", "", "| kind | skill | registry status |", "|---|---|---|");
    for (const u of rollup.unmeasured) L.push(`| ${u.kind} | ${u.skill} | ${u.status} |`);
    L.push("");
  }
  if (result.format) {
    L.push("## Producer output through the real parsers", "", "| producer | samples | passed | note |", "|---|---|---|---|");
    for (const p of result.format.producers) L.push(`| ${p.producer} | ${p.samples} | ${p.passed} | ${p.note ?? ""} |`);
    L.push("");
  }
  return L.join("\n");
}

const INDEX_HEAD = `# Model evaluation results

One directory per model, one subdirectory per date: \`<model>/<date>/result.json\` (the per-kind numbers, the by-skill roll-up and the format lane) and \`README.md\` (the tables). They are written by \`eval/run-model-eval.mjs\`; see "Evaluating a new model" in \`eval/README.md\`. This index is regenerated on every write.

Results are not baselines. \`eval/baselines/\` holds the committed numbers the regression gate compares against; this directory holds how other models compare to the reference.

Role columns are mean accuracy over the skills in that role (delta against the reference in brackets).

| model | date | tier | producer | reviewer | judge |
|---|---|---|---|---|---|
`;

const cell = (t) => (t ? `${num(t.accuracy)} (${signed(t.delta)})` : "n/a");

// Rewrites <root>/README.md from every stored result.json beneath it.
export function writeResultsIndex(root) {
  const rows = [];
  for (const slug of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    for (const date of readdirSync(join(root, slug)).sort()) {
      const file = join(root, slug, date, "result.json");
      if (!existsSync(file)) continue;
      const { meta, rollup } = JSON.parse(readFileSync(file, "utf8"));
      rows.push(`| [${meta.model_id}](${slug}/${date}/README.md) | ${meta.date} | ${meta.tier} | ${cell(rollup.by_role.producer)} | ${cell(rollup.by_role.reviewer)} | ${cell(rollup.by_role.judge)} |`);
    }
  }
  writeFileSync(join(root, "README.md"), INDEX_HEAD + rows.join("\n") + (rows.length ? "\n" : ""));
}

// Writes <root>/<slug>/<date>/{result.json,README.md} and refreshes the index. Returns the directory.
export function storeResult(result, { root }) {
  const dir = join(root, slugForModel(result.meta.model_id), result.meta.date);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, 2) + "\n");
  writeFileSync(join(dir, "README.md"), renderResultMarkdown(result) + "\n");
  writeResultsIndex(root);
  return dir;
}
