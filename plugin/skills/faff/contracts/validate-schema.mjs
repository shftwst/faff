#!/usr/bin/env node
// Minimal, dependency-free JSON Schema (Draft 2020-12 SUBSET) validator.
//
// SPIKE PROOF for FAFF-76 — proves the chosen schema language (Decision 1) works
// with zero installed dependencies, using only `JSON.parse` + Node builtins, mirroring
// the existing hand-rolled `parseYamlSubset()` in skills/faff/bin/faff.
//
// Supported keywords (the subset the flat contract shapes need): type, required,
// properties, enum, additionalProperties, items. Unknown keywords ($schema, $id,
// title, description, ...) are ignored.
//
// SCOPE: this is the spike's proof harness, NOT the production validator. Porting
// `validateAgainstSchema` into the faff CLI (`faff validate-contract` / the wiring
// of the spec contract script) is FAFF-77. See docs/adr/0001-contract-as-code-foundations.md.
//
// Usage:
//   node validate-schema.mjs <data.json> <schema.json>   # exit 0 = valid, 1 = violations
//   node validate-schema.mjs --selftest                  # good example passes, bad fails

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const TYPE_CHECK = {
  object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  string: (v) => typeof v === "string",
  boolean: (v) => typeof v === "boolean",
  number: (v) => typeof v === "number",
  integer: (v) => Number.isInteger(v),
};

// Returns an array of human-readable violation strings (empty = valid).
export function validateAgainstSchema(data, schema, path = "") {
  const where = path || "<root>";
  const errs = [];

  if (schema.type && TYPE_CHECK[schema.type] && !TYPE_CHECK[schema.type](data)) {
    const got = Array.isArray(data) ? "array" : data === null ? "null" : typeof data;
    errs.push(`${where}: expected type ${schema.type}, got ${got}`);
    return errs; // type is wrong — don't cascade into properties/items
  }

  if (schema.enum && !schema.enum.includes(data)) {
    errs.push(`${where}: ${JSON.stringify(data)} not in enum [${schema.enum.join(", ")}]`);
  }

  if (schema.type === "object" && TYPE_CHECK.object(data)) {
    for (const key of schema.required || []) {
      if (!(key in data)) errs.push(`${where}: missing required property "${key}"`);
    }
    const props = schema.properties || {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(data)) {
        if (!(key in props)) errs.push(`${where}: additional property "${key}" not allowed`);
      }
    }
    for (const [key, sub] of Object.entries(props)) {
      if (key in data) errs.push(...validateAgainstSchema(data[key], sub, path ? `${path}.${key}` : key));
    }
  }

  if (schema.type === "array" && Array.isArray(data) && schema.items) {
    data.forEach((item, i) => errs.push(...validateAgainstSchema(item, schema.items, `${where}[${i}]`)));
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
      process.exit(0);
    }
    console.error("selftest: BROKEN");
    process.exit(1);
  }

  const [dataFile, schemaFile] = args;
  if (!dataFile || !schemaFile) {
    console.error("usage: node validate-schema.mjs <data.json> <schema.json> | --selftest");
    process.exit(2);
  }

  const violations = validateFiles(dataFile, schemaFile);
  if (violations.length === 0) {
    console.log("PASS — valid against schema");
    process.exit(0);
  }
  console.error("FAIL — violations:");
  for (const v of violations) console.error("  - " + v);
  process.exit(1);
}

main();
