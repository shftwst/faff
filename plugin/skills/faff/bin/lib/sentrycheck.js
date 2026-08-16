// ===========================================================================
// === region:governance — sentrycheck — FAFF-471: staleness-triggered sentry consult ===
// in the Stop-hook family (ADR-0065's cheap ASSIST watchdog locus, sibling of the
// FAFF-470 mint-scoped detached poller — the PRIMARY locus). Every faff Stop hook
// fires on every session's turn-end and looks at the newest run ledger; the
// FAFF-205 ownership/liveness gate (runIsOwned / runIsHeld, reused verbatim from
// runcheck.js) already classifies that ledger as owned / foreign-held /
// foreign-abandoned-looking. This module adds one more Stop-hook command that, in
// EXACTLY the foreign-abandoned-looking case, spawns the unmodified `faff sentry
// check` CLI and surfaces its verdict as a non-blocking advisory — turning any
// other session's turn-end into an opportunistic sentry consult, with ZERO new
// detection math.
//
// Design principles (ADR-0065; each would reject an otherwise-valid change here):
//  - Consume, never re-derive: this module reimplements no trigger predicate, no
//    threshold, no liveness math — it imports runIsOwned/runIsHeld from
//    runcheck.js and child-spawns the unmodified `sentry check` CLI.
//  - Never trap a foreign session (FAFF-235): --hook mode ALWAYS exits 0 and NEVER
//    writes a stdout decision payload. Advisory stderr only.
//  - Heartbeat-only liveness (FAFF-233): the gate reuses runIsHeld verbatim; the
//    recorded owner.pid is never consulted.
//  - Explicitly insufficient alone: the solo-overnight threat model has no other
//    session to fire this hook. This is additive assist, never a reason to
//    descope FAFF-470.
//  - Advisory-only, all levels including L4: acting (`sentry abort`) is
//    mint-scoped (ADR-0044/0065) and belongs to the poller — this hook cannot
//    know the run's --worktree (an abort from here would strand WIP), and a
//    non-owner never writes a foreign run's ledger.
// ===========================================================================

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { runIsHeld, runIsOwned } = require("./runcheck");
const { overlayHeartbeat, readHeartbeatFile } = require("./heartbeat");
const { ENTRYPOINT, findRoot, latestRunDir, readLedger } = require("./shared-infra");
// FAFF-798: gate the andon page on the SAME acting predicate the poller uses, so an
// advisory-only (attended / non-declared) trip surfaces the stderr notice but never
// pages. `readGovernanceConfig` loads cfg exactly as sentry-poller.js does.
const { actsOnSentryAbort } = require("./sentry");
const { readGovernanceConfig } = require("./budget");

// Bounded timeout for the consult child (FAFF-471 D6): `sentry check` itself
// spawns budget + corrective-integrity children and walks transcripts, so it can
// be slow — a Stop hook must stay bounded. Narrow this constant if 10s proves too
// generous in practice; never widen the GATE to compensate.
const SENTRYCHECK_CONSULT_TIMEOUT_MS = 10000;

// ---------------------------------------------------------------------------
// Pure gate (no filesystem, no spawn) — mirrors runcheckHookDecision's shape so
// the selftest and the real entrypoint drive the identical decision.
//
// GateDecision:
//   skip-owned        — this session owns the run
//   skip-not-running   — owner absent, or owner.status != "running" (done / aborted-resumable / legacy no-owner)
//   skip-held          — foreign + live owner (fresh effective heartbeat)
//   consult            — foreign + running + not held — abandoned-looking
//
// heartbeat is assumed already overlaid onto `ledger` by the caller (mirrors
// runcheck's cmdRuncheck: overlayHeartbeat runs ONCE, before this pure fn).
// ---------------------------------------------------------------------------
function sentrycheckGateDecision(ledger, runDir, env, nowMs) {
  if (runIsOwned(ledger, runDir, env)) return "skip-owned";
  const owner = ledger && ledger.owner;
  if (!owner || owner.status !== "running") return "skip-not-running";
  if (runIsHeld(ledger, nowMs, env)) return "skip-held";
  return "consult";
}

