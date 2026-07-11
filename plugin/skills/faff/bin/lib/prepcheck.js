// ===========================================================================
// === region:factory — prepcheck — verify faff-prep attached every spec it produced (same-turn). ===
// The Stop-hook sibling of runcheck (FAFF-178): "attach the produced spec" is a
// mechanical guarantee, not prose. prep writes an externalised attach-state marker
// at produce time (attached:false, before rendering) and flips it true after the
// tracker save_comment / git-only .faff/specs write; prepcheck audits those markers.
// Like runcheck it trusts prep's externalised marker — the CLI never touches the
// tracker (pure-function invariant). An open marker surfaces until resolved (attach,
// record disposition, or remove the marker); the happy-path flip keeps false-positives
// near-zero.
// ===========================================================================

// An "open" marker = a produced-but-not-attached spec that wasn't parked by design.

const fs = require("node:fs");
const path = require("node:path");
const { runIsHeld } = require("./runcheck");
const { findRoot, readLedger } = require("./shared-infra");

function isPrepMarkerOpen(m) {
  return !!m && m.spec_produced === true && m.attached !== true && m.disposition !== "parked";
}

// Pure audit over a marker array (mirrors computeParkHistory's pure shape so the
// selftest drives it without touching the filesystem).
function auditPrepMarkers(markers) {
  const open = [...new Set(markers.filter(isPrepMarkerOpen).map((m) => m.issue))].sort();
  return { open, scanned: markers.length };
}

// Read .faff/prep/*.json into a marker array; malformed / non-file entries are
// skipped (never fatal) — same tolerance as latestRunDir/readLedger.
function readPrepMarkers(root) {
  const dir = path.join(root, ".faff", "prep");
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const p = path.join(dir, name);
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (!st.isFile()) continue;
    let m; try { m = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
    if (!m || typeof m !== "object") continue;
    if (!m.issue) m.issue = name.replace(/\.json$/, "");
    m.mtimeMs = st.mtimeMs; // FAFF-250: runtime-attached (NOT persisted) — the prepcheck hook's marker-mtime liveness floor reads it
    out.push(m);
  }
  return out;
}

function prepReason(open) {
  return (
    `faff prepcheck: faff-prep produced a spec for ${open.length} issue(s) but never ` +
    `attached it: ${open.join(", ")}. The spec was rendered but not written to the tracker ` +
    `(or .faff/specs in git-only mode) — that is a dropped spec, not a finished prep. Attach ` +
    `it (stamp → validate → save_comment → Todo), or record the park disposition, before stopping.`
  );
}

// ---------------------------------------------------------------------------
// FAFF-250 — ownership + liveness gate for the prepcheck Stop hook.
//
// Ports the FAFF-205 → FAFF-233/235 runcheck fix onto prepcheck. The Stop hook
// fires on EVERY session's turn-end and audits every .faff/prep/<ISSUE>.json
// marker globally; a parallel beep-boop drain's legitimately in-flight markers
// (spec_produced, attached:false) used to false-block an unrelated session that
// never produced that spec. The gate: HARD-BLOCK only for the session that OWNS
// the marker (env/session match) or an explicit --recover; a foreign marker a
// live owner still holds → silent; a foreign abandoned marker → a non-blocking
// WARN, never a hard block (FAFF-235 — a non-owner is never trapped).
//
// Pure-function CLI invariant: every signal comes from the marker file, the
// optionally-referenced run ledger, and process env — never the tracker. The
// recorded owner.pid is RECORDED for forensics but NEVER consulted in the
// decision (FAFF-233): a dead recorded pid is no evidence of death while a fresh
// liveness signal still arrives. Liveness is two-tier and never marker-self-
// referential — the marker is written twice (produce, attach) and never on a
// timer, so a heartbeat field ON it would reproduce the FAFF-234 confound; the
// fresh signals are the run ledger (kept fresh by FAFF-234) and the file mtime.
// ---------------------------------------------------------------------------

// NEW staleness window for the marker-mtime liveness floor. A SEPARATE constant
// from the ledger heartbeat window (RUN_HEARTBEAT_STALE_SECS) — the two measure
// different things (ledger heartbeat age vs marker file age) and may want
// independent tuning — but reuses runcheck's 900s value for consistency.
const PREP_MARKER_STALE_SECS_DEFAULT = 900;

function prepMarkerStaleSecs(env) {
  const raw = (env || process.env).FAFF_PREP_MARKER_STALE_SECS;
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : PREP_MARKER_STALE_SECS_DEFAULT;
}

// Non-throwing readLedger for prepIsHeld's tier-(a) delegation: a marker's
// owner.run_dir may point at a deleted / rotated / never-existed run dir, so a
// missing OR malformed ledger must resolve to null (the tier no-ops, mtime
// decides) — never throw. Mirrors runcheck's readLedger-throws → silent handling.
function tryReadLedger(runDir) {
  try { return readLedger(runDir); } catch { return null; }
}

// Does the current session OWN this marker? Two signal-agnostic sources mirroring
// runIsOwned: the FAFF_RUN_DIR env pointer matched against owner.run_dir, OR
// owner.session_id matched against FAFF_SESSION_ID. Either match proves ownership.
// A marker with no owner (legacy/unowned) is never owned. An interactive session
// that sets neither env var can never be mistaken for a foreign marker's owner.
function prepIsOwned(marker, env) {
  const e = env || process.env;
  const owner = marker && marker.owner;
  if (!owner) return false; // legacy/unowned
  if (e.FAFF_RUN_DIR && owner.run_dir && path.resolve(e.FAFF_RUN_DIR) === path.resolve(owner.run_dir)) return true;
  if (owner.session_id && e.FAFF_SESSION_ID && owner.session_id === e.FAFF_SESSION_ID) return true;
  return false;
}

// Is a FOREIGN marker still HELD by a live owner? Two-tier (FAFF-250 OQ2) — held
// if EITHER tier judges it live:
//   (a) ledger-delegation — when owner.run_dir references a run ledger, delegate to
//       runIsHeld(that ledger) (the FAFF-234-kept-fresh signal). A missing /
//       unparseable ledger → null → the tier no-ops (never throws).
//   (b) marker-mtime floor — a marker file written within FAFF_PREP_MARKER_STALE_SECS
//       is presumed live. Catches the observed confound (stale ledger heartbeat but
//       fresh file) and covers interactive markers with no ledger to delegate to.
// Neither live ⇒ NOT held (abandoned). pid is NOT consulted (FAFF-233). An
// unreadable/missing mtime (non-finite) skips tier (b) → treated as stale.
function prepIsHeld(marker, markerMtimeMs, nowMs, env) {
  const owner = marker && marker.owner;
  if (owner && owner.run_dir) {
    const ledger = tryReadLedger(owner.run_dir);
    if (ledger && runIsHeld(ledger, nowMs, env)) return true; // tier (a)
  }
  if (Number.isFinite(markerMtimeMs) && (nowMs - markerMtimeMs) / 1000 <= prepMarkerStaleSecs(env)) return true; // tier (b)
  return false;
}

// Pure per-marker decision for the prepcheck Stop hook (FAFF-250), the twin of
// runcheckHookDecision's per-ledger ternary. openMarkers are already filtered by
// isPrepMarkerOpen. Each marker is decided INDEPENDENTLY (mirroring runcheck's
// per-ledger decision — never a whole-batch block): owned → block (the FAFF-178
// backstop, preserved for the owning session regardless of liveness); foreign +
// held → silent; foreign + not-held → warn, unless --recover forces the block for
// deliberate human recovery. Returns { block: [issues], warn: [issues] } — block
// takes precedence when the hook emits. Reads each marker's runtime-attached
// mtimeMs (readPrepMarkers stamps it; the selftest sets it directly).
function prepcheckHookDecision(openMarkers, nowMs, env, opts) {
  const recover = !!(opts && opts.recover);
  const block = [];
  const warn = [];
  for (const m of openMarkers) {
    if (prepIsOwned(m, env)) { block.push(m.issue); continue; }       // own open marker → block (backstop)
    if (prepIsHeld(m, m.mtimeMs, nowMs, env)) continue;               // foreign + live → silent
    if (recover) block.push(m.issue);                                 // foreign + abandoned + --recover → block
    else warn.push(m.issue);                                         // foreign + abandoned → warn, NOT block
  }
  return { block: [...new Set(block)].sort(), warn: [...new Set(warn)].sort() };
}

