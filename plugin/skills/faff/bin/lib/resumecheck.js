// ===========================================================================
// === region:governance — resumecheck — release a dead headless-resume claim on the turn it dies (FAFF-896) ===
// The sixth member of the Stop-hook family (runcheck / prepcheck / inflightcheck /
// sentrycheck / turncheck): a headless `claude -p '… faff lights-out --resume …'`
// claims the run owner (stamps owner.status:"running", a fresh last_heartbeat, and a
// run-resume event) and then ENDS ITS TURN WITH NO WORK. The frozen-fresh heartbeat
// then makes the next --resume refuse for up to the whole staleness window
// (runIsHeld is heartbeat-only since FAFF-233). This hook is the WRITE-SIDE fix: the
// claiming session's OWN Stop hook stamps its OWN owner back down to
// "aborted-resumable" at turn-end when it did literally zero work — a same-session,
// same-box act that needs no cross-box liveness proof (deliberately sidestepping the
// capability-#2 machine-id/pid wiring). The read-side backstop (resumeProvablyDead
// feeding classifyReEnterable in lights-out.js) covers the hard-kill case where no
// Stop event ever fires.
//
// Design pins (mirroring inflightcheck's, adapted to the ledger-write shape):
//  - EVIDENCE OVER LIVENESS-GUESSING. "The only event since the last run-resume is
//    that run-resume" is a durable, box-independent fact in the append-only, seq-
//    ordered log — read as: the log's TAIL record type === "run-resume". Preferred to
//    any process-liveness heuristic.
//  - NEVER AGE-GATE THE SAME-SESSION RELEASE. The observed failure fires seconds after
//    the claim; an age threshold on this primary path would re-open the exact window
//    this closes. (The deadclaim grace lives ONLY on the read-side backstop.)
//  - THE EPOCH FENCE STAYS THE REAL MUTEX. The unlocked read is advisory (decides
//    whether to ATTEMPT a release); the authority is the FAFF-527 epoch/session fence
//    mutateLedgerUnderLock applies UNDER the lock against the observed owner. A
//    concurrent legitimate takeover makes this hook yield rather than clobber.
//  - STAMP, DO NOT BLOCK. A `block` payload cannot keep a terminating `-p` alive and
//    would leave the owner "running" — the corpse. The fix is the WRITE (release).
//    --hook ALWAYS exits 0; the side effect, not the exit code, is the observable.
// ===========================================================================

const path = require("node:path");
const { overlayHeartbeat, readHeartbeatFile, mutateLedgerUnderLock } = require("./heartbeat");
const { runIsOwned, resolveRunDir } = require("./runcheck");
const { tailReadNextSeq, appendRecordUnderLock } = require("./events");
const { findRoot, readLedger } = require("./shared-infra");
const { parseArgs, usageError } = require("./argv");

// The deadclaim grace (READ-SIDE ONLY): minimum age of the tail run-resume event
// before the read-side backstop treats a held-but-provably-dead claim as reclaimable,
// bounding the race with a live-but-just-started driver. Env-ONLY (mirrors
// FAFF_RUN_HEARTBEAT_STALE_SECS): a finite >0 value wins, else the 300s default
// (< heartbeatStaleSecs, above the observed first-event latency). nowFn/env injectable
// so the 299-vs-301s boundary runs as a pure, deterministic decision.
function graceSecs(env) {
  const n = Number((env || process.env).FAFF_RESUME_DEADCLAIM_GRACE_SECS);
  return Number.isFinite(n) && n > 0 ? n : 300;
}

// The no-work evidence primitive — reuses the existing events tail reader. Append-only
// + seq-ordered makes "the log's tail record" exactly "the only event since run-resume".
// An empty/unreadable log ⇒ not a resume claim (isRunResume:false). Never throws.
function tailEventIsRunResume(runDir) {
  let rec = null;
  try { rec = tailReadNextSeq(path.join(runDir, "events.jsonl")).prevRecord; }
  catch { rec = null; }
  if (!rec || typeof rec !== "object") return { isRunResume: false, ts: null, seq: null };
  return { isRunResume: rec.type === "run-resume", ts: rec.ts ?? null, seq: rec.seq ?? null };
}

