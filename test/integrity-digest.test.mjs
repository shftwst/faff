// FAFF-518 — the `faff integrity-digest` snapshot/verify CLI pair: custody-based tamper
// detection over the evidence set (correctiveIntegrityDirs). A trusted dispatcher holds the
// manifest in context across an untrusted dispatch; verify recompute-and-compares. Exercised
// end-to-end via the real CLI seam + the in-process --selftest.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
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

// --- FAFF-520: the executor-shaped bracket round-trips (run grain, no --issue) ---
// The concurrency executors snapshot/verify the RUN-grain evidence set (correctiveIntegrityDirs +
// --events, --issue omitted) and hold the manifest in conversation context, fed back via stdin.
const runSnap = (rd) => runCli(["integrity-digest", "snapshot", "--run-dir", rd, "--events"]);
const runVerify = (rd, manifest) => runCli(["integrity-digest", "verify", "--run-dir", rd, "--events", "--manifest", "-", "--json"], { input: manifest });

test("run-grain snapshot (no --issue, --events) yields exactly the three run-grain members", () => {
  const rd = evidenceDir();
  try {
    const s = runSnap(rd);
    assert.equal(s.code, 0, s.stderr);
    const m = JSON.parse(s.stdout);
    assert.equal(m.grain, "run");
    assert.deepEqual(Object.keys(m.members).sort(), ["corrective", "events.jsonl", "run-ledger.json"]);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("verify --manifest - consumes the held manifest via stdin (the executor custody path) → digest-verified", () => {
  const rd = evidenceDir();
  try {
    const held = runSnap(rd).stdout; // "held in context" — a variable, never a file
    const v = runVerify(rd, held);
    assert.equal(v.code, 0, v.stderr);
    assert.deepEqual(JSON.parse(v.stdout), { verdict: "digest-verified", tampered: [] });
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("mid-window events.jsonl APPEND + run-ledger.json edit → tampered naming ONLY run-ledger.json", () => {
  const rd = evidenceDir();
  try {
    const held = runSnap(rd).stdout;
    appendFileSync(path.join(rd, "events.jsonl"), '{"seq":1}\n'); // legitimate append — must stay clean
    writeFileSync(path.join(rd, "run-ledger.json"), '{"run":"TAMPERED"}'); // the tamper
    const v = runVerify(rd, held);
    assert.equal(v.code, 1);
    assert.deepEqual(JSON.parse(v.stdout).tampered, ["run-ledger.json"]);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("re-baseline mechanic: snapshot → own-write → re-snapshot → verify round-trips clean", () => {
  const rd = evidenceDir();
  try {
    runSnap(rd); // baseline B0 (discarded — the orchestrator's own write follows)
    writeFileSync(path.join(rd, "run-ledger.json"), '{"run":"x","outcome":"shipped"}'); // orchestrator own-write
    const candidate = runSnap(rd).stdout; // re-snapshot → candidate new baseline
    const v = runVerify(rd, candidate);
    assert.equal(v.code, 0, v.stderr); // the re-baselined chain verifies clean
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("intended-content seam: the candidate baseline's recorded member sha256 equals an independent hash of the written bytes", () => {
  const rd = evidenceDir();
  try {
    const intended = '{"run":"x","outcome":"shipped"}';
    writeFileSync(path.join(rd, "run-ledger.json"), intended);
    const candidate = JSON.parse(runSnap(rd).stdout);
    // independent oracle (node:crypto, a different implementation than the CLI's /usr/bin/sha256sum)
    const h = createHash("sha256").update(Buffer.from(intended)).digest("hex");
    assert.equal(candidate.members["run-ledger.json"].sha256, h); // touched-member launder closed
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("exit-2 seam (tamper-masking): a corrupted/garbled manifest → verify exit 2, never a false verified", () => {
  const rd = evidenceDir();
  try {
    assert.equal(runVerify(rd, "not-json-at-all").code, 2); // unparseable
    assert.equal(runVerify(rd, JSON.stringify({ version: "d1", grain: "run" })).code, 2); // no members
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("exit-2 seam: an unreadable member (chmod 000) → exit 2 (never 0) — the substrate-parity truth", { skip: process.getuid && process.getuid() === 0 ? "root ignores chmod 000" : false }, () => {
  const rd = evidenceDir();
  const ledger = path.join(rd, "run-ledger.json");
  try {
    const held = runSnap(rd).stdout;
    chmodSync(ledger, 0o000); // a same-uid subagent forcing exit 2 (unreadable member)
    assert.equal(runVerify(rd, held).code, 2); // never a silent verified
  } finally { chmodSync(ledger, 0o644); rmSync(rd, { recursive: true, force: true }); }
});
