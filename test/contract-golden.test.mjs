// FAFF-96 — contract-conformance golden tests.
//
// Pins known input → exact structured output for the four `faff contract <name>` scripts,
// catching shape drift the loosely-authored inline `--selftest` may pass. Goldens live in
// test/golden/contracts/cases.json (committed; a deliberate output change updates them in
// the same PR — the diff is the review surface). Asserts deep-equality on parsed structure,
// never substrings. Per ADR 0002.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const faffBin = path.join(repoRoot, "skills", "faff", "bin", "faff");
const cases = JSON.parse(readFileSync(path.join(here, "golden", "contracts", "cases.json"), "utf8"));

for (const c of cases) {
  test(`contract ${c.contract} — ${c.name} (golden)`, () => {
    const r = spawnSync("node", [faffBin, "contract", c.contract], { input: c.input, encoding: "utf8" });
    assert.equal(r.status, c.expectExit, `exit code for ${c.contract}/${c.name}`);
    if (c.expectStdout !== undefined) {
      assert.deepEqual(JSON.parse(r.stdout), c.expectStdout); // deep-equal on parsed structure, not substring
    }
    if (c.expectStderrIncludes !== undefined) {
      assert.ok(r.stderr.includes(c.expectStderrIncludes), `stderr should include "${c.expectStderrIncludes}"`);
    }
  });
}
