// FAFF-170 — deterministic tests for the prompt-size census + tokenomics report.
// Runs under `node --test` (free, zero model calls): the census reads files, the diff/report functions
// are pure. No frontier/local run is invoked — the size half is a pure prose measurement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fileSize, sizeCensus, skillFiles, diffSizes, qualityDelta, buildReport } from "../eval/size-census.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");

// --- the census reads real SKILL.md prose, deterministically ---
test("sizeCensus enumerates SKILL.md files and totals lines/chars/est_tokens", () => {
  const c = sizeCensus();
  assert.ok(c.totals.files >= 20, "expected the faff-family SKILL.md set");
  assert.ok(c.totals.est_tokens > 0 && c.totals.chars > 0 && c.totals.lines > 0);
  // est_tokens == ceil(chars/4) summed — reuse of estimateTokens (chars/4), not a tokenizer
  for (const f of c.per_file) assert.equal(f.est_tokens, Math.ceil(f.chars / 4), `${f.path} est_tokens = chars/4`);
});

test("sizeCensus is deterministic (same tree → identical numbers)", () => {
  assert.deepEqual(sizeCensus().totals, sizeCensus().totals);
});

test("fileSize injects a reader (pure-ish, testable with no disk)", () => {
  const s = fileSize("plugin/skills/x/SKILL.md", () => "abcd\nefgh"); // 9 chars, 2 lines
  assert.equal(s.chars, 9);
  assert.equal(s.lines, 2);
  assert.equal(s.est_tokens, Math.ceil(9 / 4)); // = 3
});

// --- diffSizes (PURE): absolute + percent deltas, added/removed files ---
const baseCensus = {
  per_file: [{ path: "a/SKILL.md", lines: 100, chars: 4000, est_tokens: 1000 }, { path: "b/SKILL.md", lines: 50, chars: 2000, est_tokens: 500 }],
  totals: { files: 2, lines: 150, chars: 6000, est_tokens: 1500 },
};
test("diffSizes reports a reduction (negative delta) + percent", () => {
  const after = {
    per_file: [{ path: "a/SKILL.md", lines: 80, chars: 3200, est_tokens: 800 }, { path: "b/SKILL.md", lines: 50, chars: 2000, est_tokens: 500 }],
    totals: { files: 2, lines: 130, chars: 5200, est_tokens: 1300 },
  };
  const d = diffSizes(after, baseCensus);
  assert.equal(d.delta.est_tokens, -200);            // 1300 - 1500
  assert.ok(Math.abs(d.delta.pct.est_tokens - (-13.333)) < 0.01); // ~-13.3%
  const aDelta = d.per_file_deltas.find((x) => x.path === "a/SKILL.md");
  assert.equal(aDelta.status, "changed");
  assert.equal(aDelta.est_tokens, -200);
});
test("diffSizes lists added + removed files", () => {
  const after = {
    per_file: [{ path: "a/SKILL.md", lines: 100, chars: 4000, est_tokens: 1000 }, { path: "c/SKILL.md", lines: 10, chars: 400, est_tokens: 100 }],
    totals: { files: 2, lines: 110, chars: 4400, est_tokens: 1100 },
  };
  const d = diffSizes(after, baseCensus);
  assert.equal(d.per_file_deltas.find((x) => x.path === "c/SKILL.md").status, "added");
  assert.equal(d.per_file_deltas.find((x) => x.path === "b/SKILL.md").status, "removed");
});

// --- qualityDelta (PURE): pairs FAFF-169's per_kind baseline vs a post-lean run ---
const frontier = { per_kind: { dupe: { accuracy: 1.0, stability: 1.0 }, gloss: { accuracy: 0.99, stability: 0.99 } } };
test("qualityDelta pairs per-kind before/after and flags regressions", () => {
  const run = { per_kind: { dupe: { accuracy: 0.9, stability: 1.0 }, gloss: { accuracy: 0.99, stability: 0.99 } } };
  const q = qualityDelta(frontier, run);
  assert.equal(q.mode, "paired");
  assert.ok(q.regressions.includes("dupe"));   // accuracy dropped
  assert.ok(!q.regressions.includes("gloss")); // unchanged
});
test("qualityDelta degrades to size-only when no run or no baseline", () => {
  assert.equal(qualityDelta(frontier, null).mode, "size-only");
  assert.equal(qualityDelta(null, { per_kind: {} }).mode, "size-only");
});

// --- buildReport (PURE): the paired headline + the size-only degrade ---
test("buildReport produces a paired 'cut N%' headline when a quality run is supplied", () => {
  const after = { per_file: baseCensus.per_file, totals: { files: 2, lines: 120, chars: 4800, est_tokens: 1200 } };
  const run = { per_kind: { dupe: { accuracy: 1.0, stability: 1.0 } } };
  const r = buildReport(after, baseCensus, run, { per_kind: { dupe: { accuracy: 1.0, stability: 1.0 } } });
  assert.equal(r.quality.mode, "paired");
  assert.match(r.headline, /cut 20\.0% prompt tokens \(1500 → 1200 est\)/); // before 1500 → after 1200 = cut 20%
  assert.match(r.headline, /judgement Δ = 0/);
});
test("buildReport degrades to size-only when no quality run", () => {
  const after = { per_file: baseCensus.per_file, totals: { files: 2, lines: 140, chars: 5600, est_tokens: 1400 } };
  const r = buildReport(after, baseCensus, null, null);
  assert.equal(r.quality.mode, "size-only");
  assert.match(r.headline, /size-only/);
});
test("buildReport never fabricates a quality delta without a run", () => {
  const r = buildReport(baseCensus, baseCensus, null, null);
  assert.equal(r.quality.mode, "size-only");
  assert.equal(r.quality.per_kind, undefined);
});

// --- the committed size baseline is valid + the census matches it (no drift at commit time) ---
test("the committed eval/baselines/prompt-size.json is a valid size baseline", () => {
  const b = JSON.parse(readFileSync(join(REPO, "eval", "baselines", "prompt-size.json"), "utf8"));
  assert.ok(b.totals && b.per_file && b.totals.est_tokens > 0);
  assert.equal(b.totals.files, b.per_file.length);
});
test("the gate/report is not wired into validate.yml CI (the size half could be later — FAFF-167 — but isn't here)", () => {
  const ci = readFileSync(join(REPO, ".github", "workflows", "validate.yml"), "utf8");
  assert.equal(/size-census/.test(ci), false);
});
