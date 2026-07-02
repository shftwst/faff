// FAFF-280 — judgement-seam declaration + shared seam→KIND registry.
// Covers the born-verifiable scenarios: grader↔registry KIND-axis equality (fail-loud on drift),
// the truthful covered/designed seed, and the validate-adapters frontmatter↔registry reconciliation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { KINDS, assertRegistryConsistent, loadSeamRegistry, CaseError } from "../eval/grader.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const registry = loadSeamRegistry();

test("grader loads — the on-load registry-consistency assertion passes (no throw)", () => {
  // Reaching this line means importing ../eval/grader.mjs did not throw on load.
  assert.equal(typeof assertRegistryConsistent, "function");
  assert.ok(assertRegistryConsistent(registry));
});

test("registry keys are EXACTLY the 23 grader KINDS (total equality)", () => {
  const rk = Object.keys(registry.kinds);
  assert.equal(rk.length, 23);
  assert.equal(KINDS.length, 23);
  assert.deepEqual(new Set(rk), new Set(KINDS));
});

test("a KIND added to one side but not the other throws a drift error", () => {
  assert.throws(() => assertRegistryConsistent({ kinds: { dupe: {} } }), CaseError);
  // extra id in registry only
  const extra = { kinds: Object.fromEntries(KINDS.concat("bogus19").map((k) => [k, { surface: "x", status: "covered" }])) };
  assert.throws(() => assertRegistryConsistent(extra), /KINDS drift/);
});

test("seed is truthful: status:covered ⇔ ≥1 case in eval/cases/; designed are exactly the two zero-case kinds", () => {
  const caseKinds = new Set();
  for (const f of readdirSync(join(REPO, "eval", "cases"))) {
    const m = f.match(/^(.*)-\d+\.json$/);
    if (m) caseKinds.add(m[1]);
  }
  for (const [kind, entry] of Object.entries(registry.kinds)) {
    const want = caseKinds.has(kind) ? "covered" : "designed";
    assert.equal(entry.status, want, `${kind} should be ${want}`);
    assert.ok(entry.surface && typeof entry.surface === "string", `${kind} has a surface`);
  }
  const designed = Object.entries(registry.kinds).filter(([, e]) => e.status === "designed").map(([k]) => k);
  assert.deepEqual(new Set(designed), new Set(["reconciliation", "verdict-build"]));
});

// ---- validate-adapters reconciliation ----
function runValidate(extraSkillsDir) {
  const args = [BIN, "validate-adapters"];
  if (extraSkillsDir) args.push("--skills-dir", extraSkillsDir);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

test("real tree passes seam reconciliation (no judgement-seam FAIL, exit 0)", () => {
  const r = runValidate();
  assert.equal(r.status, 0, r.stdout);
  assert.doesNotMatch(r.stdout, /\(judgement seam\)/);
});

function runOnFixtures(fixtures) {
  const dir = mkdtempSync(join(tmpdir(), "faff-seam-"));
  for (const [name, body] of Object.entries(fixtures)) {
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, "SKILL.md"), body);
  }
  const r = runValidate(dir);
  rmSync(dir, { recursive: true, force: true });
  return r;
}
const fm = (seam) => `---\nname: zz\ndescription: "x"\njudgement_seam: ${seam}\n---\n\nbody\n`;

test("unknown kind-id in frontmatter fails the skill with a naming message", () => {
  const r = runOnFixtures({ "zz-seam-unknown": fm("dupr") });
  assert.match(r.stdout, /zz-seam-unknown \(judgement seam\)/);
  assert.match(r.stdout, /unknown KIND\(s\): dupr/);
  assert.notEqual(r.status, 0);
});

test("`none` on a skill that owns a registered KIND fails (contradiction)", () => {
  // dir named after a real surface so reconcileSeam finds its registry rows
  const r = runOnFixtures({ "faffidavit-routing": fm("none") });
  assert.match(r.stdout, /faffidavit-routing \(judgement seam\)/);
  assert.match(r.stdout, /declares `none` but registry maps/);
});

test("declared set ≠ registry surface rows fails with a mismatch message", () => {
  const r = runOnFixtures({ "faff-tidy": fm("dupe") }); // registry maps 6 kinds to faff-tidy
  assert.match(r.stdout, /faff-tidy \(judgement seam\)/);
  assert.match(r.stdout, /judgement_seam mismatch/);
});

test("a deterministic skill declaring `none` (owning no KIND) reconciles clean", () => {
  const r = runOnFixtures({ "zz-seam-none": fm("none") });
  assert.doesNotMatch(r.stdout, /zz-seam-none \(judgement seam\)/);
});
