// FAFF-1256: the extended schema-subset validator also backs every `faff contract` through
// schemaCheck, so prove the new keywords change no existing pass/fail result. The baseline
// fixture was recorded from the unextended validator on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { sweepPairs, REPO } from "./helpers-sweep-pairs.mjs";
import { validateAgainstSchema as validateMjs } from "../plugin/skills/faff/contracts/validate-schema.mjs";

const require = createRequire(import.meta.url);
const { validateAgainstSchema: validateCjs } = require("../plugin/skills/faff/bin/lib/contract-engine.js");
const baseline = JSON.parse(readFileSync(join(REPO, "test", "fixtures", "validator-extension-baseline.json"), "utf8"));

const pairs = sweepPairs();

test("validator-extension-sweep: the baseline covers exactly the enumerated pairs", () => {
  assert.deepEqual(pairs.map((p) => p.id).sort(), Object.keys(baseline).sort());
});

for (const pair of pairs) {
  test(`validator-extension-sweep: ${pair.id} keeps its baseline result`, () => {
    const schema = JSON.parse(readFileSync(pair.schemaPath, "utf8"));
    for (const validate of [validateMjs, validateCjs]) {
      const result = validate(pair.data, schema).length === 0 ? "pass" : "fail";
      assert.equal(result, baseline[pair.id]);
    }
  });
}
