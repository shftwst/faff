// FAFF-752 — the `faff eval affected` subcommand: the advisory touched-surface→affected-KIND
// deriver. A pure classifier (composing each surface's `judgement_seam:` frontmatter with
// eval/seam-registry.json) behind a thin git/fs shell. FAIL-SAFE to `full`; `none` only when
// every touched surface is confidently non-grading. End-to-end spawn tests against the REAL
// surfaces + the REAL registry (via the shared run-cli helper), plus the in-module selftest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCli } from "./helpers/run-cli.mjs";

const affected = (args) => runCli(["eval", "affected", ...args]);

test("--selftest exercises every branch and exits 0", () => {
  const r = affected(["--selftest"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /RESULT: PASS \(\d+ cases, 0 failed\)/);
});

test("all-`none` surfaces → the explicit none line, exit 0 (the FAFF-749 case)", () => {
  const r = affected(["--surfaces", "faffter-dark-concurrency-parallel,faffter-noon-concurrency-sequential"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), "none — no eval-graded judgement seam touched");
});

test("a surface with covered KINDs → a subset containing those KINDs, exit 0", () => {
  const r = affected(["--surfaces", "faff-tidy", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const v = JSON.parse(r.stdout);
  assert.equal(v.verdict, "subset");
  // faff-tidy owns dupe + vague among others (eval/seam-registry.json).
  assert.ok(v.kinds.includes("dupe"), `expected dupe in ${v.kinds}`);
  assert.ok(v.kinds.includes("vague"), `expected vague in ${v.kinds}`);
  // sorted + unique
  assert.deepEqual(v.kinds, [...new Set(v.kinds)].sort());
  assert.ok(typeof v.reason === "string" && v.reason.length > 0);
});

test("subset plain stdout is the comma-joined sorted-unique kind list (usable as --kind)", () => {
  const r = affected(["--surfaces", "faff-tidy"]);
  assert.equal(r.code, 0, r.stderr);
  const line = r.stdout.trim();
  const parts = line.split(",");
  assert.deepEqual(parts, [...new Set(parts)].sort()); // sorted + unique
  assert.ok(parts.includes("dupe") && parts.includes("vague"));
  assert.ok(!line.includes(" "), "the --kind value must carry no spaces");
});

test("`none` + a KIND-bearing surface still contributes only the graded kinds (union)", () => {
  const r = affected(["--surfaces", "faff-tidy,faffter-noon-env-compose", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const v = JSON.parse(r.stdout);
  assert.equal(v.verdict, "subset");
  assert.ok(v.kinds.includes("dupe")); // env-compose is `none`, contributes nothing
});

test("an undeclared / unreadable surface → full (fail-safe), reason names it", () => {
  const r = affected(["--surfaces", "does-not-exist"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^full — /);
  assert.match(r.stdout, /does-not-exist/);
});

test("--json emits {verdict, kinds, surfaces, reason} with a non-empty reason on full", () => {
  const r = affected(["--surfaces", "does-not-exist", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const v = JSON.parse(r.stdout);
  assert.equal(v.verdict, "full");
  assert.deepEqual(v.kinds, []);
  assert.ok(Array.isArray(v.surfaces));
  assert.ok(typeof v.reason === "string" && v.reason.length > 0);
});

test("neither --surfaces nor --diff → usage error, exit 2", () => {
  const r = affected([]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /at least one of --surfaces or --diff/);
});

test("an unknown eval sub-verb → usage error, exit 2", () => {
  const r = runCli(["eval", "bogus"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown eval sub-verb/);
});

test("an unknown flag → usage error, exit 2 (fail-closed arg parser)", () => {
  const r = affected(["--surfaces", "faff-tidy", "--bogus-flag"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown-flag/);
});