// PURE core of the read-side backstop: is a frozen claim provably dead? True iff the
// tail is a run-resume whose timestamp is older than the deadclaim grace. nowMs/env
// injected so the grace boundary is deterministically unit-testable (no filesystem).
function provablyDeadFromTail(tail, nowMs, env) {
  if (!tail || !tail.isRunResume || tail.ts == null) return false;
  const t = Date.parse(tail.ts);
  if (!Number.isFinite(t)) return false;
  return (nowMs - t) / 1000 > graceSecs(env);
}

// The read-side backstop entry point lights-out.js's resumeLightsOut STEP 1b calls:
// read the events tail and decide provably-dead. Single-sources the grace logic so the
// hook and the resume path never drift. Impure (reads events.jsonl); the pure core is
// provablyDeadFromTail above.
function resumeProvablyDead(runDir, nowMs, env) {
  return provablyDeadFromTail(tailEventIsRunResume(runDir), nowMs, env);
}

// The run-claim-abandoned audit event (twin of runResumeEvent) — `type` MUST be
// registered in DELIVERY_PROFILE.event_types (governance-profile.js), phase "run".
// appendRecordUnderLock mints seq/prev/hash; a caller never computes them.
function runClaimAbandonedEvent(runId, seq, nowIso, epoch, prevHash) {
  return {
    schema: 2, run_id: runId, seq, ts: nowIso, prev: prevHash, phase: "run", type: "run-claim-abandoned",
    epoch,
    data: { released_from: "running", to: "aborted-resumable", reason: "no-work-since-run-resume" },
  };
}

// PURE per-run decision for the Stop hook — the twin of inflightHookDecision, decided
// against THIS session's owned run:
//   - not owned (foreign run)            → { release:false }   (never stamp a foreign owner, FAFF-235)
//   - owner absent / not "running"       → { release:false }   (already moved — idempotent no-op)
//   - tail is NOT a run-resume           → { release:false }   (work happened ⇒ healthy, leave it)
//   - owned + running + run-resume tail  → { release:true, reason }
// The advisory heartbeat is deliberately NOT consulted (never age-gate the write-side).
function resumecheckHookDecision(ledger, runDir, tail, env) {
  if (!runIsOwned(ledger, runDir, env)) return { release: false };
  const owner = (ledger && ledger.owner) || null;
  if (!owner || owner.status !== "running") return { release: false };
  if (!tail || !tail.isRunResume) return { release: false };
  return { release: true, reason: "no-work-since-run-resume" };
}

// Confine every write to the runs-root: the resolved run dir must sit strictly under
// <root>/.faff/runs. A trusted FAFF_RUN_DIR pointer resolving anywhere else is a no-op
// (never derive the write target from ledger content — mirrors runcheck/inflightcheck).
function isUnderRunsRoot(runDir, root) {
  const runsRoot = path.resolve(root, ".faff", "runs");
  const rd = path.resolve(runDir);
  return rd !== runsRoot && rd.startsWith(runsRoot + path.sep);
}

const RESUMECHECK_SPEC = { flags: {
  "--selftest": { arity: 0 }, "--hook": { arity: 0 }, "--json": { arity: 0 }, "--root": { arity: 1 },
} };