// Classify the `faff sentry check --json --run-dir <dir>` child result into a
// ConsultOutcome. consult-failed folds spawn error / timeout / non-{0,3} exit /
// unparseable stdout — every case where the consult itself couldn't be trusted,
// as distinct from `indeterminate` (a clean exit-3 reply the child ITSELF marked
// as its own fault, FAFF-425) and `tripped`/`ok` (a clean exit-0 verdict).
function classifySentryConsult(r) {
  if (r.error) {
    const timedOut = r.error.code === "ETIMEDOUT" || /timed ?out/i.test(r.error.message || "");
    return { kind: "consult-failed", reason: timedOut ? "timed out" : `spawn error: ${r.error.message}` };
  }
  if (r.signal) {
    // Only this module's own timeout kills the child (no killSignal-bearing
    // caller otherwise) — a signal with no `error` set is Node's timeout path.
    return { kind: "consult-failed", reason: "timed out" };
  }
  if (r.status === 0) {
    let payload;
    try { payload = JSON.parse((r.stdout || "").trim()); }
    catch { return { kind: "consult-failed", reason: "unparseable stdout on exit 0" }; }
    return { kind: payload && payload.tripped === true ? "tripped" : "ok", payload };
  }
  if (r.status === 3) {
    let payload;
    try { payload = JSON.parse((r.stdout || "").trim()); }
    catch { return { kind: "consult-failed", reason: "unparseable stdout on exit 3" }; }
    return { kind: "indeterminate", payload, reason: (payload && payload.reason) || "indeterminate" };
  }
  return { kind: "consult-failed", reason: `unexpected exit code ${r.status}` };
}

// One non-blocking stderr line for a consult that couldn't produce (or produced
// a self-flagged-faulty) verdict — FAFF-425's fail-closed-surfacing posture,
// softened to advisory because FAFF-235 outranks it at a foreign session's turn-end.
function consultFailureNotice(runId, runDir, outcome) {
  const detail = outcome.kind === "indeterminate" ? `indeterminate: ${outcome.reason}` : outcome.reason;
  return `[warn] faff sentrycheck: latest run ${runId} looks abandoned (heartbeat stale) ` +
    `but the sentry consult was ${detail} — not an all-clear; inspect: faff sentry check --run-dir ${runDir}\n`;
}

// One non-blocking stderr line for a genuine trip — names the remedy commands so
// a human (or the owner) can act deliberately; this hook never acts itself.
function trippedNotice(runId, runDir, payload) {
  const signals = Array.isArray(payload.verdicts) && payload.verdicts.length
    ? payload.verdicts.map((v) => v.signal).join(", ")
    : "unknown";
  return `[warn] faff sentrycheck: latest run ${runId} looks abandoned; sentry tripped ${signals} ` +
    `— intervention: ${payload.intervention}. Nothing was acted on from this session. ` +
    `Inspect: faff sentry check --run-dir ${runDir}; abort resumably: faff sentry abort --run-dir ${runDir} --worktree <path>\n`;
}

const { parseArgs, usageError } = require("./argv");
const SENTRYCHECK_SPEC = { flags: { "--selftest": { arity: 0 }, "--hook": { arity: 0 }, "--root": { arity: 1 } } };

// FAFF-620: resolve the run dir behind a discriminated catch. `findRoot()`'s
// default arg is `process.cwd()` — the sole live throw in this resolution — and
// it surfaces `ENOENT` when the cwd has been deleted out from under the process.
// `latestRunDir` is already hardened (FAFF-578, shared-infra.js) and never
// throws, so this is the only fault seam left at this call site. Swallow
// exactly that fault to a silent no-op; re-throw everything else so an
// unrelated bug never vanishes into an every-turn-hook's exit-0 silence.
//
// `deps` is a TEST-ONLY injection seam — production has exactly one caller
// (cmdSentrycheck below) and it always passes a single argument, so the
// defaults bind the real findRoot/latestRunDir imports. No production path
// ever threads `deps`.
function resolveSentryRunDir(values, deps = { findRoot, latestRunDir }) {
  try {
    const root = values["--root"] || deps.findRoot();
    return deps.latestRunDir(root);
  } catch (e) {
    if (e && e.code === "ENOENT") return null; // deleted cwd / mid-scan-deleted run dir → silent no-op
    throw e; // every other fault stays loud — no fail-open masking
  }
}

