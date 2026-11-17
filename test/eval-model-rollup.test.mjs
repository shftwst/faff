import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergePerKind, perKindFromRecords, renderResultMarkdown, renderRoleTables, rollupBySkill, slugForModel, storeResult, writeResultsIndex } from "../eval/lib/model-rollup.mjs";

const rec = (kind, case_id, score, signature = "s", format = "compliant", graded = score === 1 ? "PASS" : "FAIL") =>
  ({ kind, case_id, score, signature, graded, envelope: { format } });

test("perKindFromRecords aggregates like the sweep: accuracy, stability, format, reps", () => {
  const records = [
    rec("dupe", "dupe-001", 1), rec("dupe", "dupe-001", 1), rec("dupe", "dupe-001", 0, "other", "noncompliant"),
    rec("dupe", "dupe-002", 1), rec("dupe", "dupe-002", 1),
    rec("gloss", "gloss-001", 1),
  ];
  const pk = perKindFromRecords(records);
  assert.equal(pk.dupe.cases, 2);
  assert.equal(pk.dupe.reps, 5);
  assert.equal(pk.dupe.min_reps_per_case, 2);
  assert.ok(Math.abs(pk.dupe.accuracy - (2 / 3 + 1) / 2) < 1e-9, "mean of per-case accuracy, not of reps");
  assert.ok(Math.abs(pk.dupe.stability - (2 / 3 + 1) / 2) < 1e-9);
  assert.ok(Math.abs(pk.dupe.format_adherence - (2 / 3 + 1) / 2) < 1e-9);
  assert.equal(pk.gloss.accuracy, 1);
});

test("perKindFromRecords counts errored reps and can ignore a kind measured elsewhere", () => {
  const records = [rec("dupe", "dupe-001", 0, "x", undefined, "ERRORED"), rec("stale", "stale-001", 1)];
  assert.equal(perKindFromRecords(records).dupe.errored, 1);
  assert.deepEqual(Object.keys(perKindFromRecords(records, { ignoreKinds: ["dupe"] })), ["stale"]);
});

test("mergePerKind: a later part wins for a kind seen twice", () => {
  assert.equal(mergePerKind({ a: { accuracy: 1 } }, { a: { accuracy: 0.5 } }).a.accuracy, 0.5);
});

test("slugForModel makes a path-safe lowercase slug and keeps dots", () => {
  assert.equal(slugForModel("spark/deepseek-v4.1-flash-1017"), "spark-deepseek-v4.1-flash-1017");
  assert.equal(slugForModel("claude-opus-5-5"), "claude-opus-5-5");
});

const registry = {
  dupe: { surface: "faff-tidy", status: "covered" },
  vague: { surface: "faff-tidy", status: "covered" },
  "refutation-spec": { surface: "faffter-dark-spec-review", status: "covered" },
  reconciliation: { surface: "faff-prep", status: "designed" },
};
const roles = { "faff-tidy": "producer", "faffter-dark-spec-review": "reviewer" };

test("rollupBySkill: role, like-for-like delta, weakest kind and the unmeasured list", () => {
  const perKind = {
    dupe: { accuracy: 1, format_adherence: 0.9, reps: 40, min_reps_per_case: 20 },
    vague: { accuracy: 0.8, format_adherence: 1, reps: 10, min_reps_per_case: 5 },
    "refutation-spec": { accuracy: 0.55, format_adherence: 1, reps: 51, min_reps_per_case: 3 },
  };
  const reference = { dupe: { accuracy: 1, format_adherence: 1 }, vague: { accuracy: 1, format_adherence: 1 }, "refutation-spec": { accuracy: 0.9, format_adherence: 1 } };
  const r = rollupBySkill({ registry, perKind, reference, roles });
  const tidy = r.rows.find((x) => x.skill === "faff-tidy");
  assert.equal(tidy.role, "producer");
  assert.equal(tidy.accuracy, 0.9);
  assert.equal(tidy.delta, -0.1);
  assert.equal(tidy.weakest_kind, "vague");
  assert.equal(tidy.reps, 50);
  assert.equal(tidy.min_reps_per_case, 5);
  assert.equal(r.rows[0].skill, "faffter-dark-spec-review", "largest deficit sorts first");
  assert.deepEqual(r.unmeasured, [{ kind: "reconciliation", skill: "faff-prep", status: "designed" }]);
  assert.equal(r.by_role.producer.kinds, 2);
  assert.equal(r.by_role.reviewer.delta, -0.35);
});

test("rollupBySkill: a kind the reference lacks is left out of the delta, not scored as zero", () => {
  const perKind = { dupe: { accuracy: 1, reps: 1, min_reps_per_case: 1 }, vague: { accuracy: 0.5, reps: 1, min_reps_per_case: 1 } };
  const r = rollupBySkill({ registry, perKind, reference: { dupe: { accuracy: 1, format_adherence: 1 } }, roles });
  const tidy = r.rows.find((x) => x.skill === "faff-tidy");
  assert.equal(tidy.accuracy, 0.75);
  assert.equal(tidy.reference_accuracy, 1);
  assert.equal(tidy.delta, 0, "only the shared kind (dupe) is compared");
});

