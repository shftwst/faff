// FAFF-909 — spec-review-window: persist the spec-review convergence window across a restart
// or human unpark. Covers the disk-derived round numbering (nextRoundNumber), the window.json
// sidecar read/write round-trip (readWindowStart / writeWindowStart), the malformed-marker
// fail-loud path, the CLI subcommand (--next-round / --read / --set N + usage errors), the
// --selftest, and the faff-prep/SKILL.md rewire (lines 122/165/167) this resolver plugs into.
//
// FAFF-1052 — `--govern`: the deterministic window-governance state machine that replaces
// prep's hand-derived swap comparison. Covers every branch (no-lens / unpinnable-reset with
// the round1-capture-missed vs unpinnable anomaly split / late-pin-advance / swap-reset /
// unchanged / the soft pin-marker-missing+pin-marker-contradiction anomalies / the served-
// path exit-2 faults with their governance-<n>.json record still written / the pre-read arg-
// validation errors that write no record and leave window.json untouched).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./helpers/run-cli.mjs";
import {
  nextRoundNumber,
  readWindowStart,
  writeWindowStart,
  govern,
  specReviewWindowSelftest,
} from "../plugin/skills/faff/bin/lib/spec-review-window.js";
import {
  backendIdentity, capturePin, atomicWriteJSON, servedIdentityPath,
} from "../plugin/skills/faff/bin/lib/spec-review-pin.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const PREP_SKILL = join(REPO, "plugin", "skills", "faff-prep", "SKILL.md");

const BACKENDS = [
  { provider: "openai", model: "mA", host: "https://a/v1" },
  { provider: "nvidia", model: "mB", host: "https://b/v1" },
];

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
  assert.match(body, /spec-review-window --read --dir \$scratch/, "loop entry resolves window_start from --read");
  assert.match(body, /spec-review-window --govern --dir \$scratch --round \$n/, "per-round governance now runs via --govern, not a hand --set");
  assert.match(body, /spec-review-window --next-round --dir \$scratch/, "the round number is derived from --next-round");
  assert.match(body, /spec-review-convergence --dir \$scratch --window-start \$window_start/, "convergence reads pass --window-start");
});

// --- FAFF-1052: `--govern` deterministic window governance --------------------------------

