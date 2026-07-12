// FAFF-308 — appetite is level-scoped: under an active L4 lights-out run, `config get appetite`
// resolves to `full` unconditionally and config `appetite` is ignored; config stays authoritative
// for L1–L3. Exercises the real entrypoint via runCli (the deterministic seam per ADR 0002) — the
// resolver reads an on-disk L4 ledger via FAFF_RUN_DIR, so a child-process test with a real temp
// ledger is the correct shape (not an in-process pure --selftest).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

// A throwaway repo root with a .git marker (so findRoot anchors here) and a .faffrc.yaml carrying
// the given config appetite. Returns the root dir.
function tmpRoot(appetiteLine = "appetite: low\n") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-app-"));
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".faffrc.yaml"), appetiteLine);
  return dir;
}

// Mint a run-ledger.json fixture at the given level under a fresh run dir; returns the run dir.
// FAFF-378: the default owner is a LIVE run (status running + a fresh `last_heartbeat`), so the
// L4 pin fires via `runIsHeld`. Pass an explicit `owner` (2nd arg) to override the whole owner
// block — including `null` to omit `owner` entirely (a legacy/unowned ledger).
// LOAD-BEARING: the default `last_heartbeat` is what keeps every existing L4-pin test (the ones
// asserting `full`) on the held path — remove it and those tests break, not just the new ones.
function mintLedger(level, owner) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-run-"));
  const ledger = { run_id: "fixture", level };
  if (arguments.length >= 2) {
    if (owner !== null) ledger.owner = owner; // explicit null → omit owner
  } else {
    ledger.owner = { status: "running", last_heartbeat: new Date().toISOString() };
  }
  fs.writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify(ledger));
  return runDir;
}

// Child env with FAFF_RUN_DIR / FAFF_APPETITE cleared, then overlaid with the given keys, so the
// test's ambient run context can never leak in.
function env(overrides = {}) {
  const e = { ...process.env };
  delete e.FAFF_RUN_DIR;
  delete e.FAFF_APPETITE;
  return { ...e, ...overrides };
}

test("L4 ledger + config appetite:low → config get appetite resolves `full`", () => {
  const root = tmpRoot("appetite: low\n");
  const runDir = mintLedger("L4");
  const { stdout, code } = runCli(["config", "get", "appetite"], { cwd: root, env: env({ FAFF_RUN_DIR: runDir }) });
  assert.equal(code, 0, stdout);
  assert.equal(stdout.trim(), "full");
});

test("no L4 context + config appetite:high → resolves config value (L1–L3 byte-unchanged)", () => {
  const root = tmpRoot("appetite: high\n");
  const { stdout, code } = runCli(["config", "get", "appetite"], { cwd: root, env: env() });
  assert.equal(code, 0, stdout);
  assert.equal(stdout.trim(), "high");
});

test("no config appetite + no L4 → baked default `high`", () => {
  const root = tmpRoot("logging: full\n"); // no appetite key
  const { stdout, code } = runCli(["config", "get", "appetite"], { cwd: root, env: env() });
  assert.equal(code, 0, stdout);
  assert.equal(stdout.trim(), "high");
});

test("env FAFF_APPETITE=full belt → `full` even with no ledger", () => {
  const root = tmpRoot("appetite: low\n");
  const { stdout } = runCli(["config", "get", "appetite"], { cwd: root, env: env({ FAFF_APPETITE: "full" }) });
  assert.equal(stdout.trim(), "full");
});

test("invalid FAFF_APPETITE token → ignored, falls through to config", () => {
  const root = tmpRoot("appetite: medium\n");
  const { stdout } = runCli(["config", "get", "appetite"], { cwd: root, env: env({ FAFF_APPETITE: "reckless" }) });
  assert.equal(stdout.trim(), "medium");
});

test("FAFF_RUN_DIR set but ledger is non-L4 → fails safe to config", () => {
  const root = tmpRoot("appetite: low\n");
  const runDir = mintLedger("L3");
  const { stdout } = runCli(["config", "get", "appetite"], { cwd: root, env: env({ FAFF_RUN_DIR: runDir }) });
  assert.equal(stdout.trim(), "low");
});

test("FAFF_RUN_DIR points at an unreadable/absent ledger → fails safe to config (never fabricates full)", () => {
  const root = tmpRoot("appetite: low\n");
  const missing = fs.mkdtempSync(path.join(os.tmpdir(), "faff-noledger-")); // dir exists, no run-ledger.json
  const { stdout } = runCli(["config", "get", "appetite"], { cwd: root, env: env({ FAFF_RUN_DIR: missing }) });
  assert.equal(stdout.trim(), "low");
});

test("--json prints the resolved value as JSON under L4", () => {
  const root = tmpRoot("appetite: low\n");
  const runDir = mintLedger("L4");
  const { stdout } = runCli(["config", "get", "appetite", "--json"], { cwd: root, env: env({ FAFF_RUN_DIR: runDir }) });
  assert.equal(stdout.trim(), '"full"');
});

test("the override is guarded to the `appetite` key — other keys unchanged under L4", () => {
  const root = tmpRoot("appetite: low\nlogging: minimal\n");
  const runDir = mintLedger("L4");
  const e = env({ FAFF_RUN_DIR: runDir });
  const logging = runCli(["config", "get", "logging"], { cwd: root, env: e });
  assert.equal(logging.stdout.trim(), "minimal"); // config value, NOT forced
});

