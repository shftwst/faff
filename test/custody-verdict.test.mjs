// FAFF-784 — the pure custody-verdict validator (contract-defs.js): shape/enum validation
// (computeCustodyVerdict), file-bytes classification (classifyCustodyVerdictBytes), and the
// admission gate merge-gate.js binds a dispatched merge to (computeCustodyVerdictAdmission).
// Unit-level, filesystem-free — mirrors the review-verdict/lane-boundary pure-core test style.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  computeCustodyVerdict, classifyCustodyVerdictBytes, computeCustodyVerdictAdmission,
  CUSTODY_CLASSIFICATIONS, CUSTODY_MERGE_STATES,
} = require("../plugin/skills/faff/bin/lib/contract-defs.js");

const cleanRecord = () => ({
  schema_version: 1, run_id: "run-t", issue: "FAFF-1", classification: "clean",
  paths: [], detail: "digest-verified", verified_at: "2026-08-15T00:00:00.000Z",
  merge_state_at_verification: "pre-merge",
});
const tamperRecord = () => ({ ...cleanRecord(), classification: "tamper", paths: ["run-ledger.json"], detail: "tampered — run-ledger.json" });
const unavailableRecord = () => ({ ...cleanRecord(), classification: "verification-unavailable", detail: "no SHA-256 tool" });

// --- computeCustodyVerdict: pure shape/enum validator ---

test("computeCustodyVerdict: fail-loud ONLY on a non-object extraction", () => {
  assert.equal(computeCustodyVerdict("not an object").failLoud, "extraction must be a JSON object");
  assert.equal(computeCustodyVerdict(null).failLoud, "extraction must be a JSON object");
  assert.equal(computeCustodyVerdict([1, 2]).failLoud, "extraction must be a JSON object");
  assert.equal(computeCustodyVerdict({}).failLoud, null, "a malformed-but-object extraction is never fail-loud — only violations");
});

test("computeCustodyVerdict: an exact valid clean record is fully conformant (zero violations)", () => {
  const { contractData, failLoud } = computeCustodyVerdict(cleanRecord());
  assert.equal(failLoud, null);
  assert.deepEqual(contractData.violations, []);
  assert.equal(contractData.classification, "clean");
});

test("computeCustodyVerdict: a valid tamper record (non-empty paths) is conformant", () => {
  const { contractData } = computeCustodyVerdict(tamperRecord());
  assert.deepEqual(contractData.violations, []);
});

test("computeCustodyVerdict: CONSTRAINT — classification tamper with EMPTY paths → violation", () => {
  const { contractData } = computeCustodyVerdict({ ...cleanRecord(), classification: "tamper", paths: [] });
  assert.ok(contractData.violations.some((v) => /tamper but paths is empty/.test(v)));
});

test("computeCustodyVerdict: CONSTRAINT — classification clean with NON-EMPTY paths → violation", () => {
  const { contractData } = computeCustodyVerdict({ ...cleanRecord(), paths: ["x"] });
  assert.ok(contractData.violations.some((v) => /not tamper but paths is non-empty/.test(v)));
});

test("computeCustodyVerdict: unknown schema_version → violation (never silently accepted)", () => {
  const { contractData } = computeCustodyVerdict({ ...cleanRecord(), schema_version: 2 });
  assert.ok(contractData.violations.some((v) => /schema_version/.test(v)));
});

test("computeCustodyVerdict: out-of-enum classification / merge_state_at_verification → violations", () => {
  const c1 = computeCustodyVerdict({ ...cleanRecord(), classification: "fine" });
  assert.ok(c1.contractData.violations.some((v) => /classification/.test(v)));
  const c2 = computeCustodyVerdict({ ...cleanRecord(), merge_state_at_verification: "mid-merge" });
  assert.ok(c2.contractData.violations.some((v) => /merge_state_at_verification/.test(v)));
});

test("computeCustodyVerdict: missing run_id / issue / malformed verified_at / non-string detail → violations", () => {
  assert.ok(computeCustodyVerdict({ ...cleanRecord(), run_id: "" }).contractData.violations.some((v) => /run_id/.test(v)));
  assert.ok(computeCustodyVerdict({ ...cleanRecord(), issue: undefined }).contractData.violations.some((v) => /issue/.test(v)));
  assert.ok(computeCustodyVerdict({ ...cleanRecord(), verified_at: "not-a-date" }).contractData.violations.some((v) => /verified_at/.test(v)));
  assert.ok(computeCustodyVerdict({ ...cleanRecord(), detail: 12 }).contractData.violations.some((v) => /detail/.test(v)));
});

