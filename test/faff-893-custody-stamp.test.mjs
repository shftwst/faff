// FAFF-893 — the interactive custody stamp: the producer half of the L4 `--local` merge-floor
// custody verdict. graft's _Interactive custody stamp sub-step_ composes the two shipped
// primitives with no code change — `integrity-digest snapshot --issue` then
// `verify --record-result` over the per-issue forge surface — and threads the retained
// verdict_sha256 to the ship producer. This test pins that composition (the born-verifiable
// producer half); the merge-floor admission it feeds is FAFF-892's and is not exercised here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

const ISSUE = "FAFF-9";

// A per-issue forge surface: the run-level members plus the per-issue evidence Steps 8/9 wrote.
// merge-record.json / post-merge-verification.json are legitimately absent pre-merge and are
// recorded {present:false} in both snapshot and verify, so a clean round-trip does not false-tamper.
function forgeSurface() {
  const rd = mkdtempSync(path.join(tmpdir(), "faff-893-"));
  writeFileSync(path.join(rd, "run-ledger.json"), '{"run":"x"}');
  mkdirSync(path.join(rd, "corrective"), { recursive: true });
  writeFileSync(path.join(rd, "corrective", "c1.json"), '{"op":"park"}');
  mkdirSync(path.join(rd, ISSUE), { recursive: true });
  writeFileSync(path.join(rd, ISSUE, "ac-checklist.json"), '{"all_verified":true}');
  writeFileSync(path.join(rd, ISSUE, "review-verdict.json"), '{"signal":"pass"}');
  writeFileSync(path.join(rd, ISSUE, "holdout.json"), '{"aggregate":"meets-spec"}');
  return rd;
}

const snapshot = (rd) => runCli(["integrity-digest", "snapshot", "--run-dir", rd, "--issue", ISSUE]);
const verifyRecord = (rd, manifest) =>
  runCli(
    ["integrity-digest", "verify", "--run-dir", rd, "--manifest", "-",
      "--issue-context", ISSUE, "--merge-state", "pre-merge",
      "--record-result", path.join(rd, ISSUE, "custody-verdict.json"), "--json"],
    { input: manifest },
  );

test("clean round-trip: snapshot --issue then verify --record-result yields a clean sha256-pinned verdict (exit 0)", () => {
  const rd = forgeSurface();
  const s = snapshot(rd);
  assert.equal(s.code, 0, s.stderr);

  const v = verifyRecord(rd, s.stdout);
  assert.equal(v.code, 0, v.stderr);
  const out = JSON.parse(v.stdout);
  assert.equal(out.classification, "clean");
  // The retained sha is the persisted bytes' hash — 64 lowercase hex, never a re-hash elsewhere.
  assert.match(out.verdict_sha256, /^[0-9a-f]{64}$/);

  // custody-verdict.json is written at exactly <run-dir>/<issue>/custody-verdict.json, pre-merge.
  const verdictPath = path.join(rd, ISSUE, "custody-verdict.json");
  assert.ok(existsSync(verdictPath), "custody-verdict.json exists at the canonical per-issue path");
  assert.equal(path.resolve(out.verdict_path), path.resolve(verdictPath));
  const rec = JSON.parse(readFileSync(verdictPath, "utf8"));
  assert.equal(rec.issue, ISSUE);
  assert.equal(rec.classification, "clean");
  assert.equal(rec.merge_state_at_verification, "pre-merge");
  // Never an authorship/actor field — the admission gate rejects unexpected fields.
  assert.equal("actor" in rec, false);
  assert.equal("author" in rec, false);
});

test("tamper: a per-issue member mutated after snapshot is detected — verify refuses (non-clean), never a clean verdict", () => {
  const rd = forgeSurface();
  const s = snapshot(rd);
  assert.equal(s.code, 0, s.stderr);

  // A review-verdict flip between snapshot and verify is exactly the forge the stamp must catch.
  writeFileSync(path.join(rd, ISSUE, "review-verdict.json"), '{"signal":"tampered-to-pass"}');

  const v = verifyRecord(rd, s.stdout);
  assert.notEqual(v.code, 0, "tampered surface must not verify clean");
  // Uncertainty fails toward refuse: whatever is persisted is not a clean verdict.
  if (v.stdout.trim()) {
    const out = JSON.parse(v.stdout);
    assert.notEqual(out.classification, "clean");
  }
  const verdictPath = path.join(rd, ISSUE, "custody-verdict.json");
  if (existsSync(verdictPath)) {
    assert.notEqual(JSON.parse(readFileSync(verdictPath, "utf8")).classification, "clean");
  }
});
