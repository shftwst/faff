// FAFF-819 — `faff bundle`: publish + fail-closed independent verify of a Phase-0 recovery
// bundle. Exercised end-to-end via the real CLI seam (publish -> verify against a fixture run
// dir + anchor, local occupant) plus the in-process --selftest tables (pure cores, local-store
// round trip, and a scratch-bare-repo git-remote round trip). Per ADR 0002 (assert at the
// CLI/module seam, never narrative text).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const {
  canonicalJSON, classifyBundle, deriveSupersededBy, validateIdentityForHandle, bundleExitCode,
} = require("../plugin/skills/faff/bin/lib/bundle.js");
const { mintIssueAnchor } = require("../plugin/skills/faff/bin/lib/events.js");

// --- --selftest tables (no network beyond a local scratch bare repo) ---
test("bundle --selftest: pure cores + local-store round trip + scratch-bare-repo git-remote round trip pass", () => {
  const { code, stdout } = runCli(["bundle", "--selftest"]);
  assert.equal(code, 0, stdout);
});

test("contract bundle-verdict --selftest: the fixture table passes", () => {
  const { code } = runCli(["contract", "bundle-verdict", "--selftest"]);
  assert.equal(code, 0);
});

// --- CLI arg validation (fail-loud before any store call) ---
test("bundle publish: missing required flags -> exit 2", () => {
  const { code, stderr } = runCli(["bundle", "publish"]);
  assert.equal(code, 2);
  assert.match(stderr, /--run-dir, --boundary-kind, and --boundary-key are all required/);
});

test("bundle verify: missing required flags -> exit 2", () => {
  const { code, stderr } = runCli(["bundle", "verify"]);
  assert.equal(code, 2);
  assert.match(stderr, /--run-id, --run-segment-id, --boundary-kind, and --boundary-key are all required/);
});

test("bundle: an unknown action -> exit 2", () => {
  const { code, stderr } = runCli(["bundle", "recover"]);
  assert.equal(code, 2);
  assert.match(stderr, /expected one of publish \| verify/);
});

// --- pure cores, exercised directly (the CONSTRAINT-level assertions --selftest already covers
// in-process; repeated here at the module seam per ADR 0002) ---
test("canonicalJSON: sorted keys at every depth, no insignificant whitespace", () => {
  assert.equal(canonicalJSON({ z: 1, a: { d: 2, b: 3 } }), '{"a":{"b":3,"d":2},"z":1}');
});

test("deriveSupersededBy: a later per-issue boundary supersedes an earlier one in the same segment", () => {
  const id = { run_id: "r", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
  const later = deriveSupersededBy(id, [
    { boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 },
    { boundary_kind: "issue-merge-floor", boundary_key: "FAFF-2", boundary_seq: 1 },
  ]);
  assert.equal(later.boundary_key, "FAFF-2");
});

test("validateIdentityForHandle: a run_id with a '..' segment is refused before any handle interpolation", () => {
  const violations = validateIdentityForHandle({ run_id: "../etc", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 });
  assert.ok(violations.length > 0);
});

test("classifyBundle: exit-code mapping — CLEAN=0, the four determinate non-clean=1, VERIFICATION_UNAVAILABLE=2", () => {
  assert.equal(bundleExitCode("CLEAN"), 0);
  for (const v of ["STALE", "MISSING", "MALFORMED", "TAMPERED"]) assert.equal(bundleExitCode(v), 1);
  assert.equal(bundleExitCode("VERIFICATION_UNAVAILABLE"), 2);
});

// --- end-to-end CLI round trip: publish then verify against a real fixture run dir + anchor ---
function fixtureRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "faff-bundle-cli-t-"));
  const run_id = "run-fixture-000000-bundle";
  const runDir = path.join(root, ".faff", "runs", run_id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" }, owner: { epoch: 0, status: "done" } }));
  writeFileSync(path.join(runDir, "events.jsonl"), `{"schema":1,"run_id":"${run_id}","seq":0,"ts":"2026-01-01T00:00:00.000Z","phase":"run","type":"run-start"}\n`);
  mkdirSync(path.join(runDir, "FAFF-1"), { recursive: true });
  writeFileSync(path.join(runDir, "FAFF-1", "ac-checklist.json"), '{"all_verified":true}');
  const anchorDest = path.join(root, ".faff", "anchors", run_id, "FAFF-1");
  const mint = mintIssueAnchor(runDir, "FAFF-1", anchorDest);
  assert.equal(mint.ok, true, "fixture: anchor mint must succeed");
  return { root, run_id, runDir };
}

