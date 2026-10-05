// FAFF-1142 / FAFF-1175 — the drift alarm for verification/commissaire-facade/: every schema:3
// facade record kind (plus the EffectDescriptor, the reconcile detection output, and the on-disk
// keypair custody files) ships a schema and a carried example in each published version, and
// every example must validate against its own version's schema via the shared validate-schema.mjs
// subset checker (reused as the CLI it is, never forked — matching test/evidence-spec.test.mjs).
//
// v0.1 is frozen: the read shape for records written before FAFF-1167 renamed the envelope's unit
// key `issue` to `unit_id`. Its examples are byte-sourced from run-20260927-182054-graft-FAFF-1138
// and its tree is pinned by digest below. v0.2 names `unit_id`; its record examples are carried
// from one FAFF-360 harness run at 475c0362, whose whole ledger ships beside them so the carry is
// checked here.
// Every record this file validates is first routed by schemaVersionFor, the executable twin of
// the "Reading v0.1 and v0.2 records" rule in v0.2/records.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const FACADE = join(REPO, "verification", "commissaire-facade");
const VALIDATOR = join(REPO, "plugin", "skills", "faff", "contracts", "validate-schema.mjs");
const FROZEN_FIXTURE = join(REPO, "test", "fixtures", "commissaire", "secret-free-replay", "declared-effects.jsonl");
const SOURCE_LEDGER = join(FACADE, "v0.2", "schema", "examples", "source-run.declared-effects.jsonl");

// sha256 over the sorted (relative path, bytes) list of verification/commissaire-facade/v0.1/**.
// A published version directory is immutable; changing this value means editing v0.1, which the
// versioning policy forbids.
const V01_TREE_DIGEST = "9efd90a8f0b3a0dd6635e2a00616d39b2c706d04e85715e3748f7182a6ccaabf";

const SCRATCH = mkdtempSync(join(tmpdir(), "facade-spec-"));
process.on("exit", () => rmSync(SCRATCH, { recursive: true, force: true }));
let scratchN = 0;

function validateFile(dataPath, schemaPath) {
  return spawnSync(process.execPath, [VALIDATOR, dataPath, schemaPath], { encoding: "utf8" });
}
function validateExample(schemaRel, exampleRel) {
  return validateFile(join(FACADE, exampleRel), join(FACADE, schemaRel));
}
function validateRecord(record, schemaRel) {
  const p = join(SCRATCH, `record-${scratchN++}.json`);
  writeFileSync(p, JSON.stringify(record));
  return validateFile(p, join(FACADE, schemaRel)).status === 0;
}
const readJson = (rel) => JSON.parse(readFileSync(join(FACADE, rel), "utf8"));
const readLedger = (p) => readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));

// The reader contract from v0.2/records.md: route by key presence, then validate.
const present = (rec, key) => Object.prototype.hasOwnProperty.call(rec, key) && rec[key] !== undefined;
function schemaVersionFor(rec) {
  if (rec.schema !== 3) return "not-facade";
  const hasIssue = present(rec, "issue");
  const hasUnit = present(rec, "unit_id");
  if (hasIssue && hasUnit) return "rejected";
  const key = hasUnit ? "unit_id" : hasIssue ? "issue" : null;
  if (key === null || typeof rec[key] !== "string" || rec[key] === "") return "unresolvable";
  return key === "unit_id" ? "v0.2" : "v0.1";
}

const KIND_SCHEMA = {
  admission: "admission",
  declare: "effect-claim",
  observe: "effect-claim",
  "effect-decision-request": "effect-decision-request",
  "effect-decision-verdict": "effect-decision-verdict",
  accepted_under_contract: "accepted-under-contract",
};
const envelope = (version) => `${version}/schema/facade-envelope.schema.json`;
const kindSchema = (version, rec) => `${version}/schema/${KIND_SCHEMA[rec.kind_of_entry]}.schema.json`;

// Route, then validate against the routed version only.
function routeAndValidate(rec) {
  const version = schemaVersionFor(rec);
  if (version !== "v0.1" && version !== "v0.2") return { version, valid: false };
  return { version, valid: validateRecord(rec, envelope(version)) && validateRecord(rec, kindSchema(version, rec)) };
}

