// ===========================================================================
// === region:governance — turncheck — refuse a NON-TERMINAL turn-end on run state (FAFF-854) ===
// The fifth member of the Stop-hook family (runcheck / prepcheck / inflightcheck /
// sentrycheck). Where inflightcheck is ENUMERATION-based (it blocks only for a
// per-dispatch marker the orchestrator explicitly `--open`'d), turncheck is
// STATE-based: it reads the one durable signal that is always present when a run
// strands — `owner.status` was never moved off "running" — so it catches every
// non-terminal turn-end regardless of trigger (an adversarial outage, a failed-fast
// retry, a backgrounded subprocess spawn, or no reason at all). Enumerating dispatch
// shapes always misses the next unbracketed one (the FAFF-884 fan-out spawn gap);
// one state check does not.
//
// Composition (disjoint preconditions, so exactly one hook speaks per case):
//   - runcheck      owns "queue not drained" (undispatched admitted issues)
//   - inflightcheck owns "an open per-dispatch marker"
//   - turncheck     owns the residual: owner.status "running" AND the queue clean
//                   AND no open marker AND not-held.
// The turn may end only when all three are satisfied.
//
// Like the rest of the family it trusts on-disk owner-emitted state and never
// touches the tracker (the pure-function CLI invariant); ownership/liveness are
// runcheck's runIsOwned/runIsHeld verbatim (FAFF-233 heartbeat-only, FAFF-235
// foreign-never-trapped), never re-derived. The block PAYLOAD on stdout + exit 0 is
// the Stop-hook block mechanism (parity with the four siblings), not the exit code.
// ===========================================================================

const path = require("node:path");
const { overlayHeartbeat, readHeartbeatFile } = require("./heartbeat");
const { auditLedger, malformedOwnedReason, ownedByEnvPointer, resolveRunDir, runIsHeld, runIsOwned } = require("./runcheck");
const { inflightIsStale, readInflightMarkers, resolveOwnerScope } = require("./inflightcheck");
const { findRoot, readLedger } = require("./shared-infra");

// The block-reason text (shared by the hook and the selftest expectation).
function turncheckReason(ledger) {
  const rid = (ledger && ledger.run_id) || "this run";
  return (
    `faff turncheck: this session is ending its turn while run ${rid} is still owner.status:"running" ` +
    `with no terminal outcome recorded and nothing legitimately in flight — a non-terminal turn-end. Under ` +
    `headless \`claude -p\` the turn end exits the cage and the run dies mid-flight (owner.status:"running", ` +
    `no live process). Reach a terminal state before stopping: drain the queue / park all remaining / hit the ` +
    `budget and close the run (move owner.status off "running"), or record the durable hold.`
  );
}

// Does THIS owner have an in-flight marker inflightcheck WOULD BLOCK ON? Computed in
// the impure shell (the readInflightMarkers filesystem read) and folded into opts, so
// the pure decision keeps runcheck's 5-arg signature and stays filesystem-free. A
// marker is "this owner's" by the same path-derived owner-scope inflightcheck itself
// uses. Crucially, turncheck defers ONLY to a marker inflightcheck actually blocks on:
// a LIVE owned marker (parseable + within the TTL) or a CORRUPT owned one (inflightcheck
// fails those closed). A parseable owned marker past the TTL is a corpse inflightcheck
// SWEEPS (it does not block), so it must NOT make turncheck defer — otherwise the
// residual (owner running, clean queue, only a stale corpse marker) could slip through
// BOTH hooks. Filtering here makes the composition order-independent rather than relying
// on turncheck running after inflightcheck in the Stop sequence.
function hasOpenInflightForOwner(root, env, nowMs) {
  const scope = resolveOwnerScope(env || process.env);
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  return readInflightMarkers(root).some((m) => {
    if (m.scope !== scope) return false;
    if (!m.parseOk) return true;                          // corrupt owned marker → inflightcheck blocks → defer
    return !inflightIsStale(m.opened_at, now, env);       // live → inflightcheck blocks → defer; corpse → it sweeps → don't defer
  });
}

