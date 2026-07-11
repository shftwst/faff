// ===========================================================================
// === region:governance — heartbeat — FAFF-355: the single sanctioned write path for run liveness. ===
//
// Liveness (runIsHeld, above) is heartbeat-only: a run reads `held` while its
// effective heartbeat is fresher than STALE_SECS. But builds now run as isolated
// subagents (FAFF-201), and a build subagent in a multi-minute adversarial review
// or gate ladder has no tool to tick the heartbeat mid-step — so a live-but-quiet
// build ages past 900s and a foreign session's Stop hook treats it as abandoned.
// This primitive is the deterministic write counterpart to readLedger: faff-graft's
// long sub-steps, both concurrency executors, and beep-boop all refresh through it,
// instead of hand-rolling a read-modify-write of the ledger JSON (governing
// principle: deterministic tools over prose for a signal that gates a safety hook).
//
// Dedicated single-value file (FAFF-355 — supersedes the FAFF-234 ledger field-merge):
// a tick's ONLY write is `.faff/runs/<run-id>/heartbeat` (tmp + rename) — the run
// ledger is never touched by a tick, structurally closing the N-writer race a
// field-merge could only narrow (two concurrent full-ledger RMWs — a heartbeat tick
// and an orchestrator outcome write — could still interleave and clobber). No
// env-ownership proof is required: the only callers are the run's own orchestrator +
// build subagents (the Stop hook calls runcheck, never heartbeat), so the write guard
// is simply owner.status === "running" (checked read-only against the ledger — a
// read races with nothing).
//
// Every read seam (runcheck --hook, the config.js agency-mode pin, prepIsHeld tier
// (a), sentry check) overlays the file over the ledger's owner.last_heartbeat (now a
// run-start baseline + legacy fallback) via overlayHeartbeat/effectiveHeartbeatIso
// below, so pre-upgrade ledgers keep working with zero migration.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { findRoot, latestRunDir, readLedger } = require("./shared-infra");

// effectiveHeartbeatIso: the liveness instant a reader uses — the max, by parsed
// epoch, of the heartbeat file's timestamp and the ledger field's, either of which
// may be absent. Unparseable input is treated as absent (falls back to the other
// source); both absent -> null. Pure, no filesystem access.
function effectiveHeartbeatIso(fileIso, fieldIso) {
  const ft = fileIso == null ? NaN : Date.parse(fileIso);
  const gt = fieldIso == null ? NaN : Date.parse(fieldIso);
  const fOk = Number.isFinite(ft);
  const gOk = Number.isFinite(gt);
  if (!fOk && !gOk) return null;
  if (!fOk) return fieldIso;
  if (!gOk) return fileIso;
  return ft >= gt ? fileIso : fieldIso; // max-by-epoch; a tie arbitrarily prefers the file
}

// overlayHeartbeat: sets ledger.owner.last_heartbeat to the effective heartbeat and
// reports which source won ("heartbeat-file" | "owner.last_heartbeat" | null when
// both are absent). No-op on an ownerless ledger (nothing to overlay onto). Every
// read seam calls this once, before handing the ledger to a pure predicate — the
// predicates themselves (runIsHeld, evalWallClock, ...) stay filesystem-free.
function overlayHeartbeat(ledger, fileIso) {
  const owner = ledger && ledger.owner;
  if (!owner) return { source: null };
  const fieldIso = owner.last_heartbeat ?? null;
  const fOk = fileIso != null && Number.isFinite(Date.parse(fileIso));
  const gOk = fieldIso != null && Number.isFinite(Date.parse(fieldIso));
  let source = null;
  if (fOk && gOk) source = Date.parse(fileIso) >= Date.parse(fieldIso) ? "heartbeat-file" : "owner.last_heartbeat";
  else if (fOk) source = "heartbeat-file";
  else if (gOk) source = "owner.last_heartbeat";
  owner.last_heartbeat = effectiveHeartbeatIso(fileIso, fieldIso);
  return { source };
}

// Impure read seam: the heartbeat file's raw ISO content, or null if missing /
// unreadable / blank. Silent — a corrupt/absent file is a legitimate liveness input
// (falls back to the ledger field), never a thrown fault.
function readHeartbeatFile(runDir) {
  try {
    const raw = fs.readFileSync(path.join(runDir, "heartbeat"), "utf8").trim();
    return raw || null;
  } catch {
    return null;
  }
}

// Impure write seam: atomic tmp+rename of the dedicated single-value file — the
// SAME atomicity idiom as atomicWriteLedger below, so a concurrent reader never
// observes a torn/partial heartbeat. Content is exactly one ISO timestamp + newline.
function writeHeartbeatFile(runDir, nowIso) {
  const target = path.join(runDir, "heartbeat");
  const tmp = target + ".tmp";
  fs.writeFileSync(tmp, nowIso + "\n");
  fs.renameSync(tmp, target);
}

