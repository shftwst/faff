// FAFF-1126 — `faff run-ledger record-outcome` targets the NAMED run dir, never the newest on
// disk, and refuses an outcome for an issue not in the resolved ledger's admitted[]. Drives the
// REAL CLI (shebang dispatch, arg parsing, exit codes) against hand-minted run ledgers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runCli } from "./helpers/run-cli.mjs";

// Mint a minimal, valid run-ledger.json under <root>/.faff/runs/<runId>/. mtime is set so
// "newest on disk" is controllable (latestRunDir sorts by dir mtime).
function mkRun(root, runId, admitted, mtimeMs) {
  const rd = path.join(root, ".faff", "runs", runId);
  mkdirSync(rd, { recursive: true });
  const ledger = { run_id: runId, level: "L2", admitted, outcomes: {}, owner: { status: "running" } };
  writeFileSync(path.join(rd, "run-ledger.json"), JSON.stringify(ledger, null, 2) + "\n");
  const t = new Date(mtimeMs);
  utimesSync(rd, t, t);
  return rd;
}

function readLedger(rd) {
  return JSON.parse(readFileSync(path.join(rd, "run-ledger.json"), "utf8"));
}
function bytes(rd) {
  return readFileSync(path.join(rd, "run-ledger.json"));
}

test("record-outcome --run-dir targets the NAMED (older) run, leaving a newer run dir untouched", () => {
  const root = mkdtempSync(path.join(tmpdir(), "faff-1126-a-"));
  const older = mkRun(root, "run-OLD-graft-FAFF-1", ["FAFF-1"], Date.now() - 60_000);
  const newer = mkRun(root, "run-NEW-graft-FAFF-2", ["FAFF-2"], Date.now()); // newest on disk
  const newerBefore = bytes(newer);

  const r = runCli(
    ["run-ledger", "record-outcome", "--issue", "FAFF-1", "--outcome", "parked", "--run-dir", older, "--root", root],
    { cwd: root },
  );
  assert.equal(r.code, 0, r.stderr);
  assert.equal(readLedger(older).outcomes["FAFF-1"], "parked", "the named (older) run received the outcome");
  assert.deepEqual(bytes(newer), newerBefore, "the newer run dir is byte-for-byte untouched (not resolved as 'latest')");
});

test("record-outcome refuses an outcome for an issue not in the resolved ledger's admitted[] (byte-unchanged)", () => {
  const root = mkdtempSync(path.join(tmpdir(), "faff-1126-b-"));
  const rd = mkRun(root, "run-X-graft-FAFF-9", ["FAFF-9"], Date.now()); // admits FAFF-9 only
  const before = bytes(rd);

  const r = runCli(
    ["run-ledger", "record-outcome", "--issue", "FAFF-42", "--outcome", "shipped", "--run-dir", rd, "--root", root],
    { cwd: root },
  );
  assert.notEqual(r.code, 0, "a non-admitted issue is refused (non-zero exit)");
  assert.match(r.stderr, /not in run .* admitted/i, "the error names the admitted-mismatch");
  assert.deepEqual(bytes(rd), before, "the ledger is byte-for-byte unchanged — nothing was written");
});
