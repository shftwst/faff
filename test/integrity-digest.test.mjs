// FAFF-518 — the `faff integrity-digest` snapshot/verify CLI pair: custody-based tamper
// detection over the evidence set (correctiveIntegrityDirs). A trusted dispatcher holds the
// manifest in context across an untrusted dispatch; verify recompute-and-compares. Exercised
// end-to-end via the real CLI seam + the in-process --selftest.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync, readdirSync, rmSync, chmodSync } from "node:fs";
import * as fsReal from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const { resolveHasher, SHA256_CANDIDATES, verifyAndRecord, custodyVerdictPath, atomicWriteVerdictBytes } = require("../plugin/skills/faff/bin/lib/integrity-digest.js");

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

// --- FAFF-633: portable hasher resolution (absolute candidate list, never PATH) ---

test("resolveHasher walks the injected list in order and returns the first existing bin", () => {
  // Two existing absolute paths — /bin and /usr/bin both exist as dirs on POSIX hosts, so use real
  // files present on any runner (node itself + /bin/sh) to prove first-present-wins ordering.
  const first = { bin: process.execPath, args: ["first"] };
  const second = { bin: "/bin/sh", args: ["second"] };
  assert.equal(resolveHasher([first, second]), first, "first existing candidate wins");
  assert.equal(resolveHasher([{ bin: "/nonexistent/x", args: [] }, second]), second, "skips missing, picks next present");
});

test("resolveHasher with an all-missing injected list throws the no-candidate message naming every tried path", () => {
  assert.throws(
    () => resolveHasher([{ bin: "/no/such/sha256sum", args: [] }, { bin: "/also/missing/shasum", args: ["-a", "256"] }]),
    /no SHA-256 tool found \(tried \/no\/such\/sha256sum, \/also\/missing\/shasum\).*refusing to report verified/s,
  );
});

test("every default candidate bin is an absolute path (never a bare name / PATH)", () => {
  assert.ok(SHA256_CANDIDATES.length >= 1);
  for (const c of SHA256_CANDIDATES) assert.ok(path.isAbsolute(c.bin), `${c.bin} must be absolute`);
});

test("hash action: stdout is the node:crypto SHA-256 of the piped bytes + newline, exit 0", () => {
  const bytes = "the quick brown fox\n binaryÿ";
  const r = runCli(["integrity-digest", "hash"], { input: bytes });
  assert.equal(r.code, 0, r.stderr);
  const expected = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  assert.equal(r.stdout, expected + "\n");
});

test("hash action spawns the hasher under a sanitized env — an injected PERL5OPT/PERL5LIB never reaches it (Perl-script shasum stays uncorrupted)", () => {
  // A poisoned PERL5OPT would make a Perl-based /usr/bin/shasum die at startup if the env were
  // inherited (exit 2, fail-loud). The sanitized spawn env drops it, so the digest is still correct
  // on macOS; on a coreutils host the binary ignores it — either way, exit 0 + the right digest.
  const bytes = "abc";
  const poisoned = { ...process.env, PERL5OPT: "-Mfaff_nonexistent_module_633", PERL5LIB: "/nonexistent/perl5lib" };
  const r = runCli(["integrity-digest", "hash"], { input: bytes, env: poisoned });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, createHash("sha256").update(Buffer.from(bytes)).digest("hex") + "\n");
});

// --- FAFF-784: `verify --record-result` — atomic custody-verdict recording ---

const ISSUE = "FAFF-9";
const custodyOut = (rd) => path.join(rd, ISSUE, "custody-verdict.json");
const recordVerify = (rd, manifest, extra = []) => runCli([
  "integrity-digest", "verify", "--run-dir", rd, "--events", "--manifest", "-",
  "--issue-context", ISSUE, "--merge-state", "pre-merge", "--record-result", custodyOut(rd), "--json", ...extra,
], { input: manifest });

