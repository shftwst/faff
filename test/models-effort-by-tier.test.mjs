// FAFF-417 — models.build_by_tier / effort.build_by_tier: the per-issue build routing
// matchers keyed on the deterministic prep-time build-tier. Covers: `faff models
// build-for --tier/--confidence` and `faff effort build-for --tier` CLI surfaces; the
// tier-outranks-confidence precedence when both matchers are configured; absent-tier
// fall-through (never guesses a tier); fail-loud up-front leaf validation naming the legal
// set; `config resolved` echoing every configured `*_by_tier` leaf; and byte-for-byte
// preservation of the FAFF-334/FAFF-416 paths when no `*_by_tier` matcher is configured.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import { resolveBuildModelForIssue, resolveBuildModelForTier } from "../plugin/skills/faff/bin/lib/config.js";
import { resolveBuildEffort } from "../plugin/skills/faff/bin/lib/effort.js";

function fixtureDir(faffrcBody) {
  const dir = mkdtempSync(path.join(tmpdir(), "faff417-bytier-"));
  if (faffrcBody !== undefined) writeFileSync(path.join(dir, ".faffrc.yaml"), faffrcBody);
  return dir;
}

// ── pure resolver: precedence ──

test("resolveBuildModelForIssue: tier matcher outranks confidence matcher when both configured and tier present", () => {
  const cfg = {
    models: {
      build: "opus",
      build_by_tier: { mechanical: "haiku", default: "fable" },
      build_by_confidence: { default: "opus", high: "sonnet" },
    },
  };
  assert.equal(resolveBuildModelForIssue(cfg, "mechanical", "high").token, "haiku", "tier leaf wins over confidence leaf");
});

test("resolveBuildModelForIssue: absent tier skips the tier matcher entirely, falls through to confidence (logged fall-through)", () => {
  const cfg = {
    models: {
      build: "opus",
      build_by_tier: { mechanical: "haiku", default: "fable" },
      build_by_confidence: { default: "opus", high: "sonnet" },
    },
  };
  const res = resolveBuildModelForIssue(cfg, null, "high");
  assert.equal(res.token, "sonnet", "no tier passed -> falls through to the confidence matcher, never guesses a tier");
});

test("resolveBuildModelForIssue: legacy spec (no build-tier) + tier matcher configured -> tier matcher skipped, falls through cleanly", () => {
  // "no build-tier retained line" is modelled as tierVal === null/undefined at the call site
  // (the orchestrator never invents one) — same path as the absent-tier case above.
  const cfg = { models: { build: "haiku", build_by_tier: { mechanical: "sonnet" } } };
  const res = resolveBuildModelForIssue(cfg, undefined, null);
  assert.equal(res.token, "haiku", "falls through past the unmatched tier matcher straight to the scalar");
});

test("resolveBuildModelForIssue: both matchers absent -> byte-for-byte the FAFF-334 scalar/inherit chain", () => {
  assert.equal(resolveBuildModelForIssue({ models: { build: "fable" } }, "mechanical", "high").token, "fable");
  assert.equal(resolveBuildModelForIssue({ models: {} }, "mechanical", "high").token, "inherit");
  assert.equal(resolveBuildModelForIssue({}, null, null).token, "inherit");
});

test("resolveBuildModelForTier: invalid token in ANY leaf (including a tier that never resolves) fails loud at first resolution", () => {
  const cfg = { models: { build_by_tier: { mechanical: "sonnet", complex: "gpt-5" } } };
  // Resolve for "mechanical" — a leaf that WOULD succeed — but the "complex" leaf (never
  // touched by this resolution) is still invalid and must fail loud anyway.
  const res = resolveBuildModelForTier(cfg, "mechanical");
  assert.ok(res && res.error, "an invalid unused leaf must not be left dormant");
  assert.match(res.error, /gpt-5/);
  assert.match(res.error, /sonnet \| opus \| haiku \| fable/);
});

// ── CLI surface: faff models build-for --tier/--confidence ──

const BOTH_MATCHERS = [
  "models:",
  "  build: opus",
  "  build_by_tier:",
  "    default: fable",
  "    mechanical: haiku",
  "    complex: opus",
  "  build_by_confidence:",
  "    default: opus",
  "    high: sonnet",
  "effort:",
  "  build: medium",
  "  build_by_tier:",
  "    default: medium",
  "    mechanical: low",
  "    complex: high",
  "",
].join("\n");