test("rollupBySkill: a skill with no role entry is unclassified", () => {
  const r = rollupBySkill({ registry, perKind: { dupe: { accuracy: 1, reps: 1, min_reps_per_case: 1 } }, reference: {}, roles: {} });
  assert.equal(r.rows[0].role, "unclassified");
  assert.equal(r.rows[0].delta, null);
});

test("renderResultMarkdown carries the role table, skill table, thin-rep marker and unmeasured kinds", () => {
  const perKind = { dupe: { accuracy: 1, format_adherence: 1, reps: 4, min_reps_per_case: 2 } };
  const rollup = rollupBySkill({ registry, perKind, reference: { dupe: { accuracy: 1, format_adherence: 1 } }, roles });
  const md = renderResultMarkdown({ meta: { model_id: "m", date: "2026-01-02", driver: "local", effort: null, tier: "quick", commit: "abc", reference: { label: "ref" }, lanes: ["blackbox"] }, rollup });
  assert.match(md, /## By role/);
  assert.match(md, /\| faff-tidy \| producer \|/);
  assert.match(md, /4\*/, "thin reps are starred");
  assert.match(md, /## By role, per skill/);
  assert.match(md, /### producer\n\n\| skill \| kinds \|/);
  assert.match(md, /\| \*\*producer total\*\* \| 1 \| 1\.000 \| 1\.000 \| \+0\.000 \|/);
  assert.match(md, /## Not measured/);
  assert.match(md, /reconciliation/);
  const noted = renderResultMarkdown({ meta: { model_id: "m", date: "2026-01-02", driver: "local", effort: null, tier: "quick", commit: "abc", reference: { label: "ref" }, lanes: ["blackbox"], notes: "rebuilt from captures" }, rollup });
  assert.match(noted, /- Notes: rebuilt from captures/);
});

test("storeResult writes result.json and README.md under <slug>/<date>", () => {
  const root = mkdtempSync(join(tmpdir(), "model-results-"));
  try {
    const result = { meta: { model_id: "Org/Model-1", date: "2026-01-02", driver: "local", effort: null, tier: "quick", commit: "abc", reference: { label: "ref" }, lanes: ["blackbox"] }, rollup: rollupBySkill({ registry, perKind: {}, reference: {}, roles }) };
    const dir = storeResult(result, { root });
    assert.equal(dir, join(root, "org-model-1", "2026-01-02"));
    assert.equal(JSON.parse(readFileSync(join(dir, "result.json"), "utf8")).meta.model_id, "Org/Model-1");
    assert.match(readFileSync(join(dir, "README.md"), "utf8"), /^# Org\/Model-1/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("storeResult refreshes the results index with one row per stored result", () => {
  const root = mkdtempSync(join(tmpdir(), "model-results-"));
  try {
    const mk = (id, date) => ({ meta: { model_id: id, date, driver: "local", effort: null, tier: "quick", commit: "abc", reference: { label: "ref" }, lanes: ["blackbox"] },
      rollup: rollupBySkill({ registry, perKind: { dupe: { accuracy: 0.9, reps: 1, min_reps_per_case: 1 } }, reference: { dupe: { accuracy: 1, format_adherence: 1 } }, roles }) });
    storeResult(mk("Model-B", "2026-01-02"), { root });
    storeResult(mk("Model-A", "2026-01-03"), { root });
    const index = readFileSync(join(root, "README.md"), "utf8");
    assert.match(index, /\| \[Model-A\]\(model-a\/2026-01-03\/README.md\) \| 2026-01-03 \| quick \| 0\.900 \(-0\.100\) \| n\/a \| n\/a \|/);
    assert.ok(index.indexOf("Model-A") < index.indexOf("Model-B"), "sorted by slug");
    writeResultsIndex(root);
    assert.equal(readFileSync(join(root, "README.md"), "utf8"), index, "regenerating is idempotent");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("renderRoleTables: one section per role, skills sorted by deficit, a total row each, and the stored README embeds the same text", () => {
  const perKind = {
    dupe: { accuracy: 0.9, format_adherence: 1, reps: 20, min_reps_per_case: 20 },
    vague: { accuracy: 1, format_adherence: 1, reps: 20, min_reps_per_case: 20 },
    "refutation-spec": { accuracy: 0.5, format_adherence: 1, reps: 3, min_reps_per_case: 3 },
  };
  const reference = { dupe: { accuracy: 1, format_adherence: 1 }, vague: { accuracy: 1, format_adherence: 1 }, "refutation-spec": { accuracy: 0.9, format_adherence: 1 } };
  const rollup = rollupBySkill({ registry, perKind, reference, roles });
  const text = renderRoleTables(rollup).join("\n");
  assert.match(text, /### producer\n\n\| skill \| kinds \|/);
  assert.match(text, /### reviewer/);
  assert.match(text, /\| \*\*producer total\*\* \| 2 \| 0\.950 \| 1\.000 \| -0\.050 \|/);
  assert.match(text, /\| \*\*reviewer total\*\* \| 1 \| 0\.500 \| 0\.900 \| -0\.400 \|/);
  const md = renderResultMarkdown({ meta: { model_id: "m", date: "2026-01-02", driver: "local", effort: null, tier: "quick", commit: "abc", reference: { label: "ref" }, lanes: ["blackbox"] }, rollup });
  assert.ok(md.includes(text), "the stored README embeds exactly what the runner prints");
});
