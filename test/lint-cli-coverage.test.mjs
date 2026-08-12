// FAFF-581 — the registry-coverage gate (`faff lint-cli-coverage`) and the zero-dep
// coverage aggregator. Exercises both through their real entrypoints via runCli /
// a direct spawn, asserting the deterministic seam (exit + parsed JSON). Per ADR 0002.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli, repoRoot } from "./helpers/run-cli.mjs";

// --- lint-cli-coverage (the gate) ---
test("lint-cli-coverage: the live registry is fully covered (exit 0, PASS)", () => {
  const { stdout, code } = runCli(["lint-cli-coverage"]);
  assert.equal(code, 0);
  assert.match(stdout, /PASS/);
});

test("lint-cli-coverage --json: ok true, zero uncovered/orphaned/stale", () => {
  const { stdout, code } = runCli(["lint-cli-coverage", "--json"]);
  assert.equal(code, 0);
  const r = JSON.parse(stdout);
  assert.equal(r.ok, true);
  assert.equal(r.uncovered.length, 0);
  assert.equal(r.orphaned.length, 0);
  assert.equal(r.missingFiles.length, 0);
  assert.ok(r.commands > 0);
});

test("lint-cli-coverage --selftest: the pure bidirectional-diff cores pass", () => {
  const { stdout, code } = runCli(["lint-cli-coverage", "--selftest"]);
  assert.equal(code, 0);
  assert.match(stdout, /lint-cli-coverage --selftest: ok/);
});

// --- coverage-aggregate (publish-only measurement) ---
const aggPath = path.join(repoRoot, "scripts", "coverage-aggregate.mjs");
const runAgg = (args, env) =>
  spawnSync("node", [aggPath, ...args], { cwd: repoRoot, encoding: "utf8", env: { ...process.env, ...env } });

test("coverage-aggregate --selftest: the pure V8-range→line cores pass", () => {
  const r = runAgg(["--selftest"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /coverage-aggregate --selftest: ok/);
});

test("coverage-aggregate on an empty dir: exits 0, publishes n/a (never throws)", () => {
  const empty = mkdtempSync(path.join(tmpdir(), "faff-v8cov-empty-"));
  const r = runAgg(["--dir", empty]);
  assert.equal(r.status, 0); // publish-only: never fails the job
  assert.match(r.stdout, /n\/a/);
});

test("coverage-aggregate with NODE_V8_COVERAGE unset and no --dir: exits 0, n/a", () => {
  const r = runAgg([], { NODE_V8_COVERAGE: "" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /n\/a/);
});