test("govern: no-lens is a legitimate no-op — governance written, window.json byte-unchanged", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srw-gov-"));
  try {
    writeWindowStart(dir, 1);
    const before = readFileSync(join(dir, "window.json"), "utf8");
    const { code, result } = govern(dir, 1, "no-lens");
    assert.equal(code, 0);
    assert.equal(result.action, "no-lens");
    assert.equal(result.served_identity, null);
    assert.equal(readFileSync(join(dir, "window.json"), "utf8"), before, "window.json byte-unchanged");
    assert.equal(existsSync(join(dir, "governance-1.json")), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("govern: served round 1 with no pin → unpinnable-reset, anomaly round1-capture-missed (distinct from round >=2's 'unpinnable')", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srw-gov-"));
  try {
    const r1 = govern(dir, 1, "any-served");
    assert.equal(r1.code, 0);
    assert.equal(r1.result.action, "unpinnable-reset");
    assert.equal(r1.result.anomaly, "round1-capture-missed");
    assert.equal(r1.result.window_start, 1);

    const r3 = govern(dir, 3, "any-served");
    assert.equal(r3.result.action, "unpinnable-reset");
    assert.equal(r3.result.anomaly, "unpinnable", "round >= 2 gets the generic anomaly, not round1-capture-missed");
    assert.equal(r3.result.window_start, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("govern: late-pin-advance — the pin is first captured at round 2 (the FAFF-996 recovery case)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srw-gov-"));
  try {
    capturePin(dir, BACKENDS, 0, 2); // pin-capture.json{captured, round:2}, served-2.json == pin
    const { code, result } = govern(dir, 2, "any-served");
    assert.equal(code, 0);
    assert.equal(result.action, "late-pin-advance");
    assert.equal(result.window_start, 2, "convergence over [2..2] never compares round 1 vs round 2");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("govern: swap-reset fires from served-<n>.json even though the pin is still chain[0]", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srw-gov-"));
  try {
    capturePin(dir, BACKENDS, 0, 1); // pins backends[0] at round 1
    writeWindowStart(dir, 1);
    // The OCCUPANT records round 2's served identity as a DIFFERENT backend — never a
    // prep-side re-derivation from --resolve (which would return the pin first and miss this).
    atomicWriteJSON(servedIdentityPath(dir, 2), { round: 2, served_identity: backendIdentity(BACKENDS[1]), winner_index: 1, ts: new Date().toISOString() });
    const { code, result } = govern(dir, 2, "any-served");
    assert.equal(code, 0);
    assert.equal(result.action, "swap-reset");
    assert.equal(result.window_start, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("govern: unchanged when round 2 is served by the SAME backend as the pin", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srw-gov-"));
  try {
    capturePin(dir, BACKENDS, 0, 1);
    capturePin(dir, BACKENDS, 0, 2); // idempotent pin write; served-2.json records backends[0] again
    writeWindowStart(dir, 1);
    const { code, result } = govern(dir, 2, "any-served");
    assert.equal(code, 0);
    assert.equal(result.action, "unchanged");
    assert.equal(result.window_start, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("govern: soft pin-marker-missing (legacy pin, no capture marker) — full GovernanceResult asserted", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srw-gov-"));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pinned-reviewer.json"), JSON.stringify(BACKENDS[0]));
    atomicWriteJSON(servedIdentityPath(dir, 3), { round: 3, served_identity: backendIdentity(BACKENDS[0]), winner_index: 0, ts: new Date().toISOString() });
    const { code, result } = govern(dir, 3, "any-served");
    assert.equal(code, 0);
    assert.equal(result.anomaly, "pin-marker-missing");
    assert.equal(result.action, "unchanged");
    assert.equal(result.capture_state, "absent");
    assert.equal(result.capture_round, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("govern: soft pin-marker-contradiction (pin present, capture marker state != captured) — full GovernanceResult asserted", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srw-gov-"));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pinned-reviewer.json"), JSON.stringify(BACKENDS[0]));
    atomicWriteJSON(join(dir, "pin-capture.json"), { state: "failed", round: 1, reason: "x", ts: new Date().toISOString() });
    atomicWriteJSON(servedIdentityPath(dir, 3), { round: 3, served_identity: backendIdentity(BACKENDS[0]), winner_index: 0, ts: new Date().toISOString() });
    const { code, result } = govern(dir, 3, "any-served");
    assert.equal(code, 0);
    assert.equal(result.anomaly, "pin-marker-contradiction");
    assert.equal(result.capture_state, "failed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("govern: pin present, no served identity for this round → exit 2 fault WITH a governance-<n>.json record + window_start := n", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srw-gov-"));
  try {
    capturePin(dir, BACKENDS, 0, 1);
    const { code, result } = govern(dir, 5, "any-served"); // round 5 never served -> no served-5.json
    assert.equal(code, 2);
    assert.equal(result.action, "fault");
    assert.equal(result.anomaly, "served-identity-missing-or-malformed");
    assert.equal(existsSync(join(dir, "governance-5.json")), true, "the fault path STILL writes an audit artifact");
    assert.equal(readWindowStart(dir), 5, "unpinnable fail-safe: window_start narrows to n");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("govern: a torn/malformed served-<n>.json → the same fault, never a silent compare", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srw-gov-"));
  try {
    capturePin(dir, BACKENDS, 0, 1);
    writeFileSync(servedIdentityPath(dir, 2), "{ broken");
    const { code, result } = govern(dir, 2, "any-served");
    assert.equal(code, 2);
    assert.equal(result.anomaly, "served-identity-missing-or-malformed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("govern: a torn/field-stripped pinned-reviewer.json (degenerate '||') → pin-identity-malformed fault", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srw-gov-"));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pinned-reviewer.json"), "{ not json");
    const { code, result } = govern(dir, 1, "any-served");
    assert.equal(code, 2);
    assert.equal(result.anomaly, "pin-identity-malformed");
    assert.equal(existsSync(join(dir, "governance-1.json")), true, "the stored operand is gated symmetrically — still records");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("govern: the pinned-round happens-before-violation path (pin exists, served-<n>.json for THIS round not yet written) degrades to the same safe fault", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srw-gov-"));
  try {
    capturePin(dir, BACKENDS, 0, 1);
    const { code, result } = govern(dir, 2, "any-served"); // governed before served-2.json exists
    assert.equal(code, 2);
    assert.equal(result.anomaly, "served-identity-missing-or-malformed", "never a false unchanged/silent compare on an ordering violation");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("govern: every non-arg-error path writes governance-<n>.json with the full result shape", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srw-gov-"));
  try {
    govern(dir, 1, "no-lens");
    const g = JSON.parse(readFileSync(join(dir, "governance-1.json"), "utf8"));
    for (const key of ["round", "window_start", "action", "anomaly", "served_identity", "capture_state", "capture_round", "ts"]) {
      assert.ok(Object.prototype.hasOwnProperty.call(g, key), `governance record carries ${key}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI --govern: arg-validation combos (neither/both servedness, degenerate --round) → exit 2, NO record, window.json untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srw-gov-cli-"));
  try {
    writeWindowStart(dir, 1);
    const before = readFileSync(join(dir, "window.json"), "utf8");
    assert.equal(runCli(["spec-review-window", "--govern", "--round", "1", "--dir", dir]).code, 2, "neither servedness flag");
    assert.equal(runCli(["spec-review-window", "--govern", "--round", "1", "--any-served", "--no-lens", "--dir", dir]).code, 2, "both servedness flags");
    assert.equal(runCli(["spec-review-window", "--govern", "--round", "0", "--any-served", "--dir", dir]).code, 2, "--round 0");
    assert.equal(runCli(["spec-review-window", "--govern", "--round", "-1", "--any-served", "--dir", dir]).code, 2, "--round -1");
    assert.equal(runCli(["spec-review-window", "--govern", "--round", "1.5", "--any-served", "--dir", dir]).code, 2, "--round 1.5 (non-integer)");
    assert.equal(runCli(["spec-review-window", "--govern", "--any-served", "--dir", dir]).code, 2, "missing --round");
    assert.equal(existsSync(join(dir, "governance-1.json")), false, "no governance record from an arg-validation error");
    assert.equal(existsSync(join(dir, "governance-0.json")), false);
    assert.equal(readFileSync(join(dir, "window.json"), "utf8"), before, "window.json byte-unchanged");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI --govern: does NOT accept a --served override flag (Rev 8: removed — the occupant-written sidecar is the sole source)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srw-gov-noserved-"));
  try {
    const r = runCli(["spec-review-window", "--govern", "--round", "1", "--any-served", "--served", "openai|x|h", "--dir", dir]);
    assert.notEqual(r.code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI --govern: prints the GovernanceResult and persists window_start identically to the pure function", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-srw-gov-cli2-"));
  try {
    const r = runCli(["spec-review-window", "--govern", "--round", "1", "--no-lens", "--dir", dir]);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.action, "no-lens");
    assert.equal(parsed.round, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
