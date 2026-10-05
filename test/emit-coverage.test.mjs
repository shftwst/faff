// FAFF-1170 — S6: the emit-coverage guard. A `.ts` source under bin/lib without a committed sibling
// `.js` emit fails `faff regions check` (exit 2) — the existence-only floor that keeps the governed
// artifact (the committed `.js`) from ever going missing. Staleness detection is FAFF-1171. This
// needs no typescript (pure fs), so it runs in every lane including the CI unit matrix.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { regionsEmitCoverage } from "../plugin/skills/faff/bin/lib/regions.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const FAFF = path.join(REPO, "plugin", "skills", "faff", "bin", "faff");

test("S6 (leg): regionsEmitCoverage flags a .ts without a committed .js emit, passes when both exist", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "faff-emit-cov-"));
  try {
    const tsf = path.join(tmp, "probe.ts");
    writeFileSync(tsf, "// probe\nexport {};\n");
    assert.equal(regionsEmitCoverage([tsf]).missing.length, 1, "a .ts without a .js sibling is missing");
    writeFileSync(path.join(tmp, "probe.js"), "module.exports = {};\n");
    assert.equal(regionsEmitCoverage([tsf]).missing.length, 0, "a .ts WITH its .js sibling is covered");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("S6 (command): `faff regions check` exits 2 when a .ts source lacks its .js emit", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "faff-emit-cov-cmd-"));
  try {
    writeFileSync(path.join(tmp, "probe.ts"), "// probe\nexport {};\n");
    const r = spawnSync(process.execPath, [FAFF, "regions", "check"], {
      encoding: "utf8",
      env: { ...process.env, FAFF_EMIT_COVERAGE_TS_DIR: tmp },
    });
    assert.equal(r.status, 2, `a .ts with no .js emit must exit 2 (stderr: ${r.stderr})`);
    assert.match(r.stderr, /EMIT-MISSING/, "the diagnostic names the missing emit");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("S6 (command): `faff regions check` passes on the real tree (both cluster emits committed)", () => {
  const r = spawnSync(process.execPath, [FAFF, "regions", "check"], { encoding: "utf8" });
  assert.equal(r.status, 0, `the real tree must pass regions check (stderr: ${r.stderr})`);
});
