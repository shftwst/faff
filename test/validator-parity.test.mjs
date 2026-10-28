// FAFF-1256: validate-schema.mjs and contract-engine.js are separate copies of the
// schema-subset validator. One fixture table runs through both and must agree element by
// element, with the exact message pinned for every new keyword.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAgainstSchema as validateMjs } from "../plugin/skills/faff/contracts/validate-schema.mjs";

const require = createRequire(import.meta.url);
const { validateAgainstSchema: validateCjs } = require("../plugin/skills/faff/bin/lib/contract-engine.js");
const VALIDATOR = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "contracts", "validate-schema.mjs");

const SENTINEL = "S3CR3T-SENTINEL";
const discriminated = {
  type: "object",
  required: ["schema"],
  discriminator: {
    field: "schema",
    mapping: {
      1: { type: "object", required: ["schema", "a"], properties: { schema: { enum: [1] }, a: { type: "string" } }, additionalProperties: false },
      2: { type: "object", required: ["schema", "b"], properties: { schema: { enum: [2] }, b: { type: "integer" } }, additionalProperties: false },
    },
  },
};

const CASES = [
  ["valid string", "x", { type: "string" }, []],
  ["type mismatch (single)", 1, { type: "string" }, ["<root>: expected type string, got number"]],
  ["single null type passes", null, { type: "null" }, []],
  ["single null type fails", 0, { type: "null" }, ["<root>: expected type null, got number"]],
  ["unknown single type is ignored", 1, { type: "uuid" }, []],
  ["union passes on null", null, { type: ["string", "null"] }, []],
  ["union passes on string", "a", { type: ["string", "null"] }, []],
  ["union fails", 3, { type: ["string", "null"] }, ["<root>: expected type string|null, got number"]],
  ["union unknown name", 3, { type: ["objet", "null"] }, ["<root>: schema error: unknown type objet"]],
  ["union validates object properties", { a: 1 }, { type: ["object", "null"], properties: { a: { type: "string" } } }, ["a: expected type string, got number"]],
  ["union null skips properties", null, { type: ["object", "null"], required: ["a"] }, []],
  ["required", {}, { type: "object", required: ["a"] }, ['<root>: missing required property "a"']],
  ["additionalProperties false", { a: 1, z: 2 }, { type: "object", properties: { a: {} }, additionalProperties: false }, ['<root>: additional property "z" not allowed']],
  ["additionalProperties true", { a: 1, z: 2 }, { type: "object", properties: { a: {} }, additionalProperties: true }, []],
  ["additionalProperties schema passes", { x: "s", y: "t" }, { type: "object", additionalProperties: { type: "string" } }, []],
  ["additionalProperties schema fails", { x: "s", y: 1 }, { type: "object", additionalProperties: { type: "string" } }, ["y: expected type string, got number"]],
  ["additionalProperties schema skips declared keys", { a: 1, y: "t" }, { type: "object", properties: { a: { type: "integer" } }, additionalProperties: { type: "string" } }, []],
  ["additionalProperties schema nests", { m: { x: 1 } }, { type: "object", properties: { m: { type: "object", additionalProperties: { type: "string" } } } }, ["m.x: expected type string, got number"]],
  ["enum miss", "z", { enum: ["a", "b"] }, ["<root>: value not in enum [a, b]"]],
  ["enum hit", "a", { enum: ["a", "b"] }, []],
  ["enum miss never prints the value", SENTINEL, { type: "string", enum: ["a"] }, ["<root>: value not in enum [a]"]],
  ["minItems fails", [], { type: "array", minItems: 1 }, ["<root>: expected at least 1 items, got 0"]],
  ["minItems passes", [1], { type: "array", minItems: 1 }, []],
  ["minItems ignored for non-arrays", "", { minItems: 3 }, []],
  ["maxItems fails", [1, 2, 3], { type: "array", maxItems: 2 }, ["<root>: expected at most 2 items, got 3"]],
  ["maxItems fails on strings without printing them", ["a", "b", "c", "d"], { type: "array", maxItems: 2 }, ["<root>: expected at most 2 items, got 4"]],
  ["maxItems passes", [1, 2], { type: "array", maxItems: 2 }, []],
  ["maxItems ignored for non-arrays", "abcd", { maxItems: 2 }, []],
  ["items nest", [1, "a"], { type: "array", items: { type: "string" } }, ["<root>[0]: expected type string, got number"]],
  ["pattern passes", "abc123", { type: "string", pattern: "^[a-z]+\\d+$" }, []],
  ["pattern fails without printing the value", SENTINEL, { type: "string", pattern: "^[0-9]+$" }, ["<root>: does not match pattern ^[0-9]+$"]],
  ["pattern is unanchored", "xxabcxx", { type: "string", pattern: "abc" }, []],
  ["pattern ignored for non-strings", 5, { pattern: "^a$" }, []],
  ["invalid pattern fails closed", "a", { type: "string", pattern: "(" }, ["<root>: schema error: invalid pattern ("]],
  ["type check returns early", "x", { type: "object", required: ["a"] }, ["<root>: expected type object, got string"]],
  ["discriminator hit", { schema: 1, a: "s" }, discriminated, []],
  ["discriminator hit, sub-schema failure", { schema: 2, b: "no" }, discriminated, ["b: expected type integer, got string"]],
  ["discriminator closure is enforced in the mapped schema", { schema: 1, a: "s", prev: "x" }, discriminated, ['<root>: additional property "prev" not allowed']],
  ["discriminator missing field", {}, discriminated, ['<root>: missing required property "schema"', '<root>: missing discriminator property "schema"']],
  ["discriminator unmapped value", { schema: 9 }, discriminated, ['<root>: discriminator "schema" value not in mapping [1, 2]']],
  ["discriminator unmapped value is never printed", { schema: SENTINEL }, discriminated, ['<root>: discriminator "schema" value not in mapping [1, 2]']],
  ["discriminator wrong-typed value still reports the type error", { schema: "2", b: 1 }, discriminated, ['schema: value not in enum [2]']],
  ["discriminator nested path", { rec: { schema: 1, a: 3 } }, { type: "object", properties: { rec: discriminated } }, ["rec.a: expected type string, got number"]],
  ["discriminator ignores non-objects", "x", { discriminator: discriminated.discriminator }, []],
];

for (const [name, data, schema, expected] of CASES) {
  test(`validator-parity: ${name}`, () => {
    const mjs = validateMjs(data, schema);
    const cjs = validateCjs(data, schema);
    assert.deepStrictEqual(mjs, cjs);
    assert.deepStrictEqual(mjs, expected);
    for (const message of mjs) assert.ok(!message.includes(SENTINEL), `message leaked a value: ${message}`);
  });
}

test("validator-parity: importing validate-schema.mjs does not run main()", () => {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `import ${JSON.stringify(VALIDATOR)}; console.log("imported")`], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "imported");
});

test("validator-parity: validate-schema.mjs --selftest still exits 0", () => {
  const r = spawnSync(process.execPath, [VALIDATOR, "--selftest"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
