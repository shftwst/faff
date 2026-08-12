// FAFF-214 — plugin/skills/faff/bin/lib/pr-body.js: the deterministic PR-body
// citation-hygiene sanitizer/checker. Linear's GitHub integration auto-transitions
// any tracker-recognisable identifier it finds in a PR body — including a sibling
// issue the body only CITES, not targets — so this is the single prevention point:
// only the target issue may keep a Linear-recognisable ASCII identifier in the
// final bytes, as the sole closing `Closes <TARGET-ID>` line.
//
// Exercises: the pure functions directly, the committed fixtures (repeated target
// in AC text, sibling in a link destination, multiple prefixes, no siblings +
// idempotence, inline/fenced code), the real CLI subprocess (stdin/stdout/exit,
// --selftest), malformed input, checker failures, and — per FAFF-214 §4 — that the
// faff-graft Step 9b block's git-only no-op guard textually precedes the sanitizer
// invocation, so the documented no-op cannot silently disappear.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { runCli, repoRoot } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const mod = require(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "plugin", "skills", "faff", "bin", "lib", "pr-body.js",
));
const { sanitizePrBody, checkPrBody, PrBodyError, prBodySelftest } = mod;

const FIXTURES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "pr-body");
const readFixture = (name, ext) => fs.readFileSync(path.join(FIXTURES_DIR, `${name}.${ext}.md`), "utf8");

// --- the selftest table runs green (pure, no filesystem/tracker/network) ---
test("pr-body selftest table: every case passes", () => {
  assert.equal(prBodySelftest(), 0);
});

// --- committed fixtures: sanitize(input) === expected, byte-for-byte ---
const FIXTURE_NAMES = ["repeated-target", "link-destination", "multiple-prefixes", "no-siblings", "code-blocks"];

for (const name of FIXTURE_NAMES) {
  test(`fixture ${name}: sanitize(input) matches expected`, () => {
    const input = readFixture(name, "input");
    const expected = readFixture(name, "expected");
    assert.equal(sanitizePrBody(input, "FAFF-900"), expected);
  });

  test(`fixture ${name}: check(expected) passes`, () => {
    const expected = readFixture(name, "expected");
    assert.deepEqual(checkPrBody(expected, "FAFF-900"), { ok: true, violations: [] });
  });

  test(`fixture ${name}: sanitize is idempotent — sanitize(expected) === expected`, () => {
    const expected = readFixture(name, "expected");
    assert.equal(sanitizePrBody(expected, "FAFF-900"), expected);
  });
}

// --- fixture-specific content assertions (the rules the fixtures exist to prove) ---
test("repeated-target: exactly one ASCII target occurrence, in the closing line", () => {
  const out = sanitizePrBody(readFixture("repeated-target", "input"), "FAFF-900");
  const asciiOccurrences = out.match(/\bFAFF-900\b/g) || [];
  assert.equal(asciiOccurrences.length, 1);
  assert.ok(out.trimEnd().endsWith("Closes FAFF-900"));
  assert.match(out, /FAFF‑900/); // U+2011 form for the earlier/prose mentions
});

test("link-destination: sibling hyphen is percent-encoded inside the URL, raw key is gone", () => {
  const out = sanitizePrBody(readFixture("link-destination", "input"), "FAFF-900");
  assert.match(out, /https:\/\/linear\.app\/team\/issue\/OPS%2D42\/slug/);
  assert.doesNotMatch(out, /OPS-42/);
});

test("multiple-prefixes: every non-target prefix converts, regardless of shape", () => {
  const out = sanitizePrBody(readFixture("multiple-prefixes", "input"), "FAFF-900");
  assert.match(out, /FAFF‑19/);
  assert.match(out, /OPS‑42/);
  assert.match(out, /APP7‑3/);
  assert.doesNotMatch(out, /\bFAFF-19\b|\bOPS-42\b|\bAPP7-3\b/);
});

test("code-blocks: inline code and fenced code sibling mentions both convert", () => {
  const out = sanitizePrBody(readFixture("code-blocks", "input"), "FAFF-900");
  assert.match(out, /`FAFF‑19`/);
  assert.match(out, /command output referencing FAFF‑82/);
});

// --- malformed target ---
test("sanitize throws PrBodyError on a malformed target", () => {
  assert.throws(() => sanitizePrBody("body\n", "not-a-target"), PrBodyError);
});
test("check throws PrBodyError on a malformed target", () => {
  assert.throws(() => checkPrBody("body\n", "not-a-target"), PrBodyError);
});