test("computeCustodyVerdict: NO AUTHORSHIP — an author/actor/signer field is a violation, never silently admitted", () => {
  for (const extra of [{ author: "claude" }, { actor: "orchestrator" }, { signer: "x" }, { writer: "y" }]) {
    const { contractData } = computeCustodyVerdict({ ...cleanRecord(), ...extra });
    assert.ok(contractData.violations.some((v) => /unexpected field/.test(v) && /authorship/.test(v)), JSON.stringify(extra));
  }
});

test("CUSTODY_CLASSIFICATIONS / CUSTODY_MERGE_STATES: the exact closed enums", () => {
  assert.deepEqual(CUSTODY_CLASSIFICATIONS, ["clean", "tamper", "verification-unavailable"]);
  assert.deepEqual(CUSTODY_MERGE_STATES, ["pre-merge", "post-merge"]);
});

// --- classifyCustodyVerdictBytes: raw-bytes classification (absent/malformed/identity/clean/tamper/unavailable) ---

test("classifyCustodyVerdictBytes: non-string raw → absent", () => {
  assert.equal(classifyCustodyVerdictBytes(null).classification, "absent");
  assert.equal(classifyCustodyVerdictBytes(undefined).classification, "absent");
});

test("classifyCustodyVerdictBytes: unparseable JSON → malformed", () => {
  assert.equal(classifyCustodyVerdictBytes("not json at all").classification, "malformed");
});

test("classifyCustodyVerdictBytes: parseable JSON with violations (e.g. bad enum) → malformed", () => {
  const r = classifyCustodyVerdictBytes(JSON.stringify({ ...cleanRecord(), classification: "fine" }));
  assert.equal(r.classification, "malformed");
});

test("classifyCustodyVerdictBytes: run_id / issue mismatch against expected → identity-mismatch", () => {
  const raw = JSON.stringify(cleanRecord());
  assert.equal(classifyCustodyVerdictBytes(raw, { expectedRunId: "other-run", expectedIssue: "FAFF-1" }).classification, "identity-mismatch");
  assert.equal(classifyCustodyVerdictBytes(raw, { expectedRunId: "run-t", expectedIssue: "FAFF-9" }).classification, "identity-mismatch");
});

test("classifyCustodyVerdictBytes: an exact valid clean/tamper/unavailable record classifies as itself", () => {
  assert.equal(classifyCustodyVerdictBytes(JSON.stringify(cleanRecord())).classification, "clean");
  assert.equal(classifyCustodyVerdictBytes(JSON.stringify(tamperRecord())).classification, "tamper");
  assert.equal(classifyCustodyVerdictBytes(JSON.stringify(unavailableRecord())).classification, "verification-unavailable");
});

test("classifyCustodyVerdictBytes: identity check is skipped when expected*  is omitted entirely", () => {
  const raw = JSON.stringify(cleanRecord());
  assert.equal(classifyCustodyVerdictBytes(raw).classification, "clean");
});

// --- computeCustodyVerdictAdmission: the exact-valid-clean-only gate merge-gate.js binds to ---

