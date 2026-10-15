// FAFF-1287 — ac-id.js: the one code home for an acceptance criterion's identity.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const LIB = join(import.meta.dirname, "..", "plugin", "skills", "faff", "bin", "lib");
const { ISSUE_ID_RE, QUALIFIED_AC_ID_PATTERN, parseAcId, parseLocalAcId, qualifyAcId } = require(join(LIB, "ac-id.js"));
const { TARGET_RE, sanitizePrBody } = require(join(LIB, "pr-body.js"));

// verifies: faff-1287#ac-2
test("ac-id.js requires nothing and carries a governance region banner", () => {
  const source = readFileSync(join(LIB, "ac-id.js"), "utf8");
  assert.match(source, /^\/\/ === region:governance — ac-id — .* ===$/m);
  assert.doesNotMatch(source, /\brequire\(/);
});

// verifies: faff-1287#ac-3
test("qualifyAcId lowercases the ticket and keeps local and positional ids", () => {
  assert.equal(qualifyAcId("FAFF-1287", "ac-3"), "faff-1287#ac-3");
  assert.equal(qualifyAcId("FAFF-1287", "done:2"), "faff-1287#done:2");
  for (const bad of ["faff-1287", "F-1", "FAFF-0", "FAFF-01", "FAFF_1287", "", "FAFF-1287 "]) {
    assert.throws(() => qualifyAcId(bad, "ac-1"), bad);
  }
  assert.throws(() => qualifyAcId("FAFF-1", "ac-03"));
  assert.throws(() => qualifyAcId("FAFF-1", "AC-3"));
});

// verifies: faff-1287#ac-3
test("the helper's issue grammar has the same source as TARGET_RE", () => {
  assert.equal(ISSUE_ID_RE.source, TARGET_RE.source);
});

// verifies: faff-1287#ac-4
test("parseAcId returns the ticket and local id, and rejects near misses", () => {
  assert.deepEqual(parseAcId("faff-1287#ac-3"), { ticket: "FAFF-1287", local: "ac-3" });
  assert.deepEqual(parseAcId("faff-1287#done:3"), { ticket: "FAFF-1287", local: "done:3" });
  for (const bad of ["FAFF-1287#AC-3", "faff-1287#ac-03", "faff-1287#ac-3 ", " faff-1287#ac-3", "faff-1287#ac-3\n", "faff-1287", "#ac-3", null, 3]) {
    assert.equal(parseAcId(bad), null, String(bad));
  }
});

test("the schema pattern accepts exactly what parseAcId accepts", () => {
  const re = new RegExp(QUALIFIED_AC_ID_PATTERN);
  const schema = JSON.parse(readFileSync(join(import.meta.dirname, "..", "plugin", "skills", "faff", "contracts", "evidence-v0.3", "schema", "ac-checklist.schema.json"), "utf8"));
  assert.equal(schema.properties.criteria.items.properties.ac_id.pattern, QUALIFIED_AC_ID_PATTERN);
  for (const id of ["faff-1287#ac-3", "faff-1#done:12", "FAFF-1287#AC-3", "faff-1287#ac-03", "faff-1287#ac-3 "]) {
    assert.equal(re.test(id), parseAcId(id) !== null, id);
  }
});

// verifies: faff-1287#ac-5
test("sanitizePrBody leaves lowercase qualified ids unchanged, in and out of code spans", () => {
  const ids = ["faff-1287#ac-3", "faff-1287#done:3"];
  const body = ids.map((id) => `- [x] \`${id}\` ${id} text`).join("\n");
  const sanitized = sanitizePrBody(body, "FAFF-1287");
  for (const id of ids) {
    assert.equal(sanitized.split(id).length - 1, 2, id);
    assert.ok(sanitized.includes(`\`${id}\``), id);
  }
});

test("parseLocalAcId reads only an exact lowercase leading [ac-N]", () => {
  assert.deepEqual(parseLocalAcId("[ac-3] The command exits 0"), { local: "ac-3", text: "The command exits 0", nearMiss: false });
  assert.deepEqual(parseLocalAcId("No id here"), { local: null, text: "No id here", nearMiss: false });
  for (const near of ["[AC-2] x", "[ac-03] x", "[ac-2x] x", "[ac-] x", "[ac-2]x"]) {
    assert.deepEqual(parseLocalAcId(near), { local: null, text: near, nearMiss: true }, near);
  }
});
