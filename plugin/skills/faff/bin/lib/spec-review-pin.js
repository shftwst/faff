// ===========================================================================
// === region:factory — spec-review-pin — FAFF-886: pin the spec-review reviewer ===
// across the rounds of one spec's loop, so a flapping backend can't silently swap
// the serving reviewer mid-loop and make a converging spec read as churn.
//
// The prep↔review convergence + churn detectors (spec-review-convergence.js,
// spec-review-churn.js) grant/deny the next round from a TREND over per-round
// objection records, which is only meaningful if the SAME reviewer produces every
// round. The L4 adversarial spec_review occupant re-assembles its primary-first
// chain and walks it from index 0 every round, so a 429/timeout on a later round
// promotes a different model whose fresh objections read as churn / a count bump.
//
// This module is the deterministic pin the occupant resolves its chain through:
//   - `resolvePinChain(cfg, scratchDir, consumer)` — PREFER-WITH-FALLBACK: with a
//     pin present, emit `[pin, ...rest]` (pin first, the rest of the assembled chain
//     behind it, pin de-duped) so the pinned reviewer serves every round it is
//     reachable and a rate-limited pin round FALLS BACK to the tail instead of
//     hard-parking. Round 1 (no pin) → the full assembled chain unchanged.
//   - `capturePin(scratchDir, chain, winnerIndex)` — idempotent first-write of the
//     round-1 served backend (chain[winnerIndex]) as the out-of-band pin sidecar.
//   - `specReviewDir(issue, runDir)` — the one resolver both the round records and
//     the pin use, so interactive (no $FAFF_RUN_DIR) and autonomous never disagree.
//
// ADDITIVE ONLY: the round-record JSON, the spec-review-verdict contract schema, and
// the two reviewer-blind detectors are UNTOUCHED (spec-review-convergence.js:16's
// "NO schema change" commitment holds). The swap-round window reset that keeps a
// forced fallback from reading as churn is a LOOP-level action (faff-prep prose),
// not a detector change — nothing here teaches a detector about backends.
// ===========================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parseArgs, usageError } = require("./argv");
const { findRoot } = require("./shared-infra");
const { loadConfig } = require("./config");
const { assembleAdversarialBackends } = require("./adversarial-backends");

// The backend-identity keys — two chain elements are "the same backend" when their
// serving identity (provider/model/host) matches. This is what the pin de-dup keys
// on so the pinned backend is never tried twice in `[pin, ...rest]`, and it is the
// same identity a caller compares the served header against to detect a swap round.
const IDENTITY_KEYS = ["provider", "model", "host"];

// PURE: identity signature of a backend object (provider|model|host). A non-object
// yields a stable empty signature so it never accidentally matches a real backend.
function backendIdentity(b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) return "|";
  return IDENTITY_KEYS.map((k) => (b[k] == null ? "" : String(b[k]))).join("|");
}

// ===========================================================================
// === FAFF-1052 — non-silent, asserted, fail-safe round-1 pin capture ===
// Shared primitives the capture seam AND the window-governance seam (spec-review-
// window.js) both build on: a bounded/control-char scrub for any value derived from
// untrusted --backends-json before it is persisted, a well-formedness check on a
// backendIdentity() string (the single gate BOTH sides of a swap comparison pass
// through — "one identity function, both sides"), and one atomic write-temp-rename
// idiom every new sidecar (pin-capture.json / served-<n>.json / governance-<n>.json,
// plus pinned-reviewer.json itself) uses, mirroring heartbeat.js's
// atomicWriteSingleValueFile idiom (per-call-unique tmp name, best-effort unlink on
// a failed write, never a silent partial write).
// ===========================================================================

// scrub(s) -> a bounded (<=200 chars), control-char-stripped string. Applied to every
// value derived from --backends-json (an untrusted, agent-supplied file) before it is
// persisted into a marker: `reason` (CLI-authored, but the bounded-detail suffix may
// echo untrusted shape info) and `backend_identity`/`served_identity` (derived from
// the untrusted chain via backendIdentity()). Never claims to sanitise for any purpose
// other than bounding size + stripping control chars (no HTML/shell escaping).
function scrub(s) {
  if (s == null) return "";
  // eslint-disable-next-line no-control-regex
  const stripped = String(s).replace(/[\x00-\x1F\x7F]/g, "");
  return stripped.length > 200 ? stripped.slice(0, 200) : stripped;
}