test("record-result: a clean verify atomically writes schema_version:1 clean record, exit 0, verdict_sha256 matches an independent hash of the persisted bytes", () => {
  const rd = evidenceDir();
  try {
    const held = runSnap(rd).stdout;
    const r = recordVerify(rd, held);
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.classification, "clean");
    assert.equal(out.verdict_path, custodyOut(rd));
    assert.deepEqual(out.paths, []);

    const bytes = readFileSync(custodyOut(rd), "utf8");
    assert.equal(out.verdict_sha256, createHash("sha256").update(Buffer.from(bytes)).digest("hex"), "returned digest must be over the EXACT persisted bytes");
    const rec = JSON.parse(bytes);
    assert.equal(rec.schema_version, 1);
    assert.equal(rec.run_id, path.basename(rd));
    assert.equal(rec.issue, ISSUE);
    assert.equal(rec.classification, "clean");
    assert.deepEqual(rec.paths, []);
    assert.equal(rec.merge_state_at_verification, "pre-merge");
    assert.ok(!Number.isNaN(Date.parse(rec.verified_at)));
    // NO authorship/actor field, ever.
    assert.deepEqual(Object.keys(rec).sort(), ["classification", "detail", "issue", "merge_state_at_verification", "paths", "run_id", "schema_version", "verified_at"]);
    // NOT added to the manifest it was produced from (the manifest was already frozen before this ran).
    assert.ok(!("custody-verdict.json" in JSON.parse(held).members));
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("record-result: a tampered run-ledger.json → atomic tamper record naming the path, exit 1, non-empty paths", () => {
  const rd = evidenceDir();
  try {
    const held = runSnap(rd).stdout;
    writeFileSync(path.join(rd, "run-ledger.json"), '{"run":"TAMPERED"}');
    const r = recordVerify(rd, held);
    assert.equal(r.code, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.classification, "tamper");
    assert.deepEqual(out.paths, ["run-ledger.json"]);
    const rec = JSON.parse(readFileSync(custodyOut(rd), "utf8"));
    assert.equal(rec.classification, "tamper");
    assert.deepEqual(rec.paths, ["run-ledger.json"]);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("record-result: verification-unavailable (unreadable member) → recorded before exit 2, never tamper, never clean", { skip: process.getuid && process.getuid() === 0 ? "root ignores chmod 000" : false }, () => {
  const rd = evidenceDir();
  const ledger = path.join(rd, "run-ledger.json");
  try {
    const held = runSnap(rd).stdout;
    chmodSync(ledger, 0o000);
    const r = recordVerify(rd, held);
    assert.equal(r.code, 2);
    const out = JSON.parse(r.stdout);
    assert.equal(out.classification, "verification-unavailable");
    assert.deepEqual(out.paths, []);
    const rec = JSON.parse(readFileSync(custodyOut(rd), "utf8"));
    assert.equal(rec.classification, "verification-unavailable");
  } finally { chmodSync(ledger, 0o644); rmSync(rd, { recursive: true, force: true }); }
});

test("record-result: --record-result at a NON-CANONICAL path (wrong issue segment) → exit 2, nothing written", () => {
  const rd = evidenceDir();
  try {
    const held = runSnap(rd).stdout;
    const wrong = path.join(rd, "SOME-OTHER-ISSUE", "custody-verdict.json");
    const r = runCli(["integrity-digest", "verify", "--run-dir", rd, "--events", "--manifest", "-", "--issue-context", ISSUE, "--merge-state", "pre-merge", "--record-result", wrong], { input: held });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /canonical path/);
    assert.equal(existsSync(wrong), false);
    assert.equal(existsSync(custodyOut(rd)), false);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("record-result: --record-result outside the run dir entirely → exit 2, nothing written", () => {
  const rd = evidenceDir();
  const outside = mkdtempSync(path.join(tmpdir(), "faff-idig-outside-"));
  try {
    const held = runSnap(rd).stdout;
    const target = path.join(outside, "custody-verdict.json");
    const r = runCli(["integrity-digest", "verify", "--run-dir", rd, "--events", "--manifest", "-", "--issue-context", ISSUE, "--merge-state", "pre-merge", "--record-result", target], { input: held });
    assert.equal(r.code, 2);
    assert.equal(existsSync(target), false);
  } finally { rmSync(rd, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test("record-result: missing --issue-context or a bad --merge-state → exit 2, nothing written, before any verification runs", () => {
  const rd = evidenceDir();
  try {
    const held = runSnap(rd).stdout;
    const r1 = runCli(["integrity-digest", "verify", "--run-dir", rd, "--events", "--manifest", "-", "--merge-state", "pre-merge", "--record-result", custodyOut(rd)], { input: held });
    assert.equal(r1.code, 2);
    const r2 = runCli(["integrity-digest", "verify", "--run-dir", rd, "--events", "--manifest", "-", "--issue-context", ISSUE, "--merge-state", "mid-merge", "--record-result", custodyOut(rd)], { input: held });
    assert.equal(r2.code, 2);
    assert.match(r2.stderr, /--merge-state/);
    assert.equal(existsSync(custodyOut(rd)), false);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("record-result: post-merge merge state is stamped through verbatim", () => {
  const rd = evidenceDir();
  try {
    const held = runSnap(rd).stdout;
    const r = runCli(["integrity-digest", "verify", "--run-dir", rd, "--events", "--manifest", "-", "--issue-context", ISSUE, "--merge-state", "post-merge", "--record-result", custodyOut(rd), "--json"], { input: held });
    assert.equal(r.code, 0, r.stderr);
    const rec = JSON.parse(readFileSync(custodyOut(rd), "utf8"));
    assert.equal(rec.merge_state_at_verification, "post-merge");
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

// --- in-process: atomic-write fault injection around the rename step ---
// "No validation, interruption, or filesystem failure may produce a clean result or a partial
// target" (DoD). Drive verifyAndRecord directly with an injectable fsImpl so a rename fault can be
// simulated deterministically (no real disk-full/permission trickery required).
function fakeFsFailingRenameNTimes(n) {
  let calls = 0;
  return {
    mkdirSync: fsReal.mkdirSync, writeFileSync: fsReal.writeFileSync, unlinkSync: fsReal.unlinkSync,
    renameSync: (...a) => {
      calls++;
      if (calls <= n) throw new Error("simulated rename failure");
      return fsReal.renameSync(...a);
    },
  };
}

test("fault injection: the FIRST rename (the clean write) fails, the fallback unavailable write succeeds → exit 2, classification verification-unavailable, NEVER clean", () => {
  const rd = evidenceDir();
  try {
    const held = JSON.parse(runSnap(rd).stdout);
    const out = custodyVerdictPath(rd, ISSUE);
    const code = verifyAndRecord({
      runDir: rd, manifest: held, issueContext: ISSUE, mergeState: "pre-merge",
      recordResultPath: out, json: true, fsImpl: fakeFsFailingRenameNTimes(1),
    });
    assert.equal(code, 2, "a rename fault must NEVER surface as exit 0 clean");
    assert.equal(existsSync(out), true, "the fallback unavailable record must still land");
    const rec = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(rec.classification, "verification-unavailable");
    // no lingering temp file beside the final record
    const leftovers = readdirSync(path.dirname(out)).filter((f) => f.includes(".tmp"));
    assert.deepEqual(leftovers, []);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("fault injection: EVERY rename fails (clean write AND the fallback both fail) → exit 2, NO record persisted at all, no lingering temp file", () => {
  const rd = evidenceDir();
  try {
    const held = JSON.parse(runSnap(rd).stdout);
    const out = custodyVerdictPath(rd, ISSUE);
    const code = verifyAndRecord({
      runDir: rd, manifest: held, issueContext: ISSUE, mergeState: "pre-merge",
      recordResultPath: out, json: true, fsImpl: fakeFsFailingRenameNTimes(Infinity),
    });
    assert.equal(code, 2);
    assert.equal(existsSync(out), false, "no partial/clean target may exist when recording never succeeded");
    const dir = path.dirname(out);
    const leftovers = existsSync(dir) ? readdirSync(dir).filter((f) => f.includes(".tmp")) : [];
    assert.deepEqual(leftovers, [], "no lingering temp file — atomicWriteVerdictBytes cleans up on failure");
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("fault injection: a rename fault on a TAMPER classification also downgrades to verification-unavailable, never a phantom exit-1 tamper claim", () => {
  const rd = evidenceDir();
  try {
    const held = JSON.parse(runSnap(rd).stdout);
    writeFileSync(path.join(rd, "run-ledger.json"), '{"run":"TAMPERED"}');
    const out = custodyVerdictPath(rd, ISSUE);
    const code = verifyAndRecord({
      runDir: rd, manifest: held, issueContext: ISSUE, mergeState: "pre-merge",
      recordResultPath: out, json: true, fsImpl: fakeFsFailingRenameNTimes(1),
    });
    assert.equal(code, 2, "a failed tamper-record write must never read as exit-1 tamper");
    const rec = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(rec.classification, "verification-unavailable");
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("atomicWriteVerdictBytes: on a rename failure, the temp file is unlinked and the error is rethrown (never swallowed)", () => {
  const rd = mkdtempSync(path.join(tmpdir(), "faff-idig-awv-"));
  try {
    const target = path.join(rd, "x", "custody-verdict.json");
    assert.throws(() => atomicWriteVerdictBytes(target, "{}", fakeFsFailingRenameNTimes(Infinity)), /simulated rename failure/);
    assert.equal(existsSync(target), false);
    const dir = path.dirname(target);
    const leftovers = existsSync(dir) ? readdirSync(dir).filter((f) => f.includes(".tmp")) : [];
    assert.deepEqual(leftovers, []);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});
