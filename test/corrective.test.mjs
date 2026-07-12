// FAFF-326 — Sentry-2 Channel A: subtractive corrective authority.
// Exercises the pure fold/validate cores in-process (mirrors corrective-integrity's
// own split) plus the CLI seam via runCli. The asserted:true / "trusted" branch of
// `corrective check` is gated behind the REAL pid-1 FAFF_INTEGRITY_BOUNDARY
// declaration (corrective-integrity.js's realFsq()) — unfakeable from a test's own
// process env, exactly like corrective-integrity's own test file — so it is exercised
// here via the pure fold/validate cores directly, never via runCli. Per ADR 0002 —
// assert the deterministic seam, never prose.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import faff from "../plugin/skills/faff/bin/faff";

const { CORRECTIVE_OPS, foldCorrectiveConstraints, validateCorrectiveInput } = faff;

function tmp() { return mkdtempSync(join(tmpdir(), "faff326-")); }
function mkRun(dir, id) {
  const rd = join(dir, ".faff", "runs", id);
  mkdirSync(rd, { recursive: true });
  writeFileSync(join(rd, "run-ledger.json"), JSON.stringify({
    run_id: id, admitted: ["FAFF-1"], outcomes: {},
    owner: { status: "running", started_at: new Date().toISOString(), last_heartbeat: new Date().toISOString() },
  }, null, 2) + "\n");
  return rd;
}