test("faff models build-for --tier resolves via the by_tier matcher", () => {
  const dir = fixtureDir(BOTH_MATCHERS);
  try {
    assert.equal(runCli(["models", "build-for", "--tier", "mechanical"], { cwd: dir }).stdout.trim(), "haiku");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("faff models build-for --tier + --confidence: tier wins (the two matchers return DIFFERENT tokens)", () => {
  const dir = fixtureDir(BOTH_MATCHERS);
  try {
    const r = runCli(["models", "build-for", "--tier", "mechanical", "--confidence", "high"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), "haiku", "the tier leaf (haiku), not the confidence leaf (sonnet)");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("faff models build-for with NO --tier falls through to --confidence (still resolves, no error)", () => {
  const dir = fixtureDir(BOTH_MATCHERS);
  try {
    const r = runCli(["models", "build-for", "--confidence", "high"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), "sonnet");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("faff effort build-for --tier resolves via the by_tier matcher", () => {
  const dir = fixtureDir(BOTH_MATCHERS);
  try {
    assert.equal(runCli(["effort", "build-for", "--tier", "mechanical"], { cwd: dir }).stdout.trim(), "low");
    assert.equal(runCli(["effort", "build-for", "--tier", "complex"], { cwd: dir }).stdout.trim(), "high");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("faff effort build-for with no --tier falls through to the effort.build scalar", () => {
  const dir = fixtureDir(BOTH_MATCHERS);
  try {
    assert.equal(runCli(["effort", "build-for"], { cwd: dir }).stdout.trim(), "medium");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── Integration smoke test (spec §8): the full attach -> route -> unset flow ──

test("integration smoke: faff tier -> set matchers -> models/effort build-for --tier -> unset matchers -> scalar/inherit unchanged", () => {
  const dir = fixtureDir();
  const specFile = path.join(dir, "fixture-spec.md");
  writeFileSync(specFile, "# Spec\n\nconfidence: high\n\n- [x] one\n\nGiven a thing\n");
  try {
    const tierResult = runCli(["tier", specFile]);
    assert.equal(tierResult.code, 0);
    const tierToken = tierResult.stdout.trim();
    assert.match(tierToken, /^(mechanical|standard|complex)$/);

    writeFileSync(path.join(dir, ".faffrc.yaml"),
      `models:\n  build_by_tier:\n    ${tierToken}: sonnet\neffort:\n  build_by_tier:\n    ${tierToken}: low\n`);
    assert.equal(runCli(["models", "build-for", "--tier", tierToken], { cwd: dir }).stdout.trim(), "sonnet");
    assert.equal(runCli(["effort", "build-for", "--tier", tierToken], { cwd: dir }).stdout.trim(), "low");

    // Unset both matchers — rerun resolves to scalar/inherit, unchanged from today.
    writeFileSync(path.join(dir, ".faffrc.yaml"), "tracking:\n  team_key: X\n");
    assert.equal(runCli(["models", "build-for", "--tier", tierToken], { cwd: dir }).stdout.trim(), "inherit");
    assert.equal(runCli(["effort", "build-for", "--tier", tierToken], { cwd: dir }).stdout.trim(), "inherit");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── Fail-loud: invalid token anywhere in a *_by_tier matcher ──

test("faff models build-for fails loud on an invalid models.build_by_tier leaf (exit 2, names value + legal set)", () => {
  const dir = fixtureDir("models:\n  build_by_tier:\n    mechanical: gpt-5\n");
  try {
    const bad = runCli(["models", "build-for", "--tier", "mechanical"], { cwd: dir });
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /gpt-5/);
    assert.match(bad.stderr, /sonnet \| opus \| haiku \| fable/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("faff models build-for fails loud on an invalid leaf even for a tier that never resolves", () => {
  const dir = fixtureDir("models:\n  build_by_tier:\n    mechanical: sonnet\n    complex: gpt-5\n");
  try {
    const bad = runCli(["models", "build-for", "--tier", "mechanical"], { cwd: dir });
    assert.equal(bad.code, 2, "an unused-but-invalid leaf must still fail loud at first resolution");
    assert.match(bad.stderr, /gpt-5/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("faff effort build-for fails loud on an invalid effort.build_by_tier leaf (exit 2, names value + legal set)", () => {
  const dir = fixtureDir("effort:\n  build_by_tier:\n    mechanical: bogus\n");
  try {
    const bad = runCli(["effort", "build-for", "--tier", "mechanical"], { cwd: dir });
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /bogus/);
    assert.match(bad.stderr, /inherit \| low \| medium \| high \| xhigh \| max/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config get resolves a models.build_by_tier / effort.build_by_tier leaf directly", () => {
  const dir = fixtureDir(BOTH_MATCHERS);
  try {
    assert.equal(runCli(["config", "get", "models.build_by_tier.mechanical"], { cwd: dir }).stdout.trim(), "haiku");
    assert.equal(runCli(["config", "get", "effort.build_by_tier.complex"], { cwd: dir }).stdout.trim(), "high");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── config resolved echoes every configured *_by_tier leaf ──

test("faff config resolved echoes every configured models.build_by_tier / effort.build_by_tier leaf", () => {
  const dir = fixtureDir(BOTH_MATCHERS);
  try {
    const r = runCli(["config", "resolved"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /model build_by_tier\.default: fable/);
    assert.match(r.stdout, /model build_by_tier\.mechanical: haiku/);
    assert.match(r.stdout, /model build_by_tier\.complex: opus/);
    assert.match(r.stdout, /effort build_by_tier\.default: medium/);
    assert.match(r.stdout, /effort build_by_tier\.mechanical: low/);
    assert.match(r.stdout, /effort build_by_tier\.complex: high/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("faff config resolved with no *_by_tier config emits no build_by_tier line (no-config byte-identity)", () => {
  const dir = fixtureDir("tracking:\n  team_key: X\n");
  try {
    const r = runCli(["config", "resolved"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.stdout, /build_by_tier/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── Byte-for-byte preservation: the existing FAFF-334/FAFF-416 test suites are the
// authoritative regression guard (test/models-config.test.mjs, test/effort-config.test.mjs)
// — this suite does not duplicate them, it only asserts the NEW surfaces are additive.

test("faff models build-for high (bare positional, no *_by_tier config anywhere) is unchanged", () => {
  const dir = fixtureDir("models:\n  build: sonnet\n");
  try {
    assert.equal(runCli(["models", "build-for", "high"], { cwd: dir }).stdout.trim(), "sonnet");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("faff models --selftest / faff effort --selftest both pass", () => {
  assert.equal(runCli(["models", "--selftest"]).code, 0);
  assert.equal(runCli(["effort", "--selftest"]).code, 0);
});
