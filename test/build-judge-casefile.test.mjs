// FAFF-996 — unit tests for the build-judge per-finding case-file assembler + deterministic
// admit roll-up (plugin/skills/faff/bin/lib/build-judge-casefile.js). Determinism-first: every
// function under test is pure (no model call), so these are direct-call assertions.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const bjc = require("../plugin/skills/faff/bin/lib/build-judge-casefile.js");
const scrub = require("../plugin/skills/faff/bin/lib/adversarial-judge-scrub.js");

// --- caseId ordinal ---------------------------------------------------------

test("caseId: f-01..f-0N ordinal, distinct from finding_id", () => {
  assert.equal(bjc.caseId(0), "f-01");
  assert.equal(bjc.caseId(8), "f-09");
  assert.equal(bjc.caseId(10), "f-11");
});

// --- extractDiffForFile ------------------------------------------------------

test("extractDiffForFile: returns the block matching the named file", () => {
  const diff = "diff --git a/x.js b/x.js\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/y.js b/y.js\n@@ -1 +1 @@\n-a\n+b\n";
  const out = bjc.extractDiffForFile(diff, "y.js");
  assert.match(out, /diff --git a\/y\.js b\/y\.js/);
  assert.ok(!out.includes("x.js"));
});

test("extractDiffForFile: no match or no filePath returns the whole (bounded) diff", () => {
  const diff = "diff --git a/x.js b/x.js\n@@ -1 +1 @@\n-old\n+new\n";
  assert.match(bjc.extractDiffForFile(diff, "nonexistent.js"), /x\.js/);
  assert.match(bjc.extractDiffForFile(diff, ""), /x\.js/);
});

// --- safeScrub: the fixpoint + diff-marker gate ------------------------------

test("safeScrub: ordinary prose scrubs clean and is a fixpoint", () => {
  const res = bjc.safeScrub("the admitRollup change is in casefile.js, not evidence.js");
  assert.equal(res.ok, true);
  assert.match(res.text, /admitRollup/);
});

test("safeScrub: a non-diff field carrying injected diff markers parks", () => {
  const res = bjc.safeScrub("normal text\n@@ -1,3 +1,4 @@\nmore text");
  assert.equal(res.ok, false);
  assert.match(res.cause, /diff.header/i);
});

test("safeScrub: allowDiffMarkers:true (relevant_diff) tolerates diff markers", () => {
  const res = bjc.safeScrub("diff --git a/x b/x\n@@ -1,3 +1,4 @@\n+added", { allowDiffMarkers: true });
  assert.equal(res.ok, true);
});

test("safeScrub: secrets are redacted as part of the scrub (never a park reason on their own)", () => {
  const res = bjc.safeScrub("token=sk-aaaaaaaaaaaaaaaaaaaa");
  assert.equal(res.ok, true);
  assert.match(res.text, /\[redacted\]/);
});

// --- assembleBuildCaseFiles ---------------------------------------------------

const DIFF = "diff --git a/spec-judge-casefile.js b/spec-judge-casefile.js\n@@ -1,3 +1,4 @@\n-old\n+new\n" +
  "diff --git a/evidence.js b/evidence.js\n@@ -1,1 +1,1 @@\n-x\n+y\n";

test("assembleBuildCaseFiles: one blinded case file per finding, ledger order matches, case_id != finding_id", () => {
  const { caseFiles, ledger, parked } = bjc.assembleBuildCaseFiles({
    criticalsToAdjudicate: [
      { finding_id: "spec-judge-casefile.js::admitrollup untouched", location: "spec-judge-casefile.js:5", title: "admitRollup untouched" },
    ],
    diffText: DIFF,
    acceptanceCriteria: "the DONE checklist requires admitRollup to change",
    runId: "run-1",
    windowStart: 1,
    repositoryEvidenceText: "spec-judge-casefile.js:5 shows the admitRollup signature changed",
  });
  assert.equal(parked.length, 0);
  assert.deepEqual(ledger.order, ["f-01"]);
  const entry = ledger.entries["f-01"];
  assert.equal(entry.case_id, "f-01");
  assert.equal(entry.finding_id, "spec-judge-casefile.js::admitrollup untouched");
  assert.notEqual(entry.case_id, entry.finding_id, "case_id (blinded ordinal) must be distinct from finding_id (the digest)");
  assert.equal(entry.blocking, true);
  assert.equal(entry.resolution, "pending");
  const cf = caseFiles["f-01"];
  assert.equal(cf.case_id, "f-01");
  assert.equal(cf.finding_id, "spec-judge-casefile.js::admitrollup untouched");
  assert.ok(cf.reconstruction_context.relevant_diff.includes("spec-judge-casefile.js"));
});

