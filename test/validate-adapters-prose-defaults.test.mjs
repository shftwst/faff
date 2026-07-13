// FAFF-191 — the prose-supplied-default lint in `faff validate-adapters` (deferred half of FAFF-182).
// Rule (a): a `config get <registry-key> … -d …` is redundant — the registry already defaults it,
// and the prose `-d` is a drift vector. Rule (b): a dispatch site (Skill-tool delegation / producer
// subagent / producer dispatch) that names a bundled slot default literally is a shortcut vector —
// route through `faff config get slots.<x>` instead. Both key on the CONSTRUCTION, never on bare
// occurrence of a default name, so a documentation mention (a Slots-table row, plain narrative, the
// adversarial-review direct-reuse carve-out) must never flag. Both check sets are derived from
// `require("./config").DEFAULTS` at lint time — never hardcoded — so this file never duplicates the
// registry. Deterministic, free, CI-friendly (modeled on test/validate-adapters-delegation.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");

// Run validate-adapters over a throwaway skills dir holding a single fixture SKILL.md.
// Fixture dir name is NOT faffter-/faffidavit-/faff- prefixed, so only the repo-wide per-SKILL.md
// loops (incl. this lint) see it — the slot-conformance checks skip it.
function runOnFixture(skillBody) {
  const dir = mkdtempSync(join(tmpdir(), "faff-prosedef-"));
  mkdirSync(join(dir, "zz-prosedef-fixture"));
  writeFileSync(join(dir, "zz-prosedef-fixture", "SKILL.md"), skillBody);
  const r = spawnSync(process.execPath, [BIN, "validate-adapters", "--skills-dir", dir], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return r;
}
const flagged = (r) => /\(prose default\)/.test(r.stdout);

// --- Rule (a): redundant `-d` on a registry key ---

test("rule (a): flags a redundant -d on a registry scalar key", () => {
  const r = runOnFixture('default=$("$faff" config get automation_default -d opt-in)\n');
  assert.ok(flagged(r), "should report a prose-default failure");
  assert.match(r.stdout, /"automation_default"/);
  assert.notEqual(r.status, 0);
});

test("rule (a) negative: a non-registry key with -d passes clean", () => {
  const r = runOnFixture('deadline=$("$faff" config get graft.push_at_build_complete -d true)\n');
  assert.equal(flagged(r), false, "graft.push_at_build_complete is a deliberate non-registry key");
});

test("rule (a) negative: .example lines are exempt", () => {
  const r = runOnFixture('.faffrc.example: config get automation_default -d opt-in\n');
  assert.equal(flagged(r), false);
});

// --- Rule (b): a dispatch site naming a bundled slot default ---

test("rule (b): flags a bundled default named on a Skill-tool dispatch line", () => {
  const r = runOnFixture("Invoke the `review` slot via the Skill tool (the default `faffter-noon-review` is a canonical name).\n");
  assert.ok(flagged(r));
  assert.match(r.stdout, /"faffter-noon-review"/);
  assert.notEqual(r.status, 0);
});

test("rule (b): flags a bundled default named on a producer-subagent dispatch line", () => {
  const r = runOnFixture("Dispatch the `spec` slot (default `faffter-noon-spec`) as a producer subagent.\n");
  assert.ok(flagged(r));
  assert.match(r.stdout, /"faffter-noon-spec"/);
  assert.notEqual(r.status, 0);
});

test("rule (b): flags a bundled default named on a producer-dispatch-anchored line", () => {
  const r = runOnFixture("Resolve the `ship` slot for producer dispatch (default `faffter-noon-ship`).\n");
  assert.ok(flagged(r));
  assert.match(r.stdout, /"faffter-noon-ship"/);
  assert.notEqual(r.status, 0);
});

test("rule (b) negative: a compliant dispatch site naming no default passes clean", () => {
  const r = runOnFixture("Invoke the `review` slot via the Skill tool (resolve `faff config get slots.review` per gateway → Sibling-skill invocation).\n");
  assert.equal(flagged(r), false);
});

test("doc-mention negative: a Slots-table-style row is not a dispatch site", () => {
  const r = runOnFixture("| `review` | `faffter-noon-review` | Pre-PR review inside faff-graft. |\n");
  assert.equal(flagged(r), false, "a documentation table row must never flag");
});

test("doc-mention negative: plain narrative naming a default is not a dispatch site", () => {
  const r = runOnFixture("The slot's default is `faffter-noon-review`; the review's own passes are that skill's concern.\n");
  assert.equal(flagged(r), false, "narrative prose must never flag");
});

test("carve-out negative: the adversarial-review direct-reuse phrasing passes clean", () => {
  const r = runOnFixture("Two-phase code review: standard structural review (delegated to `faffter-noon-review`) followed by an adversarial second opinion.\n");
  assert.equal(flagged(r), false, "faffter-dark-adversarial-review runs faffter-noon-review's own logic as itself — not a dispatch site");
});

test("negative: an anchored line naming a non-default skill passes clean", () => {
  const r = runOnFixture("Validate the adaptor via the Skill tool (invoke `faffter-dark-authoring-adaptors`).\n");
  assert.equal(flagged(r), false, "not a bundled slot default — no exact match in the registry's value set");
});

test("negative: a backticked path token embedding a default name passes clean (exact-match only)", () => {
  const r = runOnFixture("See its own self-review step (`faffter-noon-spec/SKILL.md`) via the Skill tool.\n");
  assert.equal(flagged(r), false, "the token is a path, not an exact match to the bundled default literal");
});

// --- Real-tree regression guard ---

test("regression guard: the real shipped tree passes the prose-default lint clean", () => {
  const r = spawnSync(process.execPath, [BIN, "validate-adapters"], { cwd: REPO, encoding: "utf8" });
  assert.equal(flagged(r), false, "no shipped SKILL.md carries a redundant -d on a registry key or names a bundled default at a dispatch site");
  assert.equal(r.status, 0, "validate-adapters is green on the shipped tree");
});
