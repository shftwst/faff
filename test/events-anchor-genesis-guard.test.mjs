// FAFF-966 — the anchor-point genesis guard (`validateAnchorGenesis`, wired into
// `mintIssueAnchor`/`faff events anchor`). Option B (human decision, 2026-09-13): the anchor
// point never repairs a missing/invalid genesis — it refuses fail-closed, leaves
// `events.jsonl` byte-for-byte unchanged, and commits no anchor. Each validity conjunct is
// exercised independently, per the spec's DONE items.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const { appendRecordUnderLock } = require("../plugin/skills/faff/bin/lib/events.js");

function mkTmp(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

// A run dir NOT minted through any CLI verb — just the bare directory, so each test controls
// events.jsonl's exact bytes.
function mkRunDir(root, runId = "run-genesis-guard-TEST") {
  const runDir = path.join(root, ".faff", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  return runDir;
}

function tryAnchor(runDir, root) {
  const dest = path.join(root, "dest");
  return runCli(["events", "anchor", "--run-dir", runDir, "--issue", "TEST-1", "--dest", dest]);
}

test("no-events: run-ledger.json present, events.jsonl absent → exit 3, code no-events (unchanged from before this ticket)", () => {
  const root = mkTmp("faff-966-guard-");
  const runDir = mkRunDir(root);
  writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify({ run_id: path.basename(runDir) }));
  const r = tryAnchor(runDir, root);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /no events\.jsonl/);
  assert.equal(existsSync(path.join(root, "dest")), false, "no dest dir created on refusal");
  rmSync(root, { recursive: true, force: true });
});

test("neither-file: run-ledger.json ALSO absent → still no-events, exit 3, fabricates no genesis", () => {
  const root = mkTmp("faff-966-guard-");
  const runDir = mkRunDir(root);
  const r = tryAnchor(runDir, root);
  assert.equal(r.code, 3);
  assert.equal(existsSync(path.join(runDir, "events.jsonl")), false, "nothing fabricated");
  rmSync(root, { recursive: true, force: true });
});

test("genesis-invalid: zero-byte events.jsonl → exit 3, refuses, leaves the file untouched", () => {
  const root = mkTmp("faff-966-guard-");
  const runDir = mkRunDir(root);
  writeFileSync(path.join(runDir, "events.jsonl"), "");
  const before = readFileSync(path.join(runDir, "events.jsonl"));
  const r = tryAnchor(runDir, root);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /no valid genesis chain/);
  const after = readFileSync(path.join(runDir, "events.jsonl"));
  assert.ok(before.equals(after), "zero-byte file left byte-for-byte unchanged");
  rmSync(root, { recursive: true, force: true });
});

test("genesis-invalid: whitespace-only events.jsonl → exit 3, refuses, leaves the file untouched", () => {
  const root = mkTmp("faff-966-guard-");
  const runDir = mkRunDir(root);
  writeFileSync(path.join(runDir, "events.jsonl"), " \n\t\n");
  const before = readFileSync(path.join(runDir, "events.jsonl"));
  const r = tryAnchor(runDir, root);
  assert.equal(r.code, 3);
  const after = readFileSync(path.join(runDir, "events.jsonl"));
  assert.ok(before.equals(after));
  rmSync(root, { recursive: true, force: true });
});

test("genesis-invalid: torn partial line (no trailing newline, unparseable) → exit 3, leaves the file untouched", () => {
  const root = mkTmp("faff-966-guard-");
  const runDir = mkRunDir(root);
  writeFileSync(path.join(runDir, "events.jsonl"), '{"schema":2,"run_id":"run-genesis');
  const before = readFileSync(path.join(runDir, "events.jsonl"));
  const r = tryAnchor(runDir, root);
  assert.equal(r.code, 3);
  const after = readFileSync(path.join(runDir, "events.jsonl"));
  assert.ok(before.equals(after));
  rmSync(root, { recursive: true, force: true });
});

test("genesis-invalid: seq-0 record with a WRONG prev (not SHA-256(run_id)) → exit 3, leaves the file untouched", () => {
  const root = mkTmp("faff-966-guard-");
  const runDir = mkRunDir(root);
  const runId = path.basename(runDir);
  const rec = { schema: 2, run_id: runId, seq: 0, ts: "t", prev: "a".repeat(64), phase: "run", type: "run-start" };
  writeFileSync(path.join(runDir, "events.jsonl"), JSON.stringify(rec) + "\n");
  const before = readFileSync(path.join(runDir, "events.jsonl"));
  const r = tryAnchor(runDir, root);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /no valid genesis chain/);
  const after = readFileSync(path.join(runDir, "events.jsonl"));
  assert.ok(before.equals(after));
  rmSync(root, { recursive: true, force: true });
});

