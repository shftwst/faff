// ===========================================================================
// === region:governance — runcheck — verify a beep-boop run dispatched its queue ===
// ===========================================================================
// Vocabulary: "unit" — the governance core's name for the thing a run admits and
// resolves. In faff-the-factory's dialect a unit is an issue id; persisted formats
// keep their field names (see the compat notes at each definition site).
//
// TERMINAL_STATES — the outcome vocabulary of the run ledger: the terminal states a
// unit's recorded outcome must resolve to. Ledger `admitted[]` entries and `outcomes{}`
// keys are unit keys:
// "issue" — the unit key (compat dialect; rename deferred to extraction schema-v2)

const fs = require("node:fs");
const path = require("node:path");
const { overlayHeartbeat, readHeartbeatFile } = require("./heartbeat");
const { findRoot, latestRunDir, readLedger } = require("./shared-infra");

const TERMINAL_STATES = new Set(["shipped", "pr-open", "parked", "errored", "routed-out", "unreached-budget"]);

// Pure audit over a parsed ledger object (FAFF-205): the completeness core,
// decoupled from disk so the gate (which already holds the ledger) and the
// selftest can both drive it. `run_id` falls back to the caller-supplied label.
function auditLedger(data, label) {
  const admitted = [...new Set(data.admitted ?? [])];
  const outcomes = data.outcomes ?? {};
  if (typeof outcomes !== "object" || Array.isArray(outcomes)) throw new Error("outcomes must be an object");
  const undispatched = admitted.filter((i) => !(i in outcomes));
  const invalid = [...new Set(Object.entries(outcomes)
    .filter(([, s]) => !TERMINAL_STATES.has(s)).map(([i, s]) => `${i}=${s}`))].sort();
  return {
    run_id: data.run_id ?? label,
    admitted, undispatched, invalid_outcomes: invalid,
    clean: undispatched.length === 0 && invalid.length === 0,
  };
}

function auditRun(runDir) {
  const result = auditLedger(readLedger(runDir), path.basename(runDir));
  result.run_dir = runDir;
  return result;
}

// ---------------------------------------------------------------------------
// FAFF-205 — ownership + liveness gate for the runcheck Stop hook.
//
// The Stop hook fires on EVERY session's turn-end and audits the newest run
// ledger globally. A parallel beep-boop drain's legitimately in-flight ledger
// (admitted, no terminal outcome yet) looks identical to an abandoned queue, so
// the hook false-blocks an unrelated session. The gate: HARD-BLOCK only for the
// session that OWNS the run (env/session match) or an explicit --recover; a foreign
// run that a live owner is draining → silent; a foreign run that looks abandoned →
// a non-blocking WARN, never a hard block (FAFF-235 — a non-owner is never trapped).
//
// Pure-function CLI invariant: liveness is on-disk owner-emitted state — owner.status
// + owner.last_heartbeat on the ledger — never a tracker/network probe. Liveness is
// HEARTBEAT-ONLY (FAFF-233): the recorded owner.pid is NOT consulted, because the
// beep-boop worker pid rolls and a dead recorded pid is no evidence of death while
// heartbeats still arrive.
// ---------------------------------------------------------------------------

const RUN_HEARTBEAT_STALE_SECS_DEFAULT = 900;

function heartbeatStaleSecs(env) {
  const raw = (env || process.env).FAFF_RUN_HEARTBEAT_STALE_SECS;
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : RUN_HEARTBEAT_STALE_SECS_DEFAULT;
}

// Does the current session OWN the resolved run? Two signal-agnostic sources
// (the §7 assumption is de-risked by implementing both): the FAFF_RUN_DIR env
// pointer matched against the resolved dir, OR the owner.session_id on the ledger
// matched against FAFF_SESSION_ID. Either match proves ownership. An interactive
// session sets neither, so it can never be mistaken for a foreign run's owner.
function runIsOwned(ledger, runDir, env) {
  const e = env || process.env;
  if (e.FAFF_RUN_DIR && runDir && path.resolve(e.FAFF_RUN_DIR) === path.resolve(runDir)) return true;
  const owner = ledger && ledger.owner;
  if (owner && owner.session_id && e.FAFF_SESSION_ID && owner.session_id === e.FAFF_SESSION_ID) return true;
  return false;
}

