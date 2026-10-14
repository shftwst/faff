#!/usr/bin/env node
// FAFF-1260 — composes the v0.3 log schemas from their per-type sources and mirrors the v0.3
// tree into the bundled copy the plugin ships.
//
//   events/<type>.schema.json        authored data and type-specific top-level keys; the envelope
//                                    is filled from one template here
//   effects/<kind>.schema.json       filled from one template here
//   commissaire/<kind>.schema.json   authored payload; the envelope, the author and the effect
//                                    descriptor are filled here
//   run-event.schema.json,
//   declared-effect.schema.json      generated: the subset validator has no $ref, so every
//                                    per-type schema is inlined into a discriminator mapping
//
// Usage: node scripts/evidence-v0.3-compose.mjs [--check]
//   --check writes nothing and exits 1 naming every file that differs from a fresh composition.

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(REPO, "verification", "evidence", "v0.3");
const SCHEMA = join(SRC, "schema");
const BUNDLE = join(REPO, "plugin", "skills", "faff", "contracts", "evidence-v0.3");
const lib = (name) => require(join(REPO, "plugin", "skills", "faff", "bin", "lib", `${name}.js`));
const { DELIVERY_PROFILE } = lib("governance-profile");
const { EFFECT_KINDS, CONCLUSION_KIND, LEGACY_CONCLUSION_KIND } = lib("effects");
const { KIND_AUTHOR } = lib("commissaire");

const DRAFT = "https://json-schema.org/draft/2020-12/schema";
const HEX64 = { type: "string", pattern: "^[0-9a-f]{64}$" };
const S = { type: "string" };
const I = { type: "integer" };

// Schema-1 lines are legacy and frozen as slice 1 published them (data open).
const SCHEMA_1_EVENT_TYPES = DELIVERY_PROFILE.event_types.filter((t) => t !== "evidence-terminal-only");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const serialise = (doc) => JSON.stringify(doc, null, 2) + "\n";
const namesIn = (dir) => readdirSync(join(SCHEMA, dir)).filter((f) => f.endsWith(".schema.json")).map((f) => f.slice(0, -".schema.json".length)).sort();
const ENVELOPE_ORDER = (keys, envelope) => [...keys.filter((k) => envelope.includes(k)), ...keys.filter((k) => !envelope.includes(k))];

function header(id, authored) {
  return { $schema: DRAFT, $id: id, title: authored.title, description: authored.description };
}

function closedRecord(id, authored, envelopeProps, envelopeRequired) {
  const authoredProps = authored.properties || {};
  const authoredRequired = (authored.required || []).filter((k) => !(k in envelopeProps));
  return {
    ...header(id, authored),
    type: "object",
    additionalProperties: false,
    required: [...envelopeRequired, ...authoredRequired],
    properties: { ...envelopeProps, ...Object.fromEntries(Object.entries(authoredProps).filter(([k]) => !(k in envelopeProps))) },
  };
}

function eventSchema(type, authored) {
  const issueScoped = DELIVERY_PROFILE.issue_scoped_types.includes(type);
  const envelope = {
    schema: { type: "integer", enum: [2] },
    run_id: S,
    seq: I,
    ts: S,
    prev: HEX64,
    phase: { type: "string", enum: DELIVERY_PROFILE.event_phases },
    type: { type: "string", enum: [type] },
    issue: S,
  };
  const required = ["schema", "run_id", "seq", "ts", "phase", "type", "prev", ...(issueScoped ? ["issue"] : [])];
  return closedRecord(`faff/evidence/v0.3/events/${type}`, authored, envelope, required);
}

function effectSchema(kind, authored) {
  return {
    ...header(`faff/evidence/v0.3/effects/${kind}`, authored),
    type: "object",
    additionalProperties: false,
    required: ["kind", "target"],
    properties: { kind: { type: "string", enum: [kind] }, target: S, reversible: { type: "boolean" } },
  };
}

const strip = ({ $schema: _s, $id: _i, ...rest }) => rest;

