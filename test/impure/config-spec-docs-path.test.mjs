// FAFF-762 — `faff config spec-docs-path --create` over a real seeded repo: an impure fs
// exercise (loadConfig + existsSync + mkdirSync against a real tree), part of the impure
// macOS lane's exercise set (§3 row 5). Asserts the created dir + printed path against both
// the config-driven override and the docs/-detection default.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../helpers/run-cli.mjs";

function seed() {
  return mkdtempSync(join(tmpdir(), "faff762-cfg-"));
}

test("faff config spec-docs-path --create defaults to docs/specs and creates the dir", () => {
  const dir = seed();
  try {
    mkdirSync(join(dir, "docs"));
    const { stdout, code } = runCli(["config", "spec-docs-path", "--create", "--root", dir]);
    assert.equal(code, 0);
    assert.equal(stdout.trim(), "docs/specs");
    assert.ok(existsSync(join(dir, "docs", "specs")), "the resolved dir must actually be created on disk");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("faff config spec-docs-path --create honours tracking.spec_docs_path override", () => {
  const dir = seed();
  try {
    writeFileSync(join(dir, ".faffrc.yaml"), "tracking:\n  spec_docs_path: records/specs/\n");
    const { stdout, code } = runCli(["config", "spec-docs-path", "--create", "--root", dir]);
    assert.equal(code, 0);
    assert.equal(stdout.trim(), "records/specs");
    assert.ok(existsSync(join(dir, "records", "specs")), "the configured override dir must be created");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