function cmdPrepcheck(args) {
  if (args.includes("--selftest")) return prepcheckSelftest();
  const hook = args.includes("--hook");
  const asJson = args.includes("--json");
  const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  const root = get("--root") || findRoot();
  const markers = readPrepMarkers(root);
  const result = auditPrepMarkers(markers);

  if (hook) {
    // FAFF-250: per-marker ownership + liveness gate (the runcheck precedent).
    // Block only on a marker THIS session owns, or a foreign abandoned one under
    // --recover; a foreign live marker is silent; a foreign abandoned one warns.
    const recover = args.includes("--recover");
    const open = markers.filter(isPrepMarkerOpen);
    const d = prepcheckHookDecision(open, Date.now(), process.env, { recover });
    // block via the decision payload, not the exit code — same as runcheck --hook.
    if (d.block.length) console.log(JSON.stringify({ decision: "block", reason: prepReason(d.block) }));
    // FAFF-235: foreign + not-held → a one-line, NON-BLOCKING notice on stderr (never
    // the block payload), so a genuinely-abandoned foreign marker is still surfaced
    // without making an unrelated session un-exitable.
    else if (d.warn.length) process.stderr.write(`[warn] ${prepReason(d.warn)}\n`);
    return 0;
  }
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.open.length) {
    console.log(`OPEN (${result.open.length}): ${result.open.join(", ")}`);
    console.log("→ prep produced these specs but never attached them: attach, or record the park disposition.");
  } else {
    console.log(`clean: ${result.scanned} prep marker(s), every produced spec attached.`);
  }
  return result.open.length ? 3 : 0;
}

// Selftest cases drive the pure auditor directly (no filesystem), mirroring the
// park-history / eligible selftest shape. [markers, wantOpen]
const PREPCHECK_SELFTEST_CASES = [
  [[{ issue: "FAFF-1", spec_produced: true, attached: true }], []],                            // attached → clean
  [[{ issue: "FAFF-2", spec_produced: true, attached: false }], ["FAFF-2"]],                   // produced-not-attached → open
  [[{ issue: "FAFF-3", spec_produced: true, attached: false, disposition: "parked" }], []],    // parked by design → clean
  [[{ issue: "FAFF-4", spec_produced: false, attached: false }], []],                          // no spec produced → clean
  [[{ issue: "FAFF-5", spec_produced: true, attached: false, mode: "git-only" }], ["FAFF-5"]], // git-only drop → open
  [[
    { issue: "FAFF-6", spec_produced: true, attached: true },
    { issue: "FAFF-7", spec_produced: true, attached: false },
  ], ["FAFF-7"]],                                                                              // multi-issue: blocks on the open one
  [[], []],                                                                                    // no markers → clean
];

