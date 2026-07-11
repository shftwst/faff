// ===========================================================================
// === region:governance — contract validation engine ===
//
// The generic machinery the per-contract definitions dispatch through: the
// dependency-free JSON-Schema-subset validator, the on-disk schema check, and
// the uniform fail-direction exit policy. The 14 contract definitions + the
// CONTRACTS fixtures map stay factory (they encode faff-the-factory's domain);
// this engine is the extractable governance idea — a unit's contract data is
// validated here regardless of which factory defined it. Schemas load from
// contracts/*.schema.json relative to the binary — unchanged.
// ===========================================================================

// Minimal dependency-free JSON Schema (Draft 2020-12 SUBSET) validator — a CommonJS
// port of skills/faff/contracts/validate-schema.mjs (FAFF-76). Keep the two in step;
// `contract spec-readiness --selftest` is the parity guard. Subset keywords:
// type, required, properties, enum, additionalProperties, items.

const fs = require("node:fs");
const path = require("node:path");
const { HERE } = require("./shared-infra");

function validateAgainstSchema(data, schema, p = "") {
  const where = p || "<root>";
  const errs = [];
  const TYPE_OK = {
    object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
    array: Array.isArray,
    string: (v) => typeof v === "string",
    boolean: (v) => typeof v === "boolean",
    number: (v) => typeof v === "number",
    integer: Number.isInteger,
  };
  if (schema.type && TYPE_OK[schema.type] && !TYPE_OK[schema.type](data)) {
    const got = Array.isArray(data) ? "array" : data === null ? "null" : typeof data;
    errs.push(`${where}: expected type ${schema.type}, got ${got}`);
    return errs;
  }
  if (schema.enum && !schema.enum.includes(data)) {
    errs.push(`${where}: ${JSON.stringify(data)} not in enum [${schema.enum.join(", ")}]`);
  }
  if (schema.type === "object" && TYPE_OK.object(data)) {
    for (const k of schema.required || []) if (!(k in data)) errs.push(`${where}: missing required property "${k}"`);
    const props = schema.properties || {};
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(data)) if (!(k in props)) errs.push(`${where}: additional property "${k}" not allowed`);
    }
    for (const [k, sub] of Object.entries(props)) {
      if (k in data) errs.push(...validateAgainstSchema(data[k], sub, p ? `${p}.${k}` : k));
    }
  }
  if (schema.type === "array" && Array.isArray(data) && schema.items) {
    data.forEach((item, i) => errs.push(...validateAgainstSchema(item, schema.items, `${where}[${i}]`)));
  }
  return errs;
}

// Shared: validate emitted contract data against its on-disk schema (belt-and-braces).
// Returns a fail-loud reason string, or null when the data conforms.
function schemaCheck(contractData, contractName) {
  const schemaPath = path.resolve(HERE, "..", "contracts", `${contractName}.schema.json`);
  try {
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    const errs = validateAgainstSchema(contractData, schema);
    if (errs.length) return `internal: emitted contract data non-conformant: ${errs.join("; ")}`;
  } catch (e) {
    return `cannot load ${contractName} schema: ${e.message}`;
  }
  return null;
}

// Uniform exit: fail-loud → 2; any violation → 1; else 0. (Every contract data carries `violations`.)
function exitFor(result) {
  if (result.failLoud) return 2;
  return (result.contractData.violations || []).length === 0 ? 0 : 1;
}


module.exports = { exitFor, schemaCheck, validateAgainstSchema };
