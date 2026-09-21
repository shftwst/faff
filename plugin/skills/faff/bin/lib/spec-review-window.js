// ===========================================================================
// === region:factory — spec-review-window — FAFF-909: persist the convergence window ===
// The prep↔review Spec-review loop grants the next round only while the reviewer is
// CONVERGING across one continuous conversation — the round range `[window_start .. n]`
// the convergence + churn checks are allowed to compare over. Before this module both
// halves of that state lived only in the prep agent's head: `window_start` and the round
// counter `n`. A sentry kill or a human unpark dropped `window_start` (re-initialised to
// 1) AND rewound the counter to 1, so a resumed loop OVERWROTE its own earlier
// `round-<n>.json` records and then compared convergence across records from different
// conversations — both a false yield and a false park, plus outright data loss.
//
// This module owns the two deterministic pieces that close both halves:
//   - `nextRoundNumber(dir)` — the next round number derived FROM DISK
//     (`max(roundFilesInDir) + 1`, or 1 for an empty/absent/unreadable dir), so a resumed
//     loop APPENDS `round-<max+1>.json` rather than rewriting `round-1.json`. The prep
//     agent stops holding a counter and asks disk each round.
//   - `readWindowStart(dir)` / `writeWindowStart(dir, n)` — the `$scratch/window.json`
//     sidecar holding a single persisted integer, read back on resume/unpark. An absent
//     marker defaults to 1 (fail-SAFE: a wider window can only make convergence harder to
//     reach, never easier, so it can only over-park, never over-yield).
//
// It parallels spec-review-pin.js (which groups the pin sidecar + `specReviewDir`) and
// reuses `roundFilesInDir` from spec-review-convergence.js — factory → factory is a legal
// require edge (ADR-0042), the same edge convergence already uses to reach churn.
//
// NO fingerprints, no hashing: the window is one persisted integer, so nothing here
// depends on byte-stable re-serialisation across a restart. ADDITIVE ONLY: the
// `round-<n>.json` body stays exactly `{verdict, objections}`; the window marker is a
// separate sidecar, exactly as `pinned-reviewer.json` (FAFF-886) sits beside the round
// records without touching them.
// ===========================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, usageError } = require("./argv");
const { roundFilesInDir } = require("./spec-review-convergence");
const {
  backendIdentity, isWellFormedIdentity, readCaptureOutcome, readServedIdentity, atomicWriteJSON,
  capturePin, captureNoLensServed, servedIdentityPath,
} = require("./spec-review-pin");

const WINDOW_MARKER = "window.json";

// nextRoundNumber(dir) -> the next 1-indexed round number to write.
//   max(roundFilesInDir(dir).n) + 1, or 1 when the directory is empty, absent, or
//   unreadable. This is the WRITE-path counter, so an unreadable dir returning 1 can
//   never silently overwrite anything — there is nothing on disk to overwrite.
function nextRoundNumber(dir) {
  let files;
  try {
    files = roundFilesInDir(dir);
  } catch (e) {
    // ENOENT / unreadable directory — a fresh loop starts at round 1.
    return 1;
  }
  if (!files.length) return 1;
  let max = 0;
  for (const f of files) if (f.n > max) max = f.n;
  return max + 1;
}

// A fail-loud marker error the CLI wrapper maps to exit 2. readWindowStart THROWS this
// only on a present-but-broken marker (a non-ENOENT read error, unparseable JSON, or an
// out-of-shape `window_start`) — never on an absent marker, which is the fail-safe
// default-to-1 path. Parity with the round-record readers' fail-loud policy.
class WindowMarkerError extends Error {
  constructor(detail) {
    super(detail);
    this.name = "WindowMarkerError";
    this.failLoud = true;
  }
}

