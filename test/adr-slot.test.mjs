// FAFF-196 — the `adr` producer slot + faffter-noon-adr. The slot defaults to faffter-noon-adr
// (FAFF-182 DEFAULTS), and faffter-noon-adr is conformance-linted as an intake-shaped `producer-adr`
// (documented Nygard body + advisory confidence, NO gated faff-contract block).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
