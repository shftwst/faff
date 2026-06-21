// FAFF-120 — the skill-authoring charter's lintable subset in `faff validate-adapters`
// (docs/skill-authoring.md): per-file line cap, wall-of-text paragraph cap, stray transcript/
// retrospective markers, and a cross-file duplicated-block detector. Thresholds are calibrated
// against the post-FAFF-114–119 tree as lenient ceilings; the real tree must pass clean.
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

// Run validate-adapters over a throwaway skills dir of {dirName: SKILL.md body} fixtures.
// Fixture dir names are NOT faffter-/faffidavit-/faff- prefixed (unless a test needs the gateway
// override), so only the repo-wide per-SKILL.md loops — incl. the charter rules — see them.
function runOnFixtures(fixtures) {
  const dir = mkdtempSync(join(tmpdir(), "faff-charter-"));
  for (const [name, body] of Object.entries(fixtures)) {
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, "SKILL.md"), body);
  }
  const r = spawnSync(process.execPath, [BIN, "validate-adapters", "--skills-dir", dir], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return r;
}
const runOne = (body, name = "zz-charter-fixture") => runOnFixtures({ [name]: body });
const has = (r, category) => new RegExp(`\\(${category}\\)`).test(r.stdout);

test("flags a SKILL.md over the line cap", () => {
  const body = Array.from({ length: 601 }, (_, i) => `line ${i}`).join("\n");
  const r = runOne(body);
  assert.ok(has(r, "line cap"), "601-line skill should trip the line cap");
  assert.match(r.stdout, /601 lines \(cap 600\)/);
  assert.notEqual(r.status, 0);
});

test("the gateway hub gets the higher line-cap override", () => {
  // a 700-line file named `faff` is the shared-prose hub — override 1000, so no line-cap failure
  const body = Array.from({ length: 700 }, (_, i) => `gateway line ${i}`).join("\n");
  const r = runOne(body, "faff");
  assert.equal(has(r, "line cap"), false, "the gateway override (1000) must not trip at 700 lines");
});

test("flags a wall-of-text paragraph", () => {
  const para = Array.from({ length: 210 }, () => "word").join(" ");
  const r = runOne(`# Heading\n\n${para}\n`);
  assert.ok(has(r, "paragraph"), "a 210-word single line should trip the paragraph cap");
  assert.match(r.stdout, /210-word paragraph \(cap 200\)/);
  assert.notEqual(r.status, 0);
});

test("flags a transcript run-id marker", () => {
  const r = runOne("Calibrated against run 2026-06-12 of the suite.\n");
  assert.ok(has(r, "stray marker"));
  assert.match(r.stdout, /transcript run-id/);
  assert.notEqual(r.status, 0);
});

test("flags a retrospective war-story phrase", () => {
  const r = runOne("This widened definition fixes a real failure in the queue.\n");
  assert.ok(has(r, "stray marker"));
  assert.match(r.stdout, /retrospective war-story phrase/);
  assert.notEqual(r.status, 0);
});

test("FP-guard: a load-bearing FAFF-NN reference is NOT a stray marker", () => {
  const r = runOne("The producer emits its contract block (FAFF-109); see gateway → Contract loading.\n");
  assert.equal(has(r, "stray marker"), false, "issue-tag anchors are load-bearing, not war-stories");
});

test("flags a duplicated block shared across two skills", () => {
  const block = Array.from({ length: 6 }, (_, i) =>
    `This is a substantial shared sentence number ${i} that exceeds the significance length.`).join("\n");
  const r = runOnFixtures({ "zz-charter-a": block + "\n", "zz-charter-b": block + "\n" });
  assert.ok(has(r, "duplicated block"), "an identical 6-line block across two skills should be flagged");
  assert.notEqual(r.status, 0);
});

test("FP-guard: the same block within ONE skill is not a cross-file duplicate", () => {
  const block = Array.from({ length: 6 }, (_, i) =>
    `This is a substantial shared sentence number ${i} that exceeds the significance length.`).join("\n");
  const r = runOne(block + "\n\n" + block + "\n");
  assert.equal(has(r, "duplicated block"), false, "dedup is cross-file only");
});

test("regression guard: the real shipped tree passes every charter rule clean", () => {
  const r = spawnSync(process.execPath, [BIN, "validate-adapters"], { cwd: REPO, encoding: "utf8" });
  for (const cat of ["line cap", "paragraph", "stray marker", "duplicated block"]) {
    assert.equal(has(r, cat), false, `shipped tree should pass the '${cat}' charter rule`);
  }
  assert.equal(r.status, 0, "validate-adapters is green on the shipped tree");
});
