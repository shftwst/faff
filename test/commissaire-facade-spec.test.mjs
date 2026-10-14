// FAFF-1142 / FAFF-1175 / FAFF-1224 — the drift alarm for verification/commissaire-facade/: every
// schema:3 facade record kind (plus the EffectDescriptor, the reconcile detection output, and the
// on-disk keypair custody files) ships a schema and a carried example in each published version,
// and every example must validate against its own version's schema via the shared
// validate-schema.mjs subset checker (reused as the CLI it is, never forked — matching
// test/evidence-spec.test.mjs).
//
// v0.1 is frozen: the read shape for records written before FAFF-1167 renamed the envelope's unit
// key `issue` to `unit_id`. v0.2 is frozen: the read shape for `unit_id`-keyed conclusions written
// before FAFF-1221 renamed the conclusion kind `accepted_under_contract` to `conformed_to_contract`.
// Both trees are pinned by digest below. v0.2 and v0.3 each carry their record examples from one
// FAFF-360 harness run (at 475c0362 and ec676cfc), whose whole ledger ships beside them so the
// carry is checked here.
// Every record this file validates is first routed by schemaVersionFor, the executable twin of
// the "Reading v0.1, v0.2 and v0.3 records" rule in v0.3/records.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { CONCLUSION_KIND, LEGACY_CONCLUSION_KIND, conclusionKindOf } from "../plugin/skills/faff/bin/lib/effects.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const FACADE = join(REPO, "verification", "commissaire-facade");
const VALIDATOR = join(REPO, "plugin", "skills", "faff", "contracts", "validate-schema.mjs");
const FROZEN_FIXTURE = join(REPO, "test", "fixtures", "commissaire", "secret-free-replay", "declared-effects.jsonl");
const sourceLedger = (version) => join(FACADE, version, "schema", "examples", "source-run.declared-effects.jsonl");

// sha256 over the sorted (relative path, bytes) list of each frozen version directory. A
// published version directory is immutable; changing either value means editing that version,
// which the versioning policy forbids.
const FROZEN_TREE_DIGESTS = {
  "v0.1": "9efd90a8f0b3a0dd6635e2a00616d39b2c706d04e85715e3748f7182a6ccaabf",
  "v0.2": "b769acc19526ddb35c17a4473abed195df7b657e3822d6e504eb85503ef258eb",
};

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

// The reader contract from v0.3/records.md: route by unit key, then by conclusion kind, then validate.
const present = (rec, key) => Object.prototype.hasOwnProperty.call(rec, key) && rec[key] !== undefined;
function schemaVersionFor(rec) {
  if (rec.schema !== 3) return "not-facade";
  const hasIssue = present(rec, "issue");
  const hasUnit = present(rec, "unit_id");
  if (hasIssue && hasUnit) return "rejected";
  const key = hasUnit ? "unit_id" : hasIssue ? "issue" : null;
  if (key === null || typeof rec[key] !== "string" || rec[key] === "") return "unresolvable";
  if (key === "issue") return "v0.1";
  if (conclusionKindOf(rec) === LEGACY_CONCLUSION_KIND) return "v0.2";
  return "v0.3";
}
const VERSIONS = ["v0.1", "v0.2", "v0.3"];

const CONCLUSION_SCHEMA = { "v0.1": "accepted-under-contract", "v0.2": "accepted-under-contract", "v0.3": "conformed-to-contract" };
const KIND_SCHEMA = {
  admission: "admission",
  declare: "effect-claim",
  observe: "effect-claim",
  "effect-decision-request": "effect-decision-request",
  "effect-decision-verdict": "effect-decision-verdict",
};
const envelope = (version) => `${version}/schema/facade-envelope.schema.json`;
const kindSchemaName = (version, rec) => KIND_SCHEMA[rec.kind_of_entry] ?? CONCLUSION_SCHEMA[version];
const kindSchema = (version, rec) => `${version}/schema/${kindSchemaName(version, rec)}.schema.json`;
const conclusionSchema = (version) => `${version}/schema/${CONCLUSION_SCHEMA[version]}.schema.json`;

// Route, then validate against the routed version only.
function routeAndValidate(rec) {
  const version = schemaVersionFor(rec);
  if (!VERSIONS.includes(version)) return { version, valid: false };
  return { version, valid: validateRecord(rec, envelope(version)) && validateRecord(rec, kindSchema(version, rec)) };
}

