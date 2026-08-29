// FAFF-922 (absorbing FAFF-908) — appetite-scale the spec-review reject loop, exactly as the
// code-review loop's `faff review-iteration-cap` already does. This resolver is a thin CLI
// wrapper that RE-EXPORTS `resolveReviewIterationCap`/`APPETITE_CAP` from review-iteration-cap.js
// (the single authoritative literal source) — it carries no second copy of the 1/3/5/10 map.
//
// Covers: the re-exported resolver (all four appetites + case-insensitivity + fail-loud), the CLI
// subcommand (stdout/exit-code contract, --selftest), and the drift guard — faff-prep/SKILL.md's
// Loop cap paragraph must NAME the resolver, never carry a bare hardcoded loop-cap integer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./helpers/run-cli.mjs";
import {
  APPETITE_CAP,
  resolveReviewIterationCap,
  specReviewIterationCapSelftest,
} from "../plugin/skills/faff/bin/lib/spec-review-iteration-cap.js";
import { APPETITE_CAP as SOURCE_APPETITE_CAP } from "../plugin/skills/faff/bin/lib/review-iteration-cap.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const PREP_SKILL = join(REPO, "plugin", "skills", "faff-prep", "SKILL.md");

test("the re-exported resolver is the canonical 1/3/5/10 table, case-insensitive", () => {
  assert.equal(resolveReviewIterationCap("low").cap, 1);
  assert.equal(resolveReviewIterationCap("medium").cap, 3);
  assert.equal(resolveReviewIterationCap("high").cap, 5);
  assert.equal(resolveReviewIterationCap("full").cap, 10);
  assert.equal(resolveReviewIterationCap("HIGH").cap, 5, "case-insensitive");
  assert.equal(resolveReviewIterationCap("  full  ").cap, 10, "trims whitespace");
});

test("APPETITE_CAP is the SAME object re-exported from review-iteration-cap.js (no second copy)", () => {
  assert.equal(APPETITE_CAP, SOURCE_APPETITE_CAP, "the map must be re-exported, never redeclared");
});

test("unrecognised/absent appetite fails loud, names the legal set", () => {
  const bad = resolveReviewIterationCap("bogus");
  assert.ok(bad.error, "unrecognised appetite must error, never silently default");
  assert.match(bad.error, /low \| medium \| high \| full/);
  const absent = resolveReviewIterationCap(undefined);
  assert.ok(absent.error, "absent appetite must error");
  assert.match(absent.error, /low \| medium \| high \| full/);
});

test("in-process selftest passes", () => {
  assert.equal(specReviewIterationCapSelftest(), 0);
});

test("faff spec-review-iteration-cap --appetite <x> prints the cap on stdout, exit 0", () => {
  for (const [appetite, want] of [["low", "1"], ["medium", "3"], ["high", "5"], ["full", "10"]]) {
    const r = runCli(["spec-review-iteration-cap", "--appetite", appetite]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), want, appetite);
  }
});

test("faff spec-review-iteration-cap: unrecognised appetite exits 2, names the legal set, nothing on stdout", () => {
  const r = runCli(["spec-review-iteration-cap", "--appetite", "bogus"]);
  assert.equal(r.code, 2);
  assert.equal(r.stdout.trim(), "", "no value on stdout for an invalid appetite");
  assert.match(r.stderr, /low \| medium \| high \| full/);
});

test("faff spec-review-iteration-cap: absent --appetite exits 2, names the legal set", () => {
  const r = runCli(["spec-review-iteration-cap"]);
  assert.equal(r.code, 2);
  assert.equal(r.stdout.trim(), "");
  assert.match(r.stderr, /low \| medium \| high \| full/);
});

test("faff spec-review-iteration-cap --selftest exits 0 and reports PASS", () => {
  const r = runCli(["spec-review-iteration-cap", "--selftest"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: PASS/);
});

// --- Drift guard: faff-prep names the resolver, never a bare hardcoded loop-cap integer -----

test("drift guard: faff-prep/SKILL.md's Loop cap paragraph resolves the cap via the resolver", () => {
  const body = readFileSync(PREP_SKILL, "utf8");
  const loopCap = body.split("\n").find((line) => line.startsWith("**Loop cap.**"));
  assert.ok(loopCap, "the Loop cap paragraph must exist");
  assert.match(
    loopCap,
    /faff spec-review-iteration-cap/,
    "the Loop cap must resolve the ceiling via `faff spec-review-iteration-cap`, never state a bare integer",
  );
  // The exact drift this change removes: the fixed-2 form `capped at **N iterations**`.
  assert.doesNotMatch(
    loopCap,
    /capped at \*\*\d+ iterations?\*\*/i,
    "the Loop cap must not restate a bare hardcoded loop-cap integer — it resolves through the resolver",
  );
});