// FAFF-88 reference fixture — proves the determinism-seam + runner decisions (ADR 0002).
//
// Asserts at the CLI `faff next` routing seam: a fixed issue-state → flags is fed to the
// deterministic `faff next` verdict function (a pure function skills consult for routing),
// and the STRUCTURED verdict token is asserted — never the human-readable reason string.
// This is the worked example the skill-run harness (FAFF-93) generalises.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const faffBin = path.join(repoRoot, "skills", "faff", "bin", "faff");

// The deterministic seam: invoke the real CLI entrypoint as a child process, return { stdout, code }.
function faffNext(args) {
  const r = spawnSync("node", [faffBin, "next", ...args], { cwd: repoRoot, encoding: "utf8" });
  return { stdout: r.stdout, code: r.status };
}

test("faff next: todo + high spec → graft (verdict token, exit 0)", () => {
  const { stdout, code } = faffNext(["--status", "todo", "--spec", "high"]);
  assert.equal(code, 0);
  const verdict = JSON.parse(stdout); // assert the structured seam, not the prose reason
  assert.equal(verdict.next, "graft");
});

test("faff next: todo + no spec → prep (discriminating negative case)", () => {
  const { stdout, code } = faffNext(["--status", "todo", "--spec", "none"]);
  assert.equal(code, 0);
  const verdict = JSON.parse(stdout);
  assert.equal(verdict.next, "prep"); // a different input yields a different verdict — the assertion discriminates
});