const KINDS = [
  "facade-envelope", "admission", "effect-descriptor", "effect-claim", "effect-decision-request",
  "effect-decision-verdict", "reconcile", "accepted-under-contract", "governor-keypair", "producer-pk",
  "producer-admission",
];
const PAIRS = [
  ...["v0.1", "v0.2"].flatMap((v) => KINDS.map((k) => [`${v}/schema/${k}.schema.json`, `${v}/schema/examples/${k}.example.json`])),
  ["v0.2/schema/reconcile.schema.json", "v0.2/schema/examples/reconcile-rejected-unit-key.example.json"],
];

for (const [schemaRel, exampleRel] of PAIRS) {
  test(`commissaire-facade-spec: ${exampleRel} validates against ${schemaRel}`, () => {
    const r = validateExample(schemaRel, exampleRel);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
}

// The two authenticators are mutually exclusive and keyed by author (KIND_AUTHOR) — a rule the
// Draft-2020-12 subset validator cannot express, so it is guarded here against the real records.
const AUTH_KEYED = [
  ["admission", "commissaire"],
  ["effect-claim", "producer"],
  ["effect-decision-request", "producer"],
  ["effect-decision-verdict", "commissaire"],
  ["accepted-under-contract", "commissaire"],
];
const RECORD_EXAMPLES = ["facade-envelope", ...AUTH_KEYED.map(([k]) => k)];

for (const version of ["v0.1", "v0.2"]) {
  for (const [kind, author] of AUTH_KEYED) {
    const exampleRel = `${version}/schema/examples/${kind}.example.json`;
    test(`commissaire-facade-spec: ${exampleRel} carries exactly the ${author}-keyed authenticator`, () => {
      const rec = readJson(exampleRel);
      assert.equal(rec.author, author);
      if (author === "commissaire") {
        assert.ok(typeof rec.commissaire_sig === "string", "commissaire record needs commissaire_sig");
        assert.ok(!("producer_hmac" in rec), "commissaire record must not carry producer_hmac");
      } else {
        assert.ok(typeof rec.producer_hmac === "string", "producer record needs producer_hmac");
        assert.ok(!("commissaire_sig" in rec), "producer record must not carry commissaire_sig");
      }
    });
  }
}

test("commissaire-facade-spec: schemaVersionFor routes all five key forms", () => {
  assert.equal(schemaVersionFor({ schema: 2, issue: "U" }), "not-facade");
  assert.equal(schemaVersionFor({ schema: 3, issue: "U" }), "v0.1");
  assert.equal(schemaVersionFor({ schema: 3, unit_id: "U" }), "v0.2");
  assert.equal(schemaVersionFor({ schema: 3, issue: "U", unit_id: "U" }), "rejected");
  assert.equal(schemaVersionFor({ schema: 3, issue: "A", unit_id: "B" }), "rejected");
  assert.equal(schemaVersionFor({ schema: 3 }), "unresolvable");
  assert.equal(schemaVersionFor({ schema: 3, unit_id: 5 }), "unresolvable");
  assert.equal(schemaVersionFor({ schema: 3, unit_id: "" }), "unresolvable");
  assert.equal(schemaVersionFor({ schema: 3, issue: undefined, unit_id: "U" }), "v0.2");
});

test("commissaire-facade-spec: the frozen fixture's records route to v0.1, pass it, and fail the v0.2 envelope", () => {
  const frozen = readLedger(FROZEN_FIXTURE);
  assert.ok(frozen.length > 0);
  for (const rec of frozen) {
    const r = routeAndValidate(rec);
    assert.equal(r.version, "v0.1", `seq ${rec.seq}`);
    assert.ok(r.valid, `frozen seq ${rec.seq} must validate against v0.1`);
    assert.ok(!validateRecord(rec, envelope("v0.2")), `frozen seq ${rec.seq} must fail the v0.2 envelope`);
  }
});

test("commissaire-facade-spec: the v0.2 source ledger routes to v0.2, passes it, and fails the v0.1 envelope", () => {
  const source = readLedger(SOURCE_LEDGER);
  assert.equal(source.length, 8);
  for (const rec of source) {
    const r = routeAndValidate(rec);
    assert.equal(r.version, "v0.2", `seq ${rec.seq}`);
    assert.ok(r.valid, `source seq ${rec.seq} must validate against v0.2`);
    assert.ok(!validateRecord(rec, envelope("v0.1")), `source seq ${rec.seq} must fail the v0.1 envelope`);
  }
  assert.equal(source[0].kind_of_entry, "admission");
  assert.equal(source[0].unit_id, "-");
});

test("commissaire-facade-spec: every v0.2 record example is the source-ledger line with the same seq", () => {
  const bySeq = new Map(readLedger(SOURCE_LEDGER).map((r) => [r.seq, r]));
  for (const kind of RECORD_EXAMPLES) {
    const rec = readJson(`v0.2/schema/examples/${kind}.example.json`);
    assert.deepEqual(rec, bySeq.get(rec.seq), `${kind} example must equal source seq ${rec.seq}`);
  }
});

test("commissaire-facade-spec: dual-key records fail both envelopes and their kind schemas", () => {
  for (const kind of RECORD_EXAMPLES) {
    const v2 = readJson(`v0.2/schema/examples/${kind}.example.json`);
    const dual2 = { ...v2, issue: v2.unit_id };
    assert.equal(schemaVersionFor(dual2), "rejected");
    assert.ok(!validateRecord(dual2, envelope("v0.2")), `${kind}: dual-key fails the v0.2 envelope`);
    assert.ok(!validateRecord(dual2, envelope("v0.1")), `${kind}: dual-key fails the v0.1 envelope`);
    assert.ok(!validateRecord(dual2, kindSchema("v0.2", dual2)), `${kind}: dual-key fails its v0.2 kind schema`);

    const v1 = readJson(`v0.1/schema/examples/${kind}.example.json`);
    const dual1 = { ...v1, unit_id: v1.issue };
    assert.equal(schemaVersionFor(dual1), "rejected");
    assert.ok(!validateRecord(dual1, envelope("v0.1")), `${kind}: v0.1 dual-key fails the v0.1 envelope`);
    assert.ok(!validateRecord(dual1, kindSchema("v0.1", dual1)), `${kind}: v0.1 dual-key fails its v0.1 kind schema`);
  }
});

test("commissaire-facade-spec: unresolvable records with no unit key or a non-string unit fail both envelopes", () => {
  const base = readJson("v0.2/schema/examples/facade-envelope.example.json");
  const { unit_id: _drop, ...noUnit } = base;
  for (const rec of [noUnit, { ...base, unit_id: 5 }]) {
    assert.equal(schemaVersionFor(rec), "unresolvable");
    assert.ok(!validateRecord(rec, envelope("v0.1")));
    assert.ok(!validateRecord(rec, envelope("v0.2")));
  }
});

test("commissaire-facade-spec: every v0.2 reconcile escape carries equal issue and unit_id, each a non-empty string or null", () => {
  const unitOk = (v) => v === null || (typeof v === "string" && v !== "");
  const signals = new Set();
  for (const name of ["reconcile", "reconcile-rejected-unit-key"]) {
    const out = readJson(`v0.2/schema/examples/${name}.example.json`);
    assert.ok(out.escapes.length > 0, `${name} must carry an escape`);
    for (const e of out.escapes) {
      assert.ok(unitOk(e.issue) && unitOk(e.unit_id), `${name}: unit fields must be a non-empty string or null`);
      assert.equal(e.issue, e.unit_id, `${name}: issue is the one-release alias of unit_id`);
      if (e.signal === "rejected-unit-key") {
        assert.equal(e.unit_id, null);
        assert.ok(Number.isInteger(e.seq));
      }
      signals.add(e.signal);
    }
  }
  assert.deepEqual([...signals].sort(), ["escaped-side-effect", "rejected-unit-key"]);
});

function treeDigest(root) {
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(relative(root, p).split("\\").join("/"));
    }
  };
  walk(root);
  const h = createHash("sha256");
  for (const rel of files.sort()) {
    h.update(rel);
    h.update("\0");
    h.update(readFileSync(join(root, rel)));
    h.update("\0");
  }
  return h.digest("hex");
}

test("commissaire-facade-spec: v0.1 is frozen (tree digest unchanged)", () => {
  assert.equal(treeDigest(join(FACADE, "v0.1")), V01_TREE_DIGEST);
});
