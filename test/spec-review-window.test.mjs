// FAFF-909 — spec-review-window: persist the spec-review convergence window across a restart
// or human unpark. Covers the disk-derived round numbering (nextRoundNumber), the window.json
// sidecar read/write round-trip (readWindowStart / writeWindowStart), the malformed-marker
// fail-loud path, the CLI subcommand (--next-round / --read / --set N + usage errors), the
// --selftest, and the faff-prep/SKILL.md rewire (lines 122/165/167) this resolver plugs into.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./helpers/run-cli.mjs";
import {
  nextRoundNumber,
  readWindowStart,
  writeWindowStart,
  specReviewWindowSelftest,
} from "../plugin/skills/faff/bin/lib/spec-review-window.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const PREP_SKILL = join(REPO, "plugin", "skills", "faff-prep", "SKILL.md");

function mkRoundRecord(dir, n, total, lens = "architectural", blockers = 0) {
  const objections = [];
  for (let i = 0; i < total; i++) objections.push({ lens, severity: i < blockers ? "blocker" : "major" });
  writeFileSync(join(dir, `round-${n}.json`), JSON.stringify({ verdict: "reject-approach", objections }));
}

// --- nextRoundNumber: disk-derived numbering --------------------------------------------

test("nextRoundNumber: empty/absent/unreadable dir → 1 (fresh loop, cannot overwrite)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srw-empty-"));
  try {
    assert.equal(nextRoundNumber(dir), 1, "empty dir");
    assert.equal(nextRoundNumber(join(dir, "does-not-exist")), 1, "absent dir");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("nextRoundNumber: max(round) + 1, numerically (round-10 pushes to 11)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srw-max-"));
  try {
    for (const n of [1, 2, 3]) mkRoundRecord(dir, n, 5);
    assert.equal(nextRoundNumber(dir), 4);
    mkRoundRecord(dir, 10, 5);
    assert.equal(nextRoundNumber(dir), 11, "numeric max, not lexical");
    writeFileSync(join(dir, "window.json"), JSON.stringify({ window_start: 2 }));
    writeFileSync(join(dir, "notes.txt"), "ignored");
    assert.equal(nextRoundNumber(dir), 11, "non-round files ignored");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- window.json round-trip -------------------------------------------------------------

test("readWindowStart: absent marker → 1 (fail-safe default)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srw-absent-"));
  try {
    assert.equal(readWindowStart(dir), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeWindowStart → readWindowStart round-trips the integer, tolerates extra fields", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srw-rt-"));
  try {
    writeWindowStart(dir, 3);
    assert.equal(JSON.parse(readFileSync(join(dir, "window.json"), "utf8")).window_start, 3);
    assert.equal(readWindowStart(dir), 3);
    writeWindowStart(dir, 6);
    assert.equal(readWindowStart(dir), 6, "re-set overwrites");
    writeFileSync(join(dir, "window.json"), JSON.stringify({ window_start: 4, generation: "x" }));
    assert.equal(readWindowStart(dir), 4, "extra fields ignored on read");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeWindowStart: creates the scratch dir if absent (mkdir -p)", () => {
  const base = mkdtempSync(join(tmpdir(), "faff-srw-mkdir-"));
  try {
    const nested = join(base, "run", "FAFF-909", "spec-review");
    assert.equal(existsSync(nested), false);
    writeWindowStart(nested, 2);
    assert.equal(readWindowStart(nested), 2);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// --- malformed marker → fail-loud -------------------------------------------------------

test("readWindowStart: a present-but-malformed marker throws (fail-loud, never coerced)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srw-bad-"));
  try {
    writeFileSync(join(dir, "window.json"), "not json at all");
    assert.throws(() => readWindowStart(dir), /not valid JSON/);
    writeFileSync(join(dir, "window.json"), JSON.stringify({ window_start: 0 }));
    assert.throws(() => readWindowStart(dir), /integer >= 1/, "window_start 0 rejected");
    writeFileSync(join(dir, "window.json"), JSON.stringify({ window_start: "3" }));
    assert.throws(() => readWindowStart(dir), /integer >= 1/, "string window_start rejected");
    writeFileSync(join(dir, "window.json"), JSON.stringify({ nope: 1 }));
    assert.throws(() => readWindowStart(dir), /integer >= 1/, "missing window_start rejected");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Scenario: restart no longer overwrites round records -------------------------------

test("Scenario (restart): a resumed loop appends round-4, leaving round-1..3 unmodified", () => {
  const scratch = mkdtempSync(join(tmpdir(), "faff-srw-restart-"));
  try {
    mkRoundRecord(scratch, 1, 14);
    mkRoundRecord(scratch, 2, 13);
    mkRoundRecord(scratch, 3, 8);
    const before = [1, 2, 3].map((n) => readFileSync(join(scratch, `round-${n}.json`), "utf8"));
    // A fresh process resumes: the next round number comes from disk, not an agent counter.
    const next = runCli(["spec-review-window", "--next-round", "--dir", scratch]);
    assert.equal(next.code, 0, next.stdout + next.stderr);
    assert.equal(next.stdout.trim(), "4");
    // Write the appended round; the earlier records must be untouched.
    mkRoundRecord(scratch, 4, 5);
    const after = [1, 2, 3].map((n) => readFileSync(join(scratch, `round-${n}.json`), "utf8"));
    assert.deepEqual(after, before, "round-1..3 unmodified after resume");
    assert.equal(existsSync(join(scratch, "round-4.json")), true);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// --- Scenario: window.json round-trip via the CLI ---------------------------------------

test("Scenario (round-trip): --set N then --read prints N", () => {
  const scratch = mkdtempSync(join(tmpdir(), "faff-srw-cli-rt-"));
  try {
    assert.equal(runCli(["spec-review-window", "--read", "--dir", scratch]).stdout.trim(), "1", "absent → 1");
    const set = runCli(["spec-review-window", "--set", "3", "--dir", scratch]);
    assert.equal(set.code, 0, set.stdout + set.stderr);
    assert.equal(JSON.parse(set.stdout).window_start, 3);
    assert.equal(runCli(["spec-review-window", "--read", "--dir", scratch]).stdout.trim(), "3");
    runCli(["spec-review-window", "--set", "6", "--dir", scratch]);
    assert.equal(runCli(["spec-review-window", "--read", "--dir", scratch]).stdout.trim(), "6");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// --- Scenario: human unpark opens a new window at the first post-decision round ----------

test("Scenario (human unpark): window_start set to the first post-decision round; [n..n] parks", () => {
  const scratch = mkdtempSync(join(tmpdir(), "faff-srw-unpark-"));
  try {
    mkRoundRecord(scratch, 1, 10);
    mkRoundRecord(scratch, 2, 7);
    // Unpark handler: window_start := nextRoundNumber (the first post-decision round = 3).
    const next = runCli(["spec-review-window", "--next-round", "--dir", scratch]);
    assert.equal(next.stdout.trim(), "3");
    const set = runCli(["spec-review-window", "--set", next.stdout.trim(), "--dir", scratch]);
    assert.equal(set.code, 0);
    assert.equal(runCli(["spec-review-window", "--read", "--dir", scratch]).stdout.trim(), "3");
    // The first post-unpark convergence check over [3 .. 3] has < 2 records → parks.
    mkRoundRecord(scratch, 3, 4);
    const conv = runCli(["spec-review-convergence", "--dir", scratch, "--window-start", "3"]);
    assert.equal(conv.code, 0, conv.stdout + conv.stderr);
    const out = JSON.parse(conv.stdout);
    assert.equal(out.converging, false);
    assert.match(out.reason, /need >=2 rounds/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// --- Scenario: legacy / lost marker → --read prints 1, whole-dir read fails toward park --

test("Scenario (legacy dir, no window.json): --read → 1, and next-round still fixes the data-loss half", () => {
  const scratch = mkdtempSync(join(tmpdir(), "faff-srw-legacy-"));
  try {
    mkRoundRecord(scratch, 1, 9);
    mkRoundRecord(scratch, 2, 6);
    assert.equal(existsSync(join(scratch, "window.json")), false);
    assert.equal(runCli(["spec-review-window", "--read", "--dir", scratch]).stdout.trim(), "1",
      "absent marker defaults to 1 (fail-safe, park-leaning)");
    assert.equal(runCli(["spec-review-window", "--next-round", "--dir", scratch]).stdout.trim(), "3",
      "data-loss half fixed regardless of the marker");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// --- CLI usage errors -------------------------------------------------------------------

test("CLI: --set with a malformed N is a usage error (exit 2)", () => {
  const scratch = mkdtempSync(join(tmpdir(), "faff-srw-badset-"));
  try {
    assert.equal(runCli(["spec-review-window", "--set", "0", "--dir", scratch]).code, 2, "0 rejected");
    assert.equal(runCli(["spec-review-window", "--set", "1.5", "--dir", scratch]).code, 2, "1.5 rejected");
    assert.equal(runCli(["spec-review-window", "--set", "-1", "--dir", scratch]).code, 2, "-1 rejected");
    assert.equal(runCli(["spec-review-window", "--set", "abc", "--dir", scratch]).code, 2, "abc rejected");
    assert.equal(existsSync(join(scratch, "window.json")), false, "no marker written on a usage error");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("CLI: exactly one mode flag + --dir are required", () => {
  const scratch = mkdtempSync(join(tmpdir(), "faff-srw-usage-"));
  try {
    assert.notEqual(runCli(["spec-review-window", "--dir", scratch]).code, 0, "no mode flag");
    assert.notEqual(runCli(["spec-review-window", "--read"]).code, 0, "no --dir");
    assert.notEqual(runCli(["spec-review-window", "--read", "--next-round", "--dir", scratch]).code, 0, "two mode flags");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("CLI: a present-but-malformed window.json on --read is fail-loud (exit 2)", () => {
  const scratch = mkdtempSync(join(tmpdir(), "faff-srw-cli-bad-"));
  try {
    writeFileSync(join(scratch, "window.json"), "not json");
    assert.equal(runCli(["spec-review-window", "--read", "--dir", scratch]).code, 2);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// --- --selftest -------------------------------------------------------------------------

test("CLI: --selftest reports PASS", () => {
  const r = runCli(["spec-review-window", "--selftest"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: PASS/);
});

test("specReviewWindowSelftest() returns 0 in-process", () => {
  const orig = console.log;
  console.log = () => {};
  try {
    assert.equal(specReviewWindowSelftest(), 0);
  } finally {
    console.log = orig;
  }
});

// --- faff-prep/SKILL.md rewire ----------------------------------------------------------

test("faff-prep/SKILL.md: the loop resolves the window + round number via the new CLI", () => {
  const body = readFileSync(PREP_SKILL, "utf8");
  assert.match(body, /spec-review-window --read --dir \$scratch/, "line 122 resolves window_start from --read");
  assert.match(body, /spec-review-window --set \$n --dir \$scratch/, "line 122 persists the swap-round reset via --set");
  assert.match(body, /spec-review-window --next-round --dir \$scratch/, "line 165 derives the round number from --next-round");
  assert.match(body, /spec-review-convergence --dir \$scratch --window-start \$window_start/, "line 167 passes --window-start");
});