// Pure decision for the Stop hook (FAFF-854): given a parsed ledger, the resolved
// run dir, the wall clock, the env, and opts, decide what the hook emits. Returns
// { block, warn, reason?, owned, held }. Signature is byte-identical to
// runcheckHookDecision (the mirror mandate); opts carries the two extra inputs:
//   opts.recover         — the --recover human force (FAFF-235)
//   opts.hasOpenInflight — does THIS owner have an open inflight marker (gathered
//                          in the shell, so the pure fn does no filesystem read)
//
// The owning session forces held=false (it cannot be "held by a live owner" when it
// IS the owner about to stop; its heartbeat is naturally fresh at its own turn-end),
// exactly as runcheck does — so heartbeat freshness only decides the FOREIGN
// silent-vs-warn split, never whether the owner is guarded.
function turncheckHookDecision(ledger, runDir, nowMs, env, opts) {
  const recover = !!(opts && opts.recover);
  const hasOpenInflight = !!(opts && opts.hasOpenInflight);
  const owned = runIsOwned(ledger, runDir, env);
  const held = owned ? false : runIsHeld(ledger, nowMs, env);
  // Foreign AND a live owner is draining it → stay silent (a live foreign drain).
  if (held) return { block: false, warn: false, owned, held: true };
  // Audit the queue. A malformed OWNED ledger fails CLOSED (mirrors runcheck's
  // FAFF-690 F4 path); a foreign/unprovable malformed ledger stays silent.
  let clean;
  try { clean = auditLedger(ledger, (ledger && ledger.run_id) ?? path.basename(runDir || "")).clean; }
  catch {
    if (owned) return { block: true, warn: false, reason: malformedOwnedReason(runDir), owned: true, held: false };
    return { block: false, warn: false, owned: false, held: false };
  }
  const owner = ledger && ledger.owner;
  // Terminal / done / aborted-resumable / legacy no-owner → nothing to guard.
  if (!owner || owner.status !== "running") return { block: false, warn: false, owned, held: false };
  // Dirty queue is runcheck's job → defer (no double-block).
  if (!clean) return { block: false, warn: false, owned, held: false };
  // An open marker is inflightcheck's job → defer (no double-block).
  if (hasOpenInflight) return { block: false, warn: false, owned, held: false };
  // Residual: owner.status running, queue clean, no open marker, not held. The
  // owning session (backstop) or a deliberate --recover hard-blocks; any other
  // (foreign) session only warns, never blocks (FAFF-235).
  if (owned || recover) return { block: true, warn: false, reason: turncheckReason(ledger), owned, held: false };
  return { block: false, warn: true, reason: turncheckReason(ledger), owned, held: false };
}

const { parseArgs, usageError } = require("./argv");
// --root is declared (accepted-and-ignored for run-dir resolution, but consumed for
// the inflight-marker read) so probeServes's `turncheck --hook --root <probeRoot>`
// never trips unknown-flag — parity with runcheck.
const TURNCHECK_SPEC = {
  flags: { "--selftest": { arity: 0 }, "--hook": { arity: 0 }, "--json": { arity: 0 }, "--recover": { arity: 0 }, "--root": { arity: 1 } },
  positionals: { min: 0, max: 1, name: "run-dir" },
};

