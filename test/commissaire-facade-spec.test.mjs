// FAFF-1142 — the drift alarm for verification/commissaire-facade/: every schema:3 facade
// record kind (plus the EffectDescriptor, the reconcile detection output, and the on-disk
// keypair custody files) ships a schema and a hand-carried example, and every example must
// validate against its own schema via the shared validate-schema.mjs subset checker (reused
// as the CLI it is, never forked — matching test/evidence-spec.test.mjs). A forgotten example
// is a visible gap here, not a silent one.
//
// The record examples are byte-sourced from a real governed run
// (.faff/runs/run-20260927-182054-graft-FAFF-1138). `reconcile` is escape-only — a normal run
// emits none — so its example was generated under a forced escape and is labelled as such.
// The three keypair examples redact their secret halves (sk / master_secret / key_hex) for
// publication; the public fields are real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const FACADE = join(REPO, "verification", "commissaire-facade");
const VALIDATOR = join(REPO, "plugin", "skills", "faff", "contracts", "validate-schema.mjs");

function validateExample(schemaRel, exampleRel) {
  return spawnSync(process.execPath, [VALIDATOR, join(FACADE, exampleRel), join(FACADE, schemaRel)], { encoding: "utf8" });
}

// Every (schema, example) pair this directory ships. Adding a new record page means adding a
// row here.
const PAIRS = [
  ["v0.1/schema/facade-envelope.schema.json", "v0.1/schema/examples/facade-envelope.example.json"],
  ["v0.1/schema/admission.schema.json", "v0.1/schema/examples/admission.example.json"],
  ["v0.1/schema/effect-descriptor.schema.json", "v0.1/schema/examples/effect-descriptor.example.json"],
  ["v0.1/schema/effect-claim.schema.json", "v0.1/schema/examples/effect-claim.example.json"],
  ["v0.1/schema/effect-decision-request.schema.json", "v0.1/schema/examples/effect-decision-request.example.json"],
  ["v0.1/schema/effect-decision-verdict.schema.json", "v0.1/schema/examples/effect-decision-verdict.example.json"],
  ["v0.1/schema/reconcile.schema.json", "v0.1/schema/examples/reconcile.example.json"],
  ["v0.1/schema/accepted-under-contract.schema.json", "v0.1/schema/examples/accepted-under-contract.example.json"],
  ["v0.1/schema/governor-keypair.schema.json", "v0.1/schema/examples/governor-keypair.example.json"],
  ["v0.1/schema/producer-pk.schema.json", "v0.1/schema/examples/producer-pk.example.json"],
  ["v0.1/schema/producer-admission.schema.json", "v0.1/schema/examples/producer-admission.example.json"],
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
  ["v0.1/schema/examples/admission.example.json", "commissaire"],
  ["v0.1/schema/examples/effect-claim.example.json", "producer"],
  ["v0.1/schema/examples/effect-decision-request.example.json", "producer"],
  ["v0.1/schema/examples/effect-decision-verdict.example.json", "commissaire"],
  ["v0.1/schema/examples/accepted-under-contract.example.json", "commissaire"],
];

for (const [exampleRel, author] of AUTH_KEYED) {
  test(`commissaire-facade-spec: ${exampleRel} carries exactly the ${author}-keyed authenticator`, () => {
    const rec = JSON.parse(readFileSync(join(FACADE, exampleRel), "utf8"));
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
