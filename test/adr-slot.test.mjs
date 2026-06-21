// FAFF-196 — the `adr` producer slot + faffter-noon-adr. The slot defaults to faffter-noon-adr
// (FAFF-182 DEFAULTS), and faffter-noon-adr is conformance-linted as an intake-shaped `producer-adr`
// (documented Nygard body + advisory confidence, NO gated faff-contract block).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: REPO, encoding: "utf8" });

test("slots.adr defaults to faffter-noon-adr (CLI-enforced)", () => {
  assert.equal(run("config", "get", "slots.adr").stdout.trim(), "faffter-noon-adr");
});

test("config defaults --selftest covers slots.adr", () => {
  assert.equal(run("config", "defaults", "--selftest").status, 0);
});

test("faffter-noon-adr is linted as a conformant producer-adr", () => {
  const r = run("validate-adapters");
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /pass\s+faffter-noon-adr \(producer-adr\)/);
});

test("the producer-adr lint forbids a gated contract block (it's advisory-only)", () => {
  // the producer SKILL.md must NOT carry the gated-contract token; validate-adapters asserts this.
  const r = run("validate-adapters");
  assert.doesNotMatch(r.stdout, /FAIL\s+faffter-noon-adr/);
});

test("negative: a configured adr producer that emits a gated contract token FAILs the producer-adr lint", () => {
  // exercises the producer-adr checksFor via the --configured pre-flight (SLOT_TYPES.adr → producer-adr).
  const dir = mkdtempSync(join(tmpdir(), "faff-adrslot-"));
  mkdirSync(join(dir, "bad-adr"));
  // satisfies nygard+Consequences+confidence, but illegally carries a gated faff-contract block:
  writeFileSync(join(dir, "bad-adr", "SKILL.md"),
    "# bad-adr\n\nEmits a Nygard ADR body (Context / Decision / Consequences) + a confidence self-rating,\nbut also wrongly declares a `faff-contract:something` block.\n");
  writeFileSync(join(dir, ".faffrc.yaml"), "slots:\n  adr: bad-adr\n");
  const r = spawnSync(process.execPath,
    [BIN, "validate-adapters", "--configured", "--root", dir, "--skills-dir", dir],
    { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  assert.notEqual(r.status, 0, "a producer-adr carrying a gated contract token must fail");
  assert.match(r.stdout, /NO faff-contract block|advisory, not gated/);
});
