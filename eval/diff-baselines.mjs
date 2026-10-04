#!/usr/bin/env node
// Per-kind signed-delta diff between two eval baseline files. Read-only: no model calls, no cost.
// Keeps the actual scores rather than a pass/fail gate, so a candidate model's gains and losses per
// kind stay visible.
//
//   node eval/diff-baselines.mjs <base.json> <candidate.json>
//
// Delta = candidate - base, so a positive delta means the candidate scored higher.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const delta = (a, b) => (a == null || b == null ? null : b - a);

export function diffBaselines(base, cand) {
  const baseRows = base.per_kind ?? {};
  const candRows = cand.per_kind ?? {};
  const kinds = [...new Set([...Object.keys(baseRows), ...Object.keys(candRows)])].sort();
  const rows = kinds.map((kind) => {
    const b = baseRows[kind];
    const c = candRows[kind];
    return {
      kind,
      baseAcc: b?.accuracy ?? null,
      candAcc: c?.accuracy ?? null,
      dAcc: delta(b?.accuracy, c?.accuracy),
      baseStab: b?.stability ?? null,
      candStab: c?.stability ?? null,
      dStab: delta(b?.stability, c?.stability),
      onlyIn: !b ? "candidate-only" : !c ? "base-only" : null,
    };
  });
  rows.sort((x, y) => (x.dAcc ?? 0) - (y.dAcc ?? 0));

  const comparable = rows.filter((r) => r.dAcc != null);
  const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  return {
    rows,
    summary: {
      comparable: comparable.length,
      worse: comparable.filter((r) => r.dAcc < 0),
      better: comparable.filter((r) => r.dAcc > 0).sort((a, b) => b.dAcc - a.dAcc),
      same: comparable.filter((r) => r.dAcc === 0),
      meanDAcc: mean(comparable.map((r) => r.dAcc)),
      meanDStab: mean(comparable.map((r) => r.dStab).filter((x) => x != null)),
      notComparable: rows.filter((r) => r.onlyIn),
    },
  };
}

const fmt = (x) => (x == null ? "  -  " : x.toFixed(3));
const signed = (x) => (x == null ? "   -  " : (x >= 0 ? "+" : "") + x.toFixed(3));
const pad = (s, n) => String(s).padEnd(n);

export function renderDiff({ rows, summary }, { basePath, candPath, baseMeta = {}, candMeta = {} }) {
  const header = (label, path, meta) =>
    `${label} ${path}   model=${meta.model ?? "?"}  effort=${meta.effort ?? "default"}  reps=${meta.base_reps ?? "?"}  captured=${meta.captured_at ?? "?"}`;
  const lines = [
    header("base:     ", basePath, baseMeta),
    header("candidate:", candPath, candMeta),
    "",
    pad("kind", 34) + pad("acc.base", 10) + pad("acc.cand", 10) + pad("Δacc", 9) + pad("stab.base", 11) + pad("stab.cand", 11) + pad("Δstab", 9) + "note",
    "-".repeat(110),
    ...rows.map(
      (r) =>
        pad(r.kind, 34) + pad(fmt(r.baseAcc), 10) + pad(fmt(r.candAcc), 10) + pad(signed(r.dAcc), 9) +
        pad(fmt(r.baseStab), 11) + pad(fmt(r.candStab), 11) + pad(signed(r.dStab), 9) + (r.onlyIn ?? ""),
    ),
    "",
    `comparable kinds: ${summary.comparable}   worse: ${summary.worse.length}   better: ${summary.better.length}   same: ${summary.same.length}`,
    `mean Δaccuracy: ${signed(summary.meanDAcc)}   mean Δstability: ${signed(summary.meanDStab)}`,
  ];
  if (summary.worse.length) lines.push(`worst regressions: ${summary.worse.slice(0, 5).map((r) => `${r.kind} ${signed(r.dAcc)}`).join(", ")}`);
  if (summary.better.length) lines.push(`biggest gains:     ${summary.better.slice(0, 5).map((r) => `${r.kind} ${signed(r.dAcc)}`).join(", ")}`);
  if (summary.notComparable.length) lines.push(`not comparable:    ${summary.notComparable.map((r) => `${r.kind} (${r.onlyIn})`).join(", ")}`);
  return lines.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [basePath, candPath] = process.argv.slice(2);
  if (!basePath || !candPath) {
    console.error("usage: node eval/diff-baselines.mjs <base.json> <candidate.json>");
    process.exit(2);
  }
  const base = JSON.parse(readFileSync(basePath, "utf8"));
  const cand = JSON.parse(readFileSync(candPath, "utf8"));
  console.log(renderDiff(diffBaselines(base, cand), { basePath, candPath, baseMeta: base.meta, candMeta: cand.meta }));
}