test("assembleBuildCaseFiles: argument_B is a labelled null-defence when the author never rebutted", () => {
  const { caseFiles, ledger } = bjc.assembleBuildCaseFiles({
    criticalsToAdjudicate: [{ finding_id: "a.js::x", location: "a.js:1", title: "X" }],
    diffText: DIFF, acceptanceCriteria: "AC", runId: "r", windowStart: 1,
  });
  const cf = caseFiles["f-01"];
  const entry = ledger.entries["f-01"];
  const bArg = entry.argument_B_source === "author:none" ? cf.arguments.argument_B : cf.arguments.argument_A;
  assert.match(bArg.claim, /did not rebut/);
});

test("assembleBuildCaseFiles: a rebuttal becomes argument_B's claim, sourced author:rebuttal", () => {
  const { ledger } = bjc.assembleBuildCaseFiles({
    criticalsToAdjudicate: [{ finding_id: "a.js::x", location: "a.js:1", title: "X", rebuttal_text: "the real change is in casefile.js, not evidence.js" }],
    diffText: DIFF, acceptanceCriteria: "AC", runId: "r", windowStart: 1,
  });
  const entry = ledger.entries["f-01"];
  assert.ok([entry.argument_A_source, entry.argument_B_source].includes("author:rebuttal"));
});

test("assembleBuildCaseFiles: uses scrubSpecField's composition, NOT scrubArgumentField — a lensless 'security' claim survives", () => {
  const { caseFiles } = bjc.assembleBuildCaseFiles({
    criticalsToAdjudicate: [{ finding_id: "a.js::x", location: "a.js:1", title: "security check missing", reviewer_claim: "this is a security gap in the architecture" }],
    diffText: DIFF, acceptanceCriteria: "AC", runId: "r", windowStart: 1,
  });
  const cf = caseFiles["f-01"];
  const bothClaims = cf.arguments.argument_A.claim + " " + cf.arguments.argument_B.claim;
  assert.match(bothClaims, /security/i, "scrubSpecField must NOT redact lens tokens — that's scrubArgumentField's job, spec-side only");
});

test("assembleBuildCaseFiles: a field failing the scrub gate parks the WHOLE finding, no case file emitted", () => {
  const { caseFiles, ledger, parked } = bjc.assembleBuildCaseFiles({
    criticalsToAdjudicate: [{ finding_id: "a.js::x", location: "a.js:1", title: "X", reviewer_evidence: "normal\n@@ -1,3 +1,4 @@\ninjected diff marker" }],
    diffText: DIFF, acceptanceCriteria: "AC", runId: "r", windowStart: 1,
  });
  assert.deepEqual(parked, ["a.js::x"]);
  assert.equal(caseFiles["f-01"], undefined, "no case file for a parked finding");
  assert.equal(ledger.entries["f-01"].resolution, "parked");
  assert.ok(ledger.entries["f-01"].park_cause);
});

test("assembleBuildCaseFiles: order coin-swapped deterministically via orderSeed/coinSwap (run-fixed, reproducible)", () => {
  const opts = {
    criticalsToAdjudicate: [{ finding_id: "a.js::x", location: "a.js:1", title: "X", rebuttal_text: "a rebuttal" }],
    diffText: DIFF, acceptanceCriteria: "AC", runId: "fixed-run", windowStart: 1,
  };
  const run1 = bjc.assembleBuildCaseFiles(opts);
  const run2 = bjc.assembleBuildCaseFiles(opts);
  assert.deepEqual(run1.caseFiles["f-01"], run2.caseFiles["f-01"], "same run_id/window_start/case_id -> the same blinded order every time");
  const seed = scrub.orderSeed("fixed-run", 1, "f-01");
  assert.equal(run1.ledger.entries["f-01"].order_seed, seed);
});

