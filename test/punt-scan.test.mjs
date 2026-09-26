// FAFF-1078 — the pure blocking-vs-deferred Punt reporter (bin/lib/punt-scan.js) + its CLI.
// Exercises the two-fact eligibility rule, order-independent suffix parsing, the OUT OF SCOPE
// crossref key extraction (including the reserved sub-label skip), the fail-safe direction,
// the PuntScanResult shape/invariant, and the CLI's selftest + missing-file exit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const mod = require(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "plugin", "skills", "faff", "bin", "lib", "punt-scan.js",
));
const { puntScan, puntScanSelftest, runPuntScanCases, extractOutOfScopeItemKeys, slugTokenRunContains } = mod;

// --- the baked selftest table runs green (no tracker, no network, no clock) ---
test("punt-scan selftest table: every case passes", () => {
  assert.equal(runPuntScanCases(), 0);
  assert.equal(puntScanSelftest(), 0);
});

// --- eligibility is two deterministic facts ---
test("bare tag AND out-of-scope crossref → eligible", () => {
  const r = puntScan("## OUT OF SCOPE\n\n- **Repeat-park collapse** — deferred.\n\n**Punt:** repeat-park collapse — needs human (non-blocking)\n");
  assert.equal(r.punts[0].eligible, true);
  assert.equal(r.eligible_count, 1);
  assert.equal(r.blocking_open_count, 0);
});

test("the bare tag alone (no crossref) is not eligible", () => {
  const r = puntScan("## OUT OF SCOPE\n\n- **Something else** — unrelated.\n\n**Punt:** an unrelated decision (non-blocking)\n");
  assert.equal(r.punts[0].non_blocking, true);
  assert.equal(r.punts[0].out_of_scope_crossref, false);
  assert.equal(r.punts[0].eligible, false);
});

test("a crossref without the tag is not eligible", () => {
  const r = puntScan("## OUT OF SCOPE\n\n- **Repeat-park collapse** — deferred.\n\n**Punt:** repeat-park collapse — needs human\n");
  assert.equal(r.punts[0].non_blocking, false);
  assert.equal(r.punts[0].out_of_scope_crossref, true);
  assert.equal(r.punts[0].eligible, false);
});

// --- order-independent suffix parsing ---
test("(decides:)(non-blocking) and (non-blocking)(decides:) yield identical markers", () => {
  const r = puntScan("**Punt:** cron vs queue — needs human (decides: architecture) (non-blocking)\n**Punt:** cron vs queue — needs human (non-blocking) (decides: architecture)\n");
  assert.deepEqual(r.punts[0], r.punts[1]);
  assert.equal(r.punts[0].decides, "architecture");
  assert.equal(r.punts[0].non_blocking, true);
  assert.equal(r.punts[0].topic, "cron vs queue — needs human");
});

test("an unrecognised parenthetical is retained in the topic", () => {
  const r = puntScan("**Punt:** cron (or a queue) vs batch (non-blocking)\n");
  assert.equal(r.punts[0].topic, "cron (or a queue) vs batch");
});

// --- fail-safe direction ---
test("no OUT OF SCOPE section → every Punt is blocking", () => {
  const r = puntScan("**Punt:** anything at all (non-blocking)\n");
  assert.equal(r.punts[0].out_of_scope_crossref, false);
  assert.equal(r.blocking_open_count, 1);
});

test("degenerate empty-slug topic never false-matches a crossref key", () => {
  const r = puntScan("## OUT OF SCOPE\n\n- **Repeat-park collapse** — deferred.\n\n**Punt:** — (non-blocking)\n");
  assert.equal(r.punts[0].topic, "");
  assert.equal(r.punts[0].out_of_scope_crossref, false);
  assert.equal(r.punts[0].eligible, false);
});

// --- mixed Punts counted independently, invariant holds ---
test("mixed Punts: blocking_open_count counts only the non-eligible ones", () => {
  const r = puntScan("## OUT OF SCOPE\n\n- **Repeat-park collapse** — deferred.\n- **Schema versioning** — out of scope.\n\n**Punt:** repeat-park collapse handling (non-blocking)\n**Punt:** cron vs queue — needs human\n**Punt:** schema versioning approach (decides: architecture)\n");
  assert.equal(r.punts.length, 3);
  assert.equal(r.eligible_count, 1);
  assert.equal(r.blocking_open_count, 2);
  assert.equal(r.eligible_count + r.blocking_open_count, r.punts.length);
});

// --- OUT OF SCOPE key extraction: both producer formats, sub-labels skipped ---
test("canonical three-bullet item emits only the name key, never the sub-labels", () => {
  const keys = extractOutOfScopeItemKeys("## OUT OF SCOPE\n\n- **Repeat-park collapse** — the mechanism.\n- **Why excluded** — root cause dropped.\n- **Extension point** — a future ticket.\n");
  assert.ok(keys.has("repeat-park-collapse"));
  assert.ok(!keys.has("why-excluded"));
  assert.ok(!keys.has("extension-point"));
  assert.equal(keys.size, 1);
});

test("flat trailing-period item emits exactly its one name key", () => {
  const keys = extractOutOfScopeItemKeys("## OUT OF SCOPE\n\n- **Standing-park collapse.** What's excluded: the mechanism. Why excluded: dropped.\n");
  assert.deepEqual([...keys], ["standing-park-collapse"]);
});

test("a section-numbered heading (### 2. OUT OF SCOPE) is still located", () => {
  const keys = extractOutOfScopeItemKeys("### 2. OUT OF SCOPE\n\n- **Repeat-park collapse** — deferred.\n");
  assert.ok(keys.has("repeat-park-collapse"));
});

// --- the token-run matcher is one-directional and boundary-safe ---
test("slugTokenRunContains matches a contiguous token run, not a substring", () => {
  assert.equal(slugTokenRunContains("repeat-park-collapse-handling", "repeat-park-collapse"), true);
  assert.equal(slugTokenRunContains("repeat-park-collapsed", "repeat-park-collapse"), false);
  assert.equal(slugTokenRunContains("", "repeat-park-collapse"), false);
  assert.equal(slugTokenRunContains("anything", ""), false);
});

// --- determinism ---
test("same spec bytes always produce the same PuntScanResult", () => {
  const spec = "## OUT OF SCOPE\n\n- **Repeat-park collapse** — deferred.\n\n**Punt:** repeat-park collapse (non-blocking)\n";
  assert.equal(JSON.stringify(puntScan(spec)), JSON.stringify(puntScan(spec)));
});

// --- the CLI seam ---
test("CLI --selftest exits 0", () => {
  assert.equal(runCli(["punt-scan", "--selftest"]).code, 0);
});

test("CLI emits PuntScanResult JSON on stdout for a spec file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "punt-scan-"));
  const specFile = path.join(dir, "spec.md");
  fs.writeFileSync(specFile, "## OUT OF SCOPE\n\n- **Repeat-park collapse** — deferred.\n\n**Punt:** repeat-park collapse (non-blocking)\n");
  const r = runCli(["punt-scan", specFile]);
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.eligible_count, 1);
  assert.equal(out.blocking_open_count, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("CLI exits 2 on a missing/unreadable spec file", () => {
  assert.equal(runCli(["punt-scan", path.join(os.tmpdir(), "no-such-punt-scan-spec.md")]).code, 2);
});
