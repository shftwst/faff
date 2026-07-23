// FAFF-319 — the mechanical completeness gate for eval/calibration/oracle-triage.json.
//
// This is the FAFF-321 recurrence guard: that triage covered the alphabetically-first 24 case files
// instead of the 8 target kinds (5 kinds never triaged) and carried 23 interchangeable "requires Opus
// regen or human judgment" notes. The checks below make both failure modes impossible to reland:
//   1. artifact ↔ cases set equality across the 8 in-scope kinds (BOTH directions) — no untriaged case,
//      no phantom entry;
//   2. per-class required fields — oracle-defect carries a proposed_fix, needs-evidence a
//      discriminating_question, every entry the common fields;
//   3. no generic deferral and no two interchangeable rationales (the stranger-test floor).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const CASES_DIR = join(REPO, "eval", "cases");
const ARTIFACT = join(REPO, "eval", "calibration", "oracle-triage.json");

const IN_SCOPE_KINDS = new Set([
  "architecture", "specqual", "holdout", "roadmap", "adr-gloss", "spec-verdict", "refutation-spec", "refutation-code",
]);
const CLASSES = new Set(["oracle-defect", "needs-evidence", "suspected-genuine-miss", "sound"]);
// The FAFF-321 deferral signature — a rationale must never read like a generic punt.
const GENERIC_DEFERRAL = /requires?\s+(opus\s+)?regen|human judgment|human judgement|needs? regen|to be determined/i;

function inScopeCaseIds() {
  const ids = [];
  for (const f of readdirSync(CASES_DIR)) {
    if (!f.endsWith(".json")) continue;
    const c = JSON.parse(readFileSync(join(CASES_DIR, f), "utf8"));
    if (IN_SCOPE_KINDS.has(c.kind)) ids.push(c.id);
  }
  return ids;
}

const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8"));
const entries = artifact.entries || [];

test("FAFF-319 triage ↔ cases: exact set equality across the 8 in-scope kinds (both directions)", () => {
  const caseSet = new Set(inScopeCaseIds());
  const entrySet = new Set(entries.map((e) => e.case_id));
  const missing = [...caseSet].filter((id) => !entrySet.has(id)); // untriaged cases — the FAFF-321 failure
  const phantom = [...entrySet].filter((id) => !caseSet.has(id)); // entries with no live case file
  assert.deepEqual(missing, [], `untriaged in-scope cases: ${missing.join(", ")}`);
  assert.deepEqual(phantom, [], `triage entries with no matching case: ${phantom.join(", ")}`);
  assert.equal(entries.length, caseSet.size, "one entry per in-scope case, no duplicates");
});

test("FAFF-319 triage: all 8 in-scope kinds are represented (none silently dropped)", () => {
  const kindsSeen = new Set(entries.map((e) => e.kind));
  for (const k of IN_SCOPE_KINDS) assert.ok(kindsSeen.has(k), `kind never triaged: ${k}`);
});

test("FAFF-319 triage: every entry carries the common fields and a known class", () => {
  for (const e of entries) {
    assert.ok(typeof e.case_id === "string" && e.case_id, `entry missing case_id: ${JSON.stringify(e)}`);
    assert.ok(IN_SCOPE_KINDS.has(e.kind), `entry ${e.case_id}: out-of-scope kind ${e.kind}`);
    assert.ok(typeof e.grader_shape === "string" && e.grader_shape, `entry ${e.case_id}: missing grader_shape`);
    assert.ok(CLASSES.has(e.class), `entry ${e.case_id}: unknown class ${JSON.stringify(e.class)}`);
    assert.ok(typeof e.rationale === "string" && e.rationale.length > 40, `entry ${e.case_id}: rationale too thin`);
  }
});

test("FAFF-319 triage: per-class required fields (oracle-defect→proposed_fix, needs-evidence→discriminating_question)", () => {
  for (const e of entries) {
    if (e.class === "oracle-defect") {
      assert.ok(typeof e.proposed_fix === "string" && e.proposed_fix.length > 20, `oracle-defect ${e.case_id}: needs a proposed_fix`);
    } else {
      assert.ok(e.proposed_fix == null, `${e.class} ${e.case_id}: only oracle-defect entries may carry a proposed_fix`);
    }
    if (e.class === "needs-evidence") {
      assert.ok(typeof e.discriminating_question === "string" && e.discriminating_question.length > 20, `needs-evidence ${e.case_id}: needs a discriminating_question`);
    } else {
      assert.ok(e.discriminating_question == null, `${e.class} ${e.case_id}: only needs-evidence entries may carry a discriminating_question`);
    }
  }
});

test("FAFF-319 triage: no generic deferral, no two interchangeable rationales (the stranger test)", () => {
  const seen = new Map();
  for (const e of entries) {
    assert.ok(!GENERIC_DEFERRAL.test(e.rationale), `entry ${e.case_id}: rationale reads as a generic deferral — ${e.rationale.slice(0, 60)}`);
    const norm = e.rationale.trim().toLowerCase();
    assert.ok(!seen.has(norm), `entries ${seen.get(norm)} and ${e.case_id} have interchangeable rationale text`);
    seen.set(norm, e.case_id);
  }
});

test("FAFF-319 triage: meta names the superseded FAFF-321 artifact and pins the 8 scope kinds", () => {
  assert.ok(/triage-results\.json/.test(artifact.meta?.supersedes || ""), "meta.supersedes must name the superseded root artifact");
  assert.deepEqual(new Set(artifact.meta?.scope_kinds || []), IN_SCOPE_KINDS, "meta.scope_kinds must list exactly the 8 in-scope kinds");
});