const kindsFor = (version) => [
  "facade-envelope", "admission", "effect-descriptor", "effect-claim", "effect-decision-request",
  "effect-decision-verdict", "reconcile", CONCLUSION_SCHEMA[version], "governor-keypair", "producer-pk",
  "producer-admission",
];
const PAIRS = [
  ...VERSIONS.flatMap((v) => kindsFor(v).map((k) => [`${v}/schema/${k}.schema.json`, `${v}/schema/examples/${k}.example.json`])),
  ...["v0.2", "v0.3"].map((v) => [`${v}/schema/reconcile.schema.json`, `${v}/schema/examples/reconcile-rejected-unit-key.example.json`]),
];

for (const [schemaRel, exampleRel] of PAIRS) {
  test(`commissaire-facade-spec: ${exampleRel} validates against ${schemaRel}`, () => {
    const r = validateExample(schemaRel, exampleRel);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
}

test("commissaire-facade-spec: v0.3 has the conformed-to-contract schema and no accepted-under-contract schema", () => {
  const names = readdirSync(join(FACADE, "v0.3", "schema"));
  assert.ok(names.includes("conformed-to-contract.schema.json"));
  assert.ok(!names.includes("accepted-under-contract.schema.json"));
  assert.ok(!readdirSync(join(FACADE, "v0.3", "schema", "examples")).includes("accepted-under-contract.example.json"));
});

test("commissaire-facade-spec: the v0.3 kind enums name the current conclusion kind only", () => {
  const kinds = readJson(envelope("v0.3")).properties.kind_of_entry.enum;
  assert.ok(kinds.includes(CONCLUSION_KIND));
  assert.ok(!kinds.includes(LEGACY_CONCLUSION_KIND));
  assert.deepEqual(readJson(conclusionSchema("v0.3")).properties.kind_of_entry.enum, [CONCLUSION_KIND]);
});

// The two authenticators are mutually exclusive and keyed by author (KIND_AUTHOR) — a rule the
// Draft-2020-12 subset validator cannot express, so it is guarded here against the real records.
const authKeyed = (version) => [
  ["admission", "commissaire"],
  ["effect-claim", "producer"],
  ["effect-decision-request", "producer"],
  ["effect-decision-verdict", "commissaire"],
  [CONCLUSION_SCHEMA[version], "commissaire"],
];
const recordExamples = (version) => ["facade-envelope", ...authKeyed(version).map(([k]) => k)];

for (const version of VERSIONS) {
  for (const [kind, author] of authKeyed(version)) {
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

test("commissaire-facade-spec: schemaVersionFor returns all six outcomes", () => {
  assert.equal(schemaVersionFor({ schema: 2, issue: "U" }), "not-facade");
  assert.equal(schemaVersionFor({ schema: 3, issue: "U" }), "v0.1");
  assert.equal(schemaVersionFor({ schema: 3, issue: "U", kind_of_entry: CONCLUSION_KIND }), "v0.1");
  assert.equal(schemaVersionFor({ schema: 3, issue: "U", kind_of_entry: LEGACY_CONCLUSION_KIND }), "v0.1");
  assert.equal(schemaVersionFor({ schema: 3, unit_id: "U" }), "v0.3");
  assert.equal(schemaVersionFor({ schema: 3, unit_id: "U", kind_of_entry: "observe" }), "v0.3");
  assert.equal(schemaVersionFor({ schema: 3, unit_id: "U", kind_of_entry: CONCLUSION_KIND }), "v0.3");
  assert.equal(schemaVersionFor({ schema: 3, unit_id: "U", kind_of_entry: LEGACY_CONCLUSION_KIND }), "v0.2");
  assert.equal(schemaVersionFor({ schema: 3, issue: "U", unit_id: "U" }), "rejected");
  assert.equal(schemaVersionFor({ schema: 3, issue: "A", unit_id: "B" }), "rejected");
  assert.equal(schemaVersionFor({ schema: 3 }), "unresolvable");
  assert.equal(schemaVersionFor({ schema: 3, unit_id: 5 }), "unresolvable");
  assert.equal(schemaVersionFor({ schema: 3, unit_id: "" }), "unresolvable");
  assert.equal(schemaVersionFor({ schema: 3, issue: undefined, unit_id: "U" }), "v0.3");
});

test("commissaire-facade-spec: the frozen fixture's records route to v0.1, pass it, and fail the v0.2 and v0.3 envelopes", () => {
  const frozen = readLedger(FROZEN_FIXTURE);
  assert.ok(frozen.length > 0);
  for (const rec of frozen) {
    const r = routeAndValidate(rec);
    assert.equal(r.version, "v0.1", `seq ${rec.seq}`);
    assert.ok(r.valid, `frozen seq ${rec.seq} must validate against v0.1`);
    assert.ok(!validateRecord(rec, envelope("v0.2")), `frozen seq ${rec.seq} must fail the v0.2 envelope`);
    assert.ok(!validateRecord(rec, envelope("v0.3")), `frozen seq ${rec.seq} must fail the v0.3 envelope`);
  }
});

test("commissaire-facade-spec: the v0.2 source ledger routes its legacy conclusion to v0.2 and every other record to v0.3", () => {
  const source = readLedger(sourceLedger("v0.2"));
  assert.equal(source.length, 8);
  for (const rec of source) {
    const r = routeAndValidate(rec);
    assert.ok(r.valid, `v0.2 source seq ${rec.seq} must validate against its routed version ${r.version}`);
    assert.ok(!validateRecord(rec, envelope("v0.1")), `v0.2 source seq ${rec.seq} must fail the v0.1 envelope`);
    if (rec.seq === 7) {
      assert.equal(rec.kind_of_entry, LEGACY_CONCLUSION_KIND);
      assert.equal(r.version, "v0.2");
      assert.ok(!validateRecord(rec, envelope("v0.3")), "the legacy conclusion must fail the v0.3 envelope");
      assert.ok(!validateRecord(rec, conclusionSchema("v0.3")), "the legacy conclusion must fail the v0.3 conclusion schema");
    } else {
      assert.equal(r.version, "v0.3", `seq ${rec.seq}`);
      assert.ok(validateRecord(rec, envelope("v0.2")) && validateRecord(rec, kindSchema("v0.2", rec)), `v0.2 source seq ${rec.seq} still validates against v0.2`);
    }
  }
  assert.equal(source[0].kind_of_entry, "admission");
  assert.equal(source[0].unit_id, "-");
});

test("commissaire-facade-spec: the v0.3 source ledger routes to v0.3, passes it, and its conclusion fails the v0.2 envelope", () => {
  const source = readLedger(sourceLedger("v0.3"));
  assert.equal(source.length, 8);
  for (const rec of source) {
    const r = routeAndValidate(rec);
    assert.equal(r.version, "v0.3", `seq ${rec.seq}`);
    assert.ok(r.valid, `v0.3 source seq ${rec.seq} must validate against v0.3`);
    assert.ok(!validateRecord(rec, envelope("v0.1")), `v0.3 source seq ${rec.seq} must fail the v0.1 envelope`);
  }
  assert.equal(source[0].kind_of_entry, "admission");
  assert.equal(source[0].unit_id, "-");
  assert.equal(source[7].seq, 7);
  assert.equal(source[7].kind_of_entry, CONCLUSION_KIND);
  assert.ok(!validateRecord(source[7], envelope("v0.2")), "the current conclusion must fail the v0.2 envelope");
});

for (const version of ["v0.2", "v0.3"]) {
  test(`commissaire-facade-spec: every ${version} record example is the source-ledger line with the same seq`, () => {
    const bySeq = new Map(readLedger(sourceLedger(version)).map((r) => [r.seq, r]));
    for (const kind of recordExamples(version)) {
      const rec = readJson(`${version}/schema/examples/${kind}.example.json`);
      assert.deepEqual(rec, bySeq.get(rec.seq), `${kind} example must equal source seq ${rec.seq}`);
    }
  });
}

test("commissaire-facade-spec: dual-key records are rejected and fail every envelope and their kind schemas", () => {
  for (const version of ["v0.2", "v0.3"]) {
    for (const kind of recordExamples(version)) {
      const rec = readJson(`${version}/schema/examples/${kind}.example.json`);
      const dual = { ...rec, issue: rec.unit_id };
      assert.equal(schemaVersionFor(dual), "rejected");
      for (const v of VERSIONS) assert.ok(!validateRecord(dual, envelope(v)), `${version} ${kind}: dual-key fails the ${v} envelope`);
      assert.ok(!validateRecord(dual, kindSchema(version, dual)), `${version} ${kind}: dual-key fails its ${version} kind schema`);
    }
  }
  for (const kind of recordExamples("v0.1")) {
    const v1 = readJson(`v0.1/schema/examples/${kind}.example.json`);
    const dual1 = { ...v1, unit_id: v1.issue };
    assert.equal(schemaVersionFor(dual1), "rejected");
    assert.ok(!validateRecord(dual1, envelope("v0.1")), `${kind}: v0.1 dual-key fails the v0.1 envelope`);
    assert.ok(!validateRecord(dual1, kindSchema("v0.1", dual1)), `${kind}: v0.1 dual-key fails its v0.1 kind schema`);
  }
});

test("commissaire-facade-spec: unresolvable records with no unit key or a non-string unit fail every envelope", () => {
  const base = readJson("v0.3/schema/examples/facade-envelope.example.json");
  const { unit_id: _drop, ...noUnit } = base;
  for (const rec of [noUnit, { ...base, unit_id: 5 }]) {
    assert.equal(schemaVersionFor(rec), "unresolvable");
    for (const v of VERSIONS) assert.ok(!validateRecord(rec, envelope(v)), `unresolvable record fails the ${v} envelope`);
  }
});

for (const version of ["v0.2", "v0.3"]) {
  test(`commissaire-facade-spec: every ${version} reconcile escape carries equal issue and unit_id, each a non-empty string or null`, () => {
    const unitOk = (v) => v === null || (typeof v === "string" && v !== "");
    const signals = new Set();
    for (const name of ["reconcile", "reconcile-rejected-unit-key"]) {
      const out = readJson(`${version}/schema/examples/${name}.example.json`);
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
}

// Structural shape only: prose fields ($id, title, description) may differ between versions.
const PROSE_KEYS = new Set(["$id", "title", "description"]);
function structure(node) {
  if (Array.isArray(node)) return node.map(structure);
  if (node === null || typeof node !== "object") return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) if (!PROSE_KEYS.has(k)) out[k] = structure(v);
  return out;
}
const UNCHANGED_SCHEMAS = [
  "admission", "effect-claim", "effect-decision-request", "effect-decision-verdict", "reconcile",
  "effect-descriptor", "governor-keypair", "producer-pk", "producer-admission",
];
for (const name of UNCHANGED_SCHEMAS) {
  test(`commissaire-facade-spec: v0.3 ${name} schema equals its v0.2 twin structurally`, () => {
    assert.deepEqual(structure(readJson(`v0.3/schema/${name}.schema.json`)), structure(readJson(`v0.2/schema/${name}.schema.json`)));
  });
}

// Redaction guard: a custody secret that reaches a published keypair example is a key leak.
const SECRET_FIELDS = ["sk", "master_secret", "key_hex"];
const KEYPAIR_EXAMPLES = ["governor-keypair", "producer-pk", "producer-admission"];
const unredactedSecrets = (obj) =>
  SECRET_FIELDS.filter((f) => f in obj && !(typeof obj[f] === "string" && obj[f].startsWith("<REDACTED")));

for (const version of VERSIONS) {
  test(`commissaire-facade-spec: every ${version} keypair example redacts sk, master_secret and key_hex`, () => {
    for (const name of KEYPAIR_EXAMPLES) {
      assert.deepEqual(unredactedSecrets(readJson(`${version}/schema/examples/${name}.example.json`)), [], `${version} ${name}`);
    }
  });
}

test("commissaire-facade-spec: the redaction check catches each unredacted v0.3 secret", () => {
  let cases = 0;
  for (const name of KEYPAIR_EXAMPLES) {
    const example = readJson(`v0.3/schema/examples/${name}.example.json`);
    for (const field of SECRET_FIELDS.filter((f) => f in example)) {
      const leaked = { ...example, [field]: "a".repeat(32) + "0123456789abcdef".repeat(2) };
      assert.deepEqual(unredactedSecrets(leaked), [field], `${name}.${field}`);
      cases++;
    }
  }
  assert.equal(cases, 3);
});

function walkFiles(root) {
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(relative(root, p).split("\\").join("/"));
    }
  };
  walk(root);
  return files.sort();
}

test("commissaire-facade-spec: no file under verification/commissaire-facade/ holds a private key", () => {
  for (const rel of walkFiles(FACADE)) {
    assert.ok(!readFileSync(join(FACADE, rel), "utf8").includes("PRIVATE KEY"), rel);
  }
});

function treeDigest(root) {
  const h = createHash("sha256");
  for (const rel of walkFiles(root)) {
    h.update(rel);
    h.update("\0");
    h.update(readFileSync(join(root, rel)));
    h.update("\0");
  }
  return h.digest("hex");
}

for (const [version, digest] of Object.entries(FROZEN_TREE_DIGESTS)) {
  test(`commissaire-facade-spec: ${version} is frozen (tree digest unchanged)`, () => {
    assert.equal(treeDigest(join(FACADE, version)), digest);
  });
}
