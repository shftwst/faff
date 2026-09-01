// FAFF-34/275 — the `faff dod` subcommand: classify a spec's DoD criteria by
// born-verifiability class, and (FAFF-275) split off the holdout-marked subset
// into a builder view. Pure, no tracker/network/LLM — parity with `faff admissible`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");

const run = (args, stdin = "") =>
  spawnSync(process.execPath, [BIN, "dod", ...args], { cwd: REPO, encoding: "utf8", input: stdin });

const HOLDOUT_SPEC = [
  "## Scenarios", "",
  "```holdout",
  "Given a fenced holdout scenario",
  "When it runs",
  "Then it is withheld from the builder",
  "```", "",
  "```",
  "Given a plain visible scenario",
  "When it runs",
  "Then it is NOT withheld",
  "```", "",
  "- holdout: The p99 latency MUST be < 200ms",
  "- The onboarding copy reads warmly",
  "",
  "## 8. DONE", "",
  "- [ ] the parser returns >=1 item",
].join("\n");

test("--selftest table passes (exit 0)", () => {
  const r = run(["--selftest"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /dod --selftest: ok/);
});

test("dod classify: emits per-criterion holdout + top-level holdout_counts, counts unchanged shape", () => {
  const r = run(["classify", "--spec", "-", "--json"], HOLDOUT_SPEC);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  const scen = out.criteria.filter((c) => c.source === "scenarios");
  assert.ok(scen.some((c) => c.holdout === true && /withheld from the builder/.test(c.text)));
  assert.ok(scen.some((c) => c.holdout === false && /NOT withheld/.test(c.text)));
  assert.ok(scen.some((c) => c.text === "The p99 latency MUST be < 200ms" && c.holdout === true));
  assert.equal(out.holdout_counts.holdout, 2);
  assert.equal(out.holdout_counts.holdout + out.holdout_counts.visible, out.criteria.length);
  assert.equal(out.counts.scenario + out.counts.assertion + out.counts.prose, out.criteria.length);
});

const TIER_SPEC = [
  "## Scenarios", "",
  "```integration",
  "Given a migrated database",
  "When the down-migration runs",
  "Then the schema reverts",
  "```", "",
  "- The rollback MUST restore the previous schema",
  "- integration: the reverse migration MUST succeed",
  "- The API MUST return 200 on /healthz",
  "",
  "## 8. DONE", "",
  "- [ ] the parser returns >=1 item",
].join("\n");

test("dod classify (FAFF-961): emits per-criterion verification_tier + top-level verification_tier_counts, existing shape unchanged", () => {
  const r = run(["classify", "--spec", "-", "--json"], TIER_SPEC);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  const scen = out.criteria.filter((c) => c.source === "scenarios");
  // integration fence → integration, class unchanged
  const fenceCrit = scen.find((c) => c.class === "scenario");
  assert.equal(fenceCrit.verification_tier, "integration");
  assert.equal(fenceCrit.class, "scenario");
  // keyword ("rollback") → integration
  assert.ok(scen.some((c) => /rollback/.test(c.text) && c.verification_tier === "integration"));
  // "integration:" prefix stripped + tiered integration
  const prefixCrit = scen.find((c) => /reverse migration/.test(c.text));
  assert.equal(prefixCrit.verification_tier, "integration");
  assert.doesNotMatch(prefixCrit.text, /^integration:/i);
  // conservative default holds for an unmarked running-stack assertion
  assert.ok(scen.some((c) => /healthz/.test(c.text) && c.verification_tier === "running-stack"));
  // every criterion carries a legal tier value
  assert.ok(out.criteria.every((c) => c.verification_tier === "running-stack" || c.verification_tier === "integration"));
  // the new count map sums to criteria.length, and the existing counts are untouched-shape
  assert.equal(out.verification_tier_counts["running-stack"] + out.verification_tier_counts.integration, out.criteria.length);
  assert.equal(out.counts.scenario + out.counts.assertion + out.counts.prose, out.criteria.length);
  assert.equal(out.holdout_counts.holdout + out.holdout_counts.visible, out.criteria.length);
});

test("dod classify (FAFF-961): a marker- and keyword-free spec tiers every criterion running-stack; counts unchanged from today", () => {
  const r = run(["classify", "--spec", "-", "--json"], HOLDOUT_SPEC);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(out.criteria.every((c) => c.verification_tier === "running-stack"));
  assert.equal(out.verification_tier_counts.integration, 0);
  assert.equal(out.verification_tier_counts["running-stack"], out.criteria.length);
  // additive-only: the holdout axis and its counts are unperturbed by the new tier axis
  assert.equal(out.holdout_counts.holdout, 2);
});

test("dod classify: a `holdout:`-prefixed DONE item stays literal, holdout false, stderr advisory", () => {
  const spec = "## Scenarios\n```\nGiven x\nThen y\n```\n\n## 8. DONE\n\n- [ ] holdout: the parser returns >=1 item\n";
  const r = run(["classify", "--spec", "-", "--json"], spec);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  const doneItem = out.criteria.find((c) => c.source === "done");
  assert.equal(doneItem.text, "holdout: the parser returns >=1 item");
  assert.equal(doneItem.holdout, false);
  assert.match(r.stderr, /DONE items are never withheld/);
});

test("dod split --view full is the identity (byte-for-byte)", () => {
  const r = run(["split", "--spec", "-", "--view", "full"], HOLDOUT_SPEC);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, HOLDOUT_SPEC);
});

