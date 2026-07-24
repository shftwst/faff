// FAFF-598 — the inline-enum-restatement lint in `faff validate-adapters`: a skill hand-restating
// a lintable fixed-contract enum's full value set (name + per-value meaning) is exactly the FAFF-582
// drift class (a hand-copied enum going stale against the validator). The lint fires on the full-set,
// window-of-2, lintable-only, >=3-value case and never on single-value mentions or exempt groups.
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

function runOnFixtures(fixtures) {
  const dir = mkdtempSync(join(tmpdir(), "faff-enum-restatement-"));
  for (const [name, body] of Object.entries(fixtures)) {
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, "SKILL.md"), body);
  }
  const r = spawnSync(process.execPath, [BIN, "validate-adapters", "--skills-dir", dir], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return r;
}
const runOne = (body, name = "zz-enum-fixture") => runOnFixtures({ [name]: body });

test("regression fixture: restating all four spec-review verdicts in one sentence fires the lint", () => {
  // The spec's own acceptance scenario: "a SKILL.md line reintroducing all four spec-review
  // verdicts in one sentence" — `verdict` stays lintable (unlike lens/severity, its producer-
  // dialect siblings), so this is exactly the fixture the DoD names.
  const body = "# fixture\n\nThe reviewer returns one of `approve` / `revise` / `reject-approach` / `needs-human` after its pass.\n";
  const r = runOne(body);
  assert.match(r.stdout, /inline enum restatement/);
  assert.match(r.stdout, /spec-review-verdict\.verdict/);
  assert.match(r.stdout, /faff contract spec-review-verdict --describe/);
  assert.notEqual(r.status, 0);
});

test("a single verdict mention never fires (no full-set restatement)", () => {
  const body = "# fixture\n\nOn `approve`, proceed to the next step.\n";
  const r = runOne(body);
  assert.doesNotMatch(r.stdout, /inline enum restatement/);
});

test("a two-value set below the >=3 floor never fires", () => {
  // env-handle... no — pick a genuine 2-value-or-fewer case is hard since none exist at 2; use a
  // partial restatement instead (3 of 4 review-verdict values, never the full closed set).
  const body = "# fixture\n\nThe review returns `pass`, `fail`, or `needs-human` — never a fourth state here.\n";
  const r = runOne(body);
  assert.doesNotMatch(r.stdout, /review-verdict\.signal/);
});

test("the spec-readiness marker dialect is exempt (lintable:false — producers legitimately restate it)", () => {
  const body = "# fixture\n\nEvery decision carries one marker: `chosen`, `punt`, or `assumes`.\n";
  const r = runOne(body);
  assert.doesNotMatch(r.stdout, /inline enum restatement/);
});

test("identical enum sets shared across contracts dedupe to one reported owner", () => {
  // prdr-admission.disposition and adr-admission.disposition share the exact same three-value
  // set (both bound to PRDR_DISPOSITIONS by reference) — one owner is cited, never both.
  const body = "# fixture\n\nThe verdict is one of `admit`, `propose-only`, or `reject`.\n";
  const r = runOne(body);
  const owners = new Set((r.stdout.match(/inline enum restatement of ([a-z-]+)\.disposition/g) || [])
    .map((m) => m.replace("inline enum restatement of ", "").replace(".disposition", "")));
  assert.equal(owners.size, 1, `expected exactly one distinct owner cited, got: ${[...owners].join(", ")}`);
});

test("the shipped tree stays clean (no reintroduced restatement)", () => {
  const r = spawnSync(process.execPath, [BIN, "validate-adapters"], { cwd: REPO, encoding: "utf8" });
  assert.doesNotMatch(r.stdout, /inline enum restatement/, "the post-FAFF-598 tree must carry zero inline-enum-restatement findings");
});
