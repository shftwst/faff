// FAFF-1347 — the run-dir whole-file evidence_schema leg (the residue's home), the anchor-run
// self-verify spawn, the two optional governance-profile keys, and the checkAnchorDir scope carry.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { runCli } from "./helpers/run-cli.mjs";
import { mkScopeRun, mintScopeAnchor } from "./helpers/evidence-anchor-fixtures.mjs";

const require = createRequire(import.meta.url);
const evidence = require("../plugin/skills/faff/bin/lib/evidence.js");
const { DELIVERY_PROFILE, validateProfileShape } = require("../plugin/skills/faff/bin/lib/governance-profile.js");

const RUNNER = { github_login: "x", github_login_source: "configured", credential_source: "ambient", credential_unresolved: false, verified: true };
const own = (i = "FAFF-A") => ({ phase: "build", type: "build-start", issue: i, data: {} });
const emptyRow = { phase: "build", type: "decision-capture", issue: "", data: {} };
function tmp() { return mkdtempSync(path.join(tmpdir(), "faff1347rd-")); }

// ---- the run-dir whole-file leg (narrowing off) + the legacy cutoff ---------------------------
test("run-dir leg: an empty-issue row in a post-cutoff multi-issue run gates; pre-cutoff it is advisory", () => {
  for (const [startTs, gates] of [["2026-11-01T00:00:00Z", true], ["2026-10-20T17:51:17Z", false]]) {
    const root = tmp();
    try {
      const { runDir } = mkScopeRun(root, { admitted: ["FAFF-A", "FAFF-B"], startTs, rows: [own("FAFF-A"), own("FAFF-B"), emptyRow] });
      const r = evidence.evaluateRunDirEventsSchema(runDir);
      assert.equal(r.pass, !gates, `startTs ${startTs}`);
      assert.equal(r.legacy_relief, !gates);
      assert.equal(gates ? r.gating.length : r.advisory.length, 1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("run-dir leg: a SINGLE-issue pre-cutoff run gets no relief (no other issue to hold hostage)", () => {
  const root = tmp();
  try {
    const { runDir } = mkScopeRun(root, { admitted: ["FAFF-A"], startTs: "2026-10-20T17:51:17Z", rows: [own("FAFF-A"), emptyRow] });
    const r = evidence.evaluateRunDirEventsSchema(runDir);
    assert.equal(r.pass, false);
    assert.equal(r.legacy_relief, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("run-dir leg: a legacy multi-issue run whose only violation is a NON-empty bad issue still gates", () => {
  const root = tmp();
  try {
    // Non-conforming row with a non-empty (unadmitted) issue — NOT relieved by the cutoff.
    const { runDir } = mkScopeRun(root, { admitted: ["FAFF-A", "FAFF-B"], startTs: "2026-10-20T17:51:17Z",
      rows: [own("FAFF-A"), own("FAFF-B"), { phase: "build", type: "decision-capture", issue: "FAFF-9999", data: {} }] });
    const r = evidence.evaluateRunDirEventsSchema(runDir);
    assert.equal(r.pass, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("run-dir leg: whole-file judges OTHER-issue rows too (narrowing off), unlike the scoped verdict", () => {
  const root = tmp();
  try {
    const { runDir, runName } = mkScopeRun(root, { admitted: ["FAFF-A", "FAFF-B"], rows: [own("FAFF-A"),
      { phase: "build", type: "decision-capture", issue: "FAFF-B", data: {} }] }); // non-conforming OTHER row
    // Scoped (per-issue FAFF-A anchor): the FAFF-B row is out of scope → no gating violation.
    const a = mintScopeAnchor(runDir, runName, "FAFF-A", path.join(root, "anchors"));
    const scoped = evidence.validateAnchorDir(a).files.find((f) => f.path === "events.jsonl");
    assert.deepEqual(scoped.violations, []);
    // Whole-file (run-dir leg): the same bad FAFF-B row DOES gate.
    const whole = evidence.evaluateRunDirEventsSchema(runDir);
    assert.equal(whole.pass, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("governance-check --run-dir carries a report-only evidence_schema leg; --require-evidence-schema gates", () => {
  const root = tmp();
  try {
    const { runDir } = mkScopeRun(root, { admitted: ["FAFF-A", "FAFF-B"], rows: [own("FAFF-A"), own("FAFF-B"), emptyRow] });
    const report = runCli(["governance-check", "--run-dir", runDir, "--json"]);
    const rj = JSON.parse(report.stdout);
    assert.equal(rj.runs[0].legs.evidence_schema.report_only, true);
    const gate = runCli(["governance-check", "--run-dir", runDir, "--require-evidence-schema", "--json"]);
    const gj = JSON.parse(gate.stdout);
    assert.equal(gj.runs[0].legs.evidence_schema.report_only, false);
    assert.equal(gj.runs[0].legs.evidence_schema.status, "fail");
    // The leg names the offending line number in its reasons + detail.
    assert.ok(gj.reasons.some((x) => /evidence_schema/.test(x)), JSON.stringify(gj.reasons));
    assert.match(gj.runs[0].legs.evidence_schema.detail, /line \d/);
    // Text + summary renderers surface the leg (not just --json).
    const text = runCli(["governance-check", "--run-dir", runDir, "--require-evidence-schema"]);
    assert.match(text.stdout, /evidence_schema/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---- anchor-run spawns the run-dir judgement; wipes on a non-pass leg --------------------------
function anchorRun(runDir, dest) {
  const r = runCli(["events", "anchor-run", "--run-dir", runDir, "--dest", dest]);
  return { code: r.code, stderr: r.stderr };
}

test("anchor-run: a clean multi-issue run exits 0 and mints every issue's anchor", () => {
  const root = tmp();
  try {
    const { runDir } = mkScopeRun(root, { admitted: ["FAFF-A", "FAFF-B"], outcomes: { "FAFF-A": "parked", "FAFF-B": "parked" }, rows: [own("FAFF-A"), own("FAFF-B")] });
    const dest = path.join(root, "anchors", "run");
    assert.equal(anchorRun(runDir, dest).code, 0);
    assert.ok(existsSync(path.join(dest, "FAFF-A")) && existsSync(path.join(dest, "FAFF-B")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("anchor-run: a post-cutoff empty-issue row fails the run-dir leg → exits non-zero, no dest", () => {
  const root = tmp();
  try {
    const { runDir } = mkScopeRun(root, { admitted: ["FAFF-A", "FAFF-B"], outcomes: { "FAFF-A": "parked", "FAFF-B": "parked" }, startTs: "2026-11-01T00:00:00Z", rows: [own("FAFF-A"), own("FAFF-B"), emptyRow] });
    const dest = path.join(root, "anchors", "run");
    const r = anchorRun(runDir, dest);
    assert.notEqual(r.code, 0);
    assert.ok(!existsSync(dest), "dest wiped");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("anchor-run: a pre-cutoff legacy empty-issue row is advisory → exits 0 and mints", () => {
  const root = tmp();
  try {
    const { runDir } = mkScopeRun(root, { admitted: ["FAFF-A", "FAFF-B"], outcomes: { "FAFF-A": "parked", "FAFF-B": "parked" }, startTs: "2026-10-20T17:51:17Z", rows: [own("FAFF-A"), own("FAFF-B"), emptyRow] });
    const dest = path.join(root, "anchors", "run");
    assert.equal(anchorRun(runDir, dest).code, 0);
    assert.ok(existsSync(path.join(dest, "FAFF-A")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("anchor-run: a corroborated-sentinel run (no empty-issue row) exits 0 and mints", () => {
  const root = tmp();
  try {
    const sentinel = { phase: "build", type: "decision-capture", issue: "__run__", data: { kernel: "run-done", kernel_version: "v1", correlation_id: "c1", normalised_inputs: {}, verdict: {}, coverage: "replayable", missing_inputs: [], causation: { seq: 1, sha256: "a".repeat(64) } } };
    const { runDir } = mkScopeRun(root, { admitted: ["FAFF-A", "FAFF-B"], outcomes: { "FAFF-A": "parked", "FAFF-B": "parked" }, rows: [own("FAFF-A"), own("FAFF-B"), sentinel] });
    const r = evidence.evaluateRunDirEventsSchema(runDir);
    // The sentinel row classifies RUN (corroborated kernel) → never an unattributable row.
    assert.equal(r.gating.filter((e) => e.issue === "").length, 0);
    const dest = path.join(root, "anchors", "run");
    assert.equal(anchorRun(runDir, dest).code, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---- the two optional profile keys ------------------------------------------------------------
test("run_subject_sentinels / run_level_decision_kernels are optional profile keys", () => {
  assert.deepEqual(DELIVERY_PROFILE.run_subject_sentinels, ["__run__"]);
  assert.deepEqual(DELIVERY_PROFILE.run_level_decision_kernels, ["queue-state", "run-start", "run-done", "run-outward"]);
  // Present but wrong type → a violation.
  assert.ok(validateProfileShape({ ...DELIVERY_PROFILE, run_subject_sentinels: "x" }).some((v) => /run_subject_sentinels/.test(v)));
  assert.ok(validateProfileShape({ ...DELIVERY_PROFILE, run_level_decision_kernels: [1] }).some((v) => /run_level_decision_kernels/.test(v)));
  // Absent (a profile predating the keys) → still shape-valid.
  const old = { ...DELIVERY_PROFILE };
  delete old.run_subject_sentinels; delete old.run_level_decision_kernels;
  assert.deepEqual(validateProfileShape(old), []);
});

test("an override profile predating the two keys validates, and the classifier falls back to DELIVERY_PROFILE", () => {
  const events = require("../plugin/skills/faff/bin/lib/events.js");
  const old = { ...DELIVERY_PROFILE };
  delete old.run_subject_sentinels; delete old.run_level_decision_kernels;
  // A sentinel row with the default run-level kernel still classifies RUN under the key-less profile.
  const scope = events.classifyRow({ type: "decision-capture", issue: "__run__", data: { kernel: "run-done" } }, "FAFF-A", new Set(["FAFF-A"]), old);
  assert.equal(scope, events.ROW_SCOPE.RUN);
});

test("an override profile that renames the sentinel changes classification with no validator edit", () => {
  const events = require("../plugin/skills/faff/bin/lib/events.js");
  const renamed = { ...DELIVERY_PROFILE, run_subject_sentinels: ["__RUN_WIDE__"], run_level_decision_kernels: ["run-done"] };
  assert.deepEqual(validateProfileShape(renamed), []);
  assert.equal(events.classifyRow({ type: "decision-capture", issue: "__RUN_WIDE__", data: { kernel: "run-done" } }, "FAFF-A", new Set(["FAFF-A"]), renamed), events.ROW_SCOPE.RUN);
  // The old literal no longer counts as run-scope under the renamed profile (it is just another
  // non-admitted issue string now) — the point is it is NOT classified RUN.
  assert.notEqual(events.classifyRow({ type: "decision-capture", issue: "__run__", data: { kernel: "run-done" } }, "FAFF-A", new Set(["FAFF-A"]), renamed), events.ROW_SCOPE.RUN);
});

test("adding a type to issue_scoped_types changes classification with no validator edit", () => {
  const events = require("../plugin/skills/faff/bin/lib/events.js");
  const extended = { ...DELIVERY_PROFILE, issue_scoped_types: [...DELIVERY_PROFILE.issue_scoped_types, "run-start"] };
  // run-start is now issue-scoped; with no issue it is unattributable rather than run-scoped.
  assert.equal(events.classifyRow({ type: "run-start" }, "FAFF-A", new Set(["FAFF-A"]), extended), events.ROW_SCOPE.UNATTRIBUTABLE);
});

// ---- checkAnchorDir carries the scope block whatever the status --------------------------------
test("checkAnchorDir carries the events.jsonl scope block for a PASSING anchor (status ok)", () => {
  const root = tmp();
  try {
    const { runDir, runName } = mkScopeRun(root, { admitted: ["FAFF-A", "FAFF-B"], rows: [own("FAFF-A"), own("FAFF-B"), { phase: "run", type: "runner-identity", data: RUNNER }, emptyRow] });
    const a = mintScopeAnchor(runDir, runName, "FAFF-A", path.join(root, "anchors"));
    const check = evidence.checkAnchorDir(a);
    assert.equal(check.status, "pass");
    assert.ok(check.events_scope, "scope block survives the fold even when the anchor passes");
    assert.equal(check.events_scope.scope, "FAFF-A");
    assert.equal(check.events_scope.out_of_scope_rows, 1);
    assert.equal(check.events_scope.unattributable_rows, 1);
    assert.equal(check.events_scope.unattributable_gating, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
