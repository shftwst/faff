// FAFF-1293 — a `## Scenarios` unit that `faff dod classify` puts in the prose class (no Then, no MUST,
// no comparator) cannot be judged by the code-blind holdout, and a holdout-marked one is also withheld
// from the builder, so it checks nothing. `faff admissible --lights-out` surfaces a warning-only
// `scenarios-prose advisory:` naming each such unit by its classify id (with a `(holdout)` tag), reading
// dodClassify's `class`/`holdout` fields — never a second prose detector. Classify tiering is unchanged.
// Mirrors test/faff-1364-scenarios-code-surface.test.mjs. Fixtures avoid fenced examples with an internal
// blank line (FAFF-1205's fragmentation), so they pass in either merge order.
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
  const root = mkdtempSync(join(tmpdir(), "faff-1293-"));
  mkdirSync(join(root, ".git"));
  return root;
};
const specFile = (root, text, name = "spec.md") => { const f = join(root, name); writeFileSync(f, text); return f; };
const classify = (root, spec, issue = "FAFF-1293") => {
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
const proseWarnings = (v) => v.warnings.filter((w) => w.startsWith("scenarios-prose advisory:"));

const DONE = ["## 8. DONE", "", "- [ ] `faff x` MUST exit 0", ""];
const GWT = ["```", "Given a well formed case", "When the CLI runs", "Then the result MUST be ok", "```"];
const HOLDOUT_NO_THEN = ["```holdout", "Given a withheld case", "When the CLI runs", "```"];

const HOLDOUT_PROSE_SPEC = ["## Scenarios", "", ...GWT, "", ...HOLDOUT_NO_THEN, "", ...DONE].join("\n");
const WELL_FORMED_SPEC = ["## Scenarios", "", ...GWT, "", "```", "Given a user is logged in", "When they click checkout", "Then the order is submitted", "```", "", ...DONE].join("\n");
const MIXED_SPEC = ["## Scenarios", "", ...GWT, "", "- When the CLI gets no flag, its stdout is byte-identical", "- holdout: the dashboard feels responsive", "", ...DONE].join("\n");

test("scenario 1: a holdout-fenced Given/When block with no Then warns exactly once, naming scenarios:2 (holdout), and admissible stays true with exit 0", () => {
  const root = scratch();
  const spec = specFile(root, HOLDOUT_PROSE_SPEC);
  const r = faff(root, ["admissible", "--lights-out", "--spec", spec, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const v = JSON.parse(r.stdout);
  const warnings = proseWarnings(v);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].startsWith("scenarios-prose advisory: 1 Scenarios unit(s)"), warnings[0]);
  assert.match(warnings[0], /scenarios:2 \(holdout\) Given a withheld case/);
  assert.equal(v.admissible, true);
  rmSync(root, { recursive: true, force: true });
});

test("scenario 2: only well-formed Given/When/Then Scenarios units emit no scenarios-prose warning", () => {
  const root = scratch();
  const spec = specFile(root, WELL_FORMED_SPEC);
  const v = admissible(root, spec, true);
  assert.equal(proseWarnings(v).length, 0);
  rmSync(root, { recursive: true, force: true });
});

test("scenario 3: without --lights-out the same spec emits no warnings at all", () => {
  const root = scratch();
  const spec = specFile(root, HOLDOUT_PROSE_SPEC);
  const v = admissible(root, spec, false);
  assert.deepEqual(v.warnings, []);
  assert.equal(proseWarnings(v).length, 0);
  rmSync(root, { recursive: true, force: true });
});

test("scenario 4: a visible no-Then bullet and a holdout bullet are both named; only the holdout one is tagged, and the holdout clause counts one", () => {
  const root = scratch();
  const spec = specFile(root, MIXED_SPEC);
  const v = admissible(root, spec, true);
  const warnings = proseWarnings(v);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].startsWith("scenarios-prose advisory: 2 Scenarios unit(s)"), warnings[0]);
  assert.match(warnings[0], /; 1 of them are holdout-marked and withheld from the builder, so they check nothing;/);
  assert.match(warnings[0], /scenarios:2 When the CLI/);
  assert.doesNotMatch(warnings[0], /scenarios:2 \(holdout\)/);
  assert.match(warnings[0], /scenarios:3 \(holdout\) the dashboard/);
  assert.equal(v.admissible, true);
  rmSync(root, { recursive: true, force: true });
});

test("a visible (non-holdout) prose unit alone omits the holdout clause", () => {
  const root = scratch();
  const spec = specFile(root, ["## Scenarios", "", ...GWT, "", "- When the CLI gets no flag, its stdout is byte-identical", "", ...DONE].join("\n"));
  const warnings = proseWarnings(admissible(root, spec, true));
  assert.equal(warnings.length, 1);
  assert.doesNotMatch(warnings[0], /holdout-marked/);
  rmSync(root, { recursive: true, force: true });
});

test("a non-functional MUST assertion bullet is an assertion, not prose — no warning", () => {
  const root = scratch();
  const spec = specFile(root, ["## Scenarios", "", ...GWT, "", "- p99 latency MUST be < 200ms", "", ...DONE].join("\n"));
  assert.equal(proseWarnings(admissible(root, spec, true)).length, 0);
  rmSync(root, { recursive: true, force: true });
});

test("the advisory never flips admissible or the exit code: verdict, checks and other warnings equal those with the prose unit removed", () => {
  const root = scratch();
  const withIt = specFile(root, HOLDOUT_PROSE_SPEC, "with-it.md");
  const without = specFile(root, ["## Scenarios", "", ...GWT, "", ...DONE].join("\n"), "without.md");
  const withV = admissible(root, withIt, true);
  const withoutV = admissible(root, without, true);
  assert.equal(withV.admissible, withoutV.admissible);
  assert.deepEqual(withV.checks.map((c) => ({ id: c.id, pass: c.pass })), withoutV.checks.map((c) => ({ id: c.id, pass: c.pass })));
  const others = (v) => v.warnings.filter((w) => !w.startsWith("scenarios-prose advisory:"));
  assert.deepEqual(others(withV), others(withoutV));
  rmSync(root, { recursive: true, force: true });
});

test("order: the scenarios-prose line follows the scenarios-code-surface line", () => {
  const root = scratch();
  const spec = specFile(root, ["## Scenarios", "", "```", "Given a", "When b", "Then `test/a.test.mjs` MUST pass", "```", "", ...HOLDOUT_NO_THEN, "", ...DONE].join("\n"));
  const warnings = admissible(root, spec, true).warnings;
  const iSurface = warnings.findIndex((w) => w.startsWith("scenarios-code-surface advisory:"));
  const iProse = warnings.findIndex((w) => w.startsWith("scenarios-prose advisory:"));
  assert.ok(iSurface >= 0 && iProse === iSurface + 1, JSON.stringify(warnings));
  rmSync(root, { recursive: true, force: true });
});

test("classify is unchanged: a prose Scenarios unit stays class prose, holdout true, running-stack tier, holdout verifier", () => {
  const root = scratch();
  const spec = specFile(root, HOLDOUT_PROSE_SPEC);
  const c = classify(root, spec);
  const scen = c.criteria.find((x) => x.id === "scenarios:2");
  assert.equal(scen.class, "prose");
  assert.equal(scen.holdout, true);
  assert.equal(scen.verification_tier, "running-stack");
  assert.equal(scen.verifier, "holdout");
  rmSync(root, { recursive: true, force: true });
});