function cmdResumecheck(args) {
  if (args.includes("--selftest")) return resumecheckSelftest();
  const { values, errors } = parseArgs(args, RESUMECHECK_SPEC);
  if (errors.length) return usageError(errors, "usage: faff resumecheck [--hook] [--json] [--selftest] [--root DIR]");
  const env = process.env;
  const root = (values["--root"] === undefined ? null : values["--root"]) || findRoot();
  const result = { released: false };
  const emit = (code) => { if (values["--json"]) console.log(JSON.stringify(result)); return code; };

  // STEP 1: resolve the run dir from the trusted FAFF_RUN_DIR pointer (null ⇒ silent no-op).
  const runDir = resolveRunDir(env.FAFF_RUN_DIR || undefined);
  if (!runDir) return emit(0);
  // STEP 1a: confine to the runs-root — a pointer resolving outside it is a no-op.
  if (!isUnderRunsRoot(runDir, root)) return emit(0);
  // STEP 2: ADVISORY ledger snapshot (unreadable ⇒ silent no-op).
  let ledger;
  try { ledger = readLedger(runDir); } catch { return emit(0); }
  // STEP 3: overlay the dedicated heartbeat file (advisory only — never gates the release).
  try { overlayHeartbeat(ledger, readHeartbeatFile(runDir)); } catch { /* advisory */ }
  // STEP 4: the no-work evidence.
  const tail = tailEventIsRunResume(runDir);
  // STEP 5: the pure decision.
  const d = resumecheckHookDecision(ledger, runDir, tail, env);
  // STEP 6: nothing to release (foreign / already-moved / work happened) ⇒ non-blocking exit.
  if (!d.release) return emit(0);

  // STEP 7: the observed claim, armed as the under-lock fence.
  const owner = ledger.owner;
  const expectedOwner = { epoch: owner.epoch, session_id: owner.session_id };
  const runId = ledger.run_id || path.basename(runDir);
  const releasedEpoch = Number(owner.epoch || 0);
  const nowIso = new Date().toISOString();

  // STEP 8: the fenced release. mutateLedgerUnderLock applies the FAFF-527 epoch/session
  // fence (a newer on-disk epoch ⇒ yielded, no write); the mutate ALSO re-checks the
  // still-running + still-run-resume-tail invariants under the lock (work landing between
  // the advisory read and the lock aborts the release).
  let mres;
  try {
    mres = mutateLedgerUnderLock(runDir, (fresh) => {
      if (!fresh || !fresh.owner || fresh.owner.status !== "running") return null; // already moved ⇒ idempotent no-op
      if (!tailEventIsRunResume(runDir).isRunResume) return null;                  // work landed between read and lock ⇒ abort
      const next = JSON.parse(JSON.stringify(fresh));
      next.owner.status = "aborted-resumable";
      return next;
    }, expectedOwner);
  } catch (e) {
    // A busy ledger lock is non-blocking here — the read-side backstop / staleness still
    // recover the claim; never let a lock contention throw out of a Stop hook.
    if (e && e.code === "LEDGER_LOCKED") return emit(0);
    throw e;
  }

  // STEP 9/10: on a committed release, append the audit event and surface the non-blocking notice.
  if (mres && mres.written) {
    appendRecordUnderLock(runDir, (seq, _prevRecord, prevHash) => runClaimAbandonedEvent(runId, seq, nowIso, releasedEpoch, prevHash));
    result.released = true;
    result.reason = d.reason;
    result.run_id = runId;
    result.epoch = releasedEpoch;
    process.stderr.write(`[warn] released unworked resume claim (epoch ${releasedEpoch}) → aborted-resumable (no work since run-resume; the next --resume can reclaim it immediately)\n`);
  }
  // STEP 11: non-blocking — ALWAYS exit 0.
  return emit(0);
}

// ---------------------------------------------------------------------------
// Selftest — the pure decision table + the deadclaim-grace parse table + the read-side
// grace boundary (299 vs 301 against a 300s grace), all filesystem-free. Ownership is
// driven by a synthetic runDir + a matching/mismatching FAFF_RUN_DIR env pointer (the
// content-independent clause of runIsOwned resolves the same off-disk). The impure hook
// side (real ledger stamp + event append) is covered in test/resumecheck.test.mjs.
// ---------------------------------------------------------------------------
const RESUMECHECK_NOW = Date.parse("2026-08-27T12:00:00Z");
const resumeAgo = (secs) => new Date(RESUMECHECK_NOW - secs * 1000).toISOString();
const OWNED_RUNDIR = "/runs/MINE";
const OWNED_ENV = { FAFF_RUN_DIR: OWNED_RUNDIR };
const runResumeTail = { isRunResume: true, ts: resumeAgo(10), seq: 3 };
const workTail = { isRunResume: false, ts: resumeAgo(10), seq: 4 };
const emptyTail = { isRunResume: false, ts: null, seq: null };