test("genesis-invalid: a later record's prev is tampered/mis-linked (verifyChain-failing) → exit 3, leaves the file untouched", () => {
  const root = mkTmp("faff-966-guard-");
  const runDir = mkRunDir(root);
  const runId = path.basename(runDir);
  // A non-"ledger-write" seq-0 filler (mirrors events-chain.test.mjs's own `mkMinter` default)
  // — a real "ledger-write" record without a matching run-ledger.json would trip the
  // UNRELATED, pre-existing FAFF-958 ledger-fold precondition first, masking the genesis
  // check this test targets.
  appendRecordUnderLock(runDir, (seq, _p, prevHash) => ({ schema: 2, run_id: runId, seq, ts: "t", prev: prevHash, phase: "run", type: "run-start" }));
  appendRecordUnderLock(runDir, (seq, _p, prevHash) => ({ schema: 2, run_id: runId, seq, ts: "t", prev: prevHash, phase: "build", type: "build-start", issue: "TEST-1" }));
  // Tamper the SECOND line's prev so the chain is genuinely broken (not just seq-0 wrong).
  const lines = readFileSync(path.join(runDir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  lines[1].prev = "f".repeat(64);
  writeFileSync(path.join(runDir, "events.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const before = readFileSync(path.join(runDir, "events.jsonl"));
  const r = tryAnchor(runDir, root);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /no valid genesis chain/);
  const after = readFileSync(path.join(runDir, "events.jsonl"));
  assert.ok(before.equals(after), "tamper detection never further mutates the file");
  rmSync(root, { recursive: true, force: true });
});

test("valid: a real seq-0 (correct prev) followed by a run-start → anchors normally, exit 0, never parked", () => {
  const root = mkTmp("faff-966-guard-");
  const runDir = mkRunDir(root);
  const runId = path.basename(runDir);
  appendRecordUnderLock(runDir, (seq, _p, prevHash) => ({ schema: 2, run_id: runId, seq, ts: "t", prev: prevHash, phase: "run", type: "run-start", data: { level: "L3" } }));
  appendRecordUnderLock(runDir, (seq, _p, prevHash) => ({ schema: 2, run_id: runId, seq, ts: "t", prev: prevHash, phase: "build", type: "build-start", issue: "TEST-1" }));
  const r = tryAnchor(runDir, root);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(existsSync(path.join(root, "dest", "events.jsonl")), true);
  rmSync(root, { recursive: true, force: true });
});

test("integration smoke test (spec §8): mint → anchor ok → simulate a genesis-less inherited dir → anchor refuses, nothing fabricated", () => {
  const root = mkTmp("faff-966-guard-");
  const r1 = runCli(["run-ledger", "init-self-drain", "--mode", "full", "--root", root, "--json"]);
  assert.equal(r1.code, 0, r1.stderr);
  const runDir = JSON.parse(r1.stdout).run_dir;

  const dest1 = path.join(root, "anchor1");
  const a1 = runCli(["events", "anchor", "--run-dir", runDir, "--issue", "FAFF-XXX", "--dest", dest1]);
  assert.equal(a1.code, 0, a1.stderr);

  // Simulate a genesis-less inherited dir: remove events.jsonl entirely.
  const evPath = path.join(runDir, "events.jsonl");
  const before = readFileSync(evPath);
  require("node:fs").rmSync(evPath);
  const dest2 = path.join(root, "anchor2");
  const a2 = runCli(["events", "anchor", "--run-dir", runDir, "--issue", "FAFF-XXX", "--dest", dest2]);
  assert.notEqual(a2.code, 0, "no-events refuses");
  assert.equal(existsSync(evPath), false, "nothing fabricated back");
  assert.ok(before.length > 0, "sanity: the original genesis really had content");

  // Residual-bytes variant: whitespace-only.
  writeFileSync(evPath, " \n");
  const beforeWs = readFileSync(evPath);
  const dest3 = path.join(root, "anchor3");
  const a3 = runCli(["events", "anchor", "--run-dir", runDir, "--issue", "FAFF-XXX", "--dest", dest3]);
  assert.notEqual(a3.code, 0, "genesis-invalid refuses");
  const afterWs = readFileSync(evPath);
  assert.ok(beforeWs.equals(afterWs), "never truncated");

  rmSync(root, { recursive: true, force: true });
});
