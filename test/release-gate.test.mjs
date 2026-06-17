// FAFF-174 — release-gate title assertion tests.
//
// The defining property: isReleasingTitle() returns true ONLY for a feat:/fix: conventional-
// commit subject (the types release-please bumps on) and false for everything else, so a
// user-facing change can't merge under a non-releasing title and silently skip the release.
// Bare `node --test` — no LLM, no network. Mirrors the script's own `--selftest` fixtures
// plus the parse edge cases called out in the spec.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { isReleasingTitle } from "../scripts/release-gate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "..", "scripts", "release-gate.mjs");

const RELEASING = [
  "feat: add a thing",
  "fix: correct a thing",
  "fix(FAFF-1): scoped patch",
  "feat(faff-tidy): scoped feature",
  "feat!: breaking feature",
  "feat(scope)!: breaking scoped feature",
];

const NON_RELEASING = [
  "docs: tweak prose",
  "chore: tidy",
  "refactor: reshape",
  "FAFF-164: bare ticket prefix",
  "Feat: capitalised type",
  "feat:no space after colon",
  "feat: ",
  "",
];

test("releasing titles are accepted", () => {
  for (const t of RELEASING) assert.equal(isReleasingTitle(t), true, `expected releasing: ${JSON.stringify(t)}`);
});

test("non-releasing titles are rejected", () => {
  for (const t of NON_RELEASING) assert.equal(isReleasingTitle(t), false, `expected non-releasing: ${JSON.stringify(t)}`);
});

test("non-string / nullish input is non-releasing (no throw)", () => {
  assert.equal(isReleasingTitle(undefined), false);
  assert.equal(isReleasingTitle(null), false);
  assert.equal(isReleasingTitle(42), false);
});

test("leading/trailing whitespace is tolerated around a releasing title", () => {
  assert.equal(isReleasingTitle("  feat: padded  "), true);
});

test("--title exits 0 for a releasing title", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--title", "feat: x"], { encoding: "utf8" });
  assert.equal(r.status, 0);
});

test("--title exits 1 with remediation on stderr for a non-releasing title", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--title", "FAFF-200: x"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /feat: .*fix: /);
});

test("no recognised flag exits 2 (usage)", () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  assert.equal(r.status, 2);
});

test("--selftest exits 0 and reports PASS", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--selftest"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /RESULT PASS/);
});
