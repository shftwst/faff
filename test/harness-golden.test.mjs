// FAFF-483 — harness-golden tests: the falsifiable half of "no behaviour change,
// byte-for-byte where the CLI is involved" for the CURRENT_HARNESS identity move.
//
// A sibling of test/contract-golden.test.mjs (FAFF-96, ADR-0002): each committed
// case pins an argv vector + a `.faffrc.yaml` fixture body → an exact exit code and
// deep-equal parsed stdout. The harness axis is pinned by a subscription-seat
// backend resolving `{"ok":true}` at exit 0 under `--harness claude-code` and
// `{"refuse":true,"reason":"chain-unrealizable"}` at exit 1 under a non-claude-code
// harness. Cases were captured on the PRE-move tree and are asserted after, so a
// value or shape drift introduced by moving CURRENT_HARNESS out of backends.js
// lands in this diff. Per ADR 0002.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const faffBin = path.join(repoRoot, "plugin", "skills", "faff", "bin", "faff");
const cases = JSON.parse(readFileSync(path.join(here, "golden", "harness", "cases.json"), "utf8"));

for (const c of cases) {
  test(`harness golden — ${c.name}`, () => {
    const dir = mkdtempSync(path.join(tmpdir(), "faff-harness-golden-"));
    try {
      writeFileSync(path.join(dir, ".faffrc.yaml"), c.faffrc);
      const r = spawnSync("node", [faffBin, ...c.argv, "--root", dir], { encoding: "utf8" });
      assert.equal(r.status, c.expectExit, `exit code for ${c.name}: stderr=${r.stderr}`);
      if (c.expectStdout !== undefined) {
        assert.deepEqual(JSON.parse(r.stdout), c.expectStdout); // deep-equal on parsed structure, not substring
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
