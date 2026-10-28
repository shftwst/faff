// FAFF-1364 — a `## Scenarios` unit whose check is a repository test file passing is the code-blind
// holdout's own material (source="scenarios") and is intrinsically unjudgeable by it. `faff admissible
// --lights-out` surfaces a new, narrow, advisory-only `scenarios-code-surface advisory:` warning for
// such a unit — reusing FAFF-1360's `codeSurfaceSignal`/`TEST_FILE_TOKEN_RE`, never a second pattern —
// and `faff dod classify` tiering is unchanged (a Scenarios test-file unit stays running-stack/holdout;
// there is no verifier to retier it to, per ADR-0140). Mirrors test/faff-1360-code-surface-done-tier.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");

const faff = (cwd, args, input) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8", input });
const scratch = () => {
  const root = mkdtempSync(join(tmpdir(), "faff-1364-"));
  mkdirSync(join(root, ".git"));
  return root;
};
const specFile = (root, text, name = "spec.md") => { const f = join(root, name); writeFileSync(f, text); return f; };
const classify = (root, spec, issue = "FAFF-1364") => {
  const r = faff(root, ["dod", "classify", "--spec", spec, "--issue", issue, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const admissible = (root, spec, lightsOut = true) => {
  const args = ["admissible", "--spec", spec, "--json"];
  if (lightsOut) args.splice(1, 0, "--lights-out");
  const r = faff(root, args);
  const v = JSON.parse(r.stdout);
  assert.equal(r.status, v.admissible ? 0 : 1, r.stderr);
  return v;
};
const scenariosSurfaceWarnings = (v) => v.warnings.filter((w) => w.startsWith("scenarios-code-surface advisory:"));

const TEST_FILE_SCENARIO = ["## Scenarios", "", "```", "Given a", "When b", "Then `test/a.test.mjs` MUST pass", "```", "", "## 8. DONE", "", "- [ ] the parser returns >=1 item", ""].join("\n");

test("scenario 1: a lights-out spec with a test-file Scenarios unit warns exactly once, naming it, without flipping admissible", () => {
  const root = scratch();
  const spec = specFile(root, TEST_FILE_SCENARIO);
  const v = admissible(root, spec, true);
  const warnings = scenariosSurfaceWarnings(v);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /test\/a\.test\.mjs/);
  assert.equal(v.admissible, true);
  rmSync(root, { recursive: true, force: true });
});

test("scenario 2: a well-formed Given/When/Then Scenarios unit (no test-file token) emits no scenarios-code-surface warning", () => {
  const root = scratch();
  const spec = specFile(root, ["## Scenarios", "", "```", "Given a user is logged in", "When they click checkout", "Then the order is submitted", "```", "", "## 8. DONE", "", "- [ ] the parser returns >=1 item", ""].join("\n"));
  const v = admissible(root, spec, true);
  assert.equal(scenariosSurfaceWarnings(v).length, 0);
  rmSync(root, { recursive: true, force: true });
});

test("scenario 3: classify tiering is unchanged — the Scenarios test-file unit stays running-stack/holdout, a DONE test-file item stays integration/review-merge-floor", () => {
  const root = scratch();
  const spec = specFile(root, ["## Scenarios", "", "```", "Given `faff events append` MUST exit 1 on an empty issue", "```", "", "## 8. DONE", "", "- [ ] `test/b.test.mjs` MUST pass", ""].join("\n"));
  const c = classify(root, spec);
  const scen = c.criteria.find((x) => x.source === "scenarios");
  const done = c.criteria.find((x) => x.source === "done");
  assert.equal(scen.verification_tier, "running-stack");
  assert.equal(scen.verifier, "holdout");
  assert.equal(done.verification_tier, "integration");
  assert.equal(done.verifier, "review-merge-floor");
  rmSync(root, { recursive: true, force: true });
});

test("scenario 4: the warning is a pure function of lights-out — a test-file Scenarios unit without --lights-out emits no warning, and admissible/criteria/judged_count are byte-identical to the Scenarios unit removed", () => {
  const root = scratch();
  const withIt = specFile(root, TEST_FILE_SCENARIO, "with-it.md");
  const plain = faff(root, ["admissible", "--spec", withIt, "--json"]);
  assert.equal(plain.status, 0, plain.stderr);
  assert.ok(!JSON.parse(plain.stdout).warnings.some((w) => w.startsWith("scenarios-code-surface advisory:")));

  const without = specFile(root, ["## Scenarios", "", "```", "Given a", "When b", "Then c", "```", "", "## 8. DONE", "", "- [ ] the parser returns >=1 item", ""].join("\n"), "without.md");
  const withV = admissible(root, withIt, true);
  const withoutV = admissible(root, without, true);
  // Byte-identical means the FULL verdict shape matches, not just the admissible boolean — compare
  // checks (ids + pass) and the non-scenarios-surface warnings too, so a regression that corrupts
  // the verdict payload while keeping the boolean stable (e.g. the advisory leaking into `checks`)
  // is caught.
  assert.equal(withV.admissible, withoutV.admissible);
  assert.deepEqual(withV.checks.map((c) => ({ id: c.id, pass: c.pass })), withoutV.checks.map((c) => ({ id: c.id, pass: c.pass })));
  const nonSurfaceWarnings = (v) => v.warnings.filter((w) => !w.startsWith("scenarios-code-surface advisory:"));
  assert.deepEqual(nonSurfaceWarnings(withV), nonSurfaceWarnings(withoutV));
  const withC = classify(root, withIt);
  const withoutC = classify(root, without);
  assert.equal(withC.judged_count, withoutC.judged_count);
  assert.equal(withC.criteria.length, withoutC.criteria.length);
  rmSync(root, { recursive: true, force: true });
});

test("CLI-only Scenarios unit (no test-file token) stays running-stack and emits no scenarios-code-surface warning", () => {
  const root = scratch();
  const spec = specFile(root, ["## Scenarios", "", "- `faff x` MUST exit 0", "", "## 8. DONE", "", "- [ ] the parser returns >=1 item", ""].join("\n"));
  const c = classify(root, spec);
  const scen = c.criteria.find((x) => x.source === "scenarios");
  assert.equal(scen.verification_tier, "running-stack");
  const v = admissible(root, spec, true);
  assert.equal(scenariosSurfaceWarnings(v).length, 0);
  rmSync(root, { recursive: true, force: true });
});

test("OUT OF SCOPE pin: an export-signal Scenarios unit (codeSurfaceSignal === \"export\") is deliberately NOT flagged — the advisory is scoped to test-file only", () => {
  const root = scratch();
  const spec = specFile(root, ["## Scenarios", "", "```", "Given a build", "When the module loads", "Then `fooHelper` is exported from `lib/bar.js`", "```", "", "## 8. DONE", "", "- [ ] the parser returns >=1 item", ""].join("\n"));
  const c = classify(root, spec);
  const scen = c.criteria.find((x) => x.source === "scenarios");
  assert.equal(scen.verification_tier, "running-stack", "an export-signal Scenarios unit still stays running-stack — classify/tier is unchanged");
  const v = admissible(root, spec, true);
  assert.equal(scenariosSurfaceWarnings(v).length, 0, "the advisory fires on codeSurfaceSignal === \"test-file\" only (OUT OF SCOPE: export-in-Scenarios is a future extension point, not this ticket)");
  rmSync(root, { recursive: true, force: true });
});