// Is the run still HELD by a live owner? Contract = owner.status "running" + a
// heartbeat fresher than STALE_SECS. Absent owner / non-running / stale / missing
// / unparseable heartbeat ⇒ NOT held (fail-safe toward firing). nowMs/env are
// injectable so the selftest drives this as a pure function.
//
// FAFF-233: liveness is HEARTBEAT-ONLY. The recorded owner.pid is NOT consulted —
// the beep-boop worker pid rolls between issues (observed 35795→36342), so a dead
// `kill -0` on the *recorded* pid is no evidence the run is gone while heartbeats
// are still arriving. A fresh heartbeat means something live is writing it; that
// wins. (The old dead-pid corroborator could only ever fire on an already-fresh
// heartbeat — the stale-check returns first — so it never shortened the window, it
// only wrongly flipped live runs to not-held. Removed.)
function runIsHeld(ledger, nowMs, env) {
  const owner = ledger && ledger.owner;
  if (!owner) return false;                         // legacy/unowned ledger
  if (owner.status !== "running") return false;     // owner exited
  const t = Date.parse(owner.last_heartbeat);
  if (!Number.isFinite(t)) return false;            // missing/unparseable → not held
  const ageSecs = (nowMs - t) / 1000;
  if (ageSecs > heartbeatStaleSecs(env)) return false; // stale → presumed gone
  return true;                                       // running + fresh heartbeat → held (pid not consulted)
}

function resolveRunDir(arg) {
  if (arg) return fs.existsSync(path.join(arg, "run-ledger.json")) ? arg : null;
  return latestRunDir(findRoot());
}

// The block-reason text (shared by the hook and the selftest expectation).
function runcheckReason(result) {
  return (
    `faff runcheck: the latest beep-boop run (${result.run_id}) has ` +
    `${result.undispatched.length} admitted issue(s) with no terminal outcome: ` +
    `${result.undispatched.join(", ")}. These were admitted to the build queue but never ` +
    `dispatched — that is a deferred queue, not a complete run. Dispatch them (or genuinely ` +
    `park them under a valid category) before stopping.`
  );
}

// Pure decision for the Stop hook (FAFF-205): given a parsed ledger, the resolved
// run dir, the wall clock, the env, and opts, decide what the hook emits.
// Returns { block, warn, reason?, owned, held }. Drives both the live hook and the
// selftest without touching the filesystem.
//
// FAFF-235: a NON-OWNING session is never HARD-BLOCKED by another run's
// incompleteness — the Stop hook fires in every session/worktree, so a foreign
// run's undispatched work must not make an unrelated session un-exitable. Such a
// session gets at most a non-blocking WARN. Only the OWNING session (env/session
// match) — or an explicit human `--recover` — hard-blocks on undispatched work.
// This holds even if the liveness check ever misfires (defence in depth over RC1).
function runcheckHookDecision(ledger, runDir, nowMs, env, opts) {
  const recover = !!(opts && opts.recover);
  let result;
  try { result = auditLedger(ledger, ledger.run_id ?? path.basename(runDir || "")); }
  catch { return { block: false, warn: false, owned: false, held: false }; } // malformed → silent (unchanged)
  const owned = runIsOwned(ledger, runDir, env);
  const held = owned ? false : runIsHeld(ledger, nowMs, env);
  // Foreign AND a live owner is draining it → stay silent (FAFF-205).
  if (held) return { block: false, warn: false, owned, held: true };
  // No undispatched work → nothing to say.
  if (!result.undispatched.length) return { block: false, warn: false, owned, held: false };
  // Undispatched work + not held: the owning session (backstop) or a deliberate
  // --recover hard-blocks; any other (foreign) session only warns, never blocks.
  if (owned || recover) return { block: true, warn: false, reason: runcheckReason(result), owned, held: false };
  return { block: false, warn: true, reason: runcheckReason(result), owned, held: false };
}

