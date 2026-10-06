// FAFF-1200: on Node 22.18 and later, pathless `node --test` collects .ts/.mts/.cts files under
// any test/ directory and executes them as tests. TypeScript fixtures live in testdata/typescript/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const TYPESCRIPT_EXTENSION = /\.(ts|mts|cts)$/;

function typescriptFilesUnder(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...typescriptFilesUnder(full));
    else if (entry.isFile() && TYPESCRIPT_EXTENSION.test(entry.name)) found.push(full);
  }
  return found;
}

test("the walk reports a planted .ts file in a nested directory", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "faff1200-ts-guard-"));
  try {
    mkdirSync(path.join(dir, "fixtures", "nested"), { recursive: true });
    const planted = path.join(dir, "fixtures", "nested", "planted.ts");
    writeFileSync(planted, "export {};\n");
    writeFileSync(path.join(dir, "fixtures", "kept.mjs"), "export {};\n");
    assert.deepEqual(typescriptFilesUnder(dir), [planted]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no TypeScript file lives under test/", () => {
  const offenders = typescriptFilesUnder(TEST_DIR).map((f) => path.relative(path.dirname(TEST_DIR), f));
  assert.deepEqual(offenders, [], `move these to testdata/typescript/ so Node's default test glob cannot run them: ${offenders.join(", ")}`);
});
