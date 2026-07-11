// ===========================================================================
// === region:governance — heartbeat — FAFF-234: the single sanctioned write path for owner.last_heartbeat. ===
//
// Liveness (runIsHeld, above) is heartbeat-only: a run reads `held` while its
// owner.last_heartbeat is fresher than STALE_SECS. But builds now run as isolated
// subagents (FAFF-201), and a build subagent in a multi-minute adversarial review
// or gate ladder has no tool to tick the heartbeat mid-step — so a live-but-quiet
// build ages past 900s and a foreign session's Stop hook treats it as abandoned.
// This primitive is the deterministic write counterpart to readLedger: faff-graft's
// long sub-steps, both concurrency executors, and beep-boop all refresh through it,
// instead of hand-rolling a read-modify-write of the ledger JSON (governing
// principle: deterministic tools over prose for a signal that gates a safety hook).
//
// Field-merge discipline (FAFF-234): re-read the ledger immediately before mutating
// ONLY owner.last_heartbeat and write back atomically (tmp + rename) — never serialize
// a stale whole-ledger copy, so a tick can't clobber an outcome write under the
// sequential single-active-writer model. No env-ownership proof is required: the only
// callers are the run's own orchestrator + build subagents (the Stop hook calls
// runcheck, never heartbeat), so the guard is simply owner.status === "running".
// ===========================================================================

// Pure field-merge over a parsed ledger: set owner.last_heartbeat = nowIso when the
// owner is running; soft no-op otherwise. Returns { written, last_heartbeat }. Mutates
// ONLY owner.last_heartbeat on the passed object — every other field is left untouched
// (the byte-identical-other-fields guarantee). A missing last_heartbeat on a running
// owner self-heals (written:true). Injectable nowIso so the selftest drives it pure.

const fs = require("node:fs");
const path = require("node:path");
const { runIsHeld } = require("./runcheck");
const { findRoot, latestRunDir, readLedger } = require("./shared-infra");

function applyHeartbeat(ledger, nowIso) {
  const owner = ledger && ledger.owner;
  if (!owner || owner.status !== "running") {
    return { written: false, last_heartbeat: owner ? owner.last_heartbeat ?? null : null };
  }
  owner.last_heartbeat = nowIso; // the ONLY field this primitive writes
  return { written: true, last_heartbeat: nowIso };
}

// Atomic ledger write: serialize to a sibling .tmp then rename over the target, so a
// concurrent reader (runcheck) never observes a torn/partial file. 2-space + trailing
// newline matches the other JSON writers in this CLI.
function atomicWriteLedger(runDir, ledger) {
  const target = path.join(runDir, "run-ledger.json");
  const tmp = target + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2) + "\n");
  fs.renameSync(tmp, target);
}

// Resolution order (spec §3): explicit arg → $FAFF_RUN_DIR → latest run under .faff/runs.
// A subagent should always pass RUN_DIR explicitly — "latest" can resolve the wrong
// ledger under concurrent/overlapping runs (the anti-pattern the spec calls out).
function resolveHeartbeatRunDir(arg, env) {
  const e = env || process.env;
  const cand = arg || e.FAFF_RUN_DIR || latestRunDir(findRoot());
  return cand || null;
}

function cmdHeartbeat(args) {
  if (args.includes("--selftest")) return heartbeatSelftest();
  const asJson = args.includes("--json");
  const positional = args.filter((a) => !a.startsWith("-"));
  const runDir = resolveHeartbeatRunDir(positional[0], process.env);
  const emit = (rd, lastHb, written) => {
    if (asJson) console.log(JSON.stringify({ run_dir: rd || null, last_heartbeat: lastHb ?? null, written }));
    return 0;
  };

  // No run dir / no ledger → soft no-op (an interactive non-run context calling it
  // by mistake must never error). exit 0, written:false.
  if (!runDir || !fs.existsSync(path.join(runDir, "run-ledger.json"))) return emit(runDir, null, false);

  let ledger;
  try {
    ledger = readLedger(runDir); // re-read immediately before mutate (field-merge)
  } catch (e) {
    // Malformed ledger JSON is a real fault — loud on stderr, exit 2, never swallowed.
    process.stderr.write(`heartbeat: malformed ledger in ${runDir}: ${e.message}\n`);
    return 2;
  }

  const { written, last_heartbeat } = applyHeartbeat(ledger, new Date().toISOString());
  if (written) atomicWriteLedger(runDir, ledger); // a done/unowned run is never resurrected
  return emit(runDir, last_heartbeat, written);
}

// In-memory selftest of the pure field-merge + its liveness interaction (mirrors
// runcheck/lint-cli-doc --selftest). No filesystem I/O — drives applyHeartbeat and
// the runIsHeld read path the tick feeds.
function heartbeatSelftest() {
  let failed = 0;
  const check = (label, cond) => { if (!cond) { process.stderr.write(`heartbeat --selftest FAIL: ${label}\n`); failed++; } };
  const now = Date.parse("2026-06-22T16:00:00Z");
  const nowIso = new Date(now).toISOString();
  const ago = (s) => new Date(now - s * 1000).toISOString();

  // running owner → written, last_heartbeat advances, other fields untouched.
  const running = { admitted: ["X"], outcomes: {}, owner: { status: "running", pid: 42, session_id: "S", started_at: ago(2000), last_heartbeat: ago(800) } };
  const r1 = applyHeartbeat(running, nowIso);
  check("running owner → written:true", r1.written === true);
  check("last_heartbeat advanced to now", running.owner.last_heartbeat === nowIso);
  check("pid untouched", running.owner.pid === 42);
  check("session_id untouched", running.owner.session_id === "S");
  check("started_at untouched", running.owner.started_at === ago(2000));
  check("admitted untouched", JSON.stringify(running.admitted) === JSON.stringify(["X"]));
  // and a tick at now keeps it held at now+800 where the pre-tick T+800 would have been stale.
  check("tick keeps it held past the old staleness point", runIsHeld(running, now + 800 * 1000, {}) === true);
  check("pre-tick heartbeat would have been stale", runIsHeld({ owner: { status: "running", last_heartbeat: ago(800) } }, now + 800 * 1000, {}) === false);

  // done owner → soft no-op, last_heartbeat unchanged (a finished run is never resurrected).
  const done = { owner: { status: "done", last_heartbeat: ago(1000) } };
  const r2 = applyHeartbeat(done, nowIso);
  check("done owner → written:false", r2.written === false);
  check("done owner last_heartbeat unchanged", done.owner.last_heartbeat === ago(1000));

  // missing owner → soft no-op.
  check("missing owner → written:false", applyHeartbeat({ admitted: [] }, nowIso).written === false);

  // missing last_heartbeat on a running owner → self-heals (written:true).
  const healed = { owner: { status: "running" } };
  check("running owner missing last_heartbeat self-heals", applyHeartbeat(healed, nowIso).written === true && healed.owner.last_heartbeat === nowIso);

  if (failed) return 1;
  console.log("heartbeat --selftest: ok");
  return 0;
}


module.exports = { applyHeartbeat, atomicWriteLedger, cmdHeartbeat, heartbeatSelftest, resolveHeartbeatRunDir };
