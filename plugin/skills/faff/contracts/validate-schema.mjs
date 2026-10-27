#!/usr/bin/env node
// Minimal, dependency-free JSON Schema (Draft 2020-12 SUBSET) validator.
//
// SPIKE PROOF for FAFF-76 — proves the chosen schema language (Decision 1) works
// with zero installed dependencies, using only `JSON.parse` + Node builtins, mirroring
// the existing hand-rolled `parseYamlSubset()` in skills/faff/bin/faff.
//
// Supported keywords: type (string or array of names, including "null"), required,
// properties, enum, additionalProperties (false or a schema), items, minItems, pattern
// and discriminator. Unknown keywords ($schema, $id, title, description, ...) are
// ignored. Keep in step with bin/lib/contract-engine.js; test/validator-parity.test.mjs
// is the guard.
//
// SCOPE: this is the spike's proof harness, NOT the production validator. Porting
// `validateAgainstSchema` into the faff CLI (`faff validate-contract` / the wiring
// of the spec contract script) is FAFF-77. See records/adr/0001-contract-as-code-foundations.md.
//
// Usage:
//   node validate-schema.mjs <data.json> <schema.json>   # exit 0 = valid, 1 = violations
//   node validate-schema.mjs --selftest                  # good example passes, bad fails

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const TYPE_CHECK = {
  object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  string: (v) => typeof v === "string",
  boolean: (v) => typeof v === "boolean",
  number: (v) => typeof v === "number",
  integer: (v) => Number.isInteger(v),
  null: (v) => v === null,
};

function typeNames(schema) {
  if (Array.isArray(schema.type)) return schema.type;
  return schema.type ? [schema.type] : [];
}

function describeKind(data) {
  return Array.isArray(data) ? "array" : data === null ? "null" : typeof data;
}

// Returns an array of human-readable violation strings (empty = valid). No message
// contains a data value: enum, pattern and discriminator misses name the schema text only.
export function validateAgainstSchema(data, schema, path = "") {
  const where = path || "<root>";
  const errs = [];
  const types = typeNames(schema);
  const isUnion = Array.isArray(schema.type);

  if (isUnion) {
    for (const name of types) {
      if (!TYPE_CHECK[name]) {
        errs.push(`${where}: schema error: unknown type ${name}`);
        return errs;
      }
    }
  }
  const checked = types.filter((name) => TYPE_CHECK[name]);
  if (checked.length > 0 && !checked.some((name) => TYPE_CHECK[name](data))) {
    errs.push(`${where}: expected type ${types.join("|")}, got ${describeKind(data)}`);
    return errs; // type is wrong, so don't cascade into properties/items
  }

  if (schema.enum && !schema.enum.includes(data)) {
    errs.push(`${where}: value not in enum [${schema.enum.join(", ")}]`);
  }

  if (TYPE_CHECK.object(data)) {
    if (types.includes("object")) {
      for (const key of schema.required || []) {
        if (!(key in data)) errs.push(`${where}: missing required property "${key}"`);
      }
      const props = schema.properties || {};
      const extra = schema.additionalProperties;
      for (const key of Object.keys(data)) {
        if (key in props) continue;
        if (extra === false) errs.push(`${where}: additional property "${key}" not allowed`);
        else if (extra && typeof extra === "object") {
          errs.push(...validateAgainstSchema(data[key], extra, path ? `${path}.${key}` : key));
        }
      }
      for (const [key, sub] of Object.entries(props)) {
        if (key in data) errs.push(...validateAgainstSchema(data[key], sub, path ? `${path}.${key}` : key));
      }
    }
    const disc = schema.discriminator;
    if (disc) {
      if (!(disc.field in data)) {
        errs.push(`${where}: missing discriminator property "${disc.field}"`);
      } else {
        const key = String(data[disc.field]);
        if (!Object.hasOwn(disc.mapping, key)) {
          errs.push(`${where}: discriminator "${disc.field}" value not in mapping [${Object.keys(disc.mapping).join(", ")}]`);
        } else {
          errs.push(...validateAgainstSchema(data, disc.mapping[key], path));
        }
      }
    }
  }

  if (Array.isArray(data) && types.includes("array")) {
    if (typeof schema.minItems === "number" && data.length < schema.minItems) {
      errs.push(`${where}: expected at least ${schema.minItems} items, got ${data.length}`);
    }
    if (typeof schema.maxItems === "number" && data.length > schema.maxItems) {
      errs.push(`${where}: expected at most ${schema.maxItems} items, got ${data.length}`);
    }
    if (schema.items) {
      data.forEach((item, i) => errs.push(...validateAgainstSchema(item, schema.items, `${where}[${i}]`)));
    }
  }

  if (typeof data === "string" && typeof schema.pattern === "string") {
    let re = null;
    try {
      re = new RegExp(schema.pattern);
    } catch {
      errs.push(`${where}: schema error: invalid pattern ${schema.pattern}`);
    }
    if (re && !re.test(data)) errs.push(`${where}: does not match pattern ${schema.pattern}`);
  }

  return errs;
}

function validateFiles(dataFile, schemaFile) {
  const data = JSON.parse(readFileSync(dataFile, "utf8"));
  const schema = JSON.parse(readFileSync(schemaFile, "utf8"));
  return validateAgainstSchema(data, schema);
}

function main() {
  const args = process.argv.slice(2);

  if (args[0] === "--selftest") {
    const here = dirname(fileURLToPath(import.meta.url));
    const schema = join(here, "spec-readiness.schema.json");
    const good = validateFiles(join(here, "examples/spec-readiness.good.json"), schema);
    const bad = validateFiles(join(here, "examples/spec-readiness.bad.json"), schema);

    const goodOk = good.length === 0;
    const badOk = bad.length > 0 && bad.some((v) => v.includes("confidence"));

    console.log(`selftest: good example -> ${goodOk ? "PASS (no violations)" : "UNEXPECTED FAIL"}`);
    console.log(`selftest: bad example  -> ${badOk ? "FAIL as expected (" + bad[0] + ")" : "UNEXPECTED PASS"}`);

    if (goodOk && badOk) {
      console.log("selftest: OK");
      return 0;
    }
    console.error("selftest: BROKEN");
    return 1;
  }

  const [dataFile, schemaFile] = args;
  if (!dataFile || !schemaFile) {
    console.error("usage: node validate-schema.mjs <data.json> <schema.json> | --selftest");
    return 2;
  }

  const violations = validateFiles(dataFile, schemaFile);
  if (violations.length === 0) {
    console.log("PASS — valid against schema");
    return 0;
  }
  console.error("FAIL — violations:");
  for (const v of violations) console.error("  - " + v);
  return 1;
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isEntrypoint()) process.exitCode = main();