function effectNode(effects) {
  return {
    type: "object",
    description: "The effect descriptor, discriminated on kind; one closed schema per EFFECT_KINDS member (effects/<kind>.schema.json).",
    required: ["kind"],
    discriminator: { field: "kind", mapping: Object.fromEntries(Object.entries(effects).map(([k, s]) => [k, strip(s)])) },
  };
}

function authorOf(kind) {
  return KIND_AUTHOR[kind === LEGACY_CONCLUSION_KIND ? CONCLUSION_KIND : kind];
}

function commissaireSchema(kind, authored, effects) {
  const author = authorOf(kind);
  const authenticator = author === "commissaire" ? "commissaire_sig" : "producer_hmac";
  const envelope = {
    schema: { type: "integer", enum: [3] },
    run_id: S,
    seq: I,
    ts: S,
    author: { type: "string", enum: [author] },
    producer_id: S,
    contract_revision: S,
    kind_of_entry: { type: "string", enum: [kind] },
    step: S,
    prev: HEX64,
    unit_id: S,
    issue: S,
    [authenticator]: S,
  };
  const required = ["schema", "run_id", "seq", "ts", "author", "producer_id", "contract_revision", "kind_of_entry", "step", "prev", authenticator];
  const doc = closedRecord(`faff/evidence/v0.3/commissaire/${kind}`, authored, envelope, required);
  if ("effect" in doc.properties) doc.properties.effect = effectNode(effects);
  return doc;
}

function runEventSchema(events) {
  const v1 = {
    type: "object",
    additionalProperties: false,
    required: ["schema", "run_id", "seq", "ts", "phase", "type"],
    properties: {
      schema: { type: "integer", enum: [1] },
      run_id: S,
      seq: I,
      ts: S,
      phase: { type: "string", enum: DELIVERY_PROFILE.event_phases },
      type: { type: "string", enum: SCHEMA_1_EVENT_TYPES },
      issue: S,
      data: { type: "object", description: "Schema-1 lines are legacy and keep an open payload." },
    },
  };
  return {
    $schema: DRAFT,
    $id: "faff/evidence/v0.3/run-event",
    title: "<anchor-dir>/events.jsonl (one record per line)",
    description: "Generated by scripts/evidence-v0.3-compose.mjs; do not edit by hand. One closed shape per record version, chosen by `discriminator` on `schema`. Schema 2 discriminates again on `type`, mapping each event type to events/<type>.schema.json.",
    type: "object",
    required: ["schema"],
    discriminator: {
      field: "schema",
      mapping: {
        1: v1,
        2: { type: "object", required: ["schema", "type"], discriminator: { field: "type", mapping: Object.fromEntries(Object.entries(events).map(([t, s]) => [t, strip(s)])) } },
      },
    },
  };
}

function declaredEffectSchema(effects, commissaire) {
  const effect = effectNode(effects);
  const legacy = (schema, extra, required) => ({
    type: "object",
    additionalProperties: false,
    required,
    properties: {
      schema: { type: "integer", enum: [schema] },
      run_id: S,
      seq: I,
      ts: S,
      kind_of_entry: { type: "string", enum: ["declare", "observe"] },
      issue: S,
      step: S,
      effect,
      ...extra,
    },
  });
  const v1Required = ["schema", "run_id", "seq", "ts", "kind_of_entry", "issue", "step", "effect"];
  const v2Extra = {
    prev: HEX64,
    origin: S,
    github_actor: {
      type: "object",
      additionalProperties: false,
      required: ["login", "source"],
      properties: { login: { type: ["string", "null"] }, source: { type: "string", enum: ["runner-credential", "ambient"] } },
    },
  };
  return {
    $schema: DRAFT,
    $id: "faff/evidence/v0.3/declared-effect",
    title: "<anchor-dir>/declared-effects.jsonl (one record per line)",
    description: "Generated by scripts/evidence-v0.3-compose.mjs; do not edit by hand. One closed shape per record version, chosen by `discriminator` on `schema`. Every `effect` discriminates on `kind` (effects/<kind>.schema.json); schema 3 discriminates on `kind_of_entry` (commissaire/<kind>.schema.json). The line validator `declaredEffectViolations` (effects.js) enforces what the subset cannot.",
    type: "object",
    required: ["schema"],
    discriminator: {
      field: "schema",
      mapping: {
        1: legacy(1, {}, v1Required),
        2: legacy(2, v2Extra, [...v1Required, "prev"]),
        3: { type: "object", required: ["schema", "kind_of_entry"], discriminator: { field: "kind_of_entry", mapping: Object.fromEntries(Object.entries(commissaire).map(([k, s]) => [k, strip(s)])) } },
      },
    },
  };
}

