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
// test/validator-parity.test.mjs is the guard. Subset keywords: type (string or array
// of names, including "null"), required, properties, enum, additionalProperties (false
// or a schema), items, minItems, pattern and discriminator.

const fs = require("node:fs");
const path = require("node:path");
const { HERE } = require("./shared-infra");

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
function validateAgainstSchema(data, schema, path = "") {
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
