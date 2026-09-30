// FAFF-1155 — the per-PR anchor floor guard. `faff events anchor` (the per-PR mint) now REQUIRES
// ac-checklist.json + review-verdict.json under <run-dir>/<issue>/ over a valid genesis, refusing
// `floor-incomplete` (exit 3) and creating no --dest rather than committing a silently incomplete
// anchor. The guard is genesis-first (a provisioning fault still surfaces no-events / genesis-invalid,
// never floor-incomplete) and command-scoped (`anchor-run` and the shared mint core are unaffected).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const { appendRecordUnderLock } = require("../plugin/skills/faff/bin/lib/events.js");

function mkTmp(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

// A bare run dir with a VALID genesis chain (run-start + build-start), no ledger-write chained —
// the normal pre-run-close Step-9b shape.
function mkValidRun(root) {
  const runDir = path.join(root, ".faff", "runs", "run-faff-1155-TEST");
  mkdirSync(runDir, { recursive: true });
  const runId = path.basename(runDir);
  appendRecordUnderLock(runDir, (seq, _p, prevHash) => ({ schema: 2, run_id: runId, seq, ts: "t", prev: prevHash, phase: "run", type: "run-start", data: { level: "L3" } }));
  appendRecordUnderLock(runDir, (seq, _p, prevHash) => ({ schema: 2, run_id: runId, seq, ts: "t", prev: prevHash, phase: "build", type: "build-start", issue: "TEST-1" }));
  return runDir;
}

function writeFloor(runDir, which /* "both" | "ac-only" | "review-only" | "none" */, issue = "TEST-1") {
  mkdirSync(path.join(runDir, issue), { recursive: true });
  if (which === "both" || which === "ac-only") writeFileSync(path.join(runDir, issue, "ac-checklist.json"), JSON.stringify({ all_verified: true }));
  if (which === "both" || which === "review-only") writeFileSync(path.join(runDir, issue, "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
}

function anchor(runDir, root) {
  const dest = path.join(root, "dest");
  return { dest, ...runCli(["events", "anchor", "--run-dir", runDir, "--issue", "TEST-1", "--dest", dest]) };
}

test("both floor files present + valid genesis → exit 0, anchor minted", () => {
  const root = mkTmp("faff-1155-");
  try {
    const runDir = mkValidRun(root);
    writeFloor(runDir, "both");
    const r = anchor(runDir, root);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(existsSync(path.join(r.dest, "events.jsonl")), true);
    assert.equal(existsSync(path.join(r.dest, "ac-checklist.json")), true);
    assert.equal(existsSync(path.join(r.dest, "review-verdict.json")), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("valid genesis, review-verdict.json absent → exit 3 floor-incomplete, no --dest created", () => {
  const root = mkTmp("faff-1155-");
  try {
    const runDir = mkValidRun(root);
    writeFloor(runDir, "ac-only");
    const r = anchor(runDir, root);
    assert.equal(r.code, 3);
    assert.match(r.stderr, /floor-incomplete/);
    assert.match(r.stderr, /review-verdict\.json/);
    assert.equal(existsSync(r.dest), false, "a refusal leaves no partial anchor on disk");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("valid genesis, ac-checklist.json absent → exit 3 floor-incomplete, no --dest created", () => {
  const root = mkTmp("faff-1155-");
  try {
    const runDir = mkValidRun(root);
    writeFloor(runDir, "review-only");
    const r = anchor(runDir, root);
    assert.equal(r.code, 3);
    assert.match(r.stderr, /floor-incomplete/);
    assert.match(r.stderr, /ac-checklist\.json/);
    assert.equal(existsSync(r.dest), false, "a refusal leaves no partial anchor on disk");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("genesis-first: an ABSENT genesis refuses no-events (exit 3), NEVER floor-incomplete, even with no floor files", () => {
  const root = mkTmp("faff-1155-");
  try {
    // A bare run dir with no events.jsonl at all, and no floor files either.
    const runDir = path.join(root, ".faff", "runs", "run-faff-1155-nogenesis");
    mkdirSync(runDir, { recursive: true });
    const r = anchor(runDir, root);
    assert.equal(r.code, 3);
    assert.match(r.stderr, /no events\.jsonl/);
    assert.doesNotMatch(r.stderr, /floor-incomplete/, "a provisioning fault must not be mislabelled a build-evidence defect");
    assert.equal(existsSync(r.dest), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("genesis-first: a torn/whitespace genesis refuses genesis-invalid (exit 3), NEVER floor-incomplete, even with no floor files", () => {
  const root = mkTmp("faff-1155-");
  try {
    const runDir = path.join(root, ".faff", "runs", "run-faff-1155-torngenesis");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(path.join(runDir, "events.jsonl"), " \n"); // whitespace-only → no parseable genesis
    const r = anchor(runDir, root);
    assert.equal(r.code, 3);
    assert.match(r.stderr, /genesis/i);
    assert.doesNotMatch(r.stderr, /floor-incomplete/);
    assert.equal(existsSync(r.dest), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("command-scoped: `anchor-run` never emits floor-incomplete (the guard lives only in the per-PR `anchor` command)", () => {
  const root = mkTmp("faff-1155-");
  try {
    // A minimal, un-closed run dir: anchor-run may refuse on its own preconditions, but the
    // refusal must never be the per-PR floor guard — that guard is not on the anchor-run path.
    const runDir = mkValidRun(root);
    const dest = path.join(root, "run-dest");
    const r = runCli(["events", "anchor-run", "--run-dir", runDir, "--dest", dest]);
    assert.doesNotMatch(r.stderr || "", /floor-incomplete/, "anchor-run must not reach the per-PR floor guard");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