function cmdRuncheck(args) {
  if (args.includes("--selftest")) return runcheckSelftest();
  const hook = args.includes("--hook");
  const asJson = args.includes("--json");
  const positional = args.filter((a) => !a.startsWith("-"));
  const runDir = resolveRunDir(positional[0]);

  if (hook) {
    if (!runDir) return 0;
    let ledger;
    try { ledger = readLedger(runDir); } catch { return 0; } // parse error → silent (unchanged)
    // FAFF-355: overlay the dedicated heartbeat file over owner.last_heartbeat BEFORE
    // the pure decision runs — the decision fn (runcheckHookDecision → runIsHeld)
    // stays filesystem-free; this is the one read of the file for this seam.
    overlayHeartbeat(ledger, readHeartbeatFile(runDir));
    const recover = args.includes("--recover");
    const decision = runcheckHookDecision(ledger, runDir, Date.now(), process.env, { recover });
    if (decision.block) console.log(JSON.stringify({ decision: "block", reason: decision.reason }));
    // FAFF-235: foreign + not-held → a one-line, NON-BLOCKING notice on stderr (never the
    // block payload), so a genuinely-abandoned foreign run is still surfaced without making
    // an unrelated session un-exitable.
    else if (decision.warn) process.stderr.write(`[warn] ${decision.reason}\n`);
    return 0;
  }

  if (!runDir) { process.stderr.write("runcheck: no .faff/runs/*/run-ledger.json found\n"); return 2; }
  let result;
  try {
    result = auditRun(runDir);
  } catch (e) {
    process.stderr.write(`runcheck: missing or malformed ledger in ${runDir}: ${e.message}\n`);
    return 2;
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`run:       ${result.run_id}`);
    console.log(`admitted:  ${result.admitted.length}`);
    if (result.invalid_outcomes.length) console.log(`INVALID outcomes: ${result.invalid_outcomes.join(", ")}`);
    if (result.undispatched.length) {
      console.log(`UNDISPATCHED (${result.undispatched.length}): ${result.undispatched.join(", ")}`);
      console.log("→ run is NOT complete: dispatch these or park them under a valid category.");
    } else {
      console.log("clean: every admitted issue reached a terminal outcome.");
    }
  }
  if (result.undispatched.length) return 3;
  if (result.invalid_outcomes.length) return 2;
  return 0;
}

// Selftest (FAFF-205) — drives the Stop-hook gate as a pure function over
// (ledger, runDir, env-owned?, now) tuples. A fixed NOW anchors the heartbeat
// ages so the held/abandoned branches are deterministic. Covers both branches the
// AC requires plus the legacy and ownership cases.
const RUNCHECK_NOW = Date.parse("2026-06-22T16:00:00Z");
const RUNCHECK_RUN_DIR = "/runs/RUN-LIVE";
function hbAgo(secs) { return new Date(RUNCHECK_NOW - secs * 1000).toISOString(); }