function cmdTurncheck(args) {
  if (args.includes("--selftest")) return turncheckSelftest();
  const parsed = parseArgs(args, TURNCHECK_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, "usage: faff turncheck [RUN_DIR] [--hook] [--recover] [--json]");
  const hook = !!parsed.values["--hook"];
  const asJson = !!parsed.values["--json"];
  const positional = parsed.positionals;
  const root = parsed.values["--root"] || findRoot();

  let runDir;
  try {
    runDir = resolveRunDir(positional[0]);
  } catch (e) {
    // Defence in depth — a Stop hook fires at every turn-end and must never crash on
    // filesystem churn. Hook mode: silent (parity with runcheck). CLI mode: loud fault.
    if (hook) return 0;
    process.stderr.write(`turncheck: run-dir resolution failed: ${e.message}\n`);
    return 2;
  }

  if (hook) {
    if (!runDir) return 0;
    let ledger;
    try { ledger = readLedger(runDir); }
    catch {
      // readLedger JSON.parses the file, so BOTH a parse error and an unreadable file throw here — no
      // ledger object, so ownership is only establishable by the content-independent env pointer. An
      // OWNED corrupt ledger hard-blocks (fail-closed); a foreign/unprovable one stays silent — parity
      // with runcheck's FAFF-690 F4 path.
      if (ownedByEnvPointer(runDir, process.env)) {
        console.log(JSON.stringify({ decision: "block", reason: malformedOwnedReason(runDir) }));
        return 0;
      }
      return 0;
    }
    // Overlay the dedicated heartbeat file over owner.last_heartbeat BEFORE the pure decision (the pure
    // fn stays filesystem-free) — the one read of the file for this seam, mirroring runcheck.
    overlayHeartbeat(ledger, readHeartbeatFile(runDir));
    const recover = !!parsed.values["--recover"];
    const hasOpenInflight = hasOpenInflightForOwner(root, process.env, Date.now());
    const decision = turncheckHookDecision(ledger, runDir, Date.now(), process.env, { recover, hasOpenInflight });
    if (decision.block) console.log(JSON.stringify({ decision: "block", reason: decision.reason }));
    else if (decision.warn) process.stderr.write(`[warn] ${decision.reason}\n`);
    return 0;
  }

  // Non-hook CLI mode (operator use): a human summary + non-zero exit on block (parity with runcheck's exit 3).
  if (!runDir) { process.stderr.write("turncheck: no .faff/runs/*/run-ledger.json found\n"); return 2; }
  let ledger;
  try { ledger = readLedger(runDir); }
  catch (e) { process.stderr.write(`turncheck: missing or malformed ledger in ${runDir}: ${e.message}\n`); return 2; }
  overlayHeartbeat(ledger, readHeartbeatFile(runDir));
  const recover = !!parsed.values["--recover"];
  const hasOpenInflight = hasOpenInflightForOwner(root, process.env);
  const decision = turncheckHookDecision(ledger, runDir, Date.now(), process.env, { recover, hasOpenInflight });
  if (asJson) {
    console.log(JSON.stringify({ run: (ledger.run_id ?? path.basename(runDir)), ...decision }, null, 2));
  } else if (decision.block) {
    console.log(`run:   ${ledger.run_id ?? path.basename(runDir)}`);
    console.log("NON-TERMINAL turn-end: owner.status is still \"running\" with a clean queue and nothing in flight.");
    console.log("→ close the run (move owner.status off \"running\") or record a durable hold before stopping.");
  } else if (decision.warn) {
    console.log(`run:   ${ledger.run_id ?? path.basename(runDir)}`);
    console.log("[warn] a FOREIGN run looks abandoned (owner.status \"running\", stale heartbeat) — surfaced, not blocked.");
  } else {
    console.log(`run:   ${ledger.run_id ?? path.basename(runDir)}`);
    console.log("clean: no non-terminal turn-end to guard (owner not running, or held, or work still in flight).");
  }
  return decision.block ? 3 : 0;
}

// ---------------------------------------------------------------------------
// Selftest — drives the pure decision over (ledger, env, opts) tuples with a fixed
// NOW anchoring heartbeat ages, exactly as runcheck's does. hasOpenInflight is a
// pure input (gathered in the shell for real runs), so the composition-defer cases
// drive it directly; the impure shell's SCOPE RESOLUTION of hasOpenInflight is
// covered by the integration test (test/turncheck.test.mjs) — the pure table cannot
// verify it (that is the FAFF-854 QA-minor).
// ---------------------------------------------------------------------------
const TURNCHECK_NOW = Date.parse("2026-08-23T16:00:00Z");
const TURNCHECK_RUN_DIR = "/runs/RUN-LIVE";
function tcHbAgo(secs) { return new Date(TURNCHECK_NOW - secs * 1000).toISOString(); }

