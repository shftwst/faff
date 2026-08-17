// FAFF-835 — the pure stale-park validity function (bin/lib/park-verdict.js) + its CLI.
// Exercises the full boundary table (every predicate branch), the fail-safe `surface`
// direction, the {verdict} shape, and the CLI's selftest + invalid-input exits.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const mod = require(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "plugin", "skills", "faff", "bin", "lib", "park-verdict.js",
));
const { parkVerdict, parkVerdictSelftest, runParkVerdictCases, ParkVerdictError } = mod;

// --- the selftest table runs green (no tracker, no system clock) ---
test("park-verdict selftest table: every case passes", () => {
  assert.equal(runParkVerdictCases(), 0);
  assert.equal(parkVerdictSelftest(), 0);
});

// --- below In Progress: case 1's trigger does not fire ---
test("backlog → n/a", () => {
  assert.equal(parkVerdict("backlog", "absent", "none", false).verdict, "n/a");
});
test("todo → n/a (short-circuits before any signal)", () => {
  assert.equal(parkVerdict("todo", "present", "build", true).verdict, "n/a");
});

// --- terminal / in-review: strip-ok, unchanged from today ---
for (const s of ["done", "cancelled", "archived", "in-review"]) {
  test(`${s} + faff-parked → strip-ok`, () => {
    assert.equal(parkVerdict(s, "absent", "none", false).verdict, "strip-ok");
  });
}
test("externally-set in-review with a draft PR → strip-ok (label is noise; PR untouched by the rule)", () => {
  assert.equal(parkVerdict("in-review", "present", "build", false).verdict, "strip-ok");
});

// --- the disputed case: In Progress ---
test("in-progress + open draft PR → protect (post-PR held-in-draft park)", () => {
  assert.equal(parkVerdict("in-progress", "present", "none", false).verdict, "protect");
});
test("in-progress + draft PR dominates the park-comment branch", () => {
  assert.equal(parkVerdict("in-progress", "present", "nonbuild", true).verdict, "protect");
});
test("in-progress, no PR, build park, no human action → protect (no-PR mid-build park)", () => {
  assert.equal(parkVerdict("in-progress", "absent", "build", false).verdict, "protect");
});
test("in-progress, no PR, build park, human acted since → surface (ambiguous)", () => {
  assert.equal(parkVerdict("in-progress", "absent", "build", true).verdict, "surface");
});
test("in-progress, no PR, nonbuild park, human takeover → strip-ok", () => {
  assert.equal(parkVerdict("in-progress", "absent", "nonbuild", true).verdict, "strip-ok");
});
test("in-progress, no PR, nonbuild park, no human action → surface (cannot classify)", () => {
  assert.equal(parkVerdict("in-progress", "absent", "nonbuild", false).verdict, "surface");
});
test("in-progress, no PR, no park comment → surface (fail-safe)", () => {
  assert.equal(parkVerdict("in-progress", "absent", "none", false).verdict, "surface");
  assert.equal(parkVerdict("in-progress", "absent", "none", true).verdict, "surface");
});

// --- the emitted shape ---
test("emits exactly {verdict}", () => {
  assert.deepEqual(parkVerdict("in-progress", "present", "build", false), { verdict: "protect" });
});

// --- invalid inputs throw (pure layer) ---
test("bad status throws ParkVerdictError", () => {
  assert.throws(() => parkVerdict("bogus", "present", "build", false), ParkVerdictError);
});
test("bad draft-pr throws ParkVerdictError", () => {
  assert.throws(() => parkVerdict("in-progress", "maybe", "build", false), ParkVerdictError);
});
test("bad park-comment throws ParkVerdictError", () => {
  assert.throws(() => parkVerdict("in-progress", "present", "sometimes", false), ParkVerdictError);
});
test("non-boolean human-takeover throws ParkVerdictError", () => {
  assert.throws(() => parkVerdict("in-progress", "present", "build", "true"), ParkVerdictError);
});

// --- the CLI seam: exactly as tidy / CI invoke it ---
test("CLI --selftest exits 0", () => {
  assert.equal(runCli(["park-verdict", "--selftest"]).code, 0);
});
test("CLI emits verdict JSON on stdout", () => {
  const r = runCli(["park-verdict", "--status", "in-progress", "--draft-pr", "present", "--park-comment", "build", "--human-takeover", "false"]);
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.stdout), { verdict: "protect" });
});
test("CLI strip-ok path emits correctly", () => {
  const r = runCli(["park-verdict", "--status", "in-progress", "--draft-pr", "absent", "--park-comment", "nonbuild", "--human-takeover", "true"]);
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.stdout), { verdict: "strip-ok" });
});
test("CLI missing required flag → exit 2", () => {
  assert.equal(runCli(["park-verdict", "--status", "in-progress", "--draft-pr", "present", "--park-comment", "build"]).code, 2);
});
test("CLI invalid status → exit 2", () => {
  assert.equal(runCli(["park-verdict", "--status", "bogus", "--draft-pr", "present", "--park-comment", "build", "--human-takeover", "false"]).code, 2);
});
test("CLI non-boolean human-takeover → exit 2", () => {
  assert.equal(runCli(["park-verdict", "--status", "in-progress", "--draft-pr", "present", "--park-comment", "build", "--human-takeover", "yes"]).code, 2);
});
