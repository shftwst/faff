// FAFF-518 — the `faff integrity-digest` snapshot/verify CLI pair: custody-based tamper
// detection over the evidence set (correctiveIntegrityDirs). A trusted dispatcher holds the
// manifest in context across an untrusted dispatch; verify recompute-and-compares. Exercised
// end-to-end via the real CLI seam + the in-process --selftest.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

function evidenceDir() {
  const rd = mkdtempSync(path.join(tmpdir(), "faff-idig-t-"));
  writeFileSync(path.join(rd, "run-ledger.json"), '{"run":"x"}');
  mkdirSync(path.join(rd, "corrective"), { recursive: true });
  writeFileSync(path.join(rd, "corrective", "c1.json"), '{"op":"park"}');
  mkdirSync(path.join(rd, "FAFF-9"), { recursive: true });
  writeFileSync(path.join(rd, "FAFF-9", "ac-checklist.json"), '{"all_verified":true}');
  writeFileSync(path.join(rd, "events.jsonl"), '{"seq":0}\n');
  return rd;
}
const snap = (rd) => runCli(["integrity-digest", "snapshot", "--run-dir", rd, "--issue", "FAFF-9", "--events"]);
const verify = (rd, manifest) => runCli(["integrity-digest", "verify", "--run-dir", rd, "--issue", "FAFF-9", "--events", "--manifest", "-"], { input: manifest });

test("integrity-digest --selftest passes", () => {
  assert.equal(runCli(["integrity-digest", "--selftest"]).code, 0);
});

test("snapshot emits a per-member manifest; clean round-trip verifies (digest-verified, exit 0)", () => {
  const rd = evidenceDir();
  try {
    const s = snap(rd);
    assert.equal(s.code, 0, s.stderr);
    const m = JSON.parse(s.stdout);
    assert.ok(m.members["run-ledger.json"].sha256 && m.members["corrective"].dir && m.members["events.jsonl"].events);
    const v = verify(rd, s.stdout);
    assert.equal(v.code, 0);
    assert.match(v.stdout, /digest-verified/);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("an edited member → verify exit 1 naming the path", () => {
  const rd = evidenceDir();
  try {
    const man = snap(rd).stdout;
    writeFileSync(path.join(rd, "run-ledger.json"), '{"run":"TAMPERED"}');
    const v = verify(rd, man);
    assert.equal(v.code, 1);
    assert.match(v.stdout, /tampered/);
    assert.match(v.stdout, /run-ledger\.json/);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("an edited sub-file inside corrective/ → verify names the sub-path", () => {
  const rd = evidenceDir();
  try {
    const man = snap(rd).stdout;
    writeFileSync(path.join(rd, "corrective", "c1.json"), '{"op":"forbid-surface"}');
    const v = verify(rd, man);
    assert.equal(v.code, 1);
    assert.match(v.stdout, /corrective[/\\]c1\.json/);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("events.jsonl: a legitimate APPEND verifies; a TRUNCATE is tampered", () => {
  const rd = evidenceDir();
  try {
    const man = snap(rd).stdout;
    appendFileSync(path.join(rd, "events.jsonl"), '{"seq":1}\n');
    assert.equal(verify(rd, man).code, 0, "append should still verify (prefix preserved)");
    writeFileSync(path.join(rd, "events.jsonl"), '{"se');
    const v = verify(rd, man);
    assert.equal(v.code, 1);
    assert.match(v.stdout, /events\.jsonl.*truncated/);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("input validation: missing action / --run-dir / --manifest all exit 2", () => {
  assert.equal(runCli(["integrity-digest"]).code, 2);
  assert.equal(runCli(["integrity-digest", "snapshot"]).code, 2); // no --run-dir
  assert.equal(runCli(["integrity-digest", "verify", "--run-dir", "/tmp/x"]).code, 2); // no --manifest
});