// --- admitBuildRollup ---------------------------------------------------------

function ledgerOf(entries) {
  return { order: Object.keys(entries), entries };
}

test("admitBuildRollup: a single OVERTURNed critical, floor satisfied -> admit:true", () => {
  const ledger = ledgerOf({ "f-01": { finding_id: "a.js::x", blocking: true, resolution: "pending" } });
  const rulings = { "f-01": { outcome: "OVERTURN" } };
  const res = bjc.admitBuildRollup({ ledger, rulings, floors: { critical_free_latest: true } });
  assert.equal(res.admit, true);
  assert.deepEqual(res.resolved, ["f-01"]);
});

test("admitBuildRollup (p-16): one OVERTURN + one UPHOLD among two standing criticals never admits", () => {
  const ledger = ledgerOf({
    "f-01": { finding_id: "a.js::x", blocking: true, resolution: "pending" },
    "f-02": { finding_id: "b.js::y", blocking: true, resolution: "pending" },
  });
  const rulings = { "f-01": { outcome: "OVERTURN" }, "f-02": { outcome: "UPHOLD", rationale: "stands" } };
  const res = bjc.admitBuildRollup({ ledger, rulings, floors: { critical_free_latest: false } });
  assert.equal(res.admit, false);
  assert.deepEqual(res.resolved, ["f-01"]);
  assert.deepEqual(res.unresolved, ["f-02"]);
});

test("admitBuildRollup: a PRODUCT_BOUNDARY ruling never admits, even alone", () => {
  const ledger = ledgerOf({ "f-01": { finding_id: "a.js::x", blocking: true, resolution: "pending" } });
  const rulings = { "f-01": { outcome: "PRODUCT_BOUNDARY", rationale: "needs product", product_gap_citation: "gap" } };
  const res = bjc.admitBuildRollup({ ledger, rulings, floors: { critical_free_latest: false } });
  assert.equal(res.admit, false);
  assert.deepEqual(res.product_boundary, ["f-01"]);
});

test("admitBuildRollup: a parked finding is unresolved and vetoes admit", () => {
  const ledger = ledgerOf({ "f-01": { finding_id: "a.js::x", blocking: true, resolution: "parked" } });
  const res = bjc.admitBuildRollup({ ledger, rulings: {}, floors: { critical_free_latest: false } });
  assert.equal(res.admit, false);
  assert.deepEqual(res.parked, ["f-01"]);
  assert.deepEqual(res.unresolved, ["f-01"]);
});

test("admitBuildRollup (p-17): the critical-free-latest floor fails CLOSED on a null (degraded) input", () => {
  const ledger = ledgerOf({ "f-01": { finding_id: "a.js::x", blocking: true, resolution: "pending" } });
  const rulings = { "f-01": { outcome: "OVERTURN" } };
  const res = bjc.admitBuildRollup({ ledger, rulings, floors: { critical_free_latest: null } });
  assert.equal(res.admit, false, "a degraded floor input must veto, never fail open");
  assert.ok(res.floor_veto.includes("floor_input_degraded"));
});

test("admitBuildRollup (p-17): an OVERTURN-only residue does not veto the floor", () => {
  const ledger = ledgerOf({ "f-01": { finding_id: "a.js::x", blocking: true, resolution: "pending" } });
  const rulings = { "f-01": { outcome: "OVERTURN" } };
  const res = bjc.admitBuildRollup({ ledger, rulings, floors: { critical_free_latest: true } });
  assert.equal(res.admit, true);
  assert.deepEqual(res.floor_veto, []);
});

test("admitBuildRollup: throws {failLoud} for a listed case_id with no ruling and no parked marker", () => {
  const ledger = ledgerOf({ "f-01": { finding_id: "a.js::x", blocking: true, resolution: "pending" } });
  assert.throws(() => bjc.admitBuildRollup({ ledger, rulings: {}, floors: {} }), (e) => !!e.failLoud);
});

test("admitBuildRollup: throws {failLoud} when the ledger lists an order entry with no matching entries{} record", () => {
  const ledger = { order: ["f-01"], entries: {} };
  assert.throws(() => bjc.admitBuildRollup({ ledger, rulings: {}, floors: {} }), (e) => !!e.failLoud);
});
