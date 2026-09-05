// FAFF-992 — the classified park record: the reconsider axis + cited_input on park-history.js and the
// git-only prep marker, plus the shared fingerprint helper. In-process requires (the pure helpers)
// like the sibling park-history / prepcheck coverage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const ph = require(join(REPO, "plugin", "skills", "faff", "bin", "lib", "park-history.js"));
const pc = require(join(REPO, "plugin", "skills", "faff", "bin", "lib", "prepcheck.js"));

const MACHINE_CI = { kind: "config-file", ref: ".faffrc.yaml", keys: ["adversarial.spec_review.max_tokens"], fingerprint: "sha256:abc" };

test("FAFF-992: a record carrying reconsider/cited_input round-trips through add/render/extract", () => {
  const rec = { issue_id: "FAFF-92", root_cause_class: "other", timestamp: "2026-09-05T00:00:00Z", reconsider: "machine", cited_input: MACHINE_CI };
  const acc = ph.addParkRecord([], rec);
  const block = ph.renderParksBlock(acc);
  const parsed = ph.extractParksBlock(block, "run-x");
  assert.deepEqual(parsed[0], rec, "the new fields survive the wire round-trip byte-for-byte");
});

test("FAFF-992: counting is UNCHANGED by the new fields (keys only issue/class/timestamp)", () => {
  const withFields = [
    { issue_id: "A", root_cause_class: "gap", timestamp: "2026-06-01T09:00:00Z", reconsider: "human", cited_input: null },
    { issue_id: "A", root_cause_class: "gap", timestamp: "2026-06-08T09:00:00Z", reconsider: "machine", cited_input: MACHINE_CI },
    { issue_id: "A", root_cause_class: "gap", timestamp: "2026-06-15T09:00:00Z", reconsider: "machine", cited_input: { kind: "backend", ref: "spark", fingerprint: "" } },
  ];
  const plain = withFields.map(({ reconsider, cited_input, ...r }) => r);
  const now = Date.parse("2026-06-16T00:00:00Z");
  assert.deepEqual(
    ph.computeParkHistory(withFields, now, null).repeat_parked,
    ph.computeParkHistory(plain, now, null).repeat_parked,
    "identical counting with or without the reconsider fields");
});

test("FAFF-992: readReconsider is fail-safe (absent/legacy/backend/malformed all read human)", () => {
  assert.equal(ph.readReconsider({}), "human", "absent field");
  assert.equal(ph.readReconsider({ reconsider: "human", cited_input: null }), "human");
  assert.equal(ph.readReconsider({ reconsider: "machine", cited_input: MACHINE_CI }), "machine", "well-formed config-file machine");
  assert.equal(ph.readReconsider({ reconsider: "machine", cited_input: { kind: "backend", ref: "spark", fingerprint: "z" } }), "human", "backend is not machine-checkable");
  assert.equal(ph.readReconsider({ reconsider: "machine", cited_input: { kind: "config-file", ref: "x", fingerprint: "" } }), "human", "empty fingerprint");
  assert.equal(ph.readReconsider({ reconsider: "machine", cited_input: null }), "human", "machine with no cited input");
  assert.equal(ph.readReconsider(null), "human");
});

test("FAFF-992: isWellFormedMachineCitedInput accepts only a config-file with ref + fingerprint", () => {
  assert.equal(ph.isWellFormedMachineCitedInput(MACHINE_CI), true);
  assert.equal(ph.isWellFormedMachineCitedInput({ kind: "backend", ref: "spark", fingerprint: "z" }), false);
  assert.equal(ph.isWellFormedMachineCitedInput({ kind: "config-file", ref: "", fingerprint: "z" }), false);
  assert.equal(ph.isWellFormedMachineCitedInput(null), false);
});

test("FAFF-992: fingerprintFile hashes a real repo file, and fail-closes to null off-root/missing/symlink-escape", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-fp-"));
  try {
    const rootReal = realpathSync(root);
    writeFileSync(join(rootReal, "cfg.yaml"), "a: 1\n");
    const fp = ph.fingerprintFile(rootReal, "cfg.yaml");
    assert.ok(typeof fp === "string" && fp.startsWith("sha256:"), "hashes a real in-root file");
    // deterministic
    assert.equal(ph.fingerprintFile(rootReal, "cfg.yaml"), fp, "same bytes -> same hash");
    // content change -> different hash
    writeFileSync(join(rootReal, "cfg.yaml"), "a: 2\n");
    assert.notEqual(ph.fingerprintFile(rootReal, "cfg.yaml"), fp, "changed content -> changed hash");
    // missing / out-of-root -> null (fail-closed)
    assert.equal(ph.fingerprintFile(rootReal, "nope.yaml"), null, "missing file");
    assert.equal(ph.fingerprintFile(rootReal, "../../../etc/hosts"), null, "lexically out of root");
    // in-root symlink that escapes the root -> null (realpath containment)
    const outside = mkdtempSync(join(tmpdir(), "faff-out-"));
    writeFileSync(join(realpathSync(outside), "secret"), "s\n");
    symlinkSync(join(realpathSync(outside), "secret"), join(rootReal, "link"));
    assert.equal(ph.fingerprintFile(rootReal, "link"), null, "symlink escaping the root is refused");
    rmSync(outside, { recursive: true, force: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-992: prepcheck.readParkCause is fail-safe and surfaces a recorded ParkCause", () => {
  assert.deepEqual(pc.readParkCause({ disposition: "parked" }), { reconsider: "human", cause_class: null, parked_at: null, cited_input: null }, "no park sub-object -> human");
  assert.deepEqual(pc.readParkCause(null), { reconsider: "human", cause_class: null, parked_at: null, cited_input: null });
  const got = pc.readParkCause({ disposition: "parked", park: { reconsider: "machine", cause_class: "other", parked_at: "2026-09-05T00:00:00Z", cited_input: MACHINE_CI } });
  assert.equal(got.reconsider, "machine");
  assert.equal(got.cause_class, "other");
  assert.deepEqual(got.cited_input, MACHINE_CI);
});

test("FAFF-992: a park-bearing marker still classifies parked (classifyPrepIssue byte-unchanged)", () => {
  const marker = { issue: "FAFF-92", spec_produced: true, attached: false, disposition: "parked", park: { reconsider: "machine", cause_class: "other", parked_at: "2026-09-05T00:00:00Z", cited_input: MACHINE_CI } };
  const { payload, exitCode } = pc.classifyPrepIssue("FAFF-92", { exists: true, parseOk: true, marker }, null);
  assert.equal(payload.state, "parked");
  assert.equal(exitCode, 0);
  assert.equal("park" in payload, false, "classifyPrepIssue does not surface the park sub-object");
});
