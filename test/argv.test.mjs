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

// --- the completion gate: the registry-driven fuzz test (DoD §8 durability) ---
// Iterates every subcommand the CLI dispatches (COMMANDS, mirrored 1:1 by regions.js's
// REGION_MAP — that bijection is asserted by `regions selftest`) and asserts each REJECTS an
// unknown flag with a usage exit (2), never a silent fail-open (exit 0). This is the mechanical
// guard against a future subcommand regressing to the fail-open class FAFF-576 retired: a `--`-
// token that isn't a declared flag is unambiguously a flag, so a handler that ignores it (and
// proceeds/exits 0) is fail-open; a handler that routes through the shared parser exits 2.
// A bogus flag is rejected at parse time, before any I/O, so no fixture/positional is needed.
// Any subcommand that legitimately cannot participate would be listed in EXEMPT with a reason;
// today none are — every dispatched subcommand is fail-closed on unknown flags.
const regionsMod = require(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "plugin", "skills", "faff", "bin", "lib", "regions.js",
));
const ALL_SUBCOMMANDS = Object.keys(regionsMod.REGION_MAP).sort();
const FUZZ_EXEMPT = new Map(); // subcommand -> reason (none today)

test("completion gate: every dispatched subcommand rejects an unknown flag (exit 2, never fail-open) — FAFF-576 DoD §8", () => {
  assert.ok(ALL_SUBCOMMANDS.length >= 70, `expected the full COMMANDS registry, got ${ALL_SUBCOMMANDS.length}`);
  const BOGUS = "--definitely-not-a-flag-xyz";
  const failOpen = [];
  const wrongExit = [];
  for (const cmd of ALL_SUBCOMMANDS) {
    if (FUZZ_EXEMPT.has(cmd)) continue;
    const { code } = runCli([cmd, BOGUS], { input: "" });
    if (code === 0) failOpen.push(cmd);                 // the retired bug: silently ignored the flag
    else if (code !== 2) wrongExit.push(`${cmd}(exit ${code})`); // errored, but not the usage-reject path
  }
  assert.deepEqual(failOpen, [], `fail-open (exit 0 on an unknown flag): ${failOpen.join(", ")}`);
  assert.deepEqual(wrongExit, [], `rejected but not via the usage exit (want 2): ${wrongExit.join(", ")}`);
});

// --- FAFF-772: guard the eval member's REGION_SELFTEST_ARGV entry ---
// The registry selftest sweep (`faff regions selftest`) spawns each member's stored argv
// verbatim — there is no runtime correction, so the table entry must already be the runnable
// form. `cmdEval` (eval-affected.js) rejects any first token other than "affected" (exit 2), so
// the only runnable invocation is ["eval", "affected", "--selftest"]; the historical entry
// ["eval", "--selftest"] is unrunnable and made the sweep FAIL unnoticed (no test asserted it,
// and CI runs only the governance region). Deep-equal the whole array so this fails on the
// historical wrong form and on any other drift (reordered tokens, a different sub-verb, a
// missing/extra flag) — not just a single-index check.
test("REGION_SELFTEST_ARGV['eval'] is the runnable sub-verb form — FAFF-772", () => {
  assert.deepEqual(
    regionsMod.REGION_SELFTEST_ARGV["eval"],
    ["eval", "affected", "--selftest"],
    "the eval member's selftest argv must be the sub-verb form; cmdEval rejects any first token != 'affected' (exit 2)",
  );
});
