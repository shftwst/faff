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

// A strict integer-string check for the CLI's `--set N`: exactly one or more digits,
// value >= 1. Rejects "1.5", "1e2", "-1", "abc", "" — a usage error, never silently coerced.
function parsePositiveIntArg(s) {
  if (!/^\d+$/.test(String(s == null ? "" : s))) return null;
  const n = parseInt(s, 10);
  return n >= 1 ? n : null;
}

// ---------------------------------------------------------------------------
// CLI wrapper
// ---------------------------------------------------------------------------
// `faff spec-review-window (--next-round | --read | --set N) --dir <scratch>`
//   --next-round : prints the next round integer (max+1, or 1 for empty/absent/unreadable)
//   --read       : prints the persisted window_start (1 when window.json absent; exit 2 on a
//                  present-but-malformed marker)
//   --set N      : writes { "window_start": N } (N an integer >= 1, else usage error exit 2)
// Exactly one of --next-round / --read / --set is required; --dir is required.
const SPEC_REVIEW_WINDOW_SPEC = {
  flags: {
    "--selftest": { arity: 0 },
    "--next-round": { arity: 0 },
    "--read": { arity: 0 },
    "--set": { arity: 1 },
    "--dir": { arity: 1 },
  },
};
const SPEC_REVIEW_WINDOW_USAGE =
  "usage: faff spec-review-window (--next-round | --read | --set N) --dir <scratch>";

function cmdSpecReviewWindow(args) {
  if (args.includes("--selftest")) return specReviewWindowSelftest();
  const { values, errors } = parseArgs(args, SPEC_REVIEW_WINDOW_SPEC);
  if (errors.length) return usageError(errors, SPEC_REVIEW_WINDOW_USAGE);

  const isNext = !!values["--next-round"];
  const isRead = !!values["--read"];
  const isSet = values["--set"] != null;
  const modeCount = (isNext ? 1 : 0) + (isRead ? 1 : 0) + (isSet ? 1 : 0);
  if (modeCount !== 1) {
    return usageError(
      [{ code: "missing-value", detail: "exactly one of --next-round / --read / --set is required" }],
      SPEC_REVIEW_WINDOW_USAGE,
    );
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

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (spec-review-window, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  nextRoundNumber,
  readWindowStart,
  writeWindowStart,
  WindowMarkerError,
  cmdSpecReviewWindow,
  specReviewWindowSelftest,
};
