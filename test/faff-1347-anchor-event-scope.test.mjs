// FAFF-1347 — scope what a per-issue anchor JUDGES to the anchored issue, while keeping the copied
// run event chain and its witness byte-for-byte intact. One malformed row about an unrelated issue
// no longer makes every issue in a beep-boop run unlandable. Fixtures are built in a temp dir via
// test/helpers/evidence-anchor-fixtures.mjs — never by reading or writing a live run directory.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runCli } from "./helpers/run-cli.mjs";
import { mkScopeRun, mintScopeAnchor, sha256Hex } from "./helpers/evidence-anchor-fixtures.mjs";

const require = createRequire(import.meta.url);
const events = require("../plugin/skills/faff/bin/lib/events.js");
const evidence = require("../plugin/skills/faff/bin/lib/evidence.js");
const { DELIVERY_PROFILE } = require("../plugin/skills/faff/bin/lib/governance-profile.js");

const RUNNER = { github_login: "x", github_login_source: "configured", credential_source: "ambient", credential_unresolved: false, verified: true };
function tmp() { return mkdtempSync(path.join(tmpdir(), "faff1347-")); }
function validate(dir, extra = []) {
  const r = runCli(["evidence", "validate", dir, "--require-evidence-schema", "--json", ...extra]);
  let v = null; try { v = JSON.parse(r.stdout); } catch { /* non-json */ }
  return { code: r.code, stderr: r.stderr, v, events: v && v.files.find((f) => f.path === "events.jsonl") };
}

// ---- classify_row is a pure function of type/issue/data.kernel + the admitted set --------------
test("classify_row: run-scoped by type, OWN, OTHER_ISSUE, UNADMITTED, UNATTRIBUTABLE, sentinel", () => {
  const admitted = new Set(["FAFF-A", "FAFF-B"]);
  const S = events.ROW_SCOPE;
  const c = (row) => events.classifyRow(row, "FAFF-A", admitted, DELIVERY_PROFILE);
  assert.equal(c({ type: "run-start" }), S.RUN);
  assert.equal(c({ type: "ledger-write" }), S.RUN);
  assert.equal(c({ type: "build-start", issue: "FAFF-A" }), S.OWN);
  assert.equal(c({ type: "build-start", issue: "FAFF-B" }), S.OTHER_ISSUE);
  assert.equal(c({ type: "build-start", issue: "FAFF-9999" }), S.UNADMITTED_ISSUE);
  assert.equal(c({ type: "build-start", issue: " " }), S.UNADMITTED_ISSUE);
  assert.equal(c({ type: "build-start", issue: "\t" }), S.UNADMITTED_ISSUE);
  assert.equal(c({ type: "decision-capture", issue: "" }), S.UNATTRIBUTABLE);
  assert.equal(c({ type: "decision-capture", issue: null }), S.UNATTRIBUTABLE);
  assert.equal(c({ type: "decision-capture" }), S.UNATTRIBUTABLE);
  // sentinel bound to a run-level kernel → RUN; any other kernel → UNATTRIBUTABLE
  assert.equal(c({ type: "decision-capture", issue: "__run__", data: { kernel: "run-done" } }), S.RUN);
  assert.equal(c({ type: "decision-capture", issue: "__run__", data: { kernel: "next" } }), S.UNATTRIBUTABLE);
  assert.equal(c({ type: "decision-capture", issue: "__run__" }), S.UNATTRIBUTABLE);
});

// ---- the headline fix: one anchor passes, residue counted, nothing cross-contaminates ----------
function multiRun(root, { badRow = null } = {}) {
  const rows = [
    { phase: "build", type: "build-start", issue: "FAFF-A", data: {} },
    { phase: "build", type: "build-start", issue: "FAFF-B", data: {} },
    { phase: "run", type: "runner-identity", data: RUNNER },
    { phase: "build", type: "decision-capture", issue: "", data: {} },
  ];
  if (badRow) rows.push(badRow);
  return mkScopeRun(root, { admitted: ["FAFF-A", "FAFF-B"], rows });
}

