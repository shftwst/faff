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
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { runCli } from "./helpers/run-cli.mjs";
import faff from "../plugin/skills/faff/bin/faff";

const { CORRECTIVE_OPS, foldCorrectiveAuthority, foldCorrectiveConstraints, validateCorrectiveInput } = faff;

// FAFF-843: buildManifest — only needed to CONSTRUCT held-baseline fixtures for the
// --manifest wiring tests below; integrity-digest.js itself stays unmodified (the
// module under test here is corrective.js, which imports only diffAgainstManifest).
const require = createRequire(import.meta.url);
const { buildManifest } = require("../plugin/skills/faff/bin/lib/integrity-digest.js");

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
    // the event data carries the FULL written record (not a summary) — the audit
    // trail's whole value is being actually reviewable.
    assert.equal(events[0].data.op, "forbid-surface");
    assert.deepEqual(events[0].data.payload, { surfaces: ["src/foo.js"] });
    assert.equal(events[0].data.cites.signal, "fix-review-thrash");
    assert.equal(events[0].data.artifact, "0000-FAFF-1.json");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("author: a --cites-signal outside the derailment signal vocabulary → exit 1, nothing written (a real citation must trace to an actual trigger)", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    const r = runCli(["corrective", "author", "--run-dir", rd, "--issue", "FAFF-1", "--op", "forbid-surface",
      "--surface", "src/foo.js", "--cites-signal", "banana"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /derailment signal vocabulary/);
    assert.ok(!existsSync(join(rd, "corrective")));
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

test("author: a deleted earlier artifact never causes a later one to silently overwrite (collision-safe, count-independent naming)", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    const author = (surface) => JSON.parse(runCli(["corrective", "author", "--run-dir", rd, "--issue", "FAFF-1", "--op", "forbid-surface",
      "--surface", surface, "--cites-signal", "fix-review-thrash", "--json"]).stdout);
    const first = author("a");
    const second = author("b");
    assert.notEqual(first.path, second.path);
    // Simulate a compaction/cleanup deleting the FIRST artifact — a count-based seq
    // (existing.length) would now recompute the same seq the deleted file had.
    rmSync(first.path);
    const third = author("c");
    assert.notEqual(third.path, second.path, "the third artifact must never collide with — and silently overwrite — the survivor");
    // the survivor (second) is untouched
    const survivorRecord = JSON.parse(readFileSync(second.path, "utf8"));
    assert.deepEqual(survivorRecord.payload.surfaces, ["b"]);
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

// ===========================================================================
// FAFF-843 (ADR-0114) — foldCorrectiveAuthority: the digest-custody composition
// fold that admits the detective basis into the corrective authority decision as a
// distinct, weaker basis than mount-asserted. Five-branch table, precedence-ordered.
// ===========================================================================

// --- pure: the five branches, exactly as the ADR-0114 contract fixes them ----------

test("foldCorrectiveAuthority branch 3: held+clean digest verify → custody-trusted/digest-verified", () => {
  const r = foldCorrectiveAuthority({ trusted: false }, { held: true, diffs: [] });
  assert.deepEqual(r, { trusted: true, disposition: "custody-trusted", basis: "digest-verified" });
});

test("foldCorrectiveAuthority branch 4: held+tampered digest verify → refuse/tampered (proven forge, never surfaced)", () => {
  const r = foldCorrectiveAuthority({ trusted: false }, { held: true, diffs: ["corrective/0001-X.json"] });
  assert.deepEqual(r, { trusted: false, disposition: "refuse", basis: "tampered" });
});

test("foldCorrectiveAuthority branch 2: held+error (uncomputable verify) → refuse/unverifiable — never trust an uncomputable verify", () => {
  const r = foldCorrectiveAuthority({ trusted: false }, { held: true, error: "no SHA-256 tool found" });
  assert.deepEqual(r, { trusted: false, disposition: "refuse", basis: "unverifiable" });
});

test("foldCorrectiveAuthority branch 5: not held → channel-D/none, byte-identical to today's unasserted behaviour", () => {
  const r = foldCorrectiveAuthority({ trusted: false }, { held: false });
  assert.deepEqual(r, { trusted: false, disposition: "channel-D", basis: "none" });
});

test("foldCorrectiveAuthority branch 1: mount-trusted → trusted/asserted regardless of digest state — the strongest basis wins over ANY digest state, including tampered", () => {
  const r1 = foldCorrectiveAuthority({ trusted: true }, { held: false });
  assert.deepEqual(r1, { trusted: true, disposition: "trusted", basis: "asserted" });
  const r2 = foldCorrectiveAuthority({ trusted: true }, { held: true, diffs: ["corrective/x.json (added)"] });
  assert.deepEqual(r2, { trusted: true, disposition: "trusted", basis: "asserted" }, "digest state neither alters nor dilutes a genuine mount grant");
  const r3 = foldCorrectiveAuthority({ trusted: true }, { held: true, error: "boom" });
  assert.deepEqual(r3, { trusted: true, disposition: "trusted", basis: "asserted" });
});

// --- precedence: branch 2 sits ABOVE branches 3/4 — an indeterminate verify can NEVER fall through to a grant ---

test("foldCorrectiveAuthority precedence: held+error takes priority even when diffs would otherwise read clean (defensive — a caller must never construct both, but precedence must hold if it happens)", () => {
  const r = foldCorrectiveAuthority({ trusted: false }, { held: true, error: "unresolvable", diffs: [] });
  assert.equal(r.disposition, "refuse");
  assert.equal(r.basis, "unverifiable", "the error branch wins over the clean-diffs branch — never falls through to a grant");
});

test("foldCorrectiveAuthority: no held baseline never trusts even with a stray error/diffs field present (held:false is dispositive)", () => {
  const r = foldCorrectiveAuthority({ trusted: false }, { held: false, diffs: [] });
  assert.deepEqual(r, { trusted: false, disposition: "channel-D", basis: "none" });
});

// --- integration: the --manifest wiring on cmdCorrectiveCheck ----------------------

test("check --manifest: absent → byte-identical to today (digestVerify held:false; disposition channel-D, basis none; no basis-related change to the no-manifest path)", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    runCli(["corrective", "author", "--run-dir", rd, "--issue", "FAFF-1", "--op", "forbid-surface",
      "--surface", "src/foo.js", "--cites-signal", "fix-review-thrash"]);
    const r = runCli(["corrective", "check", "--run-dir", rd, "--issue", "FAFF-1", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.disposition, "channel-D");
    assert.equal(out.basis, "none");
    assert.equal(out.consumed, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("check --manifest -: the happy-path re-baseline scenario — a manifest snapshotted AFTER the trusted `corrective author` write verifies clean → custody-trusted/digest-verified, consumed:true, event records basis (the trusted-authored artifact is NOT flagged as tamper)", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    const authored = JSON.parse(runCli(["corrective", "author", "--run-dir", rd, "--issue", "FAFF-1", "--op", "forbid-surface",
      "--surface", "src/foo.js", "--cites-signal", "fix-review-thrash", "--json"]).stdout);
    assert.equal(authored.written, true);
    // The re-baselined baseline M': snapshotted AFTER corrective author's write, so its
    // lineage already contains the trusted artifact — exactly obligation-5's Class-A
    // re-baseline sequence this ticket's HOW section describes.
    const manifest = JSON.stringify(buildManifest(rd));
    const r = runCli(["corrective", "check", "--run-dir", rd, "--issue", "FAFF-1", "--manifest", "-", "--json"], { input: manifest });
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.disposition, "custody-trusted");
    assert.equal(out.basis, "digest-verified");
    assert.equal(out.consumed, true);
    const events = readFileSync(join(rd, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const consumed = events.find((e) => e.type === "corrective-consumed");
    assert.ok(consumed, "corrective-consumed WAS appended on a custody-trusted consumption");
    assert.equal(consumed.data.basis, "digest-verified");
    assert.equal(consumed.data.disposition, "custody-trusted");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("check --manifest -: the happy-path re-baseline scenario holds under the REAL obligation-5 baseline shape too — a manifest built WITH --events (the 3-entry corrective/+run-ledger.json+events.jsonl set the real orchestrator holds, per correctiveIntegrityDirs(runDir,null,{events:true})) still verifies clean after a corrective author write, because events.jsonl's legitimate append is tolerated by the prefix-preserving rule (adversarial-review follow-up: the other manifest tests here use the narrower 2-entry buildManifest(rd) set, which never exercises this interaction)", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    // Snapshot the FULL obligation-5 baseline (including events.jsonl) BEFORE the
    // trusted corrective author write appends to events.jsonl (corrective-authored)
    // and later corrective-consumed events.
    const preManifest = buildManifest(rd, null, true);
    runCli(["corrective", "author", "--run-dir", rd, "--issue", "FAFF-1", "--op", "forbid-surface",
      "--surface", "src/foo.js", "--cites-signal", "fix-review-thrash"]);
    // Re-baseline AFTER the trusted write, exactly as obligation-5's Class-A sequence
    // does — the manifest now contains both the new corrective/ artifact and the
    // events.jsonl tail the author write appended.
    const manifest = JSON.stringify(buildManifest(rd, null, true));
    const r = runCli(["corrective", "check", "--run-dir", rd, "--issue", "FAFF-1", "--manifest", "-", "--json"], { input: manifest });
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.disposition, "custody-trusted", "the events.jsonl append (a legitimate prefix-preserving extend) never false-flags as tamper under the full obligation-5 baseline shape");
    assert.equal(out.basis, "digest-verified");
    assert.equal(out.consumed, true);
    // Sanity: the pre-authoring full-baseline manifest, by contrast, DOES reads the new
    // corrective/ artifact as tamper — mirroring the anti-scenario below, now under the
    // real (events-inclusive) shape too.
    const preCheck = runCli(["corrective", "check", "--run-dir", rd, "--issue", "FAFF-1", "--manifest", "-", "--json"], { input: JSON.stringify(preManifest) });
    assert.equal(JSON.parse(preCheck.stdout).disposition, "refuse");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("check --manifest -: the anti-scenario — a manifest snapshotted BEFORE the trusted `corrective author` write reads the new artifact as (added) → refuse/tampered, consumed:false (the mis-plumbing the executor MUST avoid; fails safe, but would kill the happy path)", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    // The PRE-authoring manifest — snapshotted before any corrective/ artifact exists.
    const preManifest = JSON.stringify(buildManifest(rd));
    runCli(["corrective", "author", "--run-dir", rd, "--issue", "FAFF-1", "--op", "forbid-surface",
      "--surface", "src/foo.js", "--cites-signal", "fix-review-thrash"]);
    const r = runCli(["corrective", "check", "--run-dir", rd, "--issue", "FAFF-1", "--manifest", "-", "--json"], { input: preManifest });
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.disposition, "refuse");
    assert.equal(out.basis, "tampered");
    assert.equal(out.consumed, false);
    // no corrective-consumed on a refused consumption — a proven/uncomputable failure is never surfaced as authentic
    const events = readFileSync(join(rd, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(!events.some((e) => e.type === "corrective-consumed"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("check --manifest -: an unreadable evidence member (the verify cannot be computed) → refuse/unverifiable, never caught-and-defaulted to a clean/custody-trusted grant", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    runCli(["corrective", "author", "--run-dir", rd, "--issue", "FAFF-1", "--op", "forbid-surface",
      "--surface", "src/foo.js", "--cites-signal", "fix-review-thrash"]);
    const manifest = JSON.stringify(buildManifest(rd));
    // Make the artifact unreadable AFTER the manifest was snapshotted (simulating a
    // verify that cannot be computed at consumption time) — diffAgainstManifest's
    // underlying fs.readFileSync throws; cmdCorrectiveCheck must catch it and
    // construct {held:true,error}, never default to clean diffs.
    const artifactPath = join(rd, "corrective", "0000-FAFF-1.json");
    chmodSync(artifactPath, 0o000);
    try {
      const r = runCli(["corrective", "check", "--run-dir", rd, "--issue", "FAFF-1", "--manifest", "-", "--json"], { input: manifest });
      assert.equal(r.code, 0, r.stderr);
      const out = JSON.parse(r.stdout);
      assert.equal(out.disposition, "refuse");
      assert.equal(out.basis, "unverifiable");
      assert.equal(out.consumed, false);
    } finally { chmodSync(artifactPath, 0o644); } // restore so rmSync can clean up
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("check --manifest: malformed JSON → exit 2 (usage error), distinct from the held:false (channel-D) path", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    const r = runCli(["corrective", "check", "--run-dir", rd, "--issue", "FAFF-1", "--manifest", "-", "--json"], { input: "{not valid json" });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /not valid JSON/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("check --manifest: valid JSON with no `members` → exit 2 (usage error), distinct from the held:false (channel-D) path", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    const r = runCli(["corrective", "check", "--run-dir", rd, "--issue", "FAFF-1", "--manifest", "-", "--json"], { input: JSON.stringify({ version: 1 }) });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /no members/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- FAFF-853: negligent-hollow guard — an empty/wrong-roster --manifest is refused
// before it can trivially reach custody-trusted having verified nothing ---

test("check --manifest: an empty-members manifest ({version,grain,members:{}}) → exit 2 hollow refusal, NEVER reaches custody-trusted", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    const hollow = JSON.stringify({ version: "d1", grain: "run", members: {} });
    const r = runCli(["corrective", "check", "--run-dir", rd, "--issue", "FAFF-1", "--manifest", "-", "--json"], { input: hollow });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /hollow — missing core roster member/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("check --manifest: a manifest missing ONLY run-ledger.json (corrective present) → exit 2 hollow refusal", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    const partial = JSON.stringify({ version: "d1", grain: "run", members: { corrective: { present: true, dir: true, files: {} } } });
    const r = runCli(["corrective", "check", "--run-dir", rd, "--issue", "FAFF-1", "--manifest", "-", "--json"], { input: partial });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /hollow — missing core roster member/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- FAFF-853: the spec's own end-to-end smoke procedure — snapshot, corrective author,
// rebaseline, verify — wired through the real CLI at every step, no shortcuts ---

test("integration smoke: snapshot -> corrective author -> integrity-digest rebaseline -> verify round-trips clean, and check --manifest then reaches custody-trusted off the SAME M'", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    // Real obligation-5 usage always opens the custody chain against an already-genesis'd run
    // dir — events.jsonl exists from run start, before any snapshot is taken. Match that here
    // (rather than exercising events.jsonl's own from-nothing-to-present edge, which is a
    // pre-existing diffAgainstManifest property this ticket's spec explicitly leaves untouched
    // — see the OUT OF SCOPE "events.jsonl re-baselining" note).
    writeFileSync(join(rd, "events.jsonl"), "");
    const heldM = runCli(["integrity-digest", "snapshot", "--run-dir", rd, "--events"]).stdout; // held baseline
    const authored = JSON.parse(runCli(["corrective", "author", "--run-dir", rd, "--issue", "FAFF-1", "--op", "forbid-surface",
      "--surface", "src/foo.js", "--cites-signal", "fix-review-thrash", "--json"]).stdout);
    assert.equal(authored.written, true);
    const writtenRel = authored.path.slice(rd.length + 1); // runDir-relative, matches the verb's own normalization
    const rb = runCli([
      "integrity-digest", "rebaseline", "--run-dir", rd, "--events", "--manifest", "-",
      "--written-path", writtenRel, "--reported-sha256", authored.sha256,
    ], { input: heldM });
    assert.equal(rb.code, 0, rb.stderr); // step 4: expect exit 0, M' on stdout
    const mPrime = rb.stdout;
    const v = runCli(["integrity-digest", "verify", "--run-dir", rd, "--events", "--manifest", "-"], { input: mPrime });
    assert.equal(v.code, 0, v.stderr); // step 5: M' verifies clean against the branch that produced it
    // the fold is wired end-to-end: the same M' also grants custody-trusted at `corrective check`
    const r = runCli(["corrective", "check", "--run-dir", rd, "--issue", "FAFF-1", "--manifest", "-", "--json"], { input: mPrime });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).disposition, "custody-trusted");
    assert.equal(JSON.parse(r.stdout).basis, "digest-verified");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("check --manifest: a real, full-roster baseline (built with buildManifest) still reaches custody-trusted — the guard is default-on but never affects a legitimate baseline", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    runCli(["corrective", "author", "--run-dir", rd, "--issue", "FAFF-1", "--op", "forbid-surface",
      "--surface", "src/foo.js", "--cites-signal", "fix-review-thrash"]);
    const manifest = JSON.stringify(buildManifest(rd));
    const r = runCli(["corrective", "check", "--run-dir", rd, "--issue", "FAFF-1", "--manifest", "-", "--json"], { input: manifest });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).disposition, "custody-trusted");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- idempotency: basis is part of foldFingerprint — a basis transition re-records ---

test("check --manifest -: re-running the SAME custody-trusted check with the SAME manifest is idempotent-skipped (basis unchanged, no phantom duplicate event)", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    runCli(["corrective", "author", "--run-dir", rd, "--issue", "FAFF-1", "--op", "forbid-surface",
      "--surface", "src/foo.js", "--cites-signal", "fix-review-thrash"]);
    const manifest = JSON.stringify(buildManifest(rd));
    const first = JSON.parse(runCli(["corrective", "check", "--run-dir", rd, "--issue", "FAFF-1", "--manifest", "-", "--json"], { input: manifest }).stdout);
    assert.equal(first.event_appended, true);
    const second = JSON.parse(runCli(["corrective", "check", "--run-dir", rd, "--issue", "FAFF-1", "--manifest", "-", "--json"], { input: manifest }).stdout);
    assert.equal(second.event_appended, false);
    assert.equal(second.event_skipped, "idempotent-duplicate");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("check --manifest -: a BASIS TRANSITION re-records even when mandate/constraints/applied/rejected are unchanged — a legacy pre-FAFF-843 event (no `basis` field, defaults to \"asserted\") never falsely idempotent-skips a matching digest-verified check", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r1");
    runCli(["corrective", "author", "--run-dir", rd, "--issue", "FAFF-1", "--op", "forbid-surface",
      "--surface", "src/foo.js", "--cites-signal", "fix-review-thrash"]);
    const manifest = JSON.stringify(buildManifest(rd));
    const first = JSON.parse(runCli(["corrective", "check", "--run-dir", rd, "--issue", "FAFF-1", "--manifest", "-", "--json"], { input: manifest }).stdout);
    assert.equal(first.event_appended, true);
    assert.equal(first.basis, "digest-verified");

    // Simulate migration: rewrite the just-recorded corrective-consumed event to strip
    // its `basis` field entirely, as a genuine pre-FAFF-843 event would have no basis
    // key at all (foldFingerprint's documented legacy default is "asserted").
    const eventsPath = join(rd, "events.jsonl");
    const lines = readFileSync(eventsPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const idx = lines.findIndex((e) => e.type === "corrective-consumed");
    assert.ok(idx >= 0);
    delete lines[idx].data.basis;
    writeFileSync(eventsPath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

    // Re-run the identical custody-trusted check (same manifest, same artifacts —
    // mandate/constraints/applied/rejected all unchanged). Because the prior event's
    // basis now defaults to "asserted" while THIS check's basis is "digest-verified",
    // the fingerprints differ and a fresh corrective-consumed IS appended — never a
    // false idempotent-skip driven by a basis the fold silently ignored.
    const second = JSON.parse(runCli(["corrective", "check", "--run-dir", rd, "--issue", "FAFF-1", "--manifest", "-", "--json"], { input: manifest }).stdout);
    assert.equal(second.event_appended, true, "a basis transition must re-record, not idempotent-skip");
    assert.equal(second.basis, "digest-verified");

    const finalEvents = readFileSync(eventsPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const consumedCount = finalEvents.filter((e) => e.type === "corrective-consumed").length;
    assert.equal(consumedCount, 2, "two distinct corrective-consumed events: the original custody-trusted record, and the re-recorded one after the simulated basis transition");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
