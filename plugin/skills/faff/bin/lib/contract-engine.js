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

// Returns Violation records { path: (string|number)[], message } (empty = valid). The path is the
// segment list from the document root; a `required` violation reports the missing property's own
// path and an `additionalProperties` violation the extra property's own path, every other keyword
// the node's path. No message contains a data value: enum, pattern and discriminator misses name
// the schema text only.
function validateAgainstSchemaDetailed(data, schema, path = "", segs = []) {
  const where = path || "<root>";
  const errs = [];
  const add = (at, message) => errs.push({ path: at, message });
  const types = typeNames(schema);
  const isUnion = Array.isArray(schema.type);

  if (isUnion) {
    for (const name of types) {
      if (!TYPE_CHECK[name]) {
        add(segs, `${where}: schema error: unknown type ${name}`);
        return errs;
      }
    }
  }
  const checked = types.filter((name) => TYPE_CHECK[name]);
  if (checked.length > 0 && !checked.some((name) => TYPE_CHECK[name](data))) {
    add(segs, `${where}: expected type ${types.join("|")}, got ${describeKind(data)}`);
    return errs; // type is wrong, so don't cascade into properties/items
  }

  if (schema.enum && !schema.enum.includes(data)) {
    add(segs, `${where}: value not in enum [${schema.enum.join(", ")}]`);
  }

  if (TYPE_CHECK.object(data)) {
    if (types.includes("object")) {
      for (const key of schema.required || []) {
        if (!(key in data)) add([...segs, key], `${where}: missing required property "${key}"`);
      }
      const props = schema.properties || {};
      const extra = schema.additionalProperties;
      for (const key of Object.keys(data)) {
        if (key in props) continue;
        if (extra === false) add([...segs, key], `${where}: additional property "${key}" not allowed`);
        else if (extra && typeof extra === "object") {
          errs.push(...validateAgainstSchemaDetailed(data[key], extra, path ? `${path}.${key}` : key, [...segs, key]));
        }
      }
      for (const [key, sub] of Object.entries(props)) {
        if (key in data) errs.push(...validateAgainstSchemaDetailed(data[key], sub, path ? `${path}.${key}` : key, [...segs, key]));
      }
    }
    const disc = schema.discriminator;
    if (disc) {
      if (!(disc.field in data)) {
        add(segs, `${where}: missing discriminator property "${disc.field}"`);
      } else {
        const key = String(data[disc.field]);
        if (!Object.hasOwn(disc.mapping, key)) {
          add(segs, `${where}: discriminator "${disc.field}" value not in mapping [${Object.keys(disc.mapping).join(", ")}]`);
        } else {
          errs.push(...validateAgainstSchemaDetailed(data, disc.mapping[key], path, segs));
        }
      }
    }
  }

  if (Array.isArray(data) && types.includes("array")) {
    if (typeof schema.minItems === "number" && data.length < schema.minItems) {
      add(segs, `${where}: expected at least ${schema.minItems} items, got ${data.length}`);
    }
    if (typeof schema.maxItems === "number" && data.length > schema.maxItems) {
      add(segs, `${where}: expected at most ${schema.maxItems} items, got ${data.length}`);
    }
    if (schema.items) {
      data.forEach((item, i) => errs.push(...validateAgainstSchemaDetailed(item, schema.items, `${where}[${i}]`, [...segs, i])));
    }
  }

  if (typeof data === "string" && typeof schema.pattern === "string") {
    let re = null;
    try {
      re = new RegExp(schema.pattern);
    } catch {
      add(segs, `${where}: schema error: invalid pattern ${schema.pattern}`);
    }
    if (re && !re.test(data)) add(segs, `${where}: does not match pattern ${schema.pattern}`);
  }

  return errs;
}

// Returns an array of human-readable violation strings (empty = valid).
function validateAgainstSchema(data, schema, path = "") {
  return validateAgainstSchemaDetailed(data, schema, path).map((v) => v.message);
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


module.exports = { exitFor, schemaCheck, validateAgainstSchema, validateAgainstSchemaDetailed };