// [name, ledger, env, opts, wantBlock, wantWarn]
const TURNCHECK_SELFTEST_CASES = [
  ["owned + running + clean queue + no open marker + not-held → block (the owning session's own turn-end)",
    { run_id: "R", admitted: ["X"], outcomes: { X: "shipped" }, owner: { status: "running", last_heartbeat: tcHbAgo(10) } },
    { FAFF_RUN_DIR: TURNCHECK_RUN_DIR }, {}, true, false],
  ["owned + running + admitted:[] (empty, the canonical mid-prep death) → block (empty queue is clean)",
    { run_id: "R", admitted: [], outcomes: {}, owner: { status: "running", last_heartbeat: tcHbAgo(10) } },
    { FAFF_RUN_DIR: TURNCHECK_RUN_DIR }, {}, true, false],
  ["owned + running + DIRTY queue (undispatched) → silent (runcheck owns this; no double-block)",
    { run_id: "R", admitted: ["X"], outcomes: {}, owner: { status: "running", last_heartbeat: tcHbAgo(10) } },
    { FAFF_RUN_DIR: TURNCHECK_RUN_DIR }, {}, false, false],
  ["owned + running + clean + an OPEN inflight marker → silent (inflightcheck owns this; no double-block)",
    { run_id: "R", admitted: ["X"], outcomes: { X: "shipped" }, owner: { status: "running", last_heartbeat: tcHbAgo(10) } },
    { FAFF_RUN_DIR: TURNCHECK_RUN_DIR }, { hasOpenInflight: true }, false, false],
  ["owned + owner.status DONE → silent (terminal owner; nothing to guard)",
    { run_id: "R", admitted: ["X"], outcomes: { X: "shipped" }, owner: { status: "done", last_heartbeat: tcHbAgo(10) } },
    { FAFF_RUN_DIR: TURNCHECK_RUN_DIR }, {}, false, false],
  ["owned + owner.status aborted-resumable → silent (the sentry/abort path owns it)",
    { run_id: "R", admitted: ["X"], outcomes: {}, owner: { status: "aborted-resumable", last_heartbeat: tcHbAgo(10) } },
    { FAFF_RUN_DIR: TURNCHECK_RUN_DIR }, {}, false, false],
  ["owned + legacy ledger (no owner) → silent (nothing to guard)",
    { run_id: "R", admitted: ["X"], outcomes: { X: "shipped" } },
    { FAFF_RUN_DIR: TURNCHECK_RUN_DIR }, {}, false, false],
  ["FOREIGN + held (running, fresh heartbeat) → silent (a live foreign drain)",
    { run_id: "R", admitted: [], outcomes: {}, owner: { status: "running", last_heartbeat: tcHbAgo(10) } },
    {}, {}, false, false],
  ["FOREIGN + not-held (running, stale heartbeat) + clean + no marker → WARN, not block",
    { run_id: "R", admitted: [], outcomes: {}, owner: { status: "running", last_heartbeat: tcHbAgo(1000) } },
    {}, {}, false, true],
  ["FOREIGN + not-held residual + --recover → block (deliberate human recovery)",
    { run_id: "R", admitted: [], outcomes: {}, owner: { status: "running", last_heartbeat: tcHbAgo(1000) } },
    {}, { recover: true }, true, false],
  ["FOREIGN + held + --recover → silent (nothing to recover; a live foreign drain)",
    { run_id: "R", admitted: [], outcomes: {}, owner: { status: "running", last_heartbeat: tcHbAgo(10) } },
    {}, { recover: true }, false, false],
  ["owned via session_id fallback + running + clean + no marker → block (env-pointer absent)",
    { run_id: "R", admitted: ["X"], outcomes: { X: "shipped" }, owner: { status: "running", session_id: "S1", last_heartbeat: tcHbAgo(10) } },
    { FAFF_SESSION_ID: "S1" }, {}, true, false],
  ["owned (env-pointer) + MALFORMED ledger (outcomes non-object) → block (fail-closed)",
    { run_id: "R", admitted: ["X"], outcomes: [], owner: { status: "running", last_heartbeat: tcHbAgo(10) } },
    { FAFF_RUN_DIR: TURNCHECK_RUN_DIR }, {}, true, false],
  ["FOREIGN + MALFORMED ledger (outcomes non-object) → silent (no foreign hard-block)",
    { run_id: "R", admitted: ["X"], outcomes: [], owner: { status: "running", last_heartbeat: tcHbAgo(1000) } },
    {}, {}, false, false],
];

function turncheckSelftest() {
  let fail = 0;
  for (const [name, ledger, env, opts, wantBlock, wantWarn] of TURNCHECK_SELFTEST_CASES) {
    // Clone before overlay parity with runcheck (shared literals; overlayHeartbeat is a no-op here
    // since these fixtures carry no heartbeat file, but the clone keeps each case isolated).
    const cloned = JSON.parse(JSON.stringify(ledger));
    const d = turncheckHookDecision(cloned, TURNCHECK_RUN_DIR, TURNCHECK_NOW, env, opts);
    const ok = d.block === wantBlock && (d.warn || false) === (wantWarn || false);
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name} → block=${d.block} warn=${d.warn || false} (want block=${wantBlock} warn=${wantWarn || false})`);
  }
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${TURNCHECK_SELFTEST_CASES.length} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  TURNCHECK_NOW, TURNCHECK_RUN_DIR, TURNCHECK_SELFTEST_CASES,
  cmdTurncheck, hasOpenInflightForOwner, tcHbAgo, turncheckHookDecision, turncheckReason, turncheckSelftest,
};