test("dod split --view builder: omits holdout units, inserts the withheld-count note, keeps the rest", () => {
  const r = run(["split", "--spec", "-", "--view", "builder"], HOLDOUT_SPEC);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /withheld from the builder/);
  assert.doesNotMatch(r.stdout, /p99 latency/);
  assert.match(r.stdout, /NOT withheld/);
  assert.match(r.stdout, /onboarding copy/);
  assert.match(r.stdout, /^## Scenarios\n\n> 2 holdout scenario\(s\) withheld/);
  assert.match(r.stdout, /## 8\. DONE/);
});

test("dod split --view builder: a marker-free spec is a byte-identical no-op", () => {
  const spec = "## Scenarios\n```\nGiven x\nThen y\n```\n\n## 8. DONE\n\n- [ ] the parser returns >=1 item\n";
  const r = run(["split", "--spec", "-", "--view", "builder"], spec);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, spec);
});

test("dod split --view builder: a marker outside the Scenarios section is not recognised", () => {
  const spec = "## Scenarios\n```\nGiven x\nThen y\n```\n\n## 8. DONE\n\n- [ ] holdout: the parser returns >=1 item\n";
  const r = run(["split", "--spec", "-", "--view", "builder"], spec);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, spec);
});

test("dod split: coherence invariant — classify(split(spec, builder)) == full classification minus holdout criteria", () => {
  const full = JSON.parse(run(["classify", "--spec", "-", "--json"], HOLDOUT_SPEC).stdout);
  const builderText = run(["split", "--spec", "-", "--view", "builder"], HOLDOUT_SPEC).stdout;
  const builderClassified = JSON.parse(run(["classify", "--spec", "-", "--json"], builderText).stdout);
  const expected = full.criteria.filter((c) => !c.holdout);
  assert.deepEqual(builderClassified.criteria, expected);
  assert.equal(builderClassified.holdout_counts.holdout, 0);
});

test("dod split: over-withholding fires an advisory on stderr, never a gate (exit 0)", () => {
  const spec = "## Scenarios\n```holdout\nGiven x\nWhen y\nThen z\n```\n\n## 8. DONE\n\n- [ ] the parser returns >=1 item\n";
  const r = run(["split", "--spec", "-", "--view", "builder"], spec);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /over-withholding/);
});

test("dod split: ~~~holdout fences are recognised the same as ```holdout", () => {
  const spec = "## Scenarios\n\n~~~holdout\nGiven x\nWhen y\nThen z\n~~~\n\n## 8. DONE\n\n- [ ] the parser returns >=1 item\n";
  const r = run(["split", "--spec", "-", "--view", "builder"], spec);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /Given x/);
});

test("dod split: missing/unknown --view exits 2 with a usage line", () => {
  const missing = run(["split", "--spec", "-"], HOLDOUT_SPEC);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /usage/);

  const unknown = run(["split", "--spec", "-", "--view", "nonsense"], HOLDOUT_SPEC);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /usage/);
});

test("dod split: an unreadable --spec path exits 2", () => {
  const r = run(["split", "--spec", "/no/such/file/here.md", "--view", "full"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot read spec/);
});

test("dod classify: an unreadable --spec path exits 2", () => {
  const r = run(["classify", "--spec", "/no/such/file/here.md"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot read spec/);
});

test("dod: an unknown action prints usage naming both classify and split, exit 2", () => {
  const r = run(["bogus"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /dod classify/);
  assert.match(r.stderr, /dod split/);
});