// isWellFormedIdentity(s) -> true iff s is exactly three non-empty pipe-delimited
// segments (provider|model|host). Rejects backendIdentity()'s own degenerate "|"
// (non-object input) and a torn/field-stripped identity like "||" or "a||b". This is
// the single well-formedness gate BOTH operands of a swap comparison pass through
// (the stored pin identity AND the served identity) — a torn record on either side
// fails loud rather than silently comparing.
function isWellFormedIdentity(s) {
  if (typeof s !== "string") return false;
  const parts = s.split("|");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

// atomicWriteJSON(target, obj) -> write-temp-rename, per-call-unique tmp name (so two
// concurrent writers never race the SAME tmp path), best-effort unlink + re-throw on
// any fault. Mirrors heartbeat.js's atomicWriteSingleValueFile idiom; duplicated here
// (rather than imported) to avoid a factory->factory require cycle now that
// spec-review-window.js requires FROM this module.
function atomicWriteJSON(target, obj) {
  const tmp = `${target}.tmp.${process.pid}.${crypto.randomBytes(6).toString("hex")}`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* best-effort — tmp may never have been created */ }
    throw e;
  }
}

function pinCapturePath(dir) { return path.join(dir, "pin-capture.json"); }
function servedIdentityPath(dir, n) { return path.join(dir, `served-${n}.json`); }

// readCaptureOutcome(dir) -> the parsed PinCaptureOutcome, or null when pin-capture.json
// is absent OR unreadable/unparseable (a torn marker is treated exactly like "no marker"
// for the SOFT capRound/anomaly derivation --govern applies — it is never a hard swap
// operand, so there is no case where distinguishing "absent" from "torn" changes the
// governance outcome).
function readCaptureOutcome(dir) {
  let raw;
  try { raw = fs.readFileSync(pinCapturePath(dir), "utf8"); }
  catch { return null; }
  try { return JSON.parse(raw); } catch { return null; }
}

// readServedIdentity(dir, n) -> the parsed ServedIdentity record for round n, or null
// when served-<n>.json is absent OR unreadable/unparseable. --govern treats a null
// return as "no served identity" (a required swap operand), which is what drives the
// served-identity-missing-or-malformed fault — so ENOENT and a torn file both take the
// same fail-safe path, never a silent compare against a partially-parsed record.
function readServedIdentity(dir, n) {
  let raw;
  try { raw = fs.readFileSync(servedIdentityPath(dir, n), "utf8"); }
  catch { return null; }
  try { return JSON.parse(raw); } catch { return null; }
}

// A strict integer-string check (exactly one or more digits, value >= 1). Rejects
// "1.5", "1e2", "-1", "abc", "" — a usage error, never silently coerced. Duplicated
// (not shared) from spec-review-window.js's identical helper to avoid a factory->
// factory require cycle (spec-review-window.js already requires FROM this module).
function parsePositiveIntArg(s) {
  if (!/^\d+$/.test(String(s == null ? "" : s))) return null;
  const n = parseInt(s, 10);
  return n >= 1 ? n : null;
}

// The fixed failure-kind vocabulary `--capture`'s failed/skipped-no-lens paths author
// `reason` from — never the verbatim contents of --backends-json. Every reason string
// passes through scrub() before it is persisted.
const NO_LENS_REASON = "empty exit-0 set";