test("bundle publish (local occupant, default) then bundle verify -> CLEAN, exit 0", () => {
  const { root, run_id, runDir } = fixtureRoot();
  try {
    const pub = runCli(["bundle", "publish", "--run-dir", runDir, "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-1", "--root", root, "--json"], { cwd: root });
    assert.equal(pub.code, 0, pub.stderr);
    const pubBody = JSON.parse(pub.stdout);
    assert.equal(pubBody.published, true);
    assert.equal(pubBody.identity.run_id, run_id);
    assert.equal(pubBody.identity.run_segment_id, 0, "run_segment_id is derived from the ledger's owner.epoch");

    const ver = runCli(["bundle", "verify", "--run-id", run_id, "--run-segment-id", "0", "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-1", "--root", root, "--json"], { cwd: root });
    assert.equal(ver.code, 0, ver.stderr);
    const verBody = JSON.parse(ver.stdout);
    assert.equal(verBody.verdict, "CLEAN");
    assert.equal(verBody.conformant, true);
    assert.equal(verBody.superseded_by, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("bundle publish: a re-publish at the same identity is an idempotent no-op (never a rewrite)", () => {
  const { root, runDir } = fixtureRoot();
  try {
    const pub1 = runCli(["bundle", "publish", "--run-dir", runDir, "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-1", "--root", root, "--json"], { cwd: root });
    assert.equal(pub1.code, 0, pub1.stderr);
    const pub2 = runCli(["bundle", "publish", "--run-dir", runDir, "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-1", "--root", root, "--json"], { cwd: root });
    assert.equal(pub2.code, 0, pub2.stderr);
    assert.equal(JSON.parse(pub2.stdout).idempotent, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("bundle verify: an identity with no published bundle -> MISSING, exit 1", () => {
  const { root } = fixtureRoot();
  try {
    const ver = runCli(["bundle", "verify", "--run-id", "run-nonexistent", "--run-segment-id", "0", "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-9", "--root", root, "--json"], { cwd: root });
    assert.equal(ver.code, 1);
    assert.equal(JSON.parse(ver.stdout).verdict, "MISSING");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("bundle verify: a bundle whose manifest.json is corrupted on disk -> MALFORMED, exit 1", () => {
  const { root, run_id, runDir } = fixtureRoot();
  try {
    const pub = runCli(["bundle", "publish", "--run-dir", runDir, "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-1", "--root", root, "--json"], { cwd: root });
    assert.equal(pub.code, 0, pub.stderr);
    const manifestPath = path.join(root, ".faff", "bundles", run_id, "seg-0", "FAFF-1", "manifest.json");
    writeFileSync(manifestPath, "{not valid json");
    const ver = runCli(["bundle", "verify", "--run-id", run_id, "--run-segment-id", "0", "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-1", "--root", root, "--json"], { cwd: root });
    assert.equal(ver.code, 1);
    assert.equal(JSON.parse(ver.stdout).verdict, "MALFORMED");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("bundle publish: boundary_seq auto-increments across issues in the same run/segment via the real CLI (no --boundary-seq flag exists), and staleness fires correctly", () => {
  const { root, run_id, runDir } = fixtureRoot();
  try {
    const pub1 = runCli(["bundle", "publish", "--run-dir", runDir, "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-1", "--root", root, "--json"], { cwd: root });
    assert.equal(pub1.code, 0, pub1.stderr);
    assert.equal(JSON.parse(pub1.stdout).identity.boundary_seq, 0, "the first bundle in a fresh segment gets boundary_seq 0");

    // A second issue, same run/segment: mint its own anchor, then publish.
    mkdirSync(path.join(runDir, "FAFF-2"), { recursive: true });
    const anchorDest2 = path.join(root, ".faff", "anchors", run_id, "FAFF-2");
    mintIssueAnchor(runDir, "FAFF-2", anchorDest2);
    const pub2 = runCli(["bundle", "publish", "--run-dir", runDir, "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-2", "--root", root, "--json"], { cwd: root });
    assert.equal(pub2.code, 0, pub2.stderr);
    assert.equal(JSON.parse(pub2.stdout).identity.boundary_seq, 1, "the second bundle in the same segment auto-increments to boundary_seq 1 (the bug this regression-tests: it must NOT default to 0 again)");

    // The earlier (FAFF-1) boundary must now read STALE, superseded by FAFF-2.
    const ver1 = runCli(["bundle", "verify", "--run-id", run_id, "--run-segment-id", "0", "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-1", "--root", root, "--json"], { cwd: root });
    assert.equal(ver1.code, 1);
    const ver1Body = JSON.parse(ver1.stdout);
    assert.equal(ver1Body.verdict, "STALE");
    assert.equal(ver1Body.superseded_by.boundary_key, "FAFF-2");

    // FAFF-2 itself is the latest boundary and stays CLEAN.
    const ver2 = runCli(["bundle", "verify", "--run-id", run_id, "--run-segment-id", "0", "--boundary-kind", "issue-merge-floor", "--boundary-key", "FAFF-2", "--root", root, "--json"], { cwd: root });
    assert.equal(ver2.code, 0, ver2.stderr);
    assert.equal(JSON.parse(ver2.stdout).verdict, "CLEAN");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("classifyBundle: a required member reported missing by the store -> MISSING, naming the member", () => {
  const identity = { run_id: "r", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
  const result = classifyBundle({ identity, headStatus: "ok", headDigest: "x", members: { ledger_snapshot: { status: "missing" } } });
  assert.equal(result.verdict, "MISSING");
  assert.equal(result.cause, "ledger_snapshot");
});
