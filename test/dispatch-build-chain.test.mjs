// The build-lane chains behind `faff dispatch resolve build` (FAFF-417 tier matchers, FAFF-334
// confidence matcher, FAFF-1198 form). Covers: the pure resolver's model and effort chains over
// `dispatch.build.*`; tier-outranks-confidence precedence; absent-tier fall-through (never guesses
// a tier; effort still consults by_tier.default); field independence; fail-loud leaf validation
// naming the legal set; `config resolved` echoing every configured by_tier leaf; and no change
// to the no-matcher answer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import { resolveDispatch } from "../plugin/skills/faff/bin/lib/dispatch.js";

function fixtureDir(faffrcBody) {
  const dir = mkdtempSync(path.join(tmpdir(), "faff417-bytier-"));
  if (faffrcBody !== undefined) writeFileSync(path.join(dir, ".faffrc.yaml"), faffrcBody);
  return dir;
}

const build = (cfg, tier, confidence) => resolveDispatch({ dispatch: { build: cfg } }, "build", { tier, confidence });
const resolveBuild = (dir, ...flags) => runCli(["dispatch", "resolve", "build", ...flags], { cwd: dir });
const pairOf = (dir, ...flags) => {
  const r = resolveBuild(dir, ...flags);
  assert.equal(r.code, 0, r.stderr);
  return JSON.parse(r.stdout);
};

// ── pure resolver: model precedence ──

const LAYERED = {
  model: "opus",
  by_tier: { mechanical: { model: "haiku" }, default: { model: "fable" } },
  by_confidence: { default: { model: "opus" }, high: { model: "sonnet" } },
};

test("resolveDispatch build: tier matcher outranks confidence matcher when both configured and tier present", () => {
  assert.equal(build(LAYERED, "mechanical", "high").model, "haiku", "tier leaf wins over confidence leaf");
});

test("resolveDispatch build: absent tier skips the tier matcher entirely, falls through to confidence", () => {
  assert.equal(build(LAYERED, null, "high").model, "sonnet", "no tier passed -> confidence matcher, never guesses a tier");
});

test("resolveDispatch build: a tier with no leaf takes by_tier.default before the confidence matcher", () => {
  assert.equal(build(LAYERED, "standard", "high").model, "fable");
});

test("resolveDispatch build: legacy spec (no build-tier) + tier matcher configured -> tier matcher skipped, falls through cleanly", () => {
  const cfg = { model: "haiku", by_tier: { mechanical: { model: "sonnet" } } };
  assert.equal(build(cfg, undefined, null).model, "haiku", "falls through past the unmatched tier matcher straight to the scalar");
});

test("resolveDispatch build: tier given but no tier matcher -> falls through to the confidence matcher", () => {
  const cfg = { model: "opus", by_confidence: { default: { model: "opus" }, high: { model: "sonnet" } } };
  assert.equal(build(cfg, "mechanical", "high").model, "sonnet");
});

test("resolveDispatch build: no matchers -> the scalar / inherit chain", () => {
  assert.equal(build({ model: "fable" }, "mechanical", "high").model, "fable");
  assert.equal(build({}, "mechanical", "high").model, "inherit");
  assert.equal(resolveDispatch({}, "build").model, "inherit");
});

test("resolveDispatch build: bucket keys match case-insensitively", () => {
  const cfg = { by_tier: { MECHANICAL: { model: "haiku", effort: "low" } } };
  assert.deepEqual(build(cfg, "mechanical", null), { model: "haiku", effort: "low" });
  assert.equal(build(cfg, "Mechanical", null).model, "haiku");
});

test("resolveDispatch build: invalid token in ANY leaf (including a tier that never resolves) fails loud at first resolution", () => {
  const cfg = { by_tier: { mechanical: { model: "sonnet" }, complex: { model: "gpt-5" } } };
  const res = build(cfg, "mechanical", null);
  assert.ok(res.error, "an invalid unused leaf must not be left dormant");
  assert.match(res.error, /gpt-5/);
  assert.match(res.error, /sonnet \| opus \| haiku \| fable/);
});

test("resolveDispatch build: an invalid tier-matcher leaf fails loud even with no tier passed at all", () => {
  assert.ok(build({ by_tier: { mechanical: { model: "gpt-5" } } }, null, null).error);
});

// ── pure resolver: effort chain and field independence ──

