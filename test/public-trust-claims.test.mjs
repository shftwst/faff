import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VALIDATOR = join(ROOT, "verification/audits/tools/faff-732/validate-report.mjs");
const LEDGER = join(ROOT, "verification/audits/2026-08-07-FAFF-732-public-trust-claims/claim-ledger.json");
const REPORT = join(ROOT, "verification/audits/2026-08-07-FAFF-732-public-trust-claims.md");
const run = (...args) => spawnSync(process.execPath, [VALIDATOR, ...args], { cwd: ROOT, encoding: "utf8" });

test("FAFF-732 validator self-test covers the validation rule families", () => {
  const result = run("--selftest");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ok \(3 cases\)/);
});

test("FAFF-732 claim ledger is valid and covers the immutable source tree", () => {
  const result = run(LEDGER, REPORT);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.valid, true);
  assert.equal(output.files, 715);
  assert.ok(output.claims > 0);
});

test("FAFF-732 committed report equals deterministic renderer output", () => {
  const result = run("--render", LEDGER);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, readFileSync(REPORT, "utf8"));
});
