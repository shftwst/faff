// FAFF-576 — the shared fail-closed argv parser (bin/lib/argv.js).
// Exercises parseArgs across unknown-flag, missing-value, bad-enum, duplicate, repeatable,
// positional-arity, =-form, and sentinel cases — the matcher/selftest table — plus the two
// verified-live WHY holes end-to-end through the real CLI (via runCli).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const argvMod = require(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "plugin", "skills", "faff", "bin", "lib", "argv.js",
));
const { parseArgs, usageError, runArgvSelftest, argvSelftestCases } = argvMod;

// --- the selftest table (the matcher) runs green ---
test("argv selftest table: every case passes", () => {
  const r = runArgvSelftest();
  assert.equal(r.fails.length, 0, `selftest failures: ${JSON.stringify(r.fails)}`);
  assert.equal(r.pass, r.total);
  assert.ok(r.total >= 15, "selftest table should be comprehensive");
});

// --- targeted parseArgs assertions per DONE (HOW behaviour) ---
test("unknown flag → unknown-flag error", () => {
  const r = parseArgs(["--status", "done", "--bogus-flag-xyz"], { flags: { "--status": { arity: 1 }, "--spec": { arity: 1 } } });
  assert.deepEqual(r.errors.map((e) => e.code), ["unknown-flag"]);
  assert.equal(r.errors[0].flag, "--bogus-flag-xyz");
});

test("arity-1 flag with --prefixed next token → missing-value", () => {
  const r = parseArgs(["--run-dir", "--json", "--level", "L3"], { flags: { "--run-dir": { arity: 1 }, "--json": { arity: 0 }, "--level": { arity: 1, enum: ["L1", "L2", "L3", "L4"] } } });
  assert.equal(r.errors[0].code, "missing-value");
  assert.equal(r.errors[0].flag, "--run-dir");
});

test("arity-1 flag at end of args → missing-value", () => {
  const r = parseArgs(["--run-dir"], { flags: { "--run-dir": { arity: 1 } } });
  assert.deepEqual(r.errors.map((e) => e.code), ["missing-value"]);
});

test("out-of-enum value → bad-enum naming the accepted set", () => {
  const r = parseArgs(["--level", "L9"], { flags: { "--level": { arity: 1, enum: ["L1", "L2", "L3", "L4"] } } });
  assert.equal(r.errors[0].code, "bad-enum");
  assert.match(r.errors[0].detail, /L1\|L2\|L3\|L4/);
});

test("duplicate of non-repeatable flag → duplicate-flag; repeatable collects a list", () => {
  const dup = parseArgs(["--run-dir", "a", "--run-dir", "b"], { flags: { "--run-dir": { arity: 1 } } });
  assert.ok(dup.errors.some((e) => e.code === "duplicate-flag"));
  const rep = parseArgs(["--label", "a", "--label", "b"], { flags: { "--label": { arity: 1, repeatable: true } } });
  assert.equal(rep.errors.length, 0);
  assert.deepEqual(rep.values["--label"], ["a", "b"]);
});

test("positional arity under/over declared {min,max} → errors; positional-taking works", () => {
  const spec = { flags: { "--root": { arity: 1 } }, positionals: { min: 1, max: 2, name: "verb key" } };
  assert.equal(parseArgs(["get", "tracking.team_key"], spec).errors.length, 0);
  assert.ok(parseArgs([], spec).errors.some((e) => e.code === "too-few-positionals"));
  assert.ok(parseArgs(["a", "b", "c"], spec).errors.some((e) => e.code === "too-many-positionals"));
});

test("errors accumulate across one pass (not fail-fast)", () => {
  const r = parseArgs(["--bogus1", "--level", "L9", "--bogus2"], { flags: { "--level": { arity: 1, enum: ["L1", "L2", "L3", "L4"] } } });
  assert.deepEqual(r.errors.map((e) => e.code), ["unknown-flag", "bad-enum", "unknown-flag"]);
});

test("--flag value and --flag=value both accepted; -- and - are sentinels", () => {
  assert.equal(parseArgs(["--run-dir", "/tmp/x"], { flags: { "--run-dir": { arity: 1 } } }).values["--run-dir"], "/tmp/x");
  assert.equal(parseArgs(["--run-dir=/tmp/x"], { flags: { "--run-dir": { arity: 1 } } }).values["--run-dir"], "/tmp/x");
  const sentinel = parseArgs(["--", "--not-a-flag"], { flags: {}, positionals: { min: 0, max: null } });
  assert.deepEqual(sentinel.positionals, ["--not-a-flag"]);
  const dash = parseArgs(["-"], { flags: {}, positionals: { min: 1, max: 1 } });
  assert.deepEqual(dash.positionals, ["-"]);
});

test("usageError returns 2", () => {
  // usageError writes to stderr; capture is not needed — assert the contract (returns 2).
  assert.equal(usageError([{ code: "unknown-flag", flag: "--x", detail: "unknown flag --x" }], "usage: faff x"), 2);
});

// --- the two verified-live WHY holes, end-to-end through the real CLI ---
test("WHY hole 1: `faff next --status done --spec high --bogus-flag-xyz` exits 2 naming the flag", () => {
  const { code, stderr } = runCli(["next", "--status", "done", "--spec", "high", "--bogus-flag-xyz"]);
  assert.equal(code, 2);
  assert.match(stderr, /--bogus-flag-xyz/);
});

test("WHY hole 2: `faff reconcile --run-dir --json --level L3` exits 2 with a missing-value for --run-dir", () => {
  const { code, stderr } = runCli(["reconcile", "--run-dir", "--json", "--level", "L3"]);
  assert.equal(code, 2);
  assert.match(stderr, /missing-value/);
  assert.match(stderr, /--run-dir/);
});

test("valid input unchanged: `faff eligible --label faff-automate --default opt-in` → exit 0, true", () => {
  const { code, stdout } = runCli(["eligible", "--label", "faff-automate", "--default", "opt-in"]);
  assert.equal(code, 0);
  assert.equal(stdout.trim(), "true");
});