// readWindowStart(dir) -> the persisted window_start integer.
//   Absent window.json                        -> 1 (fail-safe default; see the header).
//   Present but unreadable / corrupt / invalid -> throws WindowMarkerError (CLI exit 2).
// Extra fields in the marker are ignored (additive-tolerant), exactly as the round-record
// reader tolerates extra keys — only `window_start` is read.
function readWindowStart(dir) {
  const p = path.join(dir, WINDOW_MARKER);
  let raw;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return 1;
    // A present-but-unreadable sidecar (permission, etc.) is plumbing corruption.
    throw new WindowMarkerError(`${p} could not be read: ${e && e.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new WindowMarkerError(`${p} is not valid JSON: ${e && e.message}`);
  }
  const ws = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed.window_start : undefined;
  if (!Number.isInteger(ws) || ws < 1) {
    throw new WindowMarkerError(`${p} window_start is not an integer >= 1`);
  }
  return ws;
}

// writeWindowStart(dir, n) -> writes { "window_start": n } to $dir/window.json, creating
// the scratch dir if absent. Owns one write; the caller has already validated `n`.
function writeWindowStart(dir, n) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, WINDOW_MARKER), JSON.stringify({ window_start: n }));
}

// A strict integer-string check for the CLI's `--set N` / `--round N`: exactly one or
// more digits, value >= 1. Rejects "1.5", "1e2", "-1", "abc", "" — a usage error, never
// silently coerced.
function parsePositiveIntArg(s) {
  if (!/^\d+$/.test(String(s == null ? "" : s))) return null;
  const n = parseInt(s, 10);
  return n >= 1 ? n : null;
}

// ===========================================================================
// === FAFF-1052 — `--govern`: deterministic window governance ===
// The swap/window rule prep used to hand-derive (parse the occupant's served-backend
// header, compare against the pin, --set the window by hand) now lives here as one
// pure, unit-testable state machine, reading the occupant-written served-<n>.json (the
// SOLE served-identity source — no caller override, no prep-side re-derivation from a
// pin-first --resolve, which would compare the pin against itself on a fallback-served
// round and miss the swap). It writes governance-<n>.json on EVERY path it reaches —
// the exit-0 actions AND the served-path exit-2 faults — mirroring spec-review-pin.js's
// "records on every path" property for pin-capture.json, so the governance seam is
// mechanically symmetric to the capture seam rather than another silently-skippable
// prose step one seam up.
// ===========================================================================

function governanceRecordPath(dir, n) { return path.join(dir, `governance-${n}.json`); }

// readPinForGovernance(dir) -> the parsed pin object, or:
//   null  — pinned-reviewer.json is genuinely ABSENT (ENOENT)      -> the pin==null branch
//   {}    — pinned-reviewer.json is PRESENT but unreadable/torn/non-object -> a degenerate
//           "||" identity via backendIdentity({}), which isWellFormedIdentity() rejects,
//           taking the pin-identity-malformed fault path. A torn pin is never silently
//           read as "no pin" (that would wrongly take the softer unpinnable-reset instead
//           of the fault the spec names for this exact case).
function readPinForGovernance(dir) {
  const p = path.join(dir, "pinned-reviewer.json");
  let raw;
  try { raw = fs.readFileSync(p, "utf8"); }
  catch (e) {
    if (e && e.code === "ENOENT") return null;
    return {}; // present but unreadable — torn, not absent
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch (e) {
    return {}; // torn JSON — degenerate identity, never a silent "no pin"
  }
}

// The GovernanceResult's capture_state/capture_round cross-refs (Rev 6): "absent" /
// null when no pin-capture.json marker exists at all, else the marker's own state/round.
function captureCrossRefs(cap) {
  return {
    capture_state: cap && cap.state ? cap.state : "absent",
    capture_round: cap && Number.isInteger(cap.round) ? cap.round : null,
  };
}

// govern(dir, n, servedness) -> { code, result, detail? }. servedness is "no-lens" or
// "any-served" (the CLI has already enforced exactly-one-of + a validated round >= 1
// BEFORE calling this — this function does no arg validation of its own).
//   code 0 -> result is the persisted GovernanceResult.
//   code 2 -> a served-path fault (torn pin / missing-or-malformed served identity) OR a
//             malformed window.json; result is the persisted GovernanceResult on the
//             fault path (so a caller can log the anomaly), or null on the window.json
//             read fault (no governance record — the round never reached a decision).
function govern(dir, n, servedness) {
  const ts = new Date().toISOString();

  let ws;
  try {
    ws = readWindowStart(dir);
  } catch (e) {
    // A malformed window.json is plumbing corruption discovered before any governance
    // decision can be reached — fail loud exactly as --read already does. No record is
    // written (mirrors the pre-read arg-validation errors: the round never reached a
    // decision point this artifact could describe).
    return { code: 2, result: null, detail: e && e.message };
  }

  const pin = readPinForGovernance(dir);
  const cap = readCaptureOutcome(dir);
  const { capture_state, capture_round } = captureCrossRefs(cap);

  if (servedness === "no-lens") {
    // Nothing served this round: no comparable objections produced. window.json is NOT
    // rewritten — a legitimate no-op, recorded, never turned into a failure.
    const result = { round: n, window_start: ws, action: "no-lens", anomaly: null, served_identity: null, capture_state, capture_round, ts };
    atomicWriteJSON(governanceRecordPath(dir, n), result);
    return { code: 0, result };
  }

  // --any-served from here.
  // Served but NO pin -> UNPINNABLE. Checked BEFORE the served-identity requirement: a
  // FAFF-996 recurrence (occupant serves but dies before capture, so neither pin nor
  // served-<n>.json exists) MUST take this fail-safe, never the exit-2 below.
  if (pin === null) {
    writeWindowStart(dir, n);
    const anomaly = n === 1 ? "round1-capture-missed" : "unpinnable";
    const servedRec = readServedIdentity(dir, n);
    const result = {
      round: n, window_start: n, action: "unpinnable-reset", anomaly,
      served_identity: servedRec ? servedRec.served_identity : null,
      capture_state, capture_round, ts,
    };
    atomicWriteJSON(governanceRecordPath(dir, n), result);
    return { code: 0, result };
  }

  // Pin present -> a swap comparison is meaningful, so BOTH operands must be well-formed
  // ("one identity function, both sides", applied symmetrically) — the stored pin
  // identity first, since a torn pin makes the served-identity question moot.
  const pinIdentity = backendIdentity(pin);
  if (!isWellFormedIdentity(pinIdentity)) {
    writeWindowStart(dir, n);
    const result = { round: n, window_start: n, action: "fault", anomaly: "pin-identity-malformed", served_identity: null, capture_state, capture_round, ts };
    atomicWriteJSON(governanceRecordPath(dir, n), result);
    return { code: 2, result };
  }

  const servedRec = readServedIdentity(dir, n);
  const servedIdentity = servedRec ? servedRec.served_identity : undefined;
  if (servedIdentity == null || !isWellFormedIdentity(servedIdentity)) {
    // Pin present but no readable well-formed served reviewer for THIS round -> a
    // served-path fault + unpinnable fail-safe, never a silent compare.
    writeWindowStart(dir, n);
    const result = { round: n, window_start: n, action: "fault", anomaly: "served-identity-missing-or-malformed", served_identity: null, capture_state, capture_round, ts };
    atomicWriteJSON(governanceRecordPath(dir, n), result);
    return { code: 2, result };
  }

  let capRound;
  let anomaly;
  if (cap && cap.state === "captured") { capRound = cap.round; anomaly = null; }
  else { capRound = 1; anomaly = cap ? "pin-marker-contradiction" : "pin-marker-missing"; } // SOFT — recorded, not fatal

  let action = "unchanged";
  let newWs = ws;
  if (newWs < capRound) { newWs = capRound; action = "late-pin-advance"; } // (L) late pin
  if (servedIdentity !== pinIdentity) { newWs = n; action = "swap-reset"; } // (S) swap within a pinned span

  writeWindowStart(dir, newWs);
  const result = { round: n, window_start: newWs, action, anomaly, served_identity: servedIdentity, capture_state, capture_round, ts };
  atomicWriteJSON(governanceRecordPath(dir, n), result);
  return { code: 0, result };
}

// ---------------------------------------------------------------------------
// CLI wrapper
// ---------------------------------------------------------------------------
// `faff spec-review-window (--next-round | --read | --set N | --govern) --dir <scratch>`
//   --next-round : prints the next round integer (max+1, or 1 for empty/absent/unreadable)
//   --read       : prints the persisted window_start (1 when window.json absent; exit 2 on a
//                  present-but-malformed marker)
//   --set N      : writes { "window_start": N } (N an integer >= 1, else usage error exit 2)
//   --govern --round N (--any-served | --no-lens) : the FAFF-1052 deterministic window-
//                  governance state machine — see `govern()` above. --round and exactly
//                  one of the servedness flags are required; both are validated BEFORE
//                  any read (a bad combination or degenerate round writes no record and
//                  leaves window.json byte-unchanged).
// Exactly one of --next-round / --read / --set / --govern is required; --dir is required.
const SPEC_REVIEW_WINDOW_SPEC = {
  flags: {
    "--selftest": { arity: 0 },
    "--next-round": { arity: 0 },
    "--read": { arity: 0 },
    "--set": { arity: 1 },
    "--govern": { arity: 0 },
    "--round": { arity: 1 },
    "--any-served": { arity: 0 },
    "--no-lens": { arity: 0 },
    "--dir": { arity: 1 },
  },
};
const SPEC_REVIEW_WINDOW_USAGE =
  "usage: faff spec-review-window (--next-round | --read | --set N | " +
  "--govern --round N (--any-served | --no-lens)) --dir <scratch>";

function cmdSpecReviewWindow(args) {
  if (args.includes("--selftest")) return specReviewWindowSelftest();
  const { values, errors } = parseArgs(args, SPEC_REVIEW_WINDOW_SPEC);
  if (errors.length) return usageError(errors, SPEC_REVIEW_WINDOW_USAGE);

  const isNext = !!values["--next-round"];
  const isRead = !!values["--read"];
  const isSet = values["--set"] != null;
  const isGovern = !!values["--govern"];
  const modeCount = (isNext ? 1 : 0) + (isRead ? 1 : 0) + (isSet ? 1 : 0) + (isGovern ? 1 : 0);
  if (modeCount !== 1) {
    return usageError(
      [{ code: "missing-value", detail: "exactly one of --next-round / --read / --set / --govern is required" }],
      SPEC_REVIEW_WINDOW_USAGE,
    );
  }

  // --govern's own arg validation (servedness exactly-one-of, --round an integer >= 1)
  // runs BEFORE --dir is required and BEFORE any read — a bad combination or a
  // degenerate round is a pure usage error: no governance record, window.json untouched.
  // (Rev 10, judge UPHOLD p-03: mirrors --capture's --round requirement and
  // writeWindowStart's own window_start >= 1 gate, so no degenerate round ever reaches
  // writeWindowStart or the governance-<n>.json filename.)
  if (isGovern) {
    const anyServed = !!values["--any-served"];
    const noLens = !!values["--no-lens"];
    if (anyServed === noLens) {
      return usageError(
        [{ code: "missing-value", detail: "exactly one of --any-served / --no-lens is required for --govern" }],
        SPEC_REVIEW_WINDOW_USAGE,
      );
    }
    const n = parsePositiveIntArg(values["--round"]);
    if (n == null) {
      return usageError(
        [{ code: "invalid-value", detail: `--govern requires --round to be an integer >= 1, got "${values["--round"]}"` }],
        SPEC_REVIEW_WINDOW_USAGE,
      );
    }
    if (values["--dir"] == null) {
      return usageError([{ code: "missing-value", detail: "--dir is required" }], SPEC_REVIEW_WINDOW_USAGE);
    }
    const { code, result, detail } = govern(values["--dir"], n, anyServed ? "any-served" : "no-lens");
    if (result == null) {
      process.stderr.write(`faff spec-review-window: ${detail}\n`);
      return 2;
    }
    console.log(JSON.stringify(result));
    return code;
  }

  if (values["--dir"] == null) {
    return usageError([{ code: "missing-value", detail: "--dir is required" }], SPEC_REVIEW_WINDOW_USAGE);
  }
  const dir = values["--dir"];

  if (isNext) {
    console.log(String(nextRoundNumber(dir)));
    return 0;
  }

  if (isRead) {
    let ws;
    try {
      ws = readWindowStart(dir);
    } catch (e) {
      process.stderr.write(`faff spec-review-window: ${e && e.message}\n`);
      return 2;
    }
    console.log(String(ws));
    return 0;
  }

  // --set N
  const n = parsePositiveIntArg(values["--set"]);
  if (n == null) {
    return usageError(
      [{ code: "invalid-value", detail: `--set expects an integer >= 1, got "${values["--set"]}"` }],
      SPEC_REVIEW_WINDOW_USAGE,
    );
  }
  writeWindowStart(dir, n);
  console.log(JSON.stringify({ window_start: n }));
  return 0;
}

// ---------------------------------------------------------------------------
// Selftest — next-round derivation, marker round-trip, malformed-marker fail-loud.
// In-process CLI harness mirrors spec-review-pin.js / spec-review-convergence.js.
// ---------------------------------------------------------------------------
function runSpecReviewWindowForSelftest(args) {
  const origLog = console.log;
  let stdout = "";
  console.log = (s) => { stdout += String(s) + "\n"; };
  try { const code = cmdSpecReviewWindow(args); return { code, stdout }; }
  finally { console.log = origLog; }
}

function specReviewWindowSelftest() {
  let fail = 0;
  const ok = (label, cond) => { console.log(`${cond ? "ok  " : "FAIL"} ${label}`); if (!cond) fail++; };
  const os = require("node:os");

  // --- nextRoundNumber ---
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srw-next-"));
    try {
      ok("nextRoundNumber empty dir → 1", nextRoundNumber(tmp) === 1);
      for (const n of [1, 2, 3]) fs.writeFileSync(path.join(tmp, `round-${n}.json`), "{}");
      ok("nextRoundNumber round-1..3 present → 4", nextRoundNumber(tmp) === 4);
      // Numeric max, not lexical: a round-10 must push next to 11.
      fs.writeFileSync(path.join(tmp, "round-10.json"), "{}");
      ok("nextRoundNumber numeric max (round-10) → 11", nextRoundNumber(tmp) === 11);
      ok("nextRoundNumber absent dir → 1", nextRoundNumber(path.join(tmp, "nope")) === 1);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // --- window marker round-trip ---
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srw-marker-"));
    try {
      ok("readWindowStart absent marker → 1 (fail-safe default)", readWindowStart(tmp) === 1);
      writeWindowStart(tmp, 3);
      ok("writeWindowStart persists window_start", JSON.parse(fs.readFileSync(path.join(tmp, WINDOW_MARKER), "utf8")).window_start === 3);
      ok("readWindowStart round-trips 3", readWindowStart(tmp) === 3);
      writeWindowStart(tmp, 6);
      ok("readWindowStart round-trips a re-set 6", readWindowStart(tmp) === 6);
      // Extra fields tolerated on read.
      fs.writeFileSync(path.join(tmp, WINDOW_MARKER), JSON.stringify({ window_start: 4, extra: "ignored" }));
      ok("readWindowStart tolerates extra fields", readWindowStart(tmp) === 4);
      // writeWindowStart creates a missing dir.
      const fresh = path.join(tmp, "made", "here");
      writeWindowStart(fresh, 2);
      ok("writeWindowStart mkdir -p", readWindowStart(fresh) === 2);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // --- malformed marker → fail-loud ---
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srw-bad-"));
    try {
      fs.writeFileSync(path.join(tmp, WINDOW_MARKER), "not json at all");
      let threw = false;
      try { readWindowStart(tmp); } catch (e) { threw = e && e.failLoud === true; }
      ok("readWindowStart malformed JSON → throws WindowMarkerError", threw);

      fs.writeFileSync(path.join(tmp, WINDOW_MARKER), JSON.stringify({ window_start: 0 }));
      let threwZero = false;
      try { readWindowStart(tmp); } catch (e) { threwZero = e && e.failLoud === true; }
      ok("readWindowStart window_start 0 → throws (must be >= 1)", threwZero);

      fs.writeFileSync(path.join(tmp, WINDOW_MARKER), JSON.stringify({ window_start: "3" }));
      let threwStr = false;
      try { readWindowStart(tmp); } catch (e) { threwStr = e && e.failLoud === true; }
      ok("readWindowStart non-integer window_start → throws", threwStr);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // --- CLI round-trip via the in-process harness ---
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srw-cli-"));
    try {
      const next0 = runSpecReviewWindowForSelftest(["--next-round", "--dir", tmp]);
      ok("CLI --next-round empty → 1, exit 0", next0.code === 0 && next0.stdout.trim() === "1");
      for (const n of [1, 2, 3]) fs.writeFileSync(path.join(tmp, `round-${n}.json`), "{}");
      const next4 = runSpecReviewWindowForSelftest(["--next-round", "--dir", tmp]);
      ok("CLI --next-round round-1..3 → 4", next4.code === 0 && next4.stdout.trim() === "4");

      const read1 = runSpecReviewWindowForSelftest(["--read", "--dir", tmp]);
      ok("CLI --read absent marker → 1", read1.code === 0 && read1.stdout.trim() === "1");
      const set = runSpecReviewWindowForSelftest(["--set", "3", "--dir", tmp]);
      ok("CLI --set 3 exit 0", set.code === 0 && JSON.parse(set.stdout).window_start === 3);
      const read3 = runSpecReviewWindowForSelftest(["--read", "--dir", tmp]);
      ok("CLI --read after --set 3 → 3", read3.code === 0 && read3.stdout.trim() === "3");

      const badSet = runSpecReviewWindowForSelftest(["--set", "0", "--dir", tmp]);
      ok("CLI --set 0 → usage error (exit 2)", badSet.code === 2);
      const badSet2 = runSpecReviewWindowForSelftest(["--set", "1.5", "--dir", tmp]);
      ok("CLI --set 1.5 → usage error (exit 2)", badSet2.code === 2);

      fs.writeFileSync(path.join(tmp, WINDOW_MARKER), "not json");
      const badRead = runSpecReviewWindowForSelftest(["--read", "--dir", tmp]);
      ok("CLI --read malformed marker → exit 2 (fail-loud)", badRead.code === 2);

      const noMode = runSpecReviewWindowForSelftest(["--dir", tmp]);
      ok("CLI no mode flag → usage error", noMode.code !== 0);
      const noDir = runSpecReviewWindowForSelftest(["--read"]);
      ok("CLI --read without --dir → usage error", noDir.code !== 0);
      const twoModes = runSpecReviewWindowForSelftest(["--read", "--next-round", "--dir", tmp]);
      ok("CLI two mode flags → usage error", twoModes.code !== 0);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // --- FAFF-1052: --govern deterministic window governance ---
  {
    const backends = [
      { provider: "openai", model: "mA", host: "https://a/v1" },
      { provider: "nvidia", model: "mB", host: "https://b/v1" },
    ];

    // no-lens: governance written, window.json byte-unchanged.
    {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srw-gov-nolens-"));
      try {
        writeWindowStart(tmp, 1);
        const before = fs.readFileSync(path.join(tmp, WINDOW_MARKER), "utf8");
        const r = govern(tmp, 1, "no-lens");
        ok("govern no-lens → action:no-lens, exit 0", r.code === 0 && r.result.action === "no-lens");
        ok("govern no-lens → window.json byte-unchanged", fs.readFileSync(path.join(tmp, WINDOW_MARKER), "utf8") === before);
        ok("govern no-lens → governance-1.json written", fs.existsSync(path.join(tmp, "governance-1.json")));
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }

    // round-1-capture-missed vs unpinnable: served but no pin.
    {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srw-gov-unpin-"));
      try {
        const r1 = govern(tmp, 1, "any-served");
        ok("govern served round 1, no pin → unpinnable-reset + round1-capture-missed", r1.code === 0 && r1.result.action === "unpinnable-reset" && r1.result.anomaly === "round1-capture-missed");
        ok("govern round1-capture-missed → window_start:1", r1.result.window_start === 1);
        const r3 = govern(tmp, 3, "any-served");
        ok("govern served round 3, no pin → anomaly:unpinnable (not round1)", r3.code === 0 && r3.result.action === "unpinnable-reset" && r3.result.anomaly === "unpinnable");
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }

    // late-pin-advance: pin captured round 2 (served-2 == pin).
    {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srw-gov-late-"));
      try {
        capturePin(tmp, backends, 0, 2); // pin first written at round 2
        const r = govern(tmp, 2, "any-served");
        ok("govern late-pin-advance", r.code === 0 && r.result.action === "late-pin-advance" && r.result.window_start === 2);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }

    // swap-reset: healthy pin round 1, a DIFFERENT backend serves round 2 (via served-2.json).
    {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srw-gov-swap-"));
      try {
        capturePin(tmp, backends, 0, 1); // pins backends[0] at round 1
        writeWindowStart(tmp, 1);
        atomicWriteJSON(servedIdentityPath(tmp, 2), { round: 2, served_identity: backendIdentity(backends[1]), winner_index: 1, ts: new Date().toISOString() });
        const r = govern(tmp, 2, "any-served");
        ok("govern swap-reset fires even though pin is chain[0]", r.code === 0 && r.result.action === "swap-reset" && r.result.window_start === 2);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }

    // unchanged: healthy pin, round 2 served by the SAME backend.
    {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srw-gov-unchanged-"));
      try {
        capturePin(tmp, backends, 0, 1);
        capturePin(tmp, backends, 0, 2); // idempotent pin, records served-2.json == pin
        writeWindowStart(tmp, 1);
        const r = govern(tmp, 2, "any-served");
        ok("govern unchanged when served == pin", r.code === 0 && r.result.action === "unchanged" && r.result.window_start === 1);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }

    // soft pin-marker-missing / pin-marker-contradiction: pin present, capture marker absent/contradictory.
    {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srw-gov-softpin-"));
      try {
        fs.mkdirSync(tmp, { recursive: true });
        fs.writeFileSync(path.join(tmp, "pinned-reviewer.json"), JSON.stringify(backends[0])); // legacy pin, no marker
        atomicWriteJSON(servedIdentityPath(tmp, 3), { round: 3, served_identity: backendIdentity(backends[0]), winner_index: 0, ts: new Date().toISOString() });
        const r = govern(tmp, 3, "any-served");
        ok("govern pin-marker-missing (soft, non-fatal)", r.code === 0 && r.result.anomaly === "pin-marker-missing" && r.result.action === "unchanged");

        atomicWriteJSON(path.join(tmp, "pin-capture.json"), { state: "failed", round: 1, reason: "x", ts: new Date().toISOString() });
        const r2 = govern(tmp, 3, "any-served");
        ok("govern pin-marker-contradiction (soft, non-fatal)", r2.code === 0 && r2.result.anomaly === "pin-marker-contradiction");
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }

    // pin-present-no-served-identity fault: pin exists, served-<n>.json absent for round n.
    {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srw-gov-fault-"));
      try {
        capturePin(tmp, backends, 0, 1);
        const r = govern(tmp, 5, "any-served"); // round 5 never served -> no served-5.json
        ok("govern pin-present-no-served-identity → exit 2 fault", r.code === 2 && r.result.action === "fault" && r.result.anomaly === "served-identity-missing-or-malformed");
        ok("govern fault still WRITES governance-5.json (records on every path)", fs.existsSync(path.join(tmp, "governance-5.json")));
        ok("govern fault sets window_start := n (unpinnable fail-safe)", readWindowStart(tmp) === 5);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }

    // malformed served-<n>.json -> same fault, never a silent compare.
    {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srw-gov-tornserved-"));
      try {
        capturePin(tmp, backends, 0, 1);
        fs.writeFileSync(servedIdentityPath(tmp, 2), "{ broken");
        const r = govern(tmp, 2, "any-served");
        ok("govern torn served-<n>.json → fault (never a silent compare)", r.code === 2 && r.result.anomaly === "served-identity-missing-or-malformed");
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }

    // torn/field-stripped pinned-reviewer.json -> pin-identity-malformed fault.
    {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srw-gov-tornpin-"));
      try {
        fs.mkdirSync(tmp, { recursive: true });
        fs.writeFileSync(path.join(tmp, "pinned-reviewer.json"), "{ not json");
        const r = govern(tmp, 1, "any-served");
        ok("govern torn pinned-reviewer.json → pin-identity-malformed fault", r.code === 2 && r.result.anomaly === "pin-identity-malformed");
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }

    // the pinned-round happens-before-violation path: pin present, served-<n>.json absent for
    // THIS round (the ordering-violation fail-safe named in the spec's Assumes section).
    {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srw-gov-ordering-"));
      try {
        capturePin(tmp, backends, 0, 1);
        const r = govern(tmp, 2, "any-served"); // round 2 governed before any served-2.json exists
        ok("govern ordering-violation (pinned round, no served-<n>.json yet) → same fault, safe over-park", r.code === 2 && r.result.anomaly === "served-identity-missing-or-malformed");
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }

    // arg-validation combos → exit 2, NO record, window.json byte-unchanged.
    {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srw-gov-argval-"));
      try {
        writeWindowStart(tmp, 1);
        const before = fs.readFileSync(path.join(tmp, WINDOW_MARKER), "utf8");
        const neither = runSpecReviewWindowForSelftest(["--govern", "--round", "1", "--dir", tmp]);
        ok("govern neither servedness flag → exit 2", neither.code === 2);
        const both = runSpecReviewWindowForSelftest(["--govern", "--round", "1", "--any-served", "--no-lens", "--dir", tmp]);
        ok("govern both servedness flags → exit 2", both.code === 2);
        const zero = runSpecReviewWindowForSelftest(["--govern", "--round", "0", "--any-served", "--dir", tmp]);
        ok("govern --round 0 → exit 2 usage error", zero.code === 2);
        const neg = runSpecReviewWindowForSelftest(["--govern", "--round", "-1", "--any-served", "--dir", tmp]);
        ok("govern --round -1 → exit 2 usage error", neg.code === 2);
        const nonInt = runSpecReviewWindowForSelftest(["--govern", "--round", "1.5", "--any-served", "--dir", tmp]);
        ok("govern --round 1.5 (non-integer) → exit 2 usage error", nonInt.code === 2);
        const missing = runSpecReviewWindowForSelftest(["--govern", "--any-served", "--dir", tmp]);
        ok("govern missing --round → exit 2 usage error", missing.code === 2);
        ok("govern arg-validation errors write NO governance record", !fs.existsSync(path.join(tmp, "governance-1.json")) && !fs.existsSync(path.join(tmp, "governance-0.json")));
        ok("govern arg-validation errors leave window.json byte-unchanged", fs.readFileSync(path.join(tmp, WINDOW_MARKER), "utf8") === before);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }

    // no --served override accepted (Rev 8: removed).
    {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srw-gov-noserved-flag-"));
      try {
        const r = runSpecReviewWindowForSelftest(["--govern", "--round", "1", "--any-served", "--served", "openai|x|h", "--dir", tmp]);
        ok("govern does NOT accept a --served override flag", r.code !== 0);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }

    // CLI round-trip: --govern via the harness matches the pure govern() result.
    {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srw-gov-cli-"));
      try {
        const cli = runSpecReviewWindowForSelftest(["--govern", "--round", "1", "--no-lens", "--dir", tmp]);
        ok("CLI --govern --no-lens exit 0", cli.code === 0);
        const parsed = JSON.parse(cli.stdout);
        ok("CLI --govern prints the GovernanceResult", parsed.action === "no-lens" && parsed.round === 1);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (spec-review-window, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  nextRoundNumber,
  readWindowStart,
  writeWindowStart,
  WindowMarkerError,
  govern,
  cmdSpecReviewWindow,
  specReviewWindowSelftest,
};
