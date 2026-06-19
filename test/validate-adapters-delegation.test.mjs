// FAFF-172 — the delegation-conformance lint in `faff validate-adapters`.
// A Skill-tool delegation site must name the sibling by its canonical name (no leading slash, no
// `faff:` namespace) per the gateway Sibling-skill-invocation convention (FAFF-164). The lint keys
// on the `<target>` skill … via the Skill tool construction so it does NOT false-positive on the
// human-command slash prose that legitimately shares the line. Deterministic, free, CI-friendly.
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
// loops (incl. the delegation lint) see it — the slot-conformance checks skip it.
function runOnFixture(skillBody) {
  const dir = mkdtempSync(join(tmpdir(), "faff-deleg-"));
  mkdirSync(join(dir, "zz-deleg-fixture"));
  writeFileSync(join(dir, "zz-deleg-fixture", "SKILL.md"), skillBody);
  const r = spawnSync(process.execPath, [BIN, "validate-adapters", "--skills-dir", dir], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return r;
}
const flagged = (r) => /\(delegation conformance\)/.test(r.stdout);

test("flags a leading-slash invoke literal at a delegation site", () => {
  const r = runOnFixture("On confirm, invoke the `/faff-prep` skill via the Skill tool.\n");
  assert.ok(flagged(r), "should report a delegation-conformance failure");
  assert.match(r.stdout, /"\/faff-prep"/);
  assert.notEqual(r.status, 0);
});

test("flags a faff:-namespaced invoke literal at a delegation site", () => {
  const r = runOnFixture("Then invoke the `faff:faff-graft` skill via the Skill tool.\n");
  assert.ok(flagged(r));
  assert.match(r.stdout, /"faff:faff-graft"/);
  assert.notEqual(r.status, 0);
});

test("a canonical delegation target passes clean", () => {
  const r = runOnFixture("On confirm, invoke the `faff-prep` skill via the Skill tool (resolve per Sibling-skill invocation).\n");
  assert.equal(flagged(r), false);
});

test("FP-guard: human-command slash prose is not a delegation (no 'via the Skill tool')", () => {
  const r = runOnFixture("Prep now: type `/faff-prep`? (y/n). Run `/faff-wtf` to catch up.\n");
  assert.equal(flagged(r), false);
});

test("FP-guard: the convention's counter-example ('to the Skill tool') is not flagged", () => {
  const r = runOnFixture("Never pass a leading-slash form (`/faff-prep`, `/faff:prep`) to the Skill tool.\n");
  assert.equal(flagged(r), false);
});

test("FP-guard: a line mixing human-command slash prose with a canonical delegation passes", () => {
  // the realistic shape across faff-wtf/map/graft: a user-facing `/faff-prep` prompt AND the delegation
  const r = runOnFixture('"Prep now via `/faff-prep`? (y/n)" — on confirm, invoke the `faff-prep` skill via the Skill tool. Then "Start via `/faff-graft`?".\n');
  assert.equal(flagged(r), false, "the canonical `faff-prep` skill is the target; the human-prose /faff-prep must not trip the lint");
});

test("regression guard: the real shipped tree passes the delegation lint clean", () => {
  const r = spawnSync(process.execPath, [BIN, "validate-adapters"], { cwd: REPO, encoding: "utf8" });
  assert.equal(flagged(r), false, "no shipped SKILL.md hardcodes an install-mode delegation literal");
  assert.equal(r.status, 0, "validate-adapters is green on the shipped tree");
});