// The full v0.3 tree as { relative path -> bytes } after composition.
function compose() {
  const out = new Map();
  const put = (rel, doc) => out.set(rel, serialise(doc));
  const events = {};
  for (const type of namesIn("events")) {
    events[type] = eventSchema(type, readJson(join(SCHEMA, "events", `${type}.schema.json`)));
    put(`schema/events/${type}.schema.json`, events[type]);
  }
  const effects = {};
  for (const kind of namesIn("effects")) {
    effects[kind] = effectSchema(kind, readJson(join(SCHEMA, "effects", `${kind}.schema.json`)));
    put(`schema/effects/${kind}.schema.json`, effects[kind]);
  }
  const commissaire = {};
  for (const kind of namesIn("commissaire")) {
    commissaire[kind] = commissaireSchema(kind, readJson(join(SCHEMA, "commissaire", `${kind}.schema.json`)), effects);
    put(`schema/commissaire/${kind}.schema.json`, commissaire[kind]);
  }
  put("schema/run-event.schema.json", runEventSchema(orderBy(events, DELIVERY_PROFILE.event_types)));
  put("schema/declared-effect.schema.json", declaredEffectSchema(orderBy(effects, [...EFFECT_KINDS]), orderBy(commissaire, [...Object.keys(KIND_AUTHOR), LEGACY_CONCLUSION_KIND])));
  return out;
}

function orderBy(map, order) {
  const keys = [...order.filter((k) => k in map), ...Object.keys(map).filter((k) => !order.includes(k)).sort()];
  return Object.fromEntries(keys.map((k) => [k, map[k]]));
}

function walk(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) visit(p);
      else files.push(relative(root, p).split("\\").join("/"));
    }
  };
  visit(root);
  return files;
}

function main(argv) {
  const check = argv.includes("--check");
  const composed = compose();
  const expected = new Map();
  for (const rel of walk(SRC)) expected.set(rel, composed.has(rel) ? composed.get(rel) : readFileSync(join(SRC, rel), "utf8"));
  for (const [rel, bytes] of composed) expected.set(rel, bytes);

  const differs = [];
  for (const [rel, bytes] of expected) {
    for (const [root, label] of [[SRC, "verification/evidence/v0.3"], [BUNDLE, "plugin/skills/faff/contracts/evidence-v0.3"]]) {
      const p = join(root, rel);
      if (!existsSync(p) || readFileSync(p, "utf8") !== bytes) {
        differs.push(`${label}/${rel}`);
        if (!check) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, bytes); }
      }
    }
  }
  for (const rel of walk(BUNDLE)) {
    if (expected.has(rel)) continue;
    differs.push(`plugin/skills/faff/contracts/evidence-v0.3/${rel} (not in the source tree)`);
    if (!check) rmSync(join(BUNDLE, rel));
  }
  if (check) {
    if (differs.length) {
      process.stderr.write(`evidence-v0.3-compose --check: ${differs.length} file(s) differ from a fresh composition; run node scripts/evidence-v0.3-compose.mjs\n${differs.map((d) => `  - ${d}`).join("\n")}\n`);
      return 1;
    }
    process.stdout.write("evidence-v0.3-compose --check: up to date\n");
    return 0;
  }
  process.stdout.write(`evidence-v0.3-compose: ${differs.length} file(s) written\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