// PURE: resolve the chain the occupant fans out over, keyed on the pin sidecar.
//   No pin file  → { chain: <full assembled>, pinned: false } (round 1 / unpinned).
//   Pin present  → { chain: [pin, ...rest], pinned: true } — pin FIRST, the rest of
//                  the assembled chain behind it as the fallback tail, pin de-duped
//                  out of the tail so it is never tried twice.
// Error passthrough mirrors `assembleAdversarialBackends` so the occupant's existing
// exit-3/2 handling is unchanged on the unpinned path:
//   { error: "unset" }        — no adversarial provider (caller → exit 3)
//   { error: "malformed" }    — unparseable config chain (caller → exit 2)
//   { error: "pin-malformed" }— present-but-corrupt pinned-reviewer.json (caller →
//                              exit 2, fail-loud; NEVER a silent bare full chain — a
//                              broken pin is a plumbing fault, not a licence to un-pin).
function resolvePinChain(cfg, scratchDir, consumer) {
  // Always assemble — it is the fallback tail, and the round-1/unpinned result.
  const assembled = assembleAdversarialBackends(cfg, consumer);
  if (assembled.error) return { error: assembled.error, detail: assembled.detail };

  const pinPath = path.join(scratchDir, "pinned-reviewer.json");
  let raw;
  try {
    raw = fs.readFileSync(pinPath, "utf8");
  } catch (e) {
    // ENOENT (no pin yet) → round-1/unpinned full chain. A different read error
    // (permission, etc.) is a genuine fault — surface it as pin-malformed rather
    // than silently dropping the pin.
    if (e && e.code === "ENOENT") return { chain: assembled.chain, pinned: false };
    return { error: "pin-malformed", detail: `pinned-reviewer.json could not be read: ${e && e.message}` };
  }

  let pin;
  try {
    pin = JSON.parse(raw);
  } catch (e) {
    return { error: "pin-malformed", detail: `pinned-reviewer.json is not valid JSON: ${e && e.message}` };
  }
  if (!pin || typeof pin !== "object" || Array.isArray(pin)) {
    return { error: "pin-malformed", detail: "pinned-reviewer.json is not a backend object" };
  }

  const pinSig = backendIdentity(pin);
  const rest = assembled.chain.filter((b) => backendIdentity(b) !== pinSig); // de-dup the pin out of the tail
  return { chain: [pin, ...rest], pinned: true };
}

// capturePin(scratchDir, chain, winnerIndex, round) — the served-capture path (FAFF-1052
// made `round` a required 4th argument; every caller must pass the round the outcome
// belongs to, since it is now recorded in pin-capture.json/served-<n>.json and used to
// name the served-identity sidecar). Idempotent first-write of the pin: if the pin
// already exists (rounds >= the first-pinned round) the pin write is a no-op, but
// served-<n>.json is written on EVERY served round regardless — the round-2+ recording
// the round-2 architectural fix depends on (a governed round always has a served
// identity to read, even when the pin write itself is a no-op). An out-of-range index,
// a non-array chain, or a non-object element writes pin-capture.json{state:"failed",
// reason} BEFORE returning fail-loud { error: "bad-capture" } (caller -> exit 2) — a
// failed capture is never silent (FAFF-1052's "candidate cause #2" class).
function capturePin(scratchDir, chain, winnerIndex, round) {
  const pinPath = path.join(scratchDir, "pinned-reviewer.json");
  const ts = () => new Date().toISOString();

  const writeFailedMarker = (reason) => {
    atomicWriteJSON(pinCapturePath(scratchDir), { state: "failed", round, reason: scrub(reason), ts: ts() });
  };

  if (fs.existsSync(pinPath)) {
    // Rounds >= the first-pinned round: the pin write is idempotent (never overwritten),
    // but THIS round's served identity is still recorded — the occupant is the only actor
    // that authoritatively knows who served round n, so --govern always has a served-<n>.json
    // to read even on a no-op capture. A malformed chain/index here degrades to a "|" identity
    // (never a hard failure — the pin itself is already safely established), which
    // isWellFormedIdentity() rejects downstream at --govern time rather than here.
    const candidate = Array.isArray(chain) && Number.isInteger(winnerIndex) ? chain[winnerIndex] : null;
    const id = scrub(backendIdentity(candidate));
    atomicWriteJSON(servedIdentityPath(scratchDir, round), { round, served_identity: id, winner_index: winnerIndex, ts: ts() });
    return { written: false };
  }

  if (!Array.isArray(chain)) {
    const detail = "backends chain is not an array";
    writeFailedMarker(detail);
    return { error: "bad-capture", detail };
  }
  if (!Number.isInteger(winnerIndex) || winnerIndex < 0 || winnerIndex >= chain.length) {
    const detail = `winner-index ${winnerIndex} out of range (chain length ${chain.length})`;
    writeFailedMarker(detail);
    return { error: "bad-capture", detail };
  }
  const pin = chain[winnerIndex];
  if (!pin || typeof pin !== "object" || Array.isArray(pin)) {
    const detail = `chain[${winnerIndex}] is not a backend object`;
    writeFailedMarker(detail);
    return { error: "bad-capture", detail };
  }
  const id = scrub(backendIdentity(pin));
  atomicWriteJSON(pinPath, pin);
  atomicWriteJSON(pinCapturePath(scratchDir), { state: "captured", round, winner_index: winnerIndex, backend_identity: id, ts: ts() });
  atomicWriteJSON(servedIdentityPath(scratchDir, round), { round, served_identity: id, winner_index: winnerIndex, ts: ts() });
  return { written: true, marker_written: true };
}

