// FAFF-281 — lintable eval-coverage gate in `faff validate-adapters` (C1/C2 + slot-sibling relaxation).
// Born-verifiable scenarios from the spec. C2-fail (a `covered` kind with its cases deleted) is left to
// the manual smoke (`rm eval/cases/<kind>-*.json`) — mutating the shared real eval/cases/ would race the
// other test files that lint the real tree in parallel.
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

function runValidate(extraSkillsDir, configured) {
  const args = [BIN, "validate-adapters"];
  if (configured) args.push("--configured");
  if (extraSkillsDir) args.push("--skills-dir", extraSkillsDir);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}
function runOnFixtures(fixtures, configured) {
  const dir = mkdtempSync(join(tmpdir(), "faff-cov-"));
  for (const [name, body] of Object.entries(fixtures)) {
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, "SKILL.md"), body);
  }
  const r = runValidate(dir, configured);
  rmSync(dir, { recursive: true, force: true });
  return r;
}
// frontmatter with an optional judgement_seam line (omit `seam` to leave the key ABSENT)
const fm = (name, seam) =>
  `---\nname: ${name}\ndescription: "x"\nuser-invocable: false\n` +
  (seam === undefined ? "" : `judgement_seam: ${seam}\n`) + `---\n\nbody\n`;

test("shipped tree passes the eval-coverage gate (exit 0, no `(eval coverage)` FAIL)", () => {
  const r = runValidate();
  assert.equal(r.status, 0, r.stdout);
  assert.doesNotMatch(r.stdout, /\(eval coverage\)/);
});

test("day-one: post-265 family is advisory `undeclared`; designed kinds are advisory NEEDS-CASES", () => {
  const r = runValidate();
  // FAFF-285 removed faffter-noon-architecture from this list: it now owns the `architecture` registry
  // row and declares `judgement_seam: architecture`, so it reconciles clean rather than being undeclared.
  // FAFF-284 removed faffter-noon-evaluate likewise: it now owns the `holdout` registry row and declares
  // `judgement_seam: holdout`, so it reconciles clean rather than being undeclared.
  // FAFF-282 removed faffter-noon-spec-review (now owns the `spec-verdict` registry row) and its slot
  // sibling faffter-dark-spec-review (declares `judgement_seam: spec-verdict` via the sibling relaxation):
  // both reconcile clean rather than being undeclared.
  for (const n of ["faffter-noon-env-compose", "faffter-noon-adr"]) {
    assert.match(r.stdout, new RegExp(`UNDECLARED  ${n} `), `${n} should be advisory undeclared`);
  }
  assert.match(r.stdout, /NEEDS-CASES  reconciliation /);
  assert.match(r.stdout, /NEEDS-CASES  verdict-build /);
});

test("C1: a registry SURFACE with no judgement_seam key FAILS (eval coverage)", () => {
  const r = runOnFixtures({ "faff-tidy": fm("faff-tidy") }); // faff-tidy owns 6 KINDs in the registry
  assert.match(r.stdout, /FAIL  faff-tidy \(eval coverage\)/);
  assert.match(r.stdout, /no `judgement_seam:` declaration/);
  assert.notEqual(r.status, 0);
});

test("C1: an unrowed REGISTRY slot-skill with no key is advisory undeclared, NOT an eval-coverage FAIL", () => {
  // FAFF-285: faffter-noon-architecture is now a registry SURFACE, so the exemplar of a still-unrowed
  // REGISTRY slot-skill is faffter-noon-env-compose (no registry row → advisory undeclared, not a fail).
  const r = runOnFixtures({ "faffter-noon-env-compose": fm("faffter-noon-env-compose") });
  assert.match(r.stdout, /UNDECLARED  faffter-noon-env-compose /);
  assert.doesNotMatch(r.stdout, /faffter-noon-env-compose \(eval coverage\)/);
});

test("slot-sibling relaxation: an alternate declaring its sibling's KINDs reconciles clean", () => {
  // FAFF-241: faffter-noon-spec's sibling row-set is now [confidence, marker, specqual], so an alternate
  // that declares all three reconciles clean (the sibling relaxation, one KIND wider than before).
  const r = runOnFixtures({ "faffter-dark-nlspec": fm("faffter-dark-nlspec", "confidence, marker, specqual") });
  assert.doesNotMatch(r.stdout, /faffter-dark-nlspec \(judgement seam\)/);
  assert.doesNotMatch(r.stdout, /faffter-dark-nlspec \(eval coverage\)/);
});

test("slot-sibling: an alternate declaring only a partial sibling set still mismatches", () => {
  const r = runOnFixtures({ "faffter-dark-nlspec": fm("faffter-dark-nlspec", "confidence") });
  assert.match(r.stdout, /faffter-dark-nlspec \(judgement seam\)/);
  // FAFF-241: expected set widened to [confidence, marker, specqual] (faffter-noon-spec's rows).
  assert.match(r.stdout, /judgement_seam mismatch — declared \[confidence\] vs expected \[confidence, marker, specqual\]/);
});

test("--configured runs no coverage sweep (no eval-coverage / undeclared / needs-cases lines)", () => {
  const r = runOnFixtures({ "faffter-noon-architecture": fm("faffter-noon-architecture") }, true);
  assert.doesNotMatch(r.stdout, /\(eval coverage\)|UNDECLARED|NEEDS-CASES/);
});
