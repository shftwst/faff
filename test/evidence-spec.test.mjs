// FAFF-601 — the drift alarm for docs/evidence/: every new schema's example must
// validate against its own schema (via the shared validate-schema.mjs subset checker —
// reused as the CLI it is, never forked; it self-executes on import so it is invoked as
// a subprocess, matching its own documented usage), the events example must pass `faff
// events validate`, and the v0.2 chain-head example must be reproducible from a fresh
// `faff events anchor` run over the same source bytes (the "does the spec describe
// reality" check).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const EVIDENCE = join(REPO, "docs", "evidence");
const VALIDATOR = join(REPO, "plugin", "skills", "faff", "contracts", "validate-schema.mjs");

function load(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function validateExample(schemaRel, exampleRel) {
  return spawnSync(process.execPath, [VALIDATOR, join(EVIDENCE, exampleRel), join(EVIDENCE, schemaRel)], { encoding: "utf8" });
}

// Every (schema, example) pair this directory ships. Adding a new artifact page means
// adding a row here — the whole point of the harness is that a forgotten example is a
// visible gap, not a silent one.
const PAIRS = [
  ["v0.1/schema/run-ledger.schema.json", "v0.1/schema/examples/run-ledger.example.json"],
  ["v0.1/schema/run-event.schema.json", "v0.1/schema/examples/run-event.example.json"],
  ["v0.1/schema/ac-checklist.schema.json", "v0.1/schema/examples/ac-checklist.example.json"],
  ["v0.1/schema/merge-record.schema.json", "v0.1/schema/examples/merge-record.example.json"],
  ["v0.1/schema/supersession.schema.json", "v0.1/schema/examples/supersession.example.json"],
  ["v0.1/schema/build-progress.schema.json", "v0.1/schema/examples/build-progress.example.json"],
  ["v0.2/schema/chain-head.schema.json", "v0.2/schema/examples/chain-head.example.json"],
];

for (const [schemaRel, exampleRel] of PAIRS) {
  test(`evidence-spec: ${exampleRel} validates against ${schemaRel}`, () => {
    const r = validateExample(schemaRel, exampleRel);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
}

test("evidence-spec: the run-event example passes `faff events validate`", () => {
  // Build a minimal one-line events.jsonl from the shipped example (schema-2, genesis
  // record) so `faff events validate` has a self-consistent file to check — the example
  // itself is a mid-chain record (real seq 29), so validate it as its own genesis line
  // by resetting seq/prev to what a standalone genesis record requires. This exercises
  // shape validation, not chain-walking (that's `faff events verify`'s job, tested next).
  const rec = load(join(EVIDENCE, "v0.1/schema/examples/run-event.example.json"));
  const dir = mkdtempSync(join(tmpdir(), "faff-evidence-spec-"));
  const genesis = { ...rec, seq: 0 };
  delete genesis.prev;
  genesis.schema = 1; // schema-1: no prev required — isolates shape validation
  writeFileSync(join(dir, "events.jsonl"), JSON.stringify(genesis) + "\n");
  const r = spawnSync(process.execPath, [BIN, "events", "validate", "--file", join(dir, "events.jsonl")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("evidence-spec: v0.2 chain-head example is reproducible from a fresh `faff events anchor`", () => {
  // Build a tiny two-line events.jsonl with a real chain (genesis + one linked record),
  // anchor it, and confirm the CLI's own computeChainHead output has exactly the field
  // set this schema requires — the "spec describes reality" check for the new artifact.
  const src = mkdtempSync(join(tmpdir(), "faff-evidence-anchor-src-"));
  const dest = mkdtempSync(join(tmpdir(), "faff-evidence-anchor-dest-"));
  const runId = "run-evidence-spec-test";
  const genesis = { schema: 2, run_id: runId, seq: 0, ts: new Date().toISOString(), phase: "run", type: "run-start" };
  // genesis prev = SHA-256(run_id) — computed the same way verifyChain expects; here we
  // only need a byte-valid events.jsonl for `faff events anchor` to read, not a verified
  // chain (anchor never re-verifies at anchor time, only computes the head).
  genesis.prev = createHash("sha256").update(runId, "utf8").digest("hex");
  writeFileSync(join(src, "events.jsonl"), JSON.stringify(genesis) + "\n");

  const r = spawnSync(process.execPath, [BIN, "events", "anchor", "--run-dir", src, "--issue", "FAFF-TEST", "--dest", dest], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);

  const head = load(join(dest, "chain-head.json"));
  const vr = spawnSync(process.execPath, [VALIDATOR, join(dest, "chain-head.json"), join(EVIDENCE, "v0.2/schema/chain-head.schema.json")], { encoding: "utf8" });
  assert.equal(vr.status, 0, vr.stdout + vr.stderr);
  // run_id is computeChainHead's SOURCE run-dir basename (the --run-dir arg's basename),
  // not the anchor dir's basename (which is the issue id) and not the events record's
  // own run_id field — src's mkdtemp-generated basename, whatever it is this run.
  assert.equal(head.run_id, src.split("/").pop());
  assert.equal(head.issue, "FAFF-TEST");
  assert.equal(head.line_count, 1);
});