test("the override never writes config — .faffrc.yaml is byte-unchanged after resolution", () => {
  const root = tmpRoot("appetite: low\n");
  const runDir = mintLedger("L4");
  const before = fs.readFileSync(path.join(root, ".faffrc.yaml"), "utf8");
  runCli(["config", "get", "appetite"], { cwd: root, env: env({ FAFF_RUN_DIR: runDir }) });
  const after = fs.readFileSync(path.join(root, ".faffrc.yaml"), "utf8");
  assert.equal(after, before);
});

// --- FAFF-378: the L4 pin fires only for a LIVE run (runIsHeld), never a stale/done ledger ---

test("FAFF-378: done-owner L4 ledger (fresh heartbeat) → resolves config appetite, not `full`", () => {
  const root = tmpRoot("appetite: low\n");
  const runDir = mintLedger("L4", { status: "done", last_heartbeat: new Date().toISOString() });
  const { stdout, code } = runCli(["config", "get", "appetite"], { cwd: root, env: env({ FAFF_RUN_DIR: runDir }) });
  assert.equal(code, 0, stdout);
  assert.equal(stdout.trim(), "low"); // the issue's headline case — a finished run no longer escalates
});

test("FAFF-378: stale-heartbeat running-owner L4 ledger → resolves config appetite, not `full`", () => {
  const root = tmpRoot("appetite: low\n");
  const stale = new Date(Date.now() - 10_000).toISOString(); // 10s ago
  const runDir = mintLedger("L4", { status: "running", last_heartbeat: stale });
  // pin the staleness window small + deterministic via the child env (10s ago > 1s window)
  const { stdout, code } = runCli(["config", "get", "appetite"],
    { cwd: root, env: env({ FAFF_RUN_DIR: runDir, FAFF_RUN_HEARTBEAT_STALE_SECS: "1" }) });
  assert.equal(code, 0, stdout);
  assert.equal(stdout.trim(), "low"); // crashed/abandoned owner (stale heartbeat) no longer grants full
});

test("FAFF-378: ownerless L4 ledger → resolves config appetite, not `full`", () => {
  const root = tmpRoot("appetite: low\n");
  const runDir = mintLedger("L4", null); // no owner block at all
  const { stdout, code } = runCli(["config", "get", "appetite"], { cwd: root, env: env({ FAFF_RUN_DIR: runDir }) });
  assert.equal(code, 0, stdout);
  assert.equal(stdout.trim(), "low");
});

test("FAFF-378: live L4 ledger (running + fresh heartbeat) → still resolves `full` (pin unchanged for its own run)", () => {
  const root = tmpRoot("appetite: low\n");
  const runDir = mintLedger("L4", { status: "running", last_heartbeat: new Date().toISOString() });
  const { stdout, code } = runCli(["config", "get", "appetite"], { cwd: root, env: env({ FAFF_RUN_DIR: runDir }) });
  assert.equal(code, 0, stdout);
  assert.equal(stdout.trim(), "full");
});

// --- Runner mint + handoff (cmdLightsOut) ---

// A contained, dial-coherent lights-out fixture (mirrors lights-out.test.mjs): adversarial review
// + spec_review slots and fail-closed gates so the preflight admits proceed; config appetite:low
// to prove the mint IGNORES config and forces `full`.
function lightsOutRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-lo-app-"));
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".faffrc.yaml"),
    "appetite: low\nslots:\n  review: faffter-dark-adversarial-review\n  spec_review: faffter-dark-spec-review\ngates:\n  fallback: fail-closed\n");
  return dir;
}
const CONTAINED = (extra = {}) => ({ ...process.env, KUBERNETES_SERVICE_HOST: "10.0.0.1", ...extra });

// FAFF-325: this real invocation now correctly refuses admission (no genuine
// FAFF_INTEGRITY_BOUNDARY pid-1 declaration on this host) — an unrelated gate to the appetite
// forcing under test here. Confirm that specific new refusal is the ONLY one (config-driven
// appetite:low doesn't ALSO trip anything), and — since `dial_profile` (built AFTER the
// preflight decision) is unreachable through the real CLI on this host — assert the underlying
// invariant directly against the shipped source: cmdLightsOut's `appetite` is a bare `"full"`
// literal, never conditioned on a config/resolveAppetite read (mirrors the sentry.test.mjs AC6
// no-`correct` source-literal guard pattern already used elsewhere in this suite).
test("cmdLightsOut refuses ONLY on the unrelated FAFF-325 gate (config appetite:low never independently blocks)", () => {
  const root = lightsOutRoot();
  const { stdout, code } = runCli(["lights-out", "--json", "--until", "23:59"], { cwd: root, env: CONTAINED() });
  assert.equal(code, 1, stdout);
  const out = JSON.parse(stdout.trim().split("\n").pop());
  assert.deepEqual(out.refusals.map((r) => r.gate), ["corrective-integrity"], stdout);
});

test("cmdLightsOut's dial_profile.appetite is a bare 'full' literal, never conditioned on config (source-literal guard)", () => {
  const src = fs.readFileSync(new URL("../plugin/skills/faff/bin/lib/lights-out.js", import.meta.url), "utf8");
  assert.match(src, /const appetite = "full";/, "the L4 appetite-forcing line must stay an unconditional literal, never gated on cfg/resolveAppetite");
  assert.match(src, /dial_profile = \{\s*\n\s*appetite,/, "dial_profile must carry that same literal, not a re-derived value");
});