function cmdSentrycheck(args) {
  if (args.includes("--selftest")) return sentrycheckSelftest();
  const { values, errors } = parseArgs(args, SENTRYCHECK_SPEC);
  if (errors.length) return usageError(errors, "faff sentrycheck: expected --hook [--root DIR] (or --selftest)");
  if (!values["--hook"]) {
    process.stderr.write("faff sentrycheck: expected --hook [--root DIR] (or --selftest)\n");
    return 2;
  }
  const runDir = resolveSentryRunDir(values);
  if (!runDir) return 0; // skip-no-run, OR resolution no-opped on a deleted cwd (ENOENT)

  let ledger;
  try { ledger = readLedger(runDir); }
  catch { return 0; } // skip-unreadable — silent, runcheck --hook parity (D8)

  // FAFF-355: overlay the dedicated heartbeat file over owner.last_heartbeat ONCE,
  // before the pure decision runs — mirrors runcheck's cmdRuncheck exactly.
  overlayHeartbeat(ledger, readHeartbeatFile(runDir));

  const decision = sentrycheckGateDecision(ledger, runDir, process.env, Date.now());
  if (decision !== "consult") return 0; // owned / held / not-running — silent, no child spawned

  const runId = ledger.run_id || path.basename(runDir);
  const r = spawnSync(process.execPath, [ENTRYPOINT, "sentry", "check", "--json", "--run-dir", runDir],
    { encoding: "utf8", timeout: SENTRYCHECK_CONSULT_TIMEOUT_MS, input: "" });
  const outcome = classifySentryConsult(r);

  if (outcome.kind === "consult-failed" || outcome.kind === "indeterminate") {
    process.stderr.write(consultFailureNotice(runId, runDir, outcome));
    return 0;
  }
  if (outcome.kind === "ok") return 0; // sentry authoritative: tripped:false → silent
  process.stderr.write(trippedNotice(runId, runDir, outcome.payload)); // tripped — advisory ALWAYS fires (never gated)
  // FAFF-798: page andon ONLY when something acts on the trip, mirroring the poller
  // (sentry-poller.js:243-246 loads cfg, and only emits sentry-trip + pumps andon
  // inside its `action === "abort"` branch, gated on actsOnSentryAbort). An
  // attended/advisory trip (L2/L3, no unattended declaration) surfaces the stderr
  // notice above but must NOT page. cfg is loaded fail-safe → {} on any fault, so a
  // config-load fault demotes a non-L4 run to no-page (the safe direction); an L4
  // ledger short-circuits inside actsOnSentryAbort before cfg is read, so a config
  // fault can never regress the L4 kill-switch (ADR-0034). `root` is hoisted once
  // and reused by both the cfg load and the andon `--root` argument.
  const root = findRoot(runDir);
  let cfg = {};
  try { cfg = readGovernanceConfig(root); }
  catch { cfg = {}; /* base-parse-error / legacy-name / any fault → fail-safe OFF */ }
  if (actsOnSentryAbort(ledger, cfg)) {
    // FAFF-472: page andon for a genuine trip observed from a foreign session's
    // turn-end. `andon send` (never pump/event-append) — this locus must NOT write
    // the foreign run's events.jsonl or andon-state.json (non-owner-never-writes,
    // FAFF-235/ADR-0065). Best-effort, fail-open; never affects this hook's
    // always-exit-0 contract.
    try {
      const payload = outcome.payload || {};
      const signals = Array.isArray(payload.verdicts) && payload.verdicts.length
        ? payload.verdicts.map((v) => v.signal).join(", ")
        : "unknown";
      // --root explicit, derived from runDir (not the hook's inherited cwd) — the
      // same reasoning as the poller's andon pump call (sentry-poller.js FAFF-472).
      spawnSync(process.execPath, [ENTRYPOINT, "andon", "send",
        "--class", "sentry-trip",
        "--title", `faff ${runId}: sentry tripped (${payload.intervention})`,
        "--body", `signals: ${signals} — run looks abandoned (heartbeat stale)`,
        "--run-dir", runDir,
        "--root", root,
      ], { encoding: "utf8" });
    } catch { /* best-effort — fail-open telemetry, never affects the hook's exit-0 contract */ }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Selftest (FAFF-471) — drives the pure gate as a fixed-clock table, the
// runcheck-selftest pattern. Covers: owned (both signals) / held / stale-running
// (consult) / done / aborted-resumable / legacy no-owner / unparseable heartbeat
// (still consult — sentry decides) / env-override staleness window.
// ---------------------------------------------------------------------------
const SENTRYCHECK_NOW = Date.parse("2026-06-22T16:00:00Z");
const SENTRYCHECK_RUN_DIR = "/runs/RUN-LIVE";
function hbAgo(secs) { return new Date(SENTRYCHECK_NOW - secs * 1000).toISOString(); }

// [name, ledger, env, wantDecision]
const SENTRYCHECK_SELFTEST_CASES = [
  ["owned via FAFF_RUN_DIR → skip-owned",
    { run_id: "R", owner: { status: "running", last_heartbeat: hbAgo(10) } },
    { FAFF_RUN_DIR: SENTRYCHECK_RUN_DIR }, "skip-owned"],
  ["owned via session_id fallback → skip-owned",
    { run_id: "R", owner: { status: "running", session_id: "S1", last_heartbeat: hbAgo(10) } },
    { FAFF_SESSION_ID: "S1" }, "skip-owned"],
  ["foreign + held (fresh heartbeat) → skip-held",
    { run_id: "R", owner: { status: "running", last_heartbeat: hbAgo(10) } },
    {}, "skip-held"],
  ["foreign + running + stale heartbeat → consult",
    { run_id: "R", owner: { status: "running", last_heartbeat: hbAgo(1000) } },
    {}, "consult"],
  ["foreign + status:done → skip-not-running (regardless of timestamps)",
    { run_id: "R", owner: { status: "done", last_heartbeat: hbAgo(1000) } },
    {}, "skip-not-running"],
  ["foreign + status:aborted-resumable → skip-not-running",
    { run_id: "R", owner: { status: "aborted-resumable", last_heartbeat: hbAgo(1000) } },
    {}, "skip-not-running"],
  ["legacy ledger (no owner) → skip-not-running",
    { run_id: "R" },
    {}, "skip-not-running"],
  ["foreign + running + unparseable heartbeat → consult (sentry decides)",
    { run_id: "R", owner: { status: "running", last_heartbeat: "not-a-date" } },
    {}, "consult"],
  ["FAFF_RUN_HEARTBEAT_STALE_SECS shrinks the window → a once-held run now consults",
    { run_id: "R", owner: { status: "running", last_heartbeat: hbAgo(120) } },
    { FAFF_RUN_HEARTBEAT_STALE_SECS: "60" }, "consult"],
  ["FAFF-233: fresh heartbeat + DEAD recorded pid → still held (pid not consulted)",
    { run_id: "R", owner: { status: "running", pid: 2147483646, last_heartbeat: hbAgo(10) } },
    {}, "skip-held"],
];

function sentrycheckSelftest() {
  let fail = 0;
  for (const [name, ledger, env, want] of SENTRYCHECK_SELFTEST_CASES) {
    const cloned = JSON.parse(JSON.stringify(ledger));
    const got = sentrycheckGateDecision(cloned, SENTRYCHECK_RUN_DIR, env, SENTRYCHECK_NOW);
    const ok = got === want;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name} → ${got} (want ${want})`);
  }
  // classifySentryConsult: exercise the outcome classifier over synthetic spawnSync-shaped results.
  const consultCases = [
    ["clean tripped:true", { status: 0, stdout: JSON.stringify({ tripped: true, intervention: "abort", verdicts: [{ signal: "wall-clock-runaway" }] }) }, "tripped"],
    ["clean tripped:false", { status: 0, stdout: JSON.stringify({ tripped: false, intervention: "continue", verdicts: [] }) }, "ok"],
    ["exit 3 indeterminate", { status: 3, stdout: JSON.stringify({ indeterminate: true, reason: "ledger unreadable" }) }, "indeterminate"],
    ["spawn error", { error: new Error("ENOENT") }, "consult-failed"],
    ["timeout (signal, no error)", { signal: "SIGTERM" }, "consult-failed"],
    ["unparseable stdout on exit 0", { status: 0, stdout: "not json" }, "consult-failed"],
    ["unexpected exit code", { status: 7, stdout: "" }, "consult-failed"],
  ];
  for (const [name, fixture, want] of consultCases) {
    const got = classifySentryConsult(fixture).kind;
    const ok = got === want;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} classify: ${name} → ${got} (want ${want})`);
  }
  const total = SENTRYCHECK_SELFTEST_CASES.length + consultCases.length;
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${total} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  SENTRYCHECK_CONSULT_TIMEOUT_MS, SENTRYCHECK_NOW, SENTRYCHECK_RUN_DIR, SENTRYCHECK_SELFTEST_CASES,
  classifySentryConsult, cmdSentrycheck, consultFailureNotice, hbAgo, resolveSentryRunDir,
  sentrycheckGateDecision, sentrycheckSelftest, trippedNotice,
};
