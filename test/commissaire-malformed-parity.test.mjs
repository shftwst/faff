// FAFF-1170 — S8 / S8b: malformed-record behaviour parity. The TypeScript conversion reads ledger
// fields back as plain `string` and parses records field-by-field, but introduces NO new null->deny
// branch: every malformed shape keeps today's exact outcome. These tests pin the full taxonomy against
// verifyAuthLeg / readLedgerEntries (the converted emit). No typescript needed — they run the emit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyAuthLeg, readLedgerEntries } from "../plugin/skills/faff/bin/lib/commissaire.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const FAFF = path.join(REPO, "plugin", "skills", "faff", "bin", "faff");
const LEDGER = "declared-effects.jsonl";

function admittedRun() {
  const tmp = mkdtempSync(path.join(tmpdir(), "faff-malformed-"));
  const runDir = path.join(tmp, "RUN-M1");
  mkdirSync(runDir, { recursive: true });
  const r = spawnSync(process.execPath, [FAFF, "commissaire", "admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"], { encoding: "utf8" });
  assert.equal(r.status, 0, `admit setup failed: ${r.stderr}`);
  return { tmp, runDir };
}
const appendLine = (runDir, obj) => appendFileSync(path.join(runDir, LEDGER), (typeof obj === "string" ? obj : JSON.stringify(obj)) + "\n");

test("S8: a schema-3 producer record with missing/invalid producer_id -> producer-auth-mismatch (no null->deny, no throw)", () => {
  const { tmp, runDir } = admittedRun();
  try {
    // A schema-3 producer record whose producer_id is absent and whose HMAC cannot match: the exact
    // existing path is deriveKey(master, undefined, rev) -> HMAC mismatch -> producer-auth-mismatch.
    appendLine(runDir, { schema: 3, author: "producer", contract_revision: "r1", seq: 99, kind_of_entry: "declare", issue: "X", step: "s", producer_hmac: "0".repeat(64) });
    const auth = verifyAuthLeg(runDir);
    assert.equal(auth.pass, false, "a bad producer record fails the auth leg");
    assert.ok(auth.failures.some((f) => f.reason === "producer-auth-mismatch"), `expected producer-auth-mismatch, got ${JSON.stringify(auth.failures)}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("S8b(a): a non-object / non-parseable JSONL line is dropped (never reaches the auth leg)", () => {
  const { tmp, runDir } = admittedRun();
  try {
    const before = readLedgerEntries(runDir).length;
    appendLine(runDir, "5");            // a bare number — parses to a non-object
    appendLine(runDir, "{not json");    // non-parseable
    const after = readLedgerEntries(runDir);
    assert.equal(after.length, before, "non-object / non-parseable lines are dropped, not surfaced as records");
    assert.equal(verifyAuthLeg(runDir).pass, true, "dropped lines never cause an auth failure");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("S8b(b): a record with schema !== 3 is skipped (frozen pre-cutover line, never a failure)", () => {
  const { tmp, runDir } = admittedRun();
  try {
    appendLine(runDir, { schema: 2, author: "producer", producer_id: "P1", seq: 50, producer_hmac: "deadbeef" });
    assert.equal(verifyAuthLeg(runDir).pass, true, "a schema<3 line is skipped, not failed");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("S8b(c): a schema-3 record with absent/other author fires neither verify branch (skipped)", () => {
  const { tmp, runDir } = admittedRun();
  try {
    appendLine(runDir, { schema: 3, author: "observer", seq: 51, kind_of_entry: "note" });
    appendLine(runDir, { schema: 3, seq: 52, kind_of_entry: "note" }); // no author at all
    assert.equal(verifyAuthLeg(runDir).pass, true, "a non-producer/non-commissaire author is skipped, not failed");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
