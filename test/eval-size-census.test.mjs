// FAFF-170 — deterministic tests for the prompt-size census + tokenomics report.
// Runs under `node --test` (free, zero model calls): the census reads files, the diff/report functions
// are pure. No frontier/local run is invoked — the size half is a pure prose measurement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fileSize, sizeCensus, skillFiles, diffSizes, qualityDelta, buildReport, evaluateGate } from "../eval/size-census.mjs";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

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
test("the budget gate IS wired into validate.yml CI, advisory (FAFF-171 — active step has no --enforce)", () => {
  const ci = readFileSync(join(REPO, ".github", "workflows", "validate.yml"), "utf8");
  assert.match(ci, /size-census\.mjs --gate --against eval\/baselines\/prompt-size\.json/);
  // advisory-first: the ACTIVE (uncommented) gate invocation must not enforce. A commented
  // "how to enforce later" hint may mention --enforce; only the live run line is asserted.
  const activeGate = ci.split("\n").find((l) => /^\s*node eval\/size-census\.mjs --gate/.test(l));
  assert.ok(activeGate, "an uncommented gate step runs in CI");
  assert.equal(/--enforce/.test(activeGate), false, "ships advisory: the active gate step is warn-only");
});

// --- evaluateGate (PURE): the ratchet verdict (FAFF-171) ---
test("evaluateGate: hold (delta 0) is within budget", () => {
  const census = { per_file: baseCensus.per_file, totals: { ...baseCensus.totals } };
  const g = evaluateGate(census, baseCensus, 0);
  assert.equal(g.status, "within");
  assert.equal(g.delta_est, 0);
  assert.equal(g.over_by, 0);
  assert.equal(g.under_by, 0);
});
test("evaluateGate: growth past budget is 'over' with over_by", () => {
  const census = { per_file: baseCensus.per_file, totals: { ...baseCensus.totals, est_tokens: 1700 } }; // +200 over 1500
  const g = evaluateGate(census, baseCensus, 0);
  assert.equal(g.status, "over");
  assert.equal(g.delta_est, 200);
  assert.equal(g.over_by, 200);
});
test("evaluateGate: growth within the --budget tolerance band stays 'within'", () => {
  const census = { per_file: baseCensus.per_file, totals: { ...baseCensus.totals, est_tokens: 1520 } }; // +20
  assert.equal(evaluateGate(census, baseCensus, 50).status, "within"); // 20 <= 50 band
  assert.equal(evaluateGate(census, baseCensus, 0).status, "over");    // 20 > 0
});
test("evaluateGate: a shrink reports under_by (the nudge signal)", () => {
  const census = { per_file: baseCensus.per_file, totals: { ...baseCensus.totals, est_tokens: 1100 } }; // -400
  const g = evaluateGate(census, baseCensus, 0);
  assert.equal(g.status, "within");
  assert.equal(g.delta_est, -400);
  assert.equal(g.under_by, 400);
});

// --- the --gate CLI exit contract: 0 within/advisory-over · 2 enforcing-over · 1 operational ---
const SCRIPT = join(REPO, "eval", "size-census.mjs");
function runGate(baselineTotals, extra = []) {
  // build a synthetic baseline relative to the CURRENT real census so the delta sign is controlled
  const cur = sizeCensus();
  const dir = mkdtempSync(join(tmpdir(), "faff-gate-"));
  const file = join(dir, "baseline.json");
  writeFileSync(file, JSON.stringify({ meta: { captured_at: "test" }, per_file: cur.per_file, totals: { ...cur.totals, est_tokens: baselineTotals } }) + "\n");
  return spawnSync(process.execPath, [SCRIPT, "--gate", "--against", file, ...extra], { encoding: "utf8" });
}
test("--gate exits 0 and says 'within budget' when the tree holds/shrinks vs the floor", () => {
  const r = runGate(sizeCensus().totals.est_tokens + 1000); // floor ABOVE current → current is a shrink
  assert.equal(r.status, 0);
  assert.match(r.stdout, /within budget/);
});
test("--gate --enforce exits 2 when the tree is over the floor", () => {
  const r = runGate(sizeCensus().totals.est_tokens - 1000, ["--enforce"]); // floor BELOW current → over by ~1000
  assert.equal(r.status, 2);
  assert.match(r.stdout, /OVER BUDGET/);
});
test("--gate WITHOUT --enforce exits 0 even when over (advisory) but still surfaces the delta", () => {
  const r = runGate(sizeCensus().totals.est_tokens - 1000); // over, advisory
  assert.equal(r.status, 0);
  assert.match(r.stdout, /OVER BUDGET/);
});
test("--gate with a missing/garbage baseline exits 1 (operational error, distinct from the gate verdict 2)", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--gate", "--against", join(tmpdir(), "does-not-exist-xyz.json")], { encoding: "utf8" });
  assert.equal(r.status, 1);
});
test("--gate without --against exits 1 (operational error)", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--gate"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /requires --against/);
});