test("corrective --selftest passes", () => {
  const r = runCli(["corrective", "--selftest"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
});

// --- closed subtractive enum: additive is inexpressible -----------------------------

test("CORRECTIVE_OPS is the closed four-op subtractive enum, no additive escape hatch", () => {
  assert.deepEqual([...CORRECTIVE_OPS].sort(), ["descope-to-subset", "forbid-surface", "park-with-cause", "tighten-threshold"]);
});

// --- author: CLI-level validation + write behaviour ---------------------------------

test("author: missing --cites-signal → exit 2, nothing written (no un-cited input is ever authored)", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    const r = runCli(["corrective", "author", "--run-dir", rd, "--issue", "FAFF-1", "--op", "forbid-surface", "--surface", "src/x.js"]);
    assert.equal(r.code, 2);
    assert.ok(!existsSync(join(rd, "corrective")), "no corrective dir created on a rejected author call");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("author: an unknown/additive op → exit 1, nothing written", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    const r = runCli(["corrective", "author", "--run-dir", rd, "--issue", "FAFF-1", "--op", "grant-authority", "--cites-signal", "fix-review-thrash"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /closed subtractive enum/);
    assert.ok(!existsSync(join(rd, "corrective")), "an invalid op writes nothing");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("author: no run dir → exit 3", () => {
  const dir = tmp();
  try {
    const r = runCli(["corrective", "author", "--run-dir", join(dir, "nope"), "--issue", "FAFF-1", "--op", "forbid-surface", "--surface", "x", "--cites-signal", "fix-review-thrash"]);
    assert.equal(r.code, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("author: a valid forbid-surface input writes the artifact + appends corrective-authored", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    const r = runCli(["corrective", "author", "--run-dir", rd, "--issue", "FAFF-1", "--op", "forbid-surface",
      "--surface", "src/foo.js", "--cites-signal", "fix-review-thrash", "--cites-seq", "5", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.written, true);
    assert.equal(out.event_appended, true);
    assert.ok(existsSync(out.path));
    const record = JSON.parse(readFileSync(out.path, "utf8"));
    assert.equal(record.op, "forbid-surface");
    assert.equal(record.cites.signal, "fix-review-thrash");
    assert.equal(record.cites.event_seq, 5);
    const events = readFileSync(join(rd, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "corrective-authored");
    assert.equal(events[0].issue, "FAFF-1");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("author: tighten-threshold looser than the effective default → exit 1, nothing written", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    // default thrash_n is 3 — 5 is LOOSER, not tighter.
    const r = runCli(["corrective", "author", "--run-dir", rd, "--issue", "FAFF-1", "--op", "tighten-threshold",
      "--threshold-key", "thrash_n", "--threshold-value", "5", "--cites-signal", "fix-review-thrash"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /strictly tighter/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("author: tighten-threshold strictly tighter than the effective default → written", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    const r = runCli(["corrective", "author", "--run-dir", rd, "--issue", "FAFF-1", "--op", "tighten-threshold",
      "--threshold-key", "thrash_n", "--threshold-value", "1", "--cites-signal", "fix-review-thrash", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).written, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- check: unasserted (production-common today) → channel-D, never acted on --------

test("check: unasserted (no real FAFF_INTEGRITY_BOUNDARY declaration) → disposition channel-D, consumed:false, surfaced for human relay", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    runCli(["corrective", "author", "--run-dir", rd, "--issue", "FAFF-1", "--op", "forbid-surface",
      "--surface", "src/foo.js", "--cites-signal", "fix-review-thrash"]);
    const r = runCli(["corrective", "check", "--run-dir", rd, "--issue", "FAFF-1", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.disposition, "channel-D");
    assert.equal(out.consumed, false);
    assert.equal(out.inputs.length, 1, "the artifact is surfaced, never silently dropped");
    // no corrective-consumed event on an unasserted (never-acted-on) check
    const events = readFileSync(join(rd, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(!events.some((e) => e.type === "corrective-consumed"), "unasserted check never appends corrective-consumed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("check: an empty corrective dir (no artifacts authored yet) → channel-D report with zero inputs, never a crash", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    const r = runCli(["corrective", "check", "--run-dir", rd, "--issue", "FAFF-1", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.inputs, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("check: a foreign/hand-written artifact with an additive-shaped op is scoped to `rejected`, never applied — even unasserted (surfaced, not acted on)", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    mkdirSync(join(rd, "corrective"), { recursive: true });
    // A hand-planted artifact bypassing `author` entirely — simulates a build-lane
    // write attempting to forge an additive-shaped corrective input.
    writeFileSync(join(rd, "corrective", "0000-FAFF-1.json"), JSON.stringify({
      schema: 1, run_id: "r1", issue: "FAFF-1", op: "grant-authority", payload: {}, cites: { signal: "fix-review-thrash" },
    }));
    const r = runCli(["corrective", "check", "--run-dir", rd, "--issue", "FAFF-1", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    // Unasserted here too (real sandbox), so the whole surface is channel-D — the
    // point is that this artifact is never trusted regardless of gate state; the
    // schema-level rejection is pinned directly at the pure-core level below.
    assert.equal(out.disposition, "channel-D");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("check: --issue scoping — an artifact filed for a DIFFERENT issue is invisible to this check (not ours to judge)", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    runCli(["corrective", "author", "--run-dir", rd, "--issue", "FAFF-2", "--op", "forbid-surface",
      "--surface", "src/other.js", "--cites-signal", "fix-review-thrash"]);
    const r = runCli(["corrective", "check", "--run-dir", rd, "--issue", "FAFF-1", "--json"]);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.inputs, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- pure cores: the "trusted" (asserted) branch — routing-relevant assertions ------
// (unfakeable via runCli — corrective-integrity's realFsq() reads the genuine pid-1
// environ; exercised here exactly like corrective-integrity's own test file exercises
// its pure correctiveIntegrityProbe/integrityGate directly.)

test("pure: an additive/unknown op is rejected at validation — never reaches the fold (park/needs-human routing input)", () => {
  const v = validateCorrectiveInput({ schema: 1, run_id: "r", issue: "X", op: "grant-authority", payload: {}, cites: { signal: "fix-review-thrash" } });
  assert.ok(v.length > 0);
});

test("pure: an empty descope-to-subset yields mandate:empty — the park-before-dispatch routing input", () => {
  const cites = { signal: "fix-review-thrash", event_seq: 1, evidence: "e" };
  const { mandate } = foldCorrectiveConstraints([{ op: "descope-to-subset", issue: "X", authored_at: "t", payload: { subset: [] }, cites }]);
  assert.equal(mandate, "empty");
});

test("pure: a subtractive input reaches the fold's `applied` list with its citation intact (the audit trail)", () => {
  const cites = { signal: "fix-review-thrash", event_seq: 7, evidence: "3 build-starts" };
  const { applied } = foldCorrectiveConstraints([{ op: "forbid-surface", issue: "X", authored_at: "2026-07-12T00:00:00Z", payload: { surfaces: ["a"] }, cites }]);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].cites.signal, "fix-review-thrash");
});

test("pure: multiple corrective inputs on one issue accumulate reviewably (steering residual, ADR-0039) — applied carries every one, not just the last", () => {
  const cites = { signal: "fix-review-thrash", event_seq: 1, evidence: "e" };
  const inputs = [
    { op: "forbid-surface", issue: "X", authored_at: "t1", payload: { surfaces: ["a"] }, cites },
    { op: "forbid-surface", issue: "X", authored_at: "t2", payload: { surfaces: ["b"] }, cites },
  ];
  const { applied, constraints } = foldCorrectiveConstraints(inputs);
  assert.equal(applied.length, 2);
  assert.deepEqual(constraints.forbid_surfaces.sort(), ["a", "b"]);
});