// [name, ledger, runDir, tail, env, wantRelease]
const RESUMECHECK_HOOK_CASES = [
  ["owned + running + run-resume tail → RELEASE",
    { owner: { status: "running", epoch: 1, session_id: "S" } }, OWNED_RUNDIR, runResumeTail, OWNED_ENV, true],
  ["owned + running + WORK tail → no release (a working run is never disturbed)",
    { owner: { status: "running", epoch: 1, session_id: "S" } }, OWNED_RUNDIR, workTail, OWNED_ENV, false],
  ["owned + running + EMPTY tail → no release",
    { owner: { status: "running", epoch: 1, session_id: "S" } }, OWNED_RUNDIR, emptyTail, OWNED_ENV, false],
  ["owned + already aborted-resumable → no release (idempotent)",
    { owner: { status: "aborted-resumable", epoch: 1, session_id: "S" } }, OWNED_RUNDIR, runResumeTail, OWNED_ENV, false],
  ["owned + owner absent → no release",
    { admitted: [] }, OWNED_RUNDIR, runResumeTail, OWNED_ENV, false],
  ["FOREIGN run (env pointer + session both mismatch) → no release (never stamp a foreign owner)",
    { owner: { status: "running", epoch: 1, session_id: "OWNER-S" } }, "/runs/THEIRS", runResumeTail, { FAFF_RUN_DIR: "/runs/MINE", FAFF_SESSION_ID: "ME" }, false],
];

// [name, env, wantGrace]
const RESUMECHECK_GRACE_CASES = [
  ["unset → default 300", {}, 300],
  ["finite >0 wins", { FAFF_RESUME_DEADCLAIM_GRACE_SECS: "60" }, 60],
  ["zero → default 300", { FAFF_RESUME_DEADCLAIM_GRACE_SECS: "0" }, 300],
  ["negative → default 300", { FAFF_RESUME_DEADCLAIM_GRACE_SECS: "-5" }, 300],
  ["non-numeric → default 300", { FAFF_RESUME_DEADCLAIM_GRACE_SECS: "abc" }, 300],
];

function resumecheckSelftest() {
  let fail = 0;
  for (const [name, ledger, runDir, tail, env, wantRelease] of RESUMECHECK_HOOK_CASES) {
    const got = resumecheckHookDecision(ledger, runDir, tail, env).release;
    const ok = got === wantRelease;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name} → release=${got} (want ${wantRelease})`);
  }
  for (const [name, env, wantGrace] of RESUMECHECK_GRACE_CASES) {
    const got = graceSecs(env);
    const ok = got === wantGrace;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} grace ${name} → ${got} (want ${wantGrace})`);
  }
  // Read-side grace boundary — deterministic 299 vs 301 against a 300s grace (nowFn injected).
  {
    const env = {}; // default grace 300
    const notDead = provablyDeadFromTail({ isRunResume: true, ts: resumeAgo(299) }, RESUMECHECK_NOW, env);
    const dead = provablyDeadFromTail({ isRunResume: true, ts: resumeAgo(301) }, RESUMECHECK_NOW, env);
    const ok = notDead === false && dead === true;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} read-side grace boundary: 299s→notDead, 301s→dead (grace 300) → ${notDead}/${dead}`);
  }
  // Non-run-resume / null-ts tails are never provably-dead regardless of age.
  {
    const env = {};
    const workNeverDead = provablyDeadFromTail({ isRunResume: false, ts: resumeAgo(9999) }, RESUMECHECK_NOW, env);
    const nullTsNeverDead = provablyDeadFromTail({ isRunResume: true, ts: null }, RESUMECHECK_NOW, env);
    const ok = workNeverDead === false && nullTsNeverDead === false;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} non-run-resume / null-ts tail → never provably-dead → ${workNeverDead}/${nullTsNeverDead}`);
  }
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${RESUMECHECK_HOOK_CASES.length + RESUMECHECK_GRACE_CASES.length + 2} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  RESUMECHECK_HOOK_CASES, RESUMECHECK_GRACE_CASES, RESUMECHECK_NOW,
  cmdResumecheck, graceSecs, isUnderRunsRoot, provablyDeadFromTail, resumeAgo,
  resumeProvablyDead, resumecheckHookDecision, resumecheckSelftest,
  runClaimAbandonedEvent, tailEventIsRunResume,
};
