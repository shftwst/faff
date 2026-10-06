// FAFF-1180 — the shared identity parsers: one permissive rule over nine kinds, the frozen-record sweep,
// the producer-auth delegates, and the module's export and require surface.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const LIB = path.join(REPO, "plugin", "skills", "faff", "bin", "lib");
const require = createRequire(import.meta.url);
const ids = require(path.join(LIB, "ids.js"));
const producerAuth = require(path.join(LIB, "producer-auth.js"));

const parserFor = (kind) => ids[`parse${kind}`];
const KINDS = ids.ID_KINDS;

const ACCEPTED = [
  "RUN-SMOKE", "run-20261004-153223-graft-FAFF-1170-1", "FAFF-1167", "-", "bare-claude", "P1",
  "faff-runner-v1", "r1", "U1", " x ",
];
const REJECTED_NON_STRINGS = [undefined, null, 0, true, {}, []];

test("ID_KINDS lists the nine kinds in order", () => {
  assert.deepEqual(KINDS, [
    "RunId", "RunSegmentId", "UnitId", "ContractRevisionId", "ProducerId",
    "EffectId", "EventId", "LaneId", "StageAttemptId",
  ]);
});

test("every kind accepts every frozen id shape and returns the identical string", () => {
  for (const kind of KINDS) {
    for (const input of ACCEPTED) {
      const r = parserFor(kind)(input);
      assert.equal(r.ok, true, `${kind} should accept ${JSON.stringify(input)}`);
      assert.equal(r.value, input);
    }
  }
});

test("every kind rejects non-strings and the empty string with a typed reason", () => {
  for (const kind of KINDS) {
    for (const input of REJECTED_NON_STRINGS) {
      assert.deepEqual(parserFor(kind)(input), { ok: false, error: { kind, reason: "not-a-string", received: typeof input } });
    }
    assert.deepEqual(parserFor(kind)(""), { ok: false, error: { kind, reason: "empty-string", received: "string" } });
  }
});

test("a Symbol is rejected without throwing", () => {
  assert.deepEqual(ids.parseUnitId(Symbol("s")), { ok: false, error: { kind: "UnitId", reason: "not-a-string", received: "symbol" } });
});

test("the module exports exactly ID_KINDS and the nine parsers (the mint stays internal)", () => {
  assert.deepEqual(Object.keys(ids).sort(), ["ID_KINDS", ...KINDS.map((k) => `parse${k}`)].sort());
});

test("ids.js requires only ./result", () => {
  const specifiers = [...readFileSync(path.join(LIB, "ids.js"), "utf8").matchAll(/\brequire\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  assert.deepEqual(specifiers, ["./result"]);
});

test("producer-auth keeps its module.exports key set", () => {
  assert.deepEqual(Object.keys(producerAuth).sort(), [
    "AUTH_FIELDS", "ProducerAuth", "CommissaireAuth",
    "canonicalBytes", "canonicalStringify",
    "deriveKey", "admitProducerKey", "signRecord", "verifyRecord",
    "asProducerId", "asContractRevisionId", "tryAsProducerId", "tryAsContractRevisionId",
    "mintGovernorKeypair", "pkFingerprint", "signDecision", "verifyDecision",
    "producerAuthSelftest",
  ].sort());
});

test("producer-auth mints delegate with the messages they threw before", () => {
  assert.throws(() => producerAuth.asProducerId(""), { name: "TypeError", message: "asProducerId: expected a non-empty string, got string" });
  assert.throws(() => producerAuth.asContractRevisionId(42), { name: "TypeError", message: "asContractRevisionId: expected a non-empty string, got number" });
  assert.equal(producerAuth.tryAsProducerId(42), null);
  assert.equal(producerAuth.tryAsProducerId("P1"), "P1");
  assert.equal(producerAuth.asProducerId("P1"), "P1");
  assert.equal(producerAuth.asContractRevisionId("r1"), "r1");
  assert.equal(producerAuth.tryAsContractRevisionId(""), null);
  assert.equal(producerAuth.tryAsContractRevisionId("r1"), "r1");
});

const SWEPT_FIELDS = [
  ["run_id", "RunId", (r) => r.run_id],
  ["producer_id", "ProducerId", (r) => r.producer_id],
  ["payload.producer_id", "ProducerId", (r) => r.payload?.producer_id],
  ["contract_revision", "ContractRevisionId", (r) => r.contract_revision],
  ["payload.contract_revision", "ContractRevisionId", (r) => r.payload?.contract_revision],
  ["unit_id", "UnitId", (r) => r.unit_id],
  ["issue", "UnitId", (r) => r.issue],
];

function frozenRecords() {
  const files = execFileSync("git", ["ls-files", "*.jsonl"], { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean);
  const records = [];
  for (const file of files) {
    for (const line of readFileSync(path.join(REPO, file), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (record?.schema === 3) records.push(record);
      } catch {
        continue;
      }
    }
  }
  return records;
}

test("every id already held by a committed schema:3 record parses to the identical string", () => {
  const records = frozenRecords();
  const seen = new Map(SWEPT_FIELDS.map(([field]) => [field, new Set()]));
  for (const record of records) {
    for (const [field, kind, read] of SWEPT_FIELDS) {
      const value = read(record);
      if (value === undefined) continue;
      const r = parserFor(kind)(value);
      assert.equal(r.ok, true, `${field}=${JSON.stringify(value)} must parse as ${kind}`);
      assert.equal(r.value, value);
      seen.get(field).add(value);
    }
  }
  for (const [field, values] of seen) assert.ok(values.size > 0, `the sweep saw no value for ${field}`);
  assert.ok(seen.get("unit_id").has("-"), 'the sweep saw no "-" under unit_id');
  assert.ok(seen.get("issue").has("-"), 'the sweep saw no "-" under issue');
});