test("a per-issue anchor of a multi-issue run passes, scoping its verdict with residue counts", () => {
  const root = tmp();
  try {
    const { runDir, runName } = multiRun(root);
    const a = mintScopeAnchor(runDir, runName, "FAFF-A", path.join(root, "anchors"));
    const r = validate(a);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.v.status, "pass");
    assert.equal(r.events.scope, "FAFF-A");
    assert.deepEqual(r.events.scope_refusals, []);
    assert.equal(r.events.out_of_scope_rows, 1);
    assert.equal(r.events.unattributable_rows, 1);
    assert.equal(r.events.unattributable_gating, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("each issue's anchor passes independently, and a non-conforming FAFF-B row never fails FAFF-A", () => {
  const root = tmp();
  try {
    // A malformed row BELONGING to FAFF-B (admitted): OTHER_ISSUE for FAFF-A, OWN for FAFF-B.
    const { runDir, runName } = multiRun(root, { badRow: { phase: "build", type: "decision-capture", issue: "FAFF-B", data: {} } });
    const anchors = path.join(root, "anchors");
    const a = mintScopeAnchor(runDir, runName, "FAFF-A", anchors);
    const b = mintScopeAnchor(runDir, runName, "FAFF-B", anchors);
    assert.equal(validate(a).code, 0, "FAFF-A unaffected by FAFF-B's malformed row");
    // FAFF-B's own malformed row DOES fail FAFF-B's anchor (it is OWN there).
    assert.equal(validate(b).code, 1, "FAFF-B's own malformed row fails its own anchor");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---- UNADMITTED_ISSUE: judged in every anchor, counted separately -----------------------------
for (const badIssue of ["FAFF-9999", " "]) {
  test(`a non-conforming row for an unadmitted issue (${JSON.stringify(badIssue)}) fails BOTH anchors under unadmitted_issue_rows`, () => {
    const root = tmp();
    try {
      const { runDir, runName } = mkScopeRun(root, { admitted: ["FAFF-A", "FAFF-B"], rows: [
        { phase: "build", type: "build-start", issue: "FAFF-A", data: {} },
        { phase: "build", type: "build-start", issue: "FAFF-B", data: {} },
        { phase: "build", type: "decision-capture", issue: badIssue, data: {} }, // non-conforming, unadmitted
      ] });
      const anchors = path.join(root, "anchors");
      for (const issue of ["FAFF-A", "FAFF-B"]) {
        const a = mintScopeAnchor(runDir, runName, issue, anchors);
        const r = validate(a);
        assert.equal(r.code, 1, `${issue} fails on the unadmitted row`);
        assert.equal(r.events.unadmitted_issue_rows, 1, `${issue} counts it as unadmitted`);
        // out_of_scope counts ONLY the legit sibling OTHER_ISSUE row (1), never the unadmitted one
        // — if the unadmitted row were folded in it would read 2.
        assert.equal(r.events.out_of_scope_rows, 1, `${issue} never folds the unadmitted row into out_of_scope`);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("a CONFORMING unadmitted-issue row passes both anchors, still counted under unadmitted_issue_rows", () => {
  const root = tmp();
  try {
    const { runDir, runName } = mkScopeRun(root, { admitted: ["FAFF-A", "FAFF-B"], rows: [
      { phase: "build", type: "build-start", issue: "FAFF-A", data: {} },
      { phase: "build", type: "build-start", issue: "FAFF-B", data: {} },
      { phase: "build", type: "park", issue: "FAFF-9999", data: {} }, // conforming; unadmitted
    ] });
    const a = mintScopeAnchor(runDir, runName, "FAFF-A", path.join(root, "anchors"));
    const r = validate(a);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.events.unadmitted_issue_rows, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---- unattributable gating depends on boundness × cardinality ---------------------------------
test("unattributable gating matrix: gates iff the ledger is bound AND names exactly one issue", () => {
  const empty = { phase: "build", type: "decision-capture", issue: "", data: {} };
  const own = { phase: "build", type: "build-start", issue: "FAFF-A", data: {} };
  const cases = [
    { admitted: ["FAFF-A"], bindLedger: true, gates: true },   // bound + single
    { admitted: ["FAFF-A"], bindLedger: false, gates: false }, // unbound + single
    { admitted: ["FAFF-A", "FAFF-B"], bindLedger: true, gates: false }, // bound + multi
    { admitted: ["FAFF-A", "FAFF-B"], bindLedger: false, gates: false }, // unbound + multi
  ];
  for (const c of cases) {
    const root = tmp();
    try {
      const rows = [own, empty];
      if (c.admitted.length > 1) rows.splice(1, 0, { phase: "build", type: "build-start", issue: "FAFF-B", data: {} });
      const { runDir, runName } = mkScopeRun(root, { admitted: c.admitted, bindLedger: c.bindLedger, rows });
      const a = mintScopeAnchor(runDir, runName, "FAFF-A", path.join(root, "anchors"));
      const r = validate(a);
      assert.equal(r.events.unattributable_rows, 1, JSON.stringify(c));
      assert.equal(r.events.unattributable_gating, c.gates, JSON.stringify(c));
      assert.equal(r.code, c.gates ? 1 : 0, JSON.stringify(c));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

// ---- the four corroborations + whole-file fallback --------------------------------------------
test("each of the seven refusal literals, in isolation, applies no narrowing (scope null, whole-file)", () => {
  const mk = () => multiRun(tmp()); // fresh run+anchor per case; returns the anchor dir
  const scenarios = {
    "witness-absent": (a) => unlinkSync(path.join(a, "chain-head.json")),
    "issue-absent": (a) => { const h = JSON.parse(readFileSync(path.join(a, "chain-head.json"))); delete h.issue; writeFileSync(path.join(a, "chain-head.json"), JSON.stringify(h)); },
    "issue-malformed": (a) => { const h = JSON.parse(readFileSync(path.join(a, "chain-head.json"))); h.issue = "../evil"; writeFileSync(path.join(a, "chain-head.json"), JSON.stringify(h)); },
    "ledger-unavailable": (a) => unlinkSync(path.join(a, "run-ledger.json")),
    "ledger-disagrees": (a) => { const h = JSON.parse(readFileSync(path.join(a, "chain-head.json"))); h.issue = "FAFF-NOPE"; writeFileSync(path.join(a, "chain-head.json"), JSON.stringify(h)); },
    "path-disagrees": null, // handled by the rename case below
    "chain-silent": null,   // an admitted-but-never-dispatched issue (no row) — handled below
  };
  for (const [literal, mutate] of Object.entries(scenarios)) {
    if (!mutate) continue;
    const root = tmp();
    try {
      const { runDir, runName } = multiRun(root);
      const a = mintScopeAnchor(runDir, runName, "FAFF-A", path.join(root, "anchors"));
      const whole = validate(a).code; // baseline unscoped-equivalent not needed; we assert scope null + verdict
      mutate(a);
      const r = validate(a);
      assert.equal(r.events.scope, null, `${literal}: no narrowing`);
      assert.deepEqual(r.events.scope_refusals, [literal], `${literal}: exactly that literal`);
      assert.ok(r.events.out_of_scope_rows === undefined, `${literal}: no counts when refused`);
      void whole;
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("path-agreement is unconditional: an anchor at a non-issue-named dir is judged whole-file", () => {
  const root = tmp();
  try {
    // FAFF-B's rows conform; FAFF-A's own row is non-conforming. Point chain-head at FAFF-B but keep
    // the directory named 'notanissue'. Whole-file judgement must still catch FAFF-A's bad row.
    const { runDir, runName } = mkScopeRun(root, { admitted: ["FAFF-A", "FAFF-B"], rows: [
      { phase: "build", type: "build-start", issue: "FAFF-B", data: {} },
      { phase: "build", type: "decision-capture", issue: "FAFF-A", data: {} }, // non-conforming
    ] });
    const a = mintScopeAnchor(runDir, runName, "FAFF-B", path.join(root, "anchors"));
    const moved = path.join(path.dirname(a), "notanissue");
    renameSync(a, moved);
    const r = validate(moved);
    assert.equal(r.events.scope, null);
    assert.deepEqual(r.events.scope_refusals, ["path-disagrees"]);
    assert.equal(r.code, 1, "whole-file still fails on FAFF-A's bad row");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("chain-silent: an admitted-but-never-dispatched issue (no row in the chain) does not narrow", () => {
  const root = tmp();
  try {
    // FAFF-C is admitted but has no row. Mint an anchor named FAFF-C.
    const { runDir, runName } = mkScopeRun(root, { admitted: ["FAFF-A", "FAFF-C"], rows: [
      { phase: "build", type: "build-start", issue: "FAFF-A", data: {} },
    ] });
    const a = mintScopeAnchor(runDir, runName, "FAFF-C", path.join(root, "anchors"));
    const r = validate(a);
    assert.equal(r.events.scope, null);
    assert.deepEqual(r.events.scope_refusals, ["chain-silent"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a lowercase, dotted bare-token issue id narrows (path-safety token shape, not the strict tracker shape)", () => {
  const root = tmp();
  try {
    const { runDir, runName } = mkScopeRun(root, { admitted: ["svc.a-1", "svc.b-2"], rows: [
      { phase: "build", type: "build-start", issue: "svc.a-1", data: {} },
      { phase: "build", type: "build-start", issue: "svc.b-2", data: {} },
    ] });
    const a = mintScopeAnchor(runDir, runName, "svc.a-1", path.join(root, "anchors"));
    const r = validate(a);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.events.scope, "svc.a-1");
    assert.equal(r.events.out_of_scope_rows, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---- the narrowing never hides the anchored issue's OWN defect ---------------------------------
test("the anchored issue's own non-conforming row still fails, the narrowing changing nothing about it", () => {
  const root = tmp();
  try {
    const { runDir, runName } = mkScopeRun(root, { admitted: ["FAFF-A", "FAFF-B"], rows: [
      { phase: "build", type: "decision-capture", issue: "FAFF-A", data: {} }, // OWN, non-conforming
      { phase: "build", type: "build-start", issue: "FAFF-B", data: {} },
    ] });
    const a = mintScopeAnchor(runDir, runName, "FAFF-A", path.join(root, "anchors"));
    const r = validate(a);
    assert.equal(r.code, 1);
    assert.equal(r.events.scope, "FAFF-A");
    assert.ok(r.events.violations.length > 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---- classification ignores seq/ts/position ---------------------------------------------------
test("the classification ignores seq/ts/position (only type/issue/data.kernel + admitted set)", () => {
  const admitted = new Set(["FAFF-A", "FAFF-B"]);
  const r1 = events.classifyRow({ type: "build-start", issue: "FAFF-B", seq: 3, ts: "2020-01-01T00:00:00Z" }, "FAFF-A", admitted, DELIVERY_PROFILE);
  const r2 = events.classifyRow({ type: "build-start", issue: "FAFF-B", seq: 99, ts: "2099-01-01T00:00:00Z" }, "FAFF-A", admitted, DELIVERY_PROFILE);
  assert.equal(r1, r2);
  assert.equal(r1, events.ROW_SCOPE.OTHER_ISSUE);
});

// ---- integrity unit stays the run: events.jsonl byte-identical, witness unchanged --------------
test("a per-issue anchor's events.jsonl is byte-identical to the run's, and the witness verifies", () => {
  const root = tmp();
  try {
    const { runDir, runName } = multiRun(root);
    const a = mintScopeAnchor(runDir, runName, "FAFF-A", path.join(root, "anchors"));
    assert.ok(readFileSync(path.join(a, "events.jsonl")).equals(readFileSync(path.join(runDir, "events.jsonl"))), "byte-identical copy");
    const head = JSON.parse(readFileSync(path.join(a, "chain-head.json")));
    const buf = readFileSync(path.join(runDir, "events.jsonl"));
    const expected = events.computeChainHead(buf, runName, "FAFF-A");
    assert.equal(head.head_sha256, expected.head_sha256);
    assert.equal(head.head_seq, expected.head_seq);
    assert.equal(head.line_count, expected.line_count);
    assert.equal(head.schema_floor, expected.schema_floor);
    assert.equal(events.verifyExitCode(events.verifyChain(a), "pass"), 0, "the anchored chain verifies");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---- the shared predicate: substitution over an explicit fixture ------------------------------
test("the scoped verdict reaches ONE shared classifier (events.classifyRow) — a double flips it", () => {
  const root = tmp();
  try {
    // One OWN (conforming), one RUN (conforming), one OTHER_ISSUE (non-conforming) at a known line.
    const { runDir, runName } = mkScopeRun(root, { admitted: ["FAFF-A", "FAFF-B"], rows: [
      { phase: "build", type: "build-start", issue: "FAFF-A", data: {} },
      { phase: "run", type: "runner-identity", data: RUNNER },
      { phase: "build", type: "decision-capture", issue: "FAFF-B", data: {} }, // OTHER_ISSUE, non-conforming
    ] });
    const a = mintScopeAnchor(runDir, runName, "FAFF-A", path.join(root, "anchors"));
    const real = evidence.validateAnchorDir(a);
    const realEvents = real.files.find((f) => f.path === "events.jsonl");
    assert.deepEqual(realEvents.violations, [], "scoped: OTHER_ISSUE row contributes no gating violation");
    // Substitute a double that classifies EVERY row OWN → the same OTHER_ISSUE row now gates.
    const orig = events.classifyRow;
    events.classifyRow = () => events.ROW_SCOPE.OWN;
    try {
      const doubled = evidence.validateAnchorDir(a);
      const de = doubled.files.find((f) => f.path === "events.jsonl");
      assert.ok(de.violations.length > 0, "double classifying every row OWN makes the bad row gate");
    } finally { events.classifyRow = orig; }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---- injection hygiene ------------------------------------------------------------------------
test("a chain-head issue carrying :: / control chars yields issue-malformed with no value leaked", () => {
  const root = tmp();
  try {
    const { runDir, runName } = multiRun(root);
    const a = mintScopeAnchor(runDir, runName, "FAFF-A", path.join(root, "anchors"));
    const h = JSON.parse(readFileSync(path.join(a, "chain-head.json")));
    h.issue = "FAFF-1::error::injected";
    writeFileSync(path.join(a, "chain-head.json"), JSON.stringify(h));
    const r = validate(a);
    assert.equal(r.events.scope, null);
    assert.deepEqual(r.events.scope_refusals, ["issue-malformed"]);
    assert.ok(!JSON.stringify(r.v).includes("FAFF-1::error::injected"), "the proposed value never leaks");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---- unparseable line gates regardless of scope ------------------------------------------------
test("an unparseable interior line is a gating violation even under narrowing", () => {
  const root = tmp();
  try {
    const { runDir, runName } = multiRun(root);
    const a = mintScopeAnchor(runDir, runName, "FAFF-A", path.join(root, "anchors"));
    // Corrupt an interior line (not the last) of the ANCHOR copy, post-mint. The chain-head still
    // names FAFF-A and the FAFF-A row still parses, so narrowing applies; the unparseable line must
    // still gate (a corrupt line can never be classified out).
    const file = path.join(a, "events.jsonl");
    const lines = readFileSync(file, "utf8").replace(/\n$/, "").split("\n");
    lines.splice(2, 0, "{ this is not json");
    writeFileSync(file, lines.join("\n") + "\n");
    const r = validate(a);
    assert.equal(r.code, 1);
    assert.ok(r.events.violations.some((v) => /line 3: not valid JSON/.test(v)), JSON.stringify(r.events.violations));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