const EFFORT_CHAIN = {
  effort: "medium",
  by_tier: { default: { effort: "medium" }, mechanical: { effort: "low" }, complex: { effort: "high" } },
};

test("resolveDispatch build: effort resolves by tier leaf, then by_tier.default, then the scalar, then inherit", () => {
  assert.equal(build(EFFORT_CHAIN, "mechanical", null).effort, "low");
  assert.equal(build(EFFORT_CHAIN, "complex", null).effort, "high");
  assert.equal(build(EFFORT_CHAIN, "standard", null).effort, "medium", "no leaf -> by_tier.default");
  assert.equal(build(EFFORT_CHAIN, "MECHANICAL", null).effort, "low", "case-insensitive");
  assert.equal(build({ effort: "low", by_tier: { default: { effort: "high" } } }, "mechanical", null).effort, "high", "default beats the scalar");
  assert.equal(build({ effort: "low" }, "mechanical", null).effort, "low", "no matcher -> scalar");
  assert.equal(build({}, "mechanical", null).effort, "inherit");
  assert.equal(resolveDispatch({}, "build", { tier: "mechanical" }).effort, "inherit");
});

test("resolveDispatch build: tier absent still consults by_tier.default for effort", () => {
  assert.equal(build(EFFORT_CHAIN, null, null).effort, "medium");
  assert.equal(build({ effort: "low", by_tier: { complex: { effort: "high" } } }, null, null).effort, "low");
});

test("resolveDispatch build: a by_tier node holding only effort lets model fall through the rest of the chain", () => {
  const cfg = { model: "sonnet", by_tier: { complex: { effort: "high" } }, by_confidence: { medium: { model: "haiku" } } };
  assert.deepEqual(build(cfg, "complex", "medium"), { model: "haiku", effort: "high" });
  assert.deepEqual(build({ model: "sonnet", by_tier: { complex: { effort: "high" } } }, "complex", null), { model: "sonnet", effort: "high" });
});

test("resolveDispatch build: invalid effort tokens fail loud, in any leaf, and a model token is not an effort", () => {
  assert.ok(build({ by_tier: { mechanical: { effort: "bogus" } } }, "mechanical", null).error);
  assert.ok(build({ by_tier: { mechanical: { effort: "bogus" }, default: { effort: "low" } } }, "complex", null).error, "unused leaf");
  assert.ok(build({ effort: "bogus" }, null, null).error);
  assert.ok(build({ by_tier: { mechanical: { effort: "sonnet" } } }, "mechanical", null).error, "distinct vocabularies");
});

// ── CLI surface: faff dispatch resolve build --tier/--confidence ──

const BOTH_MATCHERS = [
  "dispatch:",
  "  build:",
  "    model: opus",
  "    effort: medium",
  "    by_tier:",
  "      default:",
  "        model: fable",
  "        effort: medium",
  "      mechanical:",
  "        model: haiku",
  "        effort: low",
  "      complex:",
  "        model: opus",
  "        effort: high",
  "    by_confidence:",
  "      default:",
  "        model: opus",
  "      high:",
  "        model: sonnet",
  "",
].join("\n");