// --- checker failures (each broken rule, one at a time) ---
test("check fails: target missing entirely", () => {
  const r = checkPrBody("No target here.\n", "FAFF-900");
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.rule === "missing-target"));
});
test("check fails: target occurs more than once", () => {
  const r = checkPrBody("FAFF-900 and again FAFF-900.\n", "FAFF-900");
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.rule === "target-count"));
});
test("check fails: a sibling token remains", () => {
  const r = checkPrBody("Cites FAFF-19.\n\nCloses FAFF-900\n", "FAFF-900");
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.rule === "sibling-token-present"));
});
test("check fails: no trailing newline", () => {
  const r = checkPrBody("Prose.\n\nCloses FAFF-900", "FAFF-900");
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.rule === "trailing-newline"));
});
test("check violation diagnostics never echo body content", () => {
  const r = checkPrBody("Cites FAFF-19 about a secret rollout plan.\n\nCloses FAFF-900\n", "FAFF-900");
  const dump = JSON.stringify(r);
  assert.doesNotMatch(dump, /secret rollout plan/);
});

// --- the CLI seam: exactly as faff-graft Step 9b invokes it ---
test("CLI --selftest exits 0", () => {
  assert.equal(runCli(["pr-body", "--selftest"]).code, 0);
});
test("CLI sanitize reads stdin, writes stdout, exits 0", () => {
  const r = runCli(["pr-body", "sanitize", "--target", "FAFF-900"], { input: "See FAFF-900 and FAFF-19.\n" });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "See FAFF‑900 and FAFF‑19.\n\nCloses FAFF-900\n");
});
test("CLI check exits 0 on a valid sanitized body", () => {
  const r = runCli(["pr-body", "check", "--target", "FAFF-900"], { input: "See FAFF‑900 and FAFF‑19.\n\nCloses FAFF-900\n" });
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, violations: [] });
});
test("CLI check exits 1 on an unsanitized body (sibling still ASCII)", () => {
  const r = runCli(["pr-body", "check", "--target", "FAFF-900"], { input: "Cites FAFF-19.\n\nCloses FAFF-900\n" });
  assert.equal(r.code, 1);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, false);
});
test("CLI exits 2 on a malformed --target", () => {
  const r = runCli(["pr-body", "sanitize", "--target", "nope"], { input: "x\n" });
  assert.equal(r.code, 2);
});
test("CLI exits 2 on a missing --target", () => {
  const r = runCli(["pr-body", "sanitize"], { input: "x\n" });
  assert.equal(r.code, 2);
});
test("CLI exits 2 on an unknown mode", () => {
  const r = runCli(["pr-body", "frobnicate", "--target", "FAFF-900"], { input: "x\n" });
  assert.equal(r.code, 2);
});
test("CLI sanitize round-trip on the repeated-target fixture matches the committed expected file", () => {
  const input = readFixture("repeated-target", "input");
  const expected = readFixture("repeated-target", "expected");
  const r = runCli(["pr-body", "sanitize", "--target", "FAFF-900"], { input });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, expected);
});

// --- FAFF-214 §4: the faff-graft Step 9b block's git-only no-op guard must
// textually precede the sanitizer invocation, so the documented no-op cannot
// silently disappear or be reordered behind the sanitize/check/gh sequence. ---
test("faff-graft SKILL.md Step 9b: the git-only no-op guard precedes the pr-body sanitize invocation", () => {
  const skillPath = path.join(repoRoot, "plugin", "skills", "faff-graft", "SKILL.md");
  const text = fs.readFileSync(skillPath, "utf8");

  const stepStart = text.indexOf("**Step 9b: Open the PR");
  assert.ok(stepStart >= 0, "Step 9b heading not found in faff-graft/SKILL.md");
  // Bound the search to the Step 9b section (up to the next "**Step" or "###" heading).
  const nextHeading = text.indexOf("\n**Step ", stepStart + 1);
  const section = nextHeading === -1 ? text.slice(stepStart) : text.slice(stepStart, nextHeading);

  const gitOnlyIdx = section.search(/Git-only mode[^.]*no-op[^.]*does not compose a PR body[^.]*invoke `pr-body`/);
  const sanitizeInvokeIdx = section.indexOf("pr-body sanitize --target");
  assert.ok(gitOnlyIdx >= 0, "git-only no-op guard sentence not found in Step 9b");
  assert.ok(sanitizeInvokeIdx >= 0, "pr-body sanitize invocation not found in Step 9b");
  assert.ok(gitOnlyIdx < sanitizeInvokeIdx, "git-only no-op guard must precede the sanitizer invocation");

  // The sequence also names check + gh pr create --body-file, per FAFF-214 §3/§4.
  assert.match(section, /pr-body check --target/);
  assert.match(section, /gh pr create --body-file/);
});