// Atomic ledger write: serialize to a sibling .tmp then rename over the target, so a
// concurrent reader (runcheck) never observes a torn/partial file. 2-space + trailing
// newline matches the other JSON writers in this CLI. Callers: sentry abort's
// resumable mark, the lights-out mint — both orchestrator/supervisory-lane, never a
// heartbeat tick (FAFF-355 — the tick's only write is the file above).
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
    ledger = readLedger(runDir); // READ-ONLY guard check — this tick never writes the ledger back
  } catch (e) {
    // Malformed ledger JSON is a real fault — loud on stderr, exit 2, never swallowed.
    process.stderr.write(`heartbeat: malformed ledger in ${runDir}: ${e.message}\n`);
    return 2;
  }

  const owner = ledger && ledger.owner;
  if (!owner || owner.status !== "running") {
    // A done/unowned run is never resurrected — and no file write occurs either, so
    // a stray tick after the run ends can't manufacture a fresh-looking signal.
    const last = effectiveHeartbeatIso(readHeartbeatFile(runDir), owner ? owner.last_heartbeat ?? null : null);
    return emit(runDir, last, false);
  }

  const nowIso = new Date().toISOString();
  writeHeartbeatFile(runDir, nowIso); // the ONLY write this tick performs
  return emit(runDir, nowIso, true);
}

// In-memory selftest of the pure cores (mirrors runcheck/lint-cli-doc --selftest). No
// filesystem I/O — drives effectiveHeartbeatIso's max/null/unparseable table,
// overlayHeartbeat's source reporting, and the overlay→runIsHeld held-interaction the
// tick's read seams depend on. `runIsHeld` is required LAZILY (inside this function,
// not at module load) to avoid a require cycle: runcheck.js requires overlayHeartbeat/
// readHeartbeatFile from THIS module at load time, so this module must not require
// runcheck.js back at load time too.
function heartbeatSelftest() {
  const { runIsHeld } = require("./runcheck");
  let failed = 0;
  const check = (label, cond) => { if (!cond) { process.stderr.write(`heartbeat --selftest FAIL: ${label}\n`); failed++; } };
  const now = Date.parse("2026-06-22T16:00:00Z");
  const nowIso = new Date(now).toISOString();
  const ago = (s) => new Date(now - s * 1000).toISOString();

  // --- effectiveHeartbeatIso: max-by-epoch; unparseable/null -> the other source; both -> null ---
  check("file newer wins", effectiveHeartbeatIso(ago(10), ago(500)) === ago(10));
  check("field newer wins", effectiveHeartbeatIso(ago(500), ago(10)) === ago(10));
  check("file null → field", effectiveHeartbeatIso(null, ago(10)) === ago(10));
  check("field null → file", effectiveHeartbeatIso(ago(10), null) === ago(10));
  check("both null → null", effectiveHeartbeatIso(null, null) === null);
  check("file unparseable → field", effectiveHeartbeatIso("not-a-date", ago(10)) === ago(10));
  check("field unparseable → file", effectiveHeartbeatIso(ago(10), "not-a-date") === ago(10));
  check("both unparseable → null", effectiveHeartbeatIso("nope", "also-nope") === null);
  check("equal timestamps → either (file, arbitrarily)", effectiveHeartbeatIso(nowIso, nowIso) === nowIso);

  // --- overlayHeartbeat: sets owner.last_heartbeat to the effective value, reports the winning source ---
  const l1 = { owner: { status: "running", last_heartbeat: ago(500) } };
  const r1 = overlayHeartbeat(l1, ago(10));
  check("overlay: fresher file wins over a stale field", l1.owner.last_heartbeat === ago(10));
  check("overlay: source reports heartbeat-file", r1.source === "heartbeat-file");

  const l2 = { owner: { status: "running", last_heartbeat: ago(10) } };
  const r2 = overlayHeartbeat(l2, ago(500));
  check("overlay: fresher field beats a stale file", l2.owner.last_heartbeat === ago(10));
  check("overlay: source reports owner.last_heartbeat", r2.source === "owner.last_heartbeat");

  const l3 = { admitted: [] }; // ownerless ledger
  const r3 = overlayHeartbeat(l3, ago(10));
  check("overlay: no-op on an ownerless ledger", r3.source === null && l3.owner === undefined);

  const l4 = { owner: { status: "running" } }; // no field yet, no file
  const r4 = overlayHeartbeat(l4, null);
  check("overlay: both absent → last_heartbeat null, source null", l4.owner.last_heartbeat === null && r4.source === null);

  // --- overlay → runIsHeld interaction: the whole point of the change — a stale
  // ledger field is held live once overlaid with a fresh heartbeat file. ---
  const l5 = { owner: { status: "running", last_heartbeat: ago(1000) } };
  check("pre-overlay: a stale field alone reads not-held", runIsHeld(l5, now, {}) === false);
  overlayHeartbeat(l5, ago(10));
  check("post-overlay: a fresh file makes it held", runIsHeld(l5, now, {}) === true);

  const l6 = { owner: { status: "running", last_heartbeat: ago(10) } };
  overlayHeartbeat(l6, ago(1000)); // stale file, fresh field — max() keeps the fresh field
  check("a stale file never demotes a fresh field", runIsHeld(l6, now, {}) === true);

  const l7 = { owner: { status: "running", last_heartbeat: ago(1000) } };
  overlayHeartbeat(l7, ago(1000)); // both stale — stays not-held
  check("both-stale overlay stays not-held", runIsHeld(l7, now, {}) === false);

  const l8 = { owner: { status: "running", last_heartbeat: ago(10) } };
  overlayHeartbeat(l8, "not-a-date"); // unparseable file, fresh field — field fallback wins
  check("an unparseable file falls back to a fresh field, still held", runIsHeld(l8, now, {}) === true);

  if (failed) return 1;
  console.log("heartbeat --selftest: ok");
  return 0;
}


module.exports = {
  atomicWriteLedger, cmdHeartbeat, effectiveHeartbeatIso, heartbeatSelftest,
  overlayHeartbeat, readHeartbeatFile, resolveHeartbeatRunDir, writeHeartbeatFile,
};
