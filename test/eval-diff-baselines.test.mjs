import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diffBaselines, renderDiff } from "../eval/diff-baselines.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

const base = {
  meta: { model: "m-base", base_reps: 20 },
  per_kind: {
    alpha: { accuracy: 1.0, stability: 1.0 },
    beta: { accuracy: 0.8, stability: 0.9 },
    gamma: { accuracy: 0.5, stability: 0.5 },
    onlybase: { accuracy: 1.0, stability: 1.0 },
  },
};
const cand = {
  meta: { model: "m-cand", effort: "high", base_reps: 20 },
  per_kind: {
    alpha: { accuracy: 1.0, stability: 1.0 },
    beta: { accuracy: 0.6, stability: 0.95 },
    gamma: { accuracy: 0.75, stability: 0.5 },
    onlycand: { accuracy: 0.9, stability: 0.9 },
  },
};

test("diffBaselines signs each delta as candidate minus base and sorts worst first", () => {
  const { rows } = diffBaselines(base, cand);
  const beta = rows.find((r) => r.kind === "beta");
  assert.ok(Math.abs(beta.dAcc - -0.2) < 1e-9);
  assert.ok(Math.abs(beta.dStab - 0.05) < 1e-9);
  assert.equal(rows[0].kind, "beta");
});

test("diffBaselines keeps one-sided kinds as not comparable", () => {
  const { rows, summary } = diffBaselines(base, cand);
  assert.equal(rows.find((r) => r.kind === "onlybase").onlyIn, "base-only");
  assert.equal(rows.find((r) => r.kind === "onlycand").onlyIn, "candidate-only");
  assert.equal(summary.comparable, 3);
  assert.deepEqual(summary.notComparable.map((r) => r.kind).sort(), ["onlybase", "onlycand"]);
});

test("diffBaselines summarises worse, better and same", () => {
  const { summary } = diffBaselines(base, cand);
  assert.deepEqual(summary.worse.map((r) => r.kind), ["beta"]);
  assert.deepEqual(summary.better.map((r) => r.kind), ["gamma"]);
  assert.deepEqual(summary.same.map((r) => r.kind), ["alpha"]);
  assert.ok(Math.abs(summary.meanDAcc - (0 - 0.2 + 0.25) / 3) < 1e-9);
});

test("a self-diff is all zeros", () => {
  const { summary } = diffBaselines(base, base);
  assert.equal(summary.worse.length, 0);
  assert.equal(summary.better.length, 0);
  assert.equal(summary.meanDAcc, 0);
});

test("renderDiff prints the model and effort of each side", () => {
  const out = renderDiff(diffBaselines(base, cand), { basePath: "b.json", candPath: "c.json", baseMeta: base.meta, candMeta: cand.meta });
  assert.match(out, /model=m-base\s+effort=default/);
  assert.match(out, /model=m-cand\s+effort=high/);
  assert.match(out, /worst regressions: beta -0\.200/);
});

test("the CLI exits 2 with usage when a path is missing", () => {
  const res = spawnSync(process.execPath, [join(REPO, "eval", "diff-baselines.mjs")], { encoding: "utf8" });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /usage:/);
});
