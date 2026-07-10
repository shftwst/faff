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

// FAFF-337 — a literal minted canonical run-id (8 digits, 6 digits, launcher word) pasted
// into prose is exactly the transcript-breadcrumb idiom this lint targets; the
// letter-template shape used to DOCUMENT the format (`YYYY-MM-DD`/`HHMMSS` placeholders,
// no real digits) must NOT trip it.
test("flags a literal canonical run-id (beepboop)", () => {
  const r = runOne("Calibrated against .faff/runs/run-20260707-130600-beepboop-full/summary.md.\n");
  assert.ok(has(r, "stray marker"));
  assert.match(r.stdout, /transcript run-id/);
  assert.notEqual(r.status, 0);
});

test("flags a literal canonical run-id (lights-out)", () => {
  const r = runOne("The run-20260707-130600-lights-out ledger recorded the outcome.\n");
  assert.ok(has(r, "stray marker"));
  assert.match(r.stdout, /transcript run-id/);
  assert.notEqual(r.status, 0);
});

test("FP-guard: the letter-template canonical run-id shape (documentation, no real digits) is NOT a stray marker", () => {
  const r = runOne("Mint the run directory as `run-YYYYMMDD-HHMMSS-beepboop-<mode>`.\n");
  assert.equal(has(r, "stray marker"), false, "a placeholder template must not read as a pasted transcript id");
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

// FAFF-112 — the negative case FAFF-92 deferred: a REGISTRY-matched, slot-named skill that
// FAILS its type-specific `checksFor` check (exit 1), complementing FAFF-92's PASS coverage.
// The fixture is named `faffter-noon-spec` (a producer-spec REGISTRY entry) so the linter
// selects the producer-spec type-checks; the body keeps `user-invocable: false` + "confidence"
// present and omits ONLY the `faff-contract:spec-readiness` block, so exactly one check fails
// and the FAIL is unambiguously the type-specific contract-block check, not an incidental trip.
const NON_CONFORMANT_SPEC = [
  "---",
  "user-invocable: false", // => the universal user-invocable check PASSES
  "---",
  "# faffter-noon-spec (non-conformant fixture)",
  "",
  "This crafted producer-spec fixture emits a confidence self-rating but deliberately",
  "omits its contract block, so the type-specific producer-spec check is the one that fails.",
  "",
].join("\n");

// Positive control: the SAME harness + fixture name, but a conformant body (it DOES carry the
// contract block) passes. Proves the negative FAIL above is the omitted block, not a temp-dir
// artifact. Double-quoted strings hold the ``` fences literally — no backtick escaping needed.
const CONFORMANT_SPEC = [
  "---",
  "user-invocable: false",
  "judgement_seam: confidence, marker, specqual", // FAFF-281 C1: a registry surface must declare its seam (FAFF-241 added specqual)
  "---",
  "# faffter-noon-spec (conformant fixture)",
  "",
  "This producer-spec fixture emits a confidence self-rating and its contract block below.",
  "",
  "```faff-contract:spec-readiness",
  '{ "confidence": "high", "decisions": [] }',
  "```",
  "",
].join("\n");

test("FAFF-112: flags a non-conformant slot-named skill with a type-specific FAIL (exit 1)", () => {
  const r = runOnFixtures({ "faffter-noon-spec": NON_CONFORMANT_SPEC });
  assert.notEqual(r.status, 0, "a registered slot skill failing a type check must exit non-zero");
  assert.ok(has(r, "producer-spec"), "the FAIL line must be tagged with the (producer-spec) kind");
  assert.match(r.stdout, /faff-contract:spec-readiness/,
    "the specific failing check (the omitted contract block) must be surfaced");
  assert.match(r.stdout, /RESULT:\s*FAIL/, "the overall result line must be FAIL");
});

test("FAFF-112 positive control: a conformant slot-named skill passes (exit 0)", () => {
  const r = runOnFixtures({ "faffter-noon-spec": CONFORMANT_SPEC });
  assert.equal(r.status, 0, "a conformant producer-spec fixture must exit 0");
  assert.match(r.stdout, /pass\s+faffter-noon-spec \(producer-spec\)/,
    "the conformant fixture must be reported as a producer-spec pass");
});

test("regression guard: the real shipped tree passes every charter rule clean", () => {
  const r = spawnSync(process.execPath, [BIN, "validate-adapters"], { cwd: REPO, encoding: "utf8" });
  for (const cat of ["line cap", "paragraph", "stray marker", "duplicated block"]) {
    assert.equal(has(r, cat), false, `shipped tree should pass the '${cat}' charter rule`);
  }
  assert.equal(r.status, 0, "validate-adapters is green on the shipped tree");
});
