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

// PURE-ish (owns one write): idempotent first-write of the pin. If the pin already
// exists (rounds ≥ 2) → no-op { written: false }, so round 1's pin is never
// overwritten. Otherwise write chain[winnerIndex] verbatim (the full backend object)
// as the sidecar. An out-of-range index, a non-array chain, or a non-object element
// is fail-loud { error: "bad-capture" } (caller → exit 2).
function capturePin(scratchDir, chain, winnerIndex) {
  const pinPath = path.join(scratchDir, "pinned-reviewer.json");
  if (fs.existsSync(pinPath)) return { written: false };
  if (!Array.isArray(chain)) return { error: "bad-capture", detail: "backends chain is not an array" };
  if (!Number.isInteger(winnerIndex) || winnerIndex < 0 || winnerIndex >= chain.length) {
    return { error: "bad-capture", detail: `winner-index ${winnerIndex} out of range (chain length ${chain.length})` };
  }
  const pin = chain[winnerIndex];
  if (!pin || typeof pin !== "object" || Array.isArray(pin)) {
    return { error: "bad-capture", detail: `chain[${winnerIndex}] is not a backend object` };
  }
  fs.mkdirSync(scratchDir, { recursive: true });
  fs.writeFileSync(pinPath, JSON.stringify(pin));
  return { written: true };
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
    // --json wraps the resolve output as { chain, pinned }; the DEFAULT prints the bare
    // chain array, byte-identical to `faff adversarial-backends` so it is a drop-in for
    // the occupant's `--backends-json` mapper (which consumes a bare array). Mirrors
    // `adversarial-backends`'s array-default + accepted-and-ignored --json convention.
    "--json": { arity: 0 },
  },
};
const SPEC_REVIEW_PIN_USAGE =
  "usage: faff spec-review-pin (--resolve --dir <scratch> --consumer <name> [--root DIR] | " +
  "--capture --dir <scratch> --backends-json <file> --winner-index <i>)";

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

  // --capture
  if (values["--backends-json"] == null) {
    return usageError([{ code: "missing-value", detail: "--backends-json is required for --capture" }], SPEC_REVIEW_PIN_USAGE);
  }
  if (values["--winner-index"] == null) {
    return usageError([{ code: "missing-value", detail: "--winner-index is required for --capture" }], SPEC_REVIEW_PIN_USAGE);
  }
  const winnerIndex = Number(values["--winner-index"]);
  let chain;
  try {
    chain = JSON.parse(fs.readFileSync(values["--backends-json"], "utf8"));
  } catch (e) {
    process.stderr.write(`faff spec-review-pin: --backends-json could not be read as JSON: ${e && e.message}\n`);
    return 2;
  }
  const res = capturePin(dir, chain, winnerIndex);
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

  // --- capturePin ---
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srp-cap-"));
    try {
      const chain = cfg.adversarial.backends;
      const r1 = capturePin(tmp, chain, 0);
      ok("capture first-write → written:true", r1.written === true);
      ok("capture wrote chain[0] verbatim", JSON.parse(fs.readFileSync(path.join(tmp, "pinned-reviewer.json"), "utf8")).model === "mA");
      const r2 = capturePin(tmp, chain, 1); // idempotent — must NOT overwrite
      ok("capture idempotent second-write → written:false (no overwrite)", r2.written === false);
      ok("capture idempotent → pin still chain[0]", JSON.parse(fs.readFileSync(path.join(tmp, "pinned-reviewer.json"), "utf8")).model === "mA");
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srp-cap-oor-"));
    try {
      ok("capture out-of-range index → error bad-capture", capturePin(tmp, cfg.adversarial.backends, 9).error === "bad-capture");
      ok("capture non-array chain → error bad-capture", capturePin(tmp, "nope", 0).error === "bad-capture");
      ok("capture out-of-range wrote NO pin", !fs.existsSync(path.join(tmp, "pinned-reviewer.json")));
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // nothing-served round 1: capture is never called with a winner (occupant returns
  // early on an empty served set), so the guarantee is "no pin file after an
  // all-unavailable round" — modelled here as: no capture call ⇒ no pin file.
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srp-none-"));
    try {
      ok("nothing served → no pin file (no capture call)", !fs.existsSync(path.join(tmp, "pinned-reviewer.json")));
      // and a subsequent resolve on that empty dir is a plain unpinned full chain
      ok("nothing served → resolve is unpinned", resolvePinChain(cfg, tmp, undefined).pinned === false);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // --- CLI round-trip via the in-process harness ---
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-srp-cli-"));
    try {
      const bj = path.join(tmp, "backends.json");
      fs.writeFileSync(bj, JSON.stringify(cfg.adversarial.backends));
      const cap = runSpecReviewPinForSelftest(["--capture", "--dir", tmp, "--backends-json", bj, "--winner-index", "0"]);
      ok("CLI capture exit 0", cap.code === 0 && JSON.parse(cap.stdout).written === true);
      const capAgain = runSpecReviewPinForSelftest(["--capture", "--dir", tmp, "--backends-json", bj, "--winner-index", "1"]);
      ok("CLI capture idempotent exit 0 written:false", capAgain.code === 0 && JSON.parse(capAgain.stdout).written === false);
      const badIdx = runSpecReviewPinForSelftest(["--capture", "--dir", path.join(tmp, "fresh"), "--backends-json", bj, "--winner-index", "9"]);
      ok("CLI capture out-of-range → exit 2", badIdx.code === 2);
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
  specReviewDir,
  cmdSpecReviewPin,
  cmdSpecReviewDir,
  specReviewPinSelftest,
  specReviewDirSelftest,
};