test("dispatch resolve build --tier resolves via the by_tier matcher", () => {
  const dir = fixtureDir(BOTH_MATCHERS);
  try {
    assert.deepEqual(pairOf(dir, "--tier", "mechanical"), { model: "haiku", effort: "low" });
    assert.deepEqual(pairOf(dir, "--tier", "complex"), { model: "opus", effort: "high" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("dispatch resolve build --tier + --confidence: tier wins (the two matchers return DIFFERENT tokens)", () => {
  const dir = fixtureDir(BOTH_MATCHERS);
  try {
    assert.equal(pairOf(dir, "--tier", "mechanical", "--confidence", "high").model, "haiku", "the tier leaf (haiku), not the confidence leaf (sonnet)");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("dispatch resolve build with NO --tier falls through to --confidence for model and by_tier.default for effort", () => {
  const dir = fixtureDir(BOTH_MATCHERS);
  try {
    assert.deepEqual(pairOf(dir, "--confidence", "high"), { model: "sonnet", effort: "medium" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("dispatch resolve build with no flags falls through to by_confidence.default and the effort chain", () => {
  const dir = fixtureDir(BOTH_MATCHERS);
  try {
    assert.deepEqual(pairOf(dir), { model: "opus", effort: "medium" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── Integration smoke test: the full attach -> route -> unset flow ──

test("integration smoke: faff tier -> set matchers -> dispatch resolve build --tier -> unset matchers -> inherit", () => {
  const dir = fixtureDir();
  const specFile = path.join(dir, "fixture-spec.md");
  writeFileSync(specFile, "# Spec\n\nconfidence: high\n\n- [x] one\n\nGiven a thing\n");
  try {
    const tierResult = runCli(["tier", specFile]);
    assert.equal(tierResult.code, 0);
    const tierToken = tierResult.stdout.trim();
    assert.match(tierToken, /^(mechanical|standard|complex)$/);

    writeFileSync(path.join(dir, ".faffrc.yaml"),
      `dispatch:\n  build:\n    by_tier:\n      ${tierToken}:\n        model: sonnet\n        effort: low\n`);
    assert.deepEqual(pairOf(dir, "--tier", tierToken), { model: "sonnet", effort: "low" });

    // Unset the matcher — rerun resolves to inherit, unchanged from a repo that never set one.
    writeFileSync(path.join(dir, ".faffrc.yaml"), "tracking:\n  team_key: X\n");
    assert.deepEqual(pairOf(dir, "--tier", tierToken), { model: "inherit", effort: "inherit" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── Fail-loud: invalid token anywhere in a by_tier matcher ──

test("dispatch resolve build fails loud on an invalid by_tier model leaf (exit 2, names value + legal set)", () => {
  const dir = fixtureDir("dispatch:\n  build:\n    by_tier:\n      mechanical:\n        model: gpt-5\n");
  try {
    const bad = resolveBuild(dir, "--tier", "mechanical");
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /gpt-5/);
    assert.match(bad.stderr, /sonnet \| opus \| haiku \| fable/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("dispatch resolve build fails loud on an invalid leaf even for a tier that never resolves", () => {
  const dir = fixtureDir("dispatch:\n  build:\n    by_tier:\n      mechanical:\n        model: sonnet\n      complex:\n        model: gpt-5\n");
  try {
    const bad = resolveBuild(dir, "--tier", "mechanical");
    assert.equal(bad.code, 2, "an unused-but-invalid leaf must still fail loud at first resolution");
    assert.match(bad.stderr, /gpt-5/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("dispatch resolve build fails loud on an invalid by_tier effort leaf (exit 2, names value + legal set)", () => {
  const dir = fixtureDir("dispatch:\n  build:\n    by_tier:\n      mechanical:\n        effort: bogus\n");
  try {
    const bad = resolveBuild(dir, "--tier", "mechanical");
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /bogus/);
    assert.match(bad.stderr, /inherit \| low \| medium \| high \| xhigh \| max/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config get reads a dispatch.build.by_tier leaf directly", () => {
  const dir = fixtureDir(BOTH_MATCHERS);
  try {
    assert.equal(runCli(["config", "get", "dispatch.build.by_tier.mechanical.model"], { cwd: dir }).stdout.trim(), "haiku");
    assert.equal(runCli(["config", "get", "dispatch.build.by_tier.complex.effort"], { cwd: dir }).stdout.trim(), "high");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── config resolved echoes every configured by_tier leaf ──

test("config resolved echoes every configured dispatch.build.by_tier leaf", () => {
  const dir = fixtureDir(BOTH_MATCHERS);
  try {
    const r = runCli(["config", "resolved"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /dispatch build\.by_tier\.default: model=fable effort=medium/);
    assert.match(r.stdout, /dispatch build\.by_tier\.mechanical: model=haiku effort=low/);
    assert.match(r.stdout, /dispatch build\.by_tier\.complex: model=opus effort=high/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config resolved with no by_tier config emits no build.by_tier line (no-config byte-identity)", () => {
  const dir = fixtureDir("tracking:\n  team_key: X\n");
  try {
    const r = runCli(["config", "resolved"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.stdout, /by_tier/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("dispatch resolve build with only a scalar model and no by_tier config is unchanged", () => {
  const dir = fixtureDir("dispatch:\n  build:\n    model: sonnet\n");
  try {
    assert.deepEqual(pairOf(dir, "--confidence", "high"), { model: "sonnet", effort: "inherit" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("dispatch --selftest passes", () => {
  assert.equal(runCli(["dispatch", "--selftest"]).code, 0);
});
