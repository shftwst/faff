// FAFF-341 — single-owner the review fail→fix→review loop bound. Two places used to state
// how many review→fix→review cycles the pipeline attempts before escalating to `needs-human`
// (faff-graft/SKILL.md hardcoded "cap at 3 iterations"; the `review` slot's Appetite integration
// table said 1/3/5/10 by appetite), and at the shipped `appetite: high` they disagreed (3 vs 5).
// This resolver (`faff review-iteration-cap`) is now the SINGLE authoritative literal source;
// graft defers to it instead of restating a per-appetite integer.
//
// Covers: the resolver itself (all four appetites + case-insensitivity), the CLI subcommand
// (stdout/exit-code contract, --selftest), and the drift guard — a `node --test` case that
// fails loud if faff-graft/SKILL.md reintroduces a bare per-appetite review-loop integer, or
// if the reviewer's Appetite integration table disagrees with this resolver's own map.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./helpers/run-cli.mjs";
import {
  APPETITE_CAP,
  resolveReviewIterationCap,
  reviewIterationCapSelftest,
} from "../plugin/skills/faff/bin/lib/review-iteration-cap.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const GRAFT_SKILL = join(REPO, "plugin", "skills", "faff-graft", "SKILL.md");
const REVIEW_SKILL = join(REPO, "plugin", "skills", "faffter-noon-review", "SKILL.md");

test("resolveReviewIterationCap: the canonical 1/3/5/10 table, case-insensitive", () => {
  assert.equal(resolveReviewIterationCap("low").cap, 1);
  assert.equal(resolveReviewIterationCap("medium").cap, 3);
  assert.equal(resolveReviewIterationCap("high").cap, 5);
  assert.equal(resolveReviewIterationCap("full").cap, 10);
  assert.equal(resolveReviewIterationCap("HIGH").cap, 5, "case-insensitive");
  assert.equal(resolveReviewIterationCap("  full  ").cap, 10, "trims whitespace");
});

test("resolveReviewIterationCap: unrecognised/absent appetite fails loud, names the legal set", () => {
  const bad = resolveReviewIterationCap("bogus");
  assert.ok(bad.error, "unrecognised appetite must error, never silently default");
  assert.match(bad.error, /low \| medium \| high \| full/);
  const absent = resolveReviewIterationCap(undefined);
  assert.ok(absent.error, "absent appetite must error");
  assert.match(absent.error, /low \| medium \| high \| full/);
  const empty = resolveReviewIterationCap("");
  assert.ok(empty.error, "empty-string appetite must error");
});

test("in-process selftest passes", () => {
  assert.equal(reviewIterationCapSelftest(), 0);
});

test("faff review-iteration-cap --appetite <x> prints the cap on stdout, exit 0", () => {
  for (const [appetite, want] of [["low", "1"], ["medium", "3"], ["high", "5"], ["full", "10"]]) {
    const r = runCli(["review-iteration-cap", "--appetite", appetite]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), want, appetite);
  }
});

test("faff review-iteration-cap --appetite high → 5 (the shipped default; NOT the old hardcoded 3)", () => {
  const r = runCli(["review-iteration-cap", "--appetite", "high"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), "5");
});

test("faff review-iteration-cap: unrecognised appetite exits 2, names the legal set, nothing on stdout", () => {
  const r = runCli(["review-iteration-cap", "--appetite", "bogus"]);
  assert.equal(r.code, 2);
  assert.equal(r.stdout.trim(), "", "no value on stdout for an invalid appetite");
  assert.match(r.stderr, /low \| medium \| high \| full/);
});

test("faff review-iteration-cap: absent --appetite exits 2, names the legal set, nothing on stdout", () => {
  const r = runCli(["review-iteration-cap"]);
  assert.equal(r.code, 2);
  assert.equal(r.stdout.trim(), "");
  assert.match(r.stderr, /low \| medium \| high \| full/);
});

test("faff review-iteration-cap --selftest exits 0 and reports PASS", () => {
  const r = runCli(["review-iteration-cap", "--selftest"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: PASS/);
});

// --- Drift guard (DoD "From HOW (drift guard)") -----------------------------------------

test("drift guard: faff-graft/SKILL.md carries no bare per-appetite review-loop integer", () => {
  const body = readFileSync(GRAFT_SKILL, "utf8");
  // The exact drift this ticket removes: a hardcoded "cap at N iterations" for the review
  // fail→fix→review loop. Any reintroduction of this phrase — with a bare digit — is the
  // regression the ticket exists to prevent.
  assert.doesNotMatch(
    body,
    /cap at \d+ iterations?/i,
    "faff-graft/SKILL.md must not restate a bare per-appetite review-iteration integer — " +
      "it must resolve the cap via `faff review-iteration-cap`, never state one (FAFF-341)",
  );
  // Positive assertion: the loop's fail branch actually names the resolver as the cap source.
  assert.match(
    body,
    /faff review-iteration-cap/,
    "faff-graft/SKILL.md's Step 9 review loop must resolve the cap via `faff review-iteration-cap`",
  );
});

test("drift guard: the reviewer's Appetite integration table (1/3/5/10) agrees with the resolver's own map", () => {
  const body = readFileSync(REVIEW_SKILL, "utf8");
  const row = body.split("\n").find((line) => /Review.*fix.*review iterations before escalation/i.test(line));
  assert.ok(row, "faffter-noon-review/SKILL.md must carry the 'Review→fix→review iterations before escalation' row");
  // Row shape: | label | low | medium | high (default) | full |
  const cells = row.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
  // cells[0] is the label; the last four cells are the low/medium/high/full values.
  const values = cells.slice(-4).map((c) => parseInt(c, 10));
  assert.deepEqual(
    values,
    [APPETITE_CAP.low, APPETITE_CAP.medium, APPETITE_CAP.high, APPETITE_CAP.full],
    "the reviewer's table and the `faff review-iteration-cap` resolver must never disagree (FAFF-341 drift guard)",
  );
  // The row must point at the resolver as the materializing mechanism — a reader must never
  // have to trust that the two stay in sync by accident.
  assert.match(row, /faff review-iteration-cap/, "the row must be annotated as materialized by the resolver");
});