// FAFF-250 — the ownership/liveness hook gate, driven as a pure function over
// (marker, env, opts) tuples with a fixed NOW anchoring the mtime ages. Tier-(a)
// ledger-delegation reads from disk, so a synthetic owner.run_dir here resolves to
// null (no ledger on disk) and the mtime floor decides — the live ledger-delegated
// case is covered with real fixtures in test/prepcheck.test.mjs. [name, marker, env,
// wantBlock, wantWarn, opts?]
const PREPCHECK_NOW = Date.parse("2026-06-28T16:00:00Z");
const PREP_OWN_RUN_DIR = "/runs/PREP-MINE";
const prepMtAgo = (secs) => PREPCHECK_NOW - secs * 1000;
const openM = (extra) => ({ issue: "X", spec_produced: true, attached: false, ...extra });
const PREPCHECK_HOOK_SELFTEST_CASES = [
  ["owned via run_dir + open → block (FAFF-178 backstop preserved)",
    openM({ owner: { run_dir: PREP_OWN_RUN_DIR }, mtimeMs: prepMtAgo(10) }), { FAFF_RUN_DIR: PREP_OWN_RUN_DIR }, true, false],
  ["owned via session_id fallback + open → block (env-pointer absent)",
    openM({ owner: { session_id: "S1" }, mtimeMs: prepMtAgo(10) }), { FAFF_SESSION_ID: "S1" }, true, false],
  ["owned + abandoned mtime → still block (owned blocks regardless of liveness)",
    openM({ owner: { session_id: "S1" }, mtimeMs: prepMtAgo(1000) }), { FAFF_SESSION_ID: "S1" }, true, false],
  ["foreign + fresh mtime → silent (the observed confound: stale/absent ledger, fresh file)",
    openM({ owner: { run_dir: "/runs/OTHER" }, mtimeMs: prepMtAgo(10) }), {}, false, false],
  ["foreign + abandoned (stale mtime, no live ledger) → WARN, not block (FAFF-235)",
    openM({ owner: { run_dir: "/runs/OTHER" }, mtimeMs: prepMtAgo(1000) }), {}, false, true],
  ["legacy ownerless + fresh mtime → silent (mtime floor judges it live)",
    openM({ mtimeMs: prepMtAgo(10) }), {}, false, false],
  ["legacy ownerless + stale mtime → WARN, not block (no foreign hard-block)",
    openM({ mtimeMs: prepMtAgo(1000) }), {}, false, true],
  ["FAFF-233: foreign + fresh mtime + DEAD recorded pid → silent (pid not consulted)",
    openM({ owner: { run_dir: "/runs/OTHER", pid: 2147483646 }, mtimeMs: prepMtAgo(10) }), {}, false, false],
  ["custom FAFF_PREP_MARKER_STALE_SECS shrinks the window (foreign) → WARN",
    openM({ owner: { run_dir: "/runs/OTHER" }, mtimeMs: prepMtAgo(120) }), { FAFF_PREP_MARKER_STALE_SECS: "60" }, false, true],
  ["--recover on a foreign abandoned marker → block (deliberate human recovery)",
    openM({ owner: { run_dir: "/runs/OTHER" }, mtimeMs: prepMtAgo(1000) }), {}, true, false, { recover: true }],
  ["--recover + foreign fresh marker → silent (nothing to recover)",
    openM({ owner: { run_dir: "/runs/OTHER" }, mtimeMs: prepMtAgo(10) }), {}, false, false, { recover: true }],
];

function prepcheckHookSelftest() {
  let fail = 0;
  for (const [name, marker, env, wantBlock, wantWarn, opts] of PREPCHECK_HOOK_SELFTEST_CASES) {
    const d = prepcheckHookDecision([marker], PREPCHECK_NOW, env, opts);
    const gotBlock = d.block.length > 0;
    const gotWarn = d.warn.length > 0;
    const ok = gotBlock === wantBlock && gotWarn === (wantWarn || false);
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name} → block=${gotBlock} warn=${gotWarn} (want block=${wantBlock} warn=${wantWarn || false})`);
  }
  return fail;
}

function prepcheckSelftest() {
  let fail = 0;
  for (const [markers, want] of PREPCHECK_SELFTEST_CASES) {
    const got = auditPrepMarkers(markers).open;
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} markers=${markers.length} → open=${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
  }
  fail += prepcheckHookSelftest(); // FAFF-250: the ownership + liveness hook gate
  const total = PREPCHECK_SELFTEST_CASES.length + PREPCHECK_HOOK_SELFTEST_CASES.length;
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${total} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { PREPCHECK_HOOK_SELFTEST_CASES, PREPCHECK_NOW, PREPCHECK_SELFTEST_CASES, PREP_MARKER_STALE_SECS_DEFAULT, PREP_OWN_RUN_DIR, auditPrepMarkers, cmdPrepcheck, isPrepMarkerOpen, openM, prepIsHeld, prepIsOwned, prepMarkerStaleSecs, prepMtAgo, prepReason, prepcheckHookDecision, prepcheckHookSelftest, prepcheckSelftest, readPrepMarkers, tryReadLedger };
