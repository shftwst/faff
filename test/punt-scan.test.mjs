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
const { puntScan, puntScanSelftest, runPuntScanCases, extractOutOfScopeItemKeys, slugTokenRunContains, matchPuntStart } = mod;

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

// --- FAFF-1351: a Punt written as a list item is the same Punt ---
// The seven accepted forms, enumerated once: the text placed before the bold token.
const LIST_FORMS = [
  ["dash", "- "],
  ["star", "* "],
  ["plus", "+ "],
  ["ordered dot", "1. "],
  ["ordered paren", "2) "],
  ["nested dash", "    - "],
  ["nested ordered", "  1. "],
];

const OOS_PREFIX = "## OUT OF SCOPE\n\n- **Repeat-park collapse** — deferred.\n\n## Open Questions\n\n";
const PUNT_BODIES = [
  "**Punt:** repeat-park collapse — needs human (decides: architecture) (non-blocking)\n",
  "**Punt:** cron vs queue — needs human\n",
];

for (const [name, form] of LIST_FORMS) {
  for (const body of PUNT_BODIES) {
    test(`${name}: a listed Punt equals its flush-left twin (${body.slice(0, 24).trim()}…)`, () => {
      // The twin is the same body with everything before the bold token removed.
      assert.deepEqual(puntScan(OOS_PREFIX + form + body), puntScan(OOS_PREFIX + body));
      assert.equal(puntScan(OOS_PREFIX + form + body).punts.length, 1);
    });
  }
}

test("matchPuntStart returns the remainder without the prefix or the indentation", () => {
  for (const [, form] of LIST_FORMS) {
    assert.equal(matchPuntStart(`${form}**Punt:** cron vs queue (non-blocking)`), "cron vs queue (non-blocking)");
  }
  assert.equal(matchPuntStart("**Punt:** bare"), "bare");
  assert.equal(matchPuntStart("   **Punt:** indented"), "indented");
});

test("matchPuntStart rejects non-Punt-start lines", () => {
  assert.equal(matchPuntStart("- **Chosen:** pino"), null);
  assert.equal(matchPuntStart("- **Chosen:** pino — an earlier **Punt:** is closed"), null);
  assert.equal(matchPuntStart("- `**Punt:**` marks an open decision"), null);
  assert.equal(matchPuntStart("1234567890. **Punt:** ten digits is not a marker"), null);
  assert.equal(matchPuntStart("-**Punt:** fused dash is not a marker, as before"), null);
  assert.equal(matchPuntStart(""), null);
});

test("a listed Punt tagged non-blocking with an OUT OF SCOPE crossref is eligible", () => {
  const r = puntScan(OOS_PREFIX + "- **Punt:** repeat-park collapse — needs human (non-blocking)\n");
  assert.equal(r.punts[0].eligible, true);
  assert.equal(r.eligible_count, 1);
  assert.equal(r.blocking_open_count, 0);
});