// captureNoLensServed(scratchDir, round) — the empty-exit-0-set path. Writes NO pin and
// NO served-<n>.json (there is no served identity to record); writes
// pin-capture.json{state:"skipped-no-lens"} so the round's legitimate no-op is a disk-
// recorded fact, distinguishable from a silent non-run. Always succeeds (exit 0).
function captureNoLensServed(scratchDir, round) {
  atomicWriteJSON(pinCapturePath(scratchDir), { state: "skipped-no-lens", round, reason: NO_LENS_REASON, ts: new Date().toISOString() });
  return { state: "skipped-no-lens" };
}

// PURE: the per-spec scratch dir both the round records and the pin resolve through.
//   run-dir resolvable (flag, else $FAFF_RUN_DIR) → <run-dir>/<ISSUE>/spec-review
//   otherwise (interactive, no run-dir)           → .faff/spec-review/<ISSUE>
// --run-dir (explicit) wins over $FAFF_RUN_DIR (ambient), mirroring review-call.mjs.
// Pure path computation — never creates the dir (callers create on first write).
function specReviewDir(issue, runDir) {
  if (runDir) return path.join(runDir, issue, "spec-review");
  return path.join(".faff", "spec-review", issue);
}

// ---------------------------------------------------------------------------
// CLI wrappers
// ---------------------------------------------------------------------------
const SPEC_REVIEW_PIN_SPEC = {
  flags: {
    "--selftest": { arity: 0 },
    "--resolve": { arity: 0 },
    "--capture": { arity: 0 },
    "--dir": { arity: 1 },
    "--consumer": { arity: 1 },
    "--root": { arity: 1 },
    "--backends-json": { arity: 1 },
    "--winner-index": { arity: 1 },
    "--no-lens-served": { arity: 0 },
    "--round": { arity: 1 },
    // --json wraps the resolve output as { chain, pinned }; the DEFAULT prints the bare
    // chain array, byte-identical to `faff adversarial-backends` so it is a drop-in for
    // the occupant's `--backends-json` mapper (which consumes a bare array). Mirrors
    // `adversarial-backends`'s array-default + accepted-and-ignored --json convention.
    "--json": { arity: 0 },
  },
};
const SPEC_REVIEW_PIN_USAGE =
  "usage: faff spec-review-pin (--resolve --dir <scratch> --consumer <name> [--root DIR] | " +
  "--capture --dir <scratch> --round <n> (--backends-json <file> --winner-index <i> | --no-lens-served))";