// [name, ledger, env, wantBlock, wantWarn, opts?, heartbeatFile?]
// FAFF-235 contract change: foreign (not-owned) + not-held + undispatched is now a
// non-blocking WARN, not a block. Only OWNED or --recover hard-blocks. FAFF-233:
// liveness is heartbeat-only, so a fresh heartbeat is held even with a dead recorded pid.
// FAFF-355: an optional trailing `heartbeatFile` column (ISO string | undefined) is
// overlaid onto a CLONE of the fixture ledger before the decision runs — undefined on
// every pre-existing case preserves ledger-field-only behaviour byte-for-byte; the
// new cases below exercise the file/field interaction the overlay is for.
const RUNCHECK_SELFTEST_CASES = [
  ["owned + undispatched → block (backstop preserved)",
    { run_id: "R", admitted: ["X"], outcomes: {}, owner: { status: "running", last_heartbeat: hbAgo(10) } },
    { FAFF_RUN_DIR: RUNCHECK_RUN_DIR }, true, false],
  ["owned + clean queue → silent",
    { run_id: "R", admitted: ["X"], outcomes: { X: "shipped" }, owner: { status: "running", last_heartbeat: hbAgo(10) } },
    { FAFF_RUN_DIR: RUNCHECK_RUN_DIR }, false, false],
  ["not-owned + held (running, fresh heartbeat) → silent (FAFF-205)",
    { run_id: "R", admitted: ["X"], outcomes: {}, owner: { status: "running", last_heartbeat: hbAgo(10) } },
    {}, false, false],
  ["FAFF-233: not-owned + fresh heartbeat + DEAD recorded pid → held/silent (pid not consulted)",
    { run_id: "R", admitted: ["X"], outcomes: {}, owner: { status: "running", pid: 2147483646, last_heartbeat: hbAgo(10) } },
    {}, false, false],
  ["FAFF-235: not-owned + stale heartbeat + undispatched → WARN, not block (abandoned still surfaced)",
    { run_id: "R", admitted: ["X"], outcomes: {}, owner: { status: "running", last_heartbeat: hbAgo(1000) } },
    {}, false, true],
  ["FAFF-235: not-owned + status:done + undispatched → WARN, not block",
    { run_id: "R", admitted: ["X"], outcomes: {}, owner: { status: "done", last_heartbeat: hbAgo(10) } },
    {}, false, true],
  ["FAFF-235: legacy ledger (no owner) + undispatched → WARN, not block (no foreign hard-block)",
    { run_id: "R", admitted: ["X"], outcomes: {} },
    {}, false, true],
  ["not-owned + held + clean queue → silent",
    { run_id: "R", admitted: ["X"], outcomes: { X: "shipped" }, owner: { status: "running", last_heartbeat: hbAgo(10) } },
    {}, false, false],
  ["FAFF-235: not-owned + unparseable heartbeat + undispatched → WARN, not block",
    { run_id: "R", admitted: ["X"], outcomes: {}, owner: { status: "running", last_heartbeat: "not-a-date" } },
    {}, false, true],
  ["owned via session_id fallback + undispatched → block (backstop, env-pointer absent)",
    { run_id: "R", admitted: ["X"], outcomes: {}, owner: { status: "running", session_id: "S1", last_heartbeat: hbAgo(10) } },
    { FAFF_SESSION_ID: "S1" }, true, false],
  ["FAFF-235: custom STALE_SECS shrinks the window (foreign) → WARN, not block",
    { run_id: "R", admitted: ["X"], outcomes: {}, owner: { status: "running", last_heartbeat: hbAgo(120) } },
    { FAFF_RUN_HEARTBEAT_STALE_SECS: "60" }, false, true],
  ["FAFF-235: --recover on a foreign not-held undispatched run → block (deliberate human recovery)",
    { run_id: "R", admitted: ["X"], outcomes: {}, owner: { status: "running", last_heartbeat: hbAgo(1000) } },
    {}, true, false, { recover: true }],
  ["FAFF-235: --recover + clean queue → silent (nothing to recover)",
    { run_id: "R", admitted: ["X"], outcomes: { X: "shipped" }, owner: { status: "done", last_heartbeat: hbAgo(1000) } },
    {}, false, false, { recover: true }],
  ["FAFF-355: not-owned + fresh heartbeat FILE (stale field) + undispatched → held/silent (file wins)",
    { run_id: "R", admitted: ["X"], outcomes: {}, owner: { status: "running", last_heartbeat: hbAgo(1000) } },
    {}, false, false, undefined, hbAgo(10)],
  ["FAFF-355: not-owned + no file + fresh field + undispatched → held/silent (ledger-field fallback)",
    { run_id: "R", admitted: ["X"], outcomes: {}, owner: { status: "running", last_heartbeat: hbAgo(10) } },
    {}, false, false, undefined, null],
  ["FAFF-355: not-owned + both file and field stale + undispatched → WARN, not block",
    { run_id: "R", admitted: ["X"], outcomes: {}, owner: { status: "running", last_heartbeat: hbAgo(1000) } },
    {}, false, true, undefined, hbAgo(1000)],
  ["FAFF-355: not-owned + unparseable file + fresh field + undispatched → held/silent (field fallback)",
    { run_id: "R", admitted: ["X"], outcomes: {}, owner: { status: "running", last_heartbeat: hbAgo(10) } },
    {}, false, false, undefined, "not-a-date"],
];

function runcheckSelftest() {
  let fail = 0;
  for (const [name, ledger, env, wantBlock, wantWarn, opts, heartbeatFile] of RUNCHECK_SELFTEST_CASES) {
    // Clone before overlay — these fixtures are shared array literals and overlayHeartbeat
    // mutates owner.last_heartbeat in place; a clone keeps each case isolated + rerunnable.
    const cloned = JSON.parse(JSON.stringify(ledger));
    overlayHeartbeat(cloned, heartbeatFile === undefined ? null : heartbeatFile);
    const d = runcheckHookDecision(cloned, RUNCHECK_RUN_DIR, RUNCHECK_NOW, env, opts);
    const ok = d.block === wantBlock && (d.warn || false) === (wantWarn || false);
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name} → block=${d.block} warn=${d.warn || false} (want block=${wantBlock} warn=${wantWarn || false})`);
  }
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${RUNCHECK_SELFTEST_CASES.length} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { RUNCHECK_NOW, RUNCHECK_RUN_DIR, RUNCHECK_SELFTEST_CASES, RUN_HEARTBEAT_STALE_SECS_DEFAULT, TERMINAL_STATES, auditLedger, auditRun, cmdRuncheck, hbAgo, heartbeatStaleSecs, resolveRunDir, runIsHeld, runIsOwned, runcheckHookDecision, runcheckReason, runcheckSelftest };
