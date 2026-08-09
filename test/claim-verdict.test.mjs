// FAFF-758 — the pure stale-claim liveness function (bin/lib/claim-verdict.js) + its CLI.
// Exercises the boundary table (just-under / at / just-over TTL), the clock-skew fail-safe,
// the {verdict, age_secs, ttl_secs} shape, and the CLI's selftest + invalid-input exits.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const mod = require(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "plugin", "skills", "faff", "bin", "lib", "claim-verdict.js",
));
const { claimVerdict, claimVerdictSelftest, runClaimVerdictCases, ClaimVerdictError } = mod;

// --- the selftest table runs green (no tracker, no system clock) ---
test("claim-verdict selftest table: every case passes", () => {
  assert.equal(runClaimVerdictCases(), 0);
  assert.equal(claimVerdictSelftest(), 0);
});

// --- the boundary: stale IFF strictly older than the TTL ---
test("just under TTL → live", () => {
  assert.equal(claimVerdict("2026-01-01T00:00:00Z", "2026-01-01T05:59:59Z", 6).verdict, "live");
});
test("exactly at TTL → live (not strictly older)", () => {
  assert.equal(claimVerdict("2026-01-01T00:00:00Z", "2026-01-01T06:00:00Z", 6).verdict, "live");
});
test("just over TTL → stale", () => {
  assert.equal(claimVerdict("2026-01-01T00:00:00Z", "2026-01-01T06:00:01Z", 6).verdict, "stale");
});

// --- clock skew (now < claimed) fails safe to live, never reclaims ---
test("negative age (backwards clock) → live", () => {
  assert.equal(claimVerdict("2026-01-01T06:00:00Z", "2026-01-01T00:00:00Z", 6).verdict, "live");
});

// --- the emitted shape ---
test("emits {verdict, age_secs, ttl_secs}", () => {
  const out = claimVerdict("2026-01-01T00:00:00Z", "2026-01-01T03:00:00Z", 6);
  assert.deepEqual(out, { verdict: "live", age_secs: 10800, ttl_secs: 21600 });
});

// --- invalid inputs throw (pure layer) ---
test("bad claimed-at throws ClaimVerdictError", () => {
  assert.throws(() => claimVerdict("nope", "2026-01-01T00:00:00Z", 6), ClaimVerdictError);
});
test("negative ttl throws ClaimVerdictError", () => {
  assert.throws(() => claimVerdict("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", -1), ClaimVerdictError);
});

// --- the CLI seam: exactly as CI / users invoke it ---
test("CLI --selftest exits 0", () => {
  assert.equal(runCli(["claim-verdict", "--selftest"]).code, 0);
});
test("CLI emits verdict JSON on stdout", () => {
  const r = runCli(["claim-verdict", "--claimed-at", "2026-01-01T00:00:00Z", "--now", "2026-01-01T07:00:00Z", "--ttl-hours", "6"]);
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.stdout), { verdict: "stale", age_secs: 25200, ttl_secs: 21600 });
});
test("CLI missing required flag → exit 2", () => {
  assert.equal(runCli(["claim-verdict", "--now", "2026-01-01T07:00:00Z", "--ttl-hours", "6"]).code, 2);
});
test("CLI invalid timestamp → exit 2", () => {
  assert.equal(runCli(["claim-verdict", "--claimed-at", "nope", "--now", "2026-01-01T07:00:00Z", "--ttl-hours", "6"]).code, 2);
});

// --- config default: claim_ttl_hours resolves to 6 with no .faffrc ---
test("config get claim_ttl_hours defaults to 6", () => {
  const r = runCli(["config", "get", "claim_ttl_hours"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), "6");
});

// --- the label manifest carries faff-claimed, machine-writable (no tracker_owned) ---
test("faff labels includes faff-claimed with tracker_owned falsey", () => {
  const r = runCli(["labels"]);
  assert.equal(r.code, 0);
  const claimed = JSON.parse(r.stdout).find((l) => l.name === "faff-claimed");
  assert.ok(claimed, "faff-claimed present in the manifest");
  assert.ok(!claimed.tracker_owned, "faff-claimed is not tracker_owned (machine-writable)");
});