function sha(s) { return createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex"); }

test("computeCustodyVerdictAdmission: admits ONLY an exact valid clean record with a matching digest and identity", () => {
  const raw = JSON.stringify(cleanRecord());
  const actualSha256 = sha(raw);
  const r = computeCustodyVerdictAdmission({ raw, actualSha256, expectedSha256: actualSha256, expectedRunId: "run-t", expectedIssue: "FAFF-1" });
  assert.equal(r.admitted, true);
});

test("computeCustodyVerdictAdmission: refuses ABSENT (raw not a string)", () => {
  const r = computeCustodyVerdictAdmission({ raw: null, actualSha256: null, expectedSha256: "a".repeat(64), expectedRunId: "run-t", expectedIssue: "FAFF-1" });
  assert.equal(r.admitted, false);
  assert.match(r.reason, /absent or unreadable/);
});

test("computeCustodyVerdictAdmission: refuses MALFORMED JSON", () => {
  const raw = "not json";
  const actualSha256 = sha(raw);
  const r = computeCustodyVerdictAdmission({ raw, actualSha256, expectedSha256: actualSha256, expectedRunId: "run-t", expectedIssue: "FAFF-1" });
  assert.equal(r.admitted, false);
  assert.match(r.reason, /malformed/);
});

test("computeCustodyVerdictAdmission: refuses an UNKNOWN-VERSION record", () => {
  const raw = JSON.stringify({ ...cleanRecord(), schema_version: 2 });
  const actualSha256 = sha(raw);
  const r = computeCustodyVerdictAdmission({ raw, actualSha256, expectedSha256: actualSha256, expectedRunId: "run-t", expectedIssue: "FAFF-1" });
  assert.equal(r.admitted, false);
  assert.match(r.reason, /malformed/);
});

test("computeCustodyVerdictAdmission: refuses a DIGEST MISMATCH (verdict replaced after recording)", () => {
  const raw = JSON.stringify(cleanRecord());
  const retained = sha(raw); // the SHA the dispatcher retained from verify --record-result
  const replaced = JSON.stringify({ ...cleanRecord(), detail: "replaced" }); // same on-disk path, different bytes
  const actualSha256 = sha(replaced);
  const r = computeCustodyVerdictAdmission({ raw: replaced, actualSha256, expectedSha256: retained, expectedRunId: "run-t", expectedIssue: "FAFF-1" });
  assert.equal(r.admitted, false);
  assert.match(r.reason, /digest mismatch/);
});

test("computeCustodyVerdictAdmission: refuses when actualSha256 could not be computed at all (null — never treated as a match)", () => {
  const raw = JSON.stringify(cleanRecord());
  const expectedSha256 = sha(raw);
  const r = computeCustodyVerdictAdmission({ raw, actualSha256: null, expectedSha256, expectedRunId: "run-t", expectedIssue: "FAFF-1" });
  assert.equal(r.admitted, false);
});

test("computeCustodyVerdictAdmission: refuses RUN-IDENTITY mismatch", () => {
  const raw = JSON.stringify(cleanRecord());
  const actualSha256 = sha(raw);
  const r = computeCustodyVerdictAdmission({ raw, actualSha256, expectedSha256: actualSha256, expectedRunId: "some-other-run", expectedIssue: "FAFF-1" });
  assert.equal(r.admitted, false);
  assert.match(r.reason, /identity mismatch/);
});

test("computeCustodyVerdictAdmission: refuses ISSUE-IDENTITY mismatch", () => {
  const raw = JSON.stringify(cleanRecord());
  const actualSha256 = sha(raw);
  const r = computeCustodyVerdictAdmission({ raw, actualSha256, expectedSha256: actualSha256, expectedRunId: "run-t", expectedIssue: "FAFF-2" });
  assert.equal(r.admitted, false);
  assert.match(r.reason, /identity mismatch/);
});

test("computeCustodyVerdictAdmission: refuses TAMPER (valid record, non-clean classification)", () => {
  const raw = JSON.stringify(tamperRecord());
  const actualSha256 = sha(raw);
  const r = computeCustodyVerdictAdmission({ raw, actualSha256, expectedSha256: actualSha256, expectedRunId: "run-t", expectedIssue: "FAFF-1" });
  assert.equal(r.admitted, false);
  assert.equal(r.classification, "tamper");
});

test("computeCustodyVerdictAdmission: refuses VERIFICATION-UNAVAILABLE", () => {
  const raw = JSON.stringify(unavailableRecord());
  const actualSha256 = sha(raw);
  const r = computeCustodyVerdictAdmission({ raw, actualSha256, expectedSha256: actualSha256, expectedRunId: "run-t", expectedIssue: "FAFF-1" });
  assert.equal(r.admitted, false);
  assert.equal(r.classification, "verification-unavailable");
});

test("computeCustodyVerdictAdmission: refuses a missing/malformed expectedSha256 (no retained digest to check against)", () => {
  const raw = JSON.stringify(cleanRecord());
  const r1 = computeCustodyVerdictAdmission({ raw, actualSha256: sha(raw), expectedSha256: undefined, expectedRunId: "run-t", expectedIssue: "FAFF-1" });
  assert.equal(r1.admitted, false);
  const r2 = computeCustodyVerdictAdmission({ raw, actualSha256: sha(raw), expectedSha256: "not-hex", expectedRunId: "run-t", expectedIssue: "FAFF-1" });
  assert.equal(r2.admitted, false);
});
