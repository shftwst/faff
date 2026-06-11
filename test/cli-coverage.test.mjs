// FAFF-92 — CLI decision-logic coverage: config / faff next / state / validate-adapters.
// Exercises each subcommand through the real entrypoint via FAFF-91's runCli, against
// provisioned fixture state, asserting the deterministic seam (token/exit/parsed JSON) — never prose.
// Per ADR 0002.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

function fixtureDir(faffrcBody) {
  const dir = mkdtempSync(path.join(tmpdir(), "faff-cov-"));
  if (faffrcBody !== undefined) writeFileSync(path.join(dir, ".faffrc.yaml"), faffrcBody);
  return dir;
}

// --- config ---
test("config get: reads a value from the resolved .faffrc.yaml (precedence + cwd)", () => {
  const dir = fixtureDir("tracking:\n  team_key: ZZZ\n");
  const { stdout, code } = runCli(["config", "get", "tracking.team_key"], { cwd: dir });
  assert.equal(code, 0);
  assert.equal(stdout.trim(), "ZZZ");
});

test("config get: falls back to the -d default and exits 3 when absent", () => {
  const dir = fixtureDir(); // no .faffrc.yaml
  const { stdout, code } = runCli(["config", "get", "tracking.team_key", "-d", "FALLBACK"], { cwd: dir });
  assert.equal(code, 3);
  assert.equal(stdout.trim(), "FALLBACK");
});

// --- faff next (pure transition function) ---
const nextCases = [
  [["--status", "backlog", "--spec", "none"], "prep"],
  [["--status", "todo", "--spec", "high"], "graft"],
  [["--status", "todo", "--spec", "none"], "prep"],
  [["--status", "done", "--spec", "high"], "done"],
];
for (const [args, expected] of nextCases) {
  test(`next ${args.join(" ")} → ${expected}`, () => {
    const { stdout, code } = runCli(["next", ...args]);
    assert.equal(code, 0);
    assert.equal(JSON.parse(stdout).next, expected); // token, not reason
  });
}

// --- faff state (read-model) ---
test("state: an unknown issue returns a read-model with status unknown", () => {
  const { stdout, code } = runCli(["state", "FAFF-ZZZ999-nonexistent"]);
  assert.equal(code, 0);
  const s = JSON.parse(stdout);
  assert.equal(s.issue, "FAFF-ZZZ999-nonexistent");
  assert.equal(s.status, "unknown");
  assert.equal(s.parked, false);
});

// --- validate-adapters ---
test("validate-adapters: the shipped slot skills conform (exit 0)", () => {
  const { code } = runCli(["validate-adapters"]);
  assert.equal(code, 0);
});