test("CLI: two listed untagged Punts report blocking_open_count 2 (the ticket repro)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "punt-scan-listed-"));
  try {
    const specFile = path.join(dir, "spec.md");
    fs.writeFileSync(specFile, "- **Punt:** first open decision\n- **Punt:** second open decision\n");
    const r = runCli(["punt-scan", specFile]);
    assert.equal(r.code, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.punts.length, 2);
    assert.equal(out.blocking_open_count, 2);
    assert.equal(out.eligible_count, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- FAFF-1340: a wrapped Punt reads as its logical line ---
const WRAP_OOS_SECTION = "## OUT OF SCOPE\n\n- **Scrub asymmetry** — deferred to its own ticket.\n\n## Open Questions\n\n";
// The ticket's repro Punt. No wrap point in it puts a terminator at the start of a continuation line.
const WRAP_PUNT_TEXT = "scrub asymmetry in the window comparison, left to its own ticket (decides: architecture) (non-blocking)";
const WRAP_SINGLE_LINE = WRAP_OOS_SECTION + "**Punt:** " + WRAP_PUNT_TEXT + "\n";

test("the ticket repro Punt wrapped at every space, with each separator, reads as the single-line form", () => {
  const expected = puntScan(WRAP_SINGLE_LINE);
  assert.equal(expected.eligible_count, 1);
  assert.equal(expected.blocking_open_count, 0);
  assert.equal(expected.punts[0].decides, "architecture");
  const words = WRAP_PUNT_TEXT.split(" ");
  let wrapPoints = 0;
  for (const sep of ["\n", "\r\n", "\n  "]) {
    for (let k = 1; k < words.length; k++) {
      const wrapped = words.slice(0, k).join(" ") + sep + words.slice(k).join(" ");
      assert.deepEqual(puntScan(WRAP_OOS_SECTION + "**Punt:** " + wrapped + "\n"), expected, `wrap before word ${k} with ${JSON.stringify(sep)}`);
      wrapPoints++;
    }
  }
  assert.ok(wrapPoints >= 3 * (words.length - 1));
});

test("the same property holds for a listed Punt and an indented listed Punt", () => {
  const expected = puntScan(WRAP_SINGLE_LINE);
  const words = WRAP_PUNT_TEXT.split(" ");
  for (const [prefix, indent] of [["- ", "  "], ["1. ", "   "], ["    - ", "      "]]) {
    for (let k = 1; k < words.length; k++) {
      const wrapped = words.slice(0, k).join(" ") + "\n" + indent + words.slice(k).join(" ");
      assert.deepEqual(puntScan(WRAP_OOS_SECTION + prefix + "**Punt:** " + wrapped + "\n"), expected);
    }
  }
});

test("two wrapped Punts separated by a blank line stay two markers and the counts add up", () => {
  const r = puntScan(WRAP_OOS_SECTION + "**Punt:** scrub asymmetry\nin the window comparison\n\n**Punt:** cron vs queue\n");
  assert.equal(r.punts.length, 2);
  assert.equal(r.eligible_count + r.blocking_open_count, r.punts.length);
});

test("punt-scan.js holds exactly one rule for what opens a list item", () => {
  const src = fs.readFileSync(path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..", "plugin", "skills", "faff", "bin", "lib", "punt-scan.js",
  ), "utf8");
  // The ordered-marker digit run is written once: in LIST_ITEM_PREFIX.
  assert.equal(src.split("\\\\d{1,9}").length - 1, 1);
  assert.equal(src.split("const LIST_ITEM_PREFIX").length - 1, 1);
});

test("exports are unchanged in shape", () => {
  assert.deepEqual(Object.keys(mod).sort(), [
    "PUNT_SCAN_CASES", "cmdPuntScan", "extractOutOfScopeItemKeys", "matchPuntStart",
    "puntScan", "puntScanSelftest", "runPuntScanCases", "slugTokenRunContains",
  ]);
});

test("CLI smoke: wrapping the repro Punt leaves the JSON byte-identical; a blank-separated paragraph tag is not absorbed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "punt-scan-wrap-"));
  try {
    const single = path.join(dir, "single.md");
    const wrapped = path.join(dir, "wrapped.md");
    fs.writeFileSync(single, WRAP_SINGLE_LINE);
    fs.writeFileSync(wrapped, WRAP_OOS_SECTION + "**Punt:** scrub asymmetry in the window comparison, left to its own ticket\n(decides: architecture) (non-blocking)\n");
    const a = runCli(["punt-scan", single]);
    const b = runCli(["punt-scan", wrapped]);
    assert.equal(a.code, 0);
    assert.equal(a.stdout, b.stdout);
    const apart = path.join(dir, "apart.md");
    fs.writeFileSync(apart, "**Punt:** cron vs queue — needs human\n\nA separate paragraph (non-blocking).\n");
    const out = JSON.parse(runCli(["punt-scan", apart]).stdout);
    assert.equal(out.punts[0].non_blocking, false);
    assert.equal(out.blocking_open_count, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
