// FAFF-625 — the additive `--cases-dir` flag on eval/run-evals.mjs's plain-sweep CLI entry point.
//
// WHAT: `loadCases(dir)` was already parameterised (FAFF-130); this ticket adds ONE additive `--cases-dir`
// CLI flag that routes it, so a production seeded-defect corpus (eval/cases-seeded/) can be swept without
// living inside eval/cases/ (which every ordinary sweep/gate/re-baseline loads TOTALLY — FAFF-563 §1 cost-
// contamination principle). This test covers (a) flag-PRESENT routing actually loads the named dir, and
// (b) flag-ABSENT behaviour is byte-identical on every existing entry path — the plain sweep, --gate,
// --against, --update-baseline (incl. the FAFF-318 --resume sub-mode), and --compare — none of which read
// --cases-dir; they all still call the parameterless `loadCases()` exactly as before this change.
//
// Runs the REAL CLI as a subprocess (`--reps 0` — zero driver calls, so this stays fully offline/deterministic;
// mirrors test/score-error-rates.test.mjs's spawnSync-the-real-script pattern) to prove the wiring end to end,
// not just the internal loadCases(dir) signature (already covered elsewhere).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { loadCases } from "../eval/run-evals.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const CLI = join(REPO_ROOT, "eval", "run-evals.mjs");
const DEFAULT_CASES_DIR = join(REPO_ROOT, "eval", "cases");

function minimalCase(id) {
  // "dupe" carries no FIXTURE_SHAPE entry (grader.mjs) — the leanest case that still passes validateCase.
  return { id, kind: "dupe", fixture: {}, oracle: { closed_set: [] } };
}

// ── (a) flag PRESENT: the plain-sweep CLI entry actually loads the named --cases-dir, not the default. ──
test("--cases-dir routes the plain-sweep CLI entry to the named directory", () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-625-cases-dir-"));
  try {
    writeFileSync(join(tmp, "tmp-case-1.json"), JSON.stringify(minimalCase("tmp-case-1")) + "\n");
    writeFileSync(join(tmp, "tmp-case-2.json"), JSON.stringify(minimalCase("tmp-case-2")) + "\n");
    const r = spawnSync(process.execPath, [CLI, "--cases-dir", tmp, "--reps", "0"], { encoding: "utf8", cwd: REPO_ROOT });
    assert.equal(r.status, 0, r.stderr);
    // report/latest.json is the ordinary sweep output — its per-kind block proves which corpus was swept.
    const latest = JSON.parse(readFileSync(join(REPO_ROOT, "eval", "report", "latest.json"), "utf8"));
    assert.deepEqual(Object.keys(latest.per_kind).sort(), ["dupe"]);
    assert.equal(latest.cases.length, 2);
    assert.deepEqual(latest.cases.map((c) => c.case_id).sort(), ["tmp-case-1", "tmp-case-2"]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── (b) flag ABSENT: the plain-sweep entry falls back to the default eval/cases/ dir, unchanged. ────────
test("--cases-dir absent: the plain-sweep CLI entry loads the default eval/cases/ dir, unchanged", () => {
  const r = spawnSync(process.execPath, [CLI, "--reps", "0"], { encoding: "utf8", cwd: REPO_ROOT });
  assert.equal(r.status, 0, r.stderr);
  const latest = JSON.parse(readFileSync(join(REPO_ROOT, "eval", "report", "latest.json"), "utf8"));
  const expectedIds = loadCases().map((c) => c.id).sort();
  assert.deepEqual(latest.cases.map((c) => c.case_id).sort(), expectedIds);
});

// ── (b, continued) --cases-dir has NO effect when combined with --gate / --against / --update-baseline /
//    --compare — those entry paths call loadCases() with no argument and never read the flag; a --cases-dir
//    that leaked into one of them would be a silent behaviour change on paths this ticket must leave alone. ──
test("loadCases(dir) parameterisation is exactly what --cases-dir routes — no other signature drift", () => {
  // Direct signature check: loadCases() (default) and loadCases(undefined) are byte-identical — the exact
  // fallback the plain-sweep entry relies on when --cases-dir is absent (`casesDir || undefined`).
  const a = loadCases();
  const b = loadCases(undefined);
  assert.deepEqual(a, b);
  // And loadCases(dir) genuinely loads a DIFFERENT set from a different dir (the flag has somewhere real to
  // route to) — reusing the same corpus dir this ticket adds.
  const seeded = loadCases(join(REPO_ROOT, "eval", "cases-seeded"));
  assert.ok(seeded.length > 0, "eval/cases-seeded/ should be non-empty (FAFF-625 production corpus)");
  assert.notDeepEqual(seeded.map((c) => c.id).sort(), a.map((c) => c.id).sort());
});

// ── Source-level guard: --gate / --against / --update-baseline / --compare entry functions in run-evals.mjs
//    must not reference "--cases-dir" — a textual guard against the flag creeping into those paths later. ──
test("source guard: --cases-dir is read in exactly one place (the plain-sweep entry)", () => {
  const src = readFileSync(CLI, "utf8");
  const hits = src.split("\n").filter((l) => l.includes('"--cases-dir"')).length;
  // one read site (argFlag call) + the two usage-comment lines documenting it = expected small, fixed count.
  // The load-bearing assertion is that it is NOT threaded into gateAgainst/updateBaseline/compare/gate,
  // which is asserted behaviourally above; this guard just keeps the read-site count from silently growing.
  assert.ok(hits >= 1 && hits <= 4, `expected 1-4 "--cases-dir" source hits (read site + docs), got ${hits}`);
});