function cmdSpecReviewPin(args) {
  if (args.includes("--selftest")) return specReviewPinSelftest();
  const { values, errors } = parseArgs(args, SPEC_REVIEW_PIN_SPEC);
  if (errors.length) return usageError(errors, SPEC_REVIEW_PIN_USAGE);

  const isResolve = values["--resolve"];
  const isCapture = values["--capture"];
  if (isResolve === isCapture) {
    return usageError([{ code: "missing-value", detail: "exactly one of --resolve / --capture is required" }], SPEC_REVIEW_PIN_USAGE);
  }
  if (values["--dir"] == null) {
    return usageError([{ code: "missing-value", detail: "--dir is required" }], SPEC_REVIEW_PIN_USAGE);
  }
  const dir = values["--dir"];

  if (isResolve) {
    const root = values["--root"] || findRoot();
    const [cfg] = loadConfig(root);
    const res = resolvePinChain(cfg, dir, values["--consumer"]);
    if (res.error === "unset") {
      process.stderr.write(
        "faff spec-review-pin: adversarial is unset (or its host is unset) — no adversarial provider " +
        "configured; the calling skill's --host-source default → needs-human path applies\n");
      return 3;
    }
    if (res.error === "malformed") {
      process.stderr.write(`faff spec-review-pin: ${res.detail}\n`);
      return 2;
    }
    if (res.error === "pin-malformed") {
      process.stderr.write(`faff spec-review-pin: ${res.detail}\n`);
      return 2;
    }
    // Default: the bare chain array (drop-in for `adversarial-backends`, the shape
    // review-call.mjs's --backends-json mapper consumes). --json: the { chain, pinned }
    // wrapper for callers/tests that want the pinned flag.
    console.log(JSON.stringify(values["--json"] ? { chain: res.chain, pinned: res.pinned } : res.chain));
    return 0;
  }

  // --capture: --round is REQUIRED on both the served and no-lens-served forms (no
  // default — an implicit round silently breaks late-pin detection); --winner-index and
  // --no-lens-served are mutually exclusive, exactly one of {served capture,
  // --no-lens-served} per call. All of this is arg validation, checked before any read.
  const round = parsePositiveIntArg(values["--round"]);
  if (round == null) {
    return usageError([{ code: "missing-value", detail: "--round is required for --capture and must be an integer >= 1" }], SPEC_REVIEW_PIN_USAGE);
  }
  const noLensServed = !!values["--no-lens-served"];
  const hasWinnerIndex = values["--winner-index"] != null;
  if (noLensServed === hasWinnerIndex) {
    return usageError([{ code: "missing-value", detail: "exactly one of --winner-index / --no-lens-served is required for --capture" }], SPEC_REVIEW_PIN_USAGE);
  }

  if (noLensServed) {
    const res = captureNoLensServed(dir, round);
    console.log(JSON.stringify(res));
    return 0;
  }

  if (values["--backends-json"] == null) {
    return usageError([{ code: "missing-value", detail: "--backends-json is required for a served --capture" }], SPEC_REVIEW_PIN_USAGE);
  }
  const winnerIndex = Number(values["--winner-index"]);
  let chain;
  try {
    chain = JSON.parse(fs.readFileSync(values["--backends-json"], "utf8"));
  } catch (e) {
    // A failed --backends-json read/parse is candidate-cause #2 from the FAFF-1052 spec —
    // never silent: write pin-capture.json{failed} before the existing exit 2.
    const reason = `--backends-json could not be read as JSON: ${e && e.message}`;
    atomicWriteJSON(pinCapturePath(dir), { state: "failed", round, reason: scrub(reason), ts: new Date().toISOString() });
    process.stderr.write(`faff spec-review-pin: ${reason}\n`);
    return 2;
  }
  const res = capturePin(dir, chain, winnerIndex, round);
  if (res.error) {
    process.stderr.write(`faff spec-review-pin: ${res.detail}\n`);
    return 2;
  }
  console.log(JSON.stringify({ written: res.written }));
  return 0;
}

const SPEC_REVIEW_DIR_SPEC = { flags: { "--selftest": { arity: 0 }, "--issue": { arity: 1 }, "--run-dir": { arity: 1 } } };
const SPEC_REVIEW_DIR_USAGE = "usage: faff spec-review-dir --issue <ISSUE-XX> [--run-dir <dir>]";

function cmdSpecReviewDir(args) {
  if (args.includes("--selftest")) return specReviewDirSelftest();
  const { values, errors } = parseArgs(args, SPEC_REVIEW_DIR_SPEC);
  if (errors.length) return usageError(errors, SPEC_REVIEW_DIR_USAGE);
  if (values["--issue"] == null) {
    return usageError([{ code: "missing-value", detail: "--issue is required" }], SPEC_REVIEW_DIR_USAGE);
  }
  const runDir = values["--run-dir"] || process.env.FAFF_RUN_DIR || null;
  console.log(specReviewDir(values["--issue"], runDir));
  return 0;
}

// ---------------------------------------------------------------------------
// Selftests
// ---------------------------------------------------------------------------
function specReviewPinSelftest() {
  let fail = 0;
  const ok = (label, cond) => { console.log(`${cond ? "ok  " : "FAIL"} ${label}`); if (!cond) fail++; };
  const os = require("node:os");

  // --- pure resolvePinChain ---
  const cfg = {
    adversarial: { backends: [
      { provider: "openai", model: "mA", host: "https://a/v1", api_key_env: "KA" },
      { provider: "nvidia", model: "mB", host: "https://b/v1", api_key_env: "KB" },
      { provider: "openai", model: "mC", host: "https://c/v1", api_key_env: "KC" },
    ] },
  };

  // unpinned dir → full chain, pinned:false
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srp-unpinned-"));
    try {
      const res = resolvePinChain(cfg, tmp, undefined);
      ok("resolve unpinned → pinned:false", res.pinned === false);
      ok("resolve unpinned → full assembled chain (3)", Array.isArray(res.chain) && res.chain.length === 3);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // pinned dir → [pin, ...rest] with pin de-duped out of the tail
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srp-pinned-"));
    try {
      // pin the SECOND backend (mB): resolved chain must be [mB, mA, mC] — pin first, mB not repeated
      fs.writeFileSync(path.join(tmp, "pinned-reviewer.json"), JSON.stringify({ provider: "nvidia", model: "mB", host: "https://b/v1", api_key_env: "KB" }));
      const res = resolvePinChain(cfg, tmp, undefined);
      ok("resolve pinned → pinned:true", res.pinned === true);
      ok("resolve pinned → pin FIRST", res.chain[0].model === "mB");
      ok("resolve pinned → pin de-duped out of tail", res.chain.filter((b) => b.model === "mB").length === 1);
      ok("resolve pinned → tail is the rest (mA, mC), pin-first order", res.chain.length === 3 && res.chain[1].model === "mA" && res.chain[2].model === "mC");
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // malformed pin file → pin-malformed (fail-loud), NEVER a bare full chain
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srp-badpin-"));
    try {
      fs.writeFileSync(path.join(tmp, "pinned-reviewer.json"), "not json at all");
      const res = resolvePinChain(cfg, tmp, undefined);
      ok("malformed pin → error pin-malformed", res.error === "pin-malformed");
      ok("malformed pin → NO chain emitted", res.chain === undefined);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // unset / malformed config passthrough
  ok("unset adversarial → error unset", resolvePinChain({}, "/nonexistent", undefined).error === "unset");
  {
    const bad = { adversarial: { provider: "nvidia", model: "m1", host: "https://a/v1", fallbacks: "{not json" } };
    ok("malformed config fallbacks → error malformed", resolvePinChain(bad, "/nonexistent", undefined).error === "malformed");
  }

  // --- capturePin (FAFF-1052: round is now required; served-<n>.json on every served round) ---
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srp-cap-"));
    try {
      const chain = cfg.adversarial.backends;
      const r1 = capturePin(tmp, chain, 0, 1);
      ok("capture first-write → written:true", r1.written === true);
      ok("capture wrote chain[0] verbatim", JSON.parse(fs.readFileSync(path.join(tmp, "pinned-reviewer.json"), "utf8")).model === "mA");
      ok("capture round 1 → pin-capture.json{captured, round:1}", (() => {
        const c = readCaptureOutcome(tmp); return c && c.state === "captured" && c.round === 1 && c.backend_identity === backendIdentity(chain[0]);
      })());
      ok("capture round 1 → served-1.json records the served identity", (() => {
        const s = readServedIdentity(tmp, 1); return s && s.served_identity === backendIdentity(chain[0]);
      })());
      const r2 = capturePin(tmp, chain, 1, 2); // idempotent on the pin — must NOT overwrite
      ok("capture idempotent second-write → written:false (no overwrite)", r2.written === false);
      ok("capture idempotent → pin still chain[0]", JSON.parse(fs.readFileSync(path.join(tmp, "pinned-reviewer.json"), "utf8")).model === "mA");
      ok("capture idempotent round >= 2 STILL writes served-<n>.json (the round-2 regression fix)", (() => {
        const s = readServedIdentity(tmp, 2); return s && s.served_identity === backendIdentity(chain[1]);
      })());
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srp-cap-oor-"));
    try {
      ok("capture out-of-range index → error bad-capture", capturePin(tmp, cfg.adversarial.backends, 9, 1).error === "bad-capture");
      ok("capture non-array chain → error bad-capture", capturePin(tmp, "nope", 0, 1).error === "bad-capture");
      ok("capture out-of-range wrote NO pin", !fs.existsSync(path.join(tmp, "pinned-reviewer.json")));
      ok("capture failure → pin-capture.json{failed} written before exit (never silent)", (() => {
        const c = readCaptureOutcome(tmp); return c && c.state === "failed" && typeof c.reason === "string" && c.reason.length > 0;
      })());
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // captureNoLensServed: a legitimate no-op, distinguishable from a silent non-run.
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srp-none-"));
    try {
      const r = captureNoLensServed(tmp, 1);
      ok("no-lens-served → state:skipped-no-lens", r.state === "skipped-no-lens");
      ok("no-lens-served → no pin file", !fs.existsSync(path.join(tmp, "pinned-reviewer.json")));
      ok("no-lens-served → no served-1.json", !readServedIdentity(tmp, 1));
      ok("no-lens-served → pin-capture.json{skipped-no-lens, round:1}", (() => {
        const c = readCaptureOutcome(tmp); return c && c.state === "skipped-no-lens" && c.round === 1;
      })());
      ok("nothing served → resolve is unpinned", resolvePinChain(cfg, tmp, undefined).pinned === false);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // scrub / isWellFormedIdentity round-trip + tolerance
  ok("scrub strips control chars", scrub("a\x00b\x1fc") === "abc");
  ok("scrub bounds to 200 chars", scrub("x".repeat(500)).length === 200);
  ok("isWellFormedIdentity accepts a well-formed 3-segment identity", isWellFormedIdentity("openai|mA|https://a/v1") === true);
  ok("isWellFormedIdentity rejects the degenerate backendIdentity(null) '|'", isWellFormedIdentity(backendIdentity(null)) === false);
  ok("isWellFormedIdentity rejects a torn '||' identity", isWellFormedIdentity("||") === false);
  ok("isWellFormedIdentity rejects a non-string", isWellFormedIdentity(undefined) === false && isWellFormedIdentity(null) === false);
  ok("scrub(backendIdentity()) format round-trip stays well-formed", isWellFormedIdentity(scrub(backendIdentity({ provider: "p", model: "m", host: "h" }))) === true);

  // readCaptureOutcome / readServedIdentity tolerate absent + malformed
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srp-reader-"));
    try {
      ok("readCaptureOutcome absent → null", readCaptureOutcome(tmp) === null);
      ok("readServedIdentity absent → null", readServedIdentity(tmp, 1) === null);
      fs.writeFileSync(pinCapturePath(tmp), "not json");
      ok("readCaptureOutcome malformed → null (never throws)", readCaptureOutcome(tmp) === null);
      fs.writeFileSync(servedIdentityPath(tmp, 3), "{ broken");
      ok("readServedIdentity malformed → null (never throws)", readServedIdentity(tmp, 3) === null);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // --- CLI round-trip via the in-process harness (FAFF-1052: --round required, --no-lens-served) ---
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srp-cli-"));
    try {
      const bj = path.join(tmp, "backends.json");
      fs.writeFileSync(bj, JSON.stringify(cfg.adversarial.backends));
      const cap = runSpecReviewPinForSelftest(["--capture", "--dir", tmp, "--backends-json", bj, "--winner-index", "0", "--round", "1"]);
      ok("CLI capture exit 0", cap.code === 0 && JSON.parse(cap.stdout).written === true);
      const capAgain = runSpecReviewPinForSelftest(["--capture", "--dir", tmp, "--backends-json", bj, "--winner-index", "1", "--round", "2"]);
      ok("CLI capture idempotent exit 0 written:false", capAgain.code === 0 && JSON.parse(capAgain.stdout).written === false);
      const badIdx = runSpecReviewPinForSelftest(["--capture", "--dir", path.join(tmp, "fresh"), "--backends-json", bj, "--winner-index", "9", "--round", "1"]);
      ok("CLI capture out-of-range → exit 2", badIdx.code === 2);
      const noRound = runSpecReviewPinForSelftest(["--capture", "--dir", tmp, "--backends-json", bj, "--winner-index", "0"]);
      ok("CLI capture missing --round → exit 2 (usage error)", noRound.code === 2);
      const noLens = runSpecReviewPinForSelftest(["--capture", "--dir", path.join(tmp, "empty"), "--no-lens-served", "--round", "1"]);
      ok("CLI --no-lens-served exit 0, state:skipped-no-lens", noLens.code === 0 && JSON.parse(noLens.stdout).state === "skipped-no-lens");
      const both = runSpecReviewPinForSelftest(["--capture", "--dir", tmp, "--no-lens-served", "--backends-json", bj, "--winner-index", "0", "--round", "1"]);
      ok("CLI both --no-lens-served and --winner-index → usage error", both.code !== 0);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (spec-review-pin, ${fail} failed)`);
  return fail ? 1 : 0;
}

function specReviewDirSelftest() {
  let fail = 0;
  const ok = (label, cond) => { console.log(`${cond ? "ok  " : "FAIL"} ${label}`); if (!cond) fail++; };
  const sep = path.sep;

  ok("no run-dir → .faff/spec-review/<issue>", specReviewDir("FAFF-886", null) === path.join(".faff", "spec-review", "FAFF-886"));
  ok("run-dir set → <run-dir>/<issue>/spec-review", specReviewDir("FAFF-886", "/runs/r1") === path.join("/runs/r1", "FAFF-886", "spec-review"));
  ok("uses path.sep, no double slash", !specReviewDir("FAFF-886", null).includes(sep + sep));

  // flag-wins-over-env: --run-dir arg beats $FAFF_RUN_DIR (asserted at the CLI layer)
  const savedEnv = process.env.FAFF_RUN_DIR;
  try {
    process.env.FAFF_RUN_DIR = "/env/run";
    const viaFlag = runSpecReviewDirForSelftest(["--issue", "FAFF-886", "--run-dir", "/flag/run"]);
    ok("CLI --run-dir wins over $FAFF_RUN_DIR", viaFlag.code === 0 && viaFlag.stdout.trim() === path.join("/flag/run", "FAFF-886", "spec-review"));
    const viaEnv = runSpecReviewDirForSelftest(["--issue", "FAFF-886"]);
    ok("CLI falls back to $FAFF_RUN_DIR when no flag", viaEnv.code === 0 && viaEnv.stdout.trim() === path.join("/env/run", "FAFF-886", "spec-review"));
    delete process.env.FAFF_RUN_DIR;
    const noneSet = runSpecReviewDirForSelftest(["--issue", "FAFF-886"]);
    ok("CLI no run-dir at all → interactive .faff path", noneSet.code === 0 && noneSet.stdout.trim() === path.join(".faff", "spec-review", "FAFF-886"));
  } finally {
    if (savedEnv === undefined) delete process.env.FAFF_RUN_DIR; else process.env.FAFF_RUN_DIR = savedEnv;
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (spec-review-dir, ${fail} failed)`);
  return fail ? 1 : 0;
}

// In-process harnesses capturing stdout + return code (mirrors spec-review-churn.js).
function runSpecReviewPinForSelftest(args) {
  const origLog = console.log;
  let stdout = "";
  console.log = (s) => { stdout += String(s) + "\n"; };
  try { const code = cmdSpecReviewPin(args); return { code, stdout }; }
  finally { console.log = origLog; }
}
function runSpecReviewDirForSelftest(args) {
  const origLog = console.log;
  let stdout = "";
  console.log = (s) => { stdout += String(s) + "\n"; };
  try { const code = cmdSpecReviewDir(args); return { code, stdout }; }
  finally { console.log = origLog; }
}

module.exports = {
  backendIdentity,
  resolvePinChain,
  capturePin,
  captureNoLensServed,
  specReviewDir,
  cmdSpecReviewPin,
  cmdSpecReviewDir,
  specReviewPinSelftest,
  specReviewDirSelftest,
  // FAFF-1052 — shared with spec-review-window.js's --govern (factory->factory require).
  scrub,
  isWellFormedIdentity,
  atomicWriteJSON,
  readCaptureOutcome,
  readServedIdentity,
  pinCapturePath,
  servedIdentityPath,
};
