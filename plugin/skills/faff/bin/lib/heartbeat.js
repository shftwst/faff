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
//
// FAFF-327: `--unit <issue>` is the fleet member tick — the FAFF-355 spec's own named
// extension point ("suffix the filename (heartbeat.<issue>), take the max at the read
// seam"). A member tick writes BOTH the run heartbeat file above (unchanged path,
// unchanged atomicity) AND a dedicated `heartbeat.<issue>` file — same single-value
// ISO+newline shape, same tmp+rename idiom, single-writer by construction (only that
// member ever ticks its own file). The run-level file stays the one scalar every
// existing reader consumes; sentry's fleet evaluator (bin/lib/sentry.js) is the only
// consumer of the member file, read via `readMemberHeartbeatFile` below.
// ===========================================================================

const crypto = require("node:crypto");
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

// overlayHeartbeat: MUTATES the passed ledger's owner.last_heartbeat in place to the
// effective heartbeat (adversarial-review note: every call site passes a ledger it
// just freshly read via readLedger/tryReadLedger for this one call — never a shared
// or cached reference reused across two overlay calls — so the in-place write is
// safe today; a future caller that aliases a ledger across two overlay calls would
// need to clone first, as runcheckSelftest already does for its shared fixture array).
// Reports which source won ("heartbeat-file" | "owner.last_heartbeat" | null when
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

// FAFF-327: the canonical `heartbeat.<issue>` filename — one home for the member-file
// naming so a caller never hand-builds the suffix.
function memberHeartbeatFileName(issue) {
  return `heartbeat.${issue}`;
}

// FAFF-327: read one member's heartbeat file — same silent-null contract as
// readHeartbeatFile above (absent/unreadable/blank -> null, never a thrown fault; a
// stale/corrupt member file is a legitimate "hasn't ticked" input, not an error).
function readMemberHeartbeatFile(runDir, issue) {
  try {
    const raw = fs.readFileSync(path.join(runDir, memberHeartbeatFileName(issue)), "utf8").trim();
    return raw || null;
  } catch {
    return null;
  }
}

// Impure write seam: atomic tmp+rename of the dedicated single-value file — the
// SAME atomicity idiom as atomicWriteLedger below, so a concurrent reader never
// observes a torn/partial heartbeat. Content is exactly one ISO timestamp + newline.
//
// The tmp name is PER-CALL-UNIQUE (pid + a random suffix), not a fixed sibling path —
// this is the one place FAFF-355 has N *concurrent* writers by design (every build
// subagent ticks the same file at once), unlike atomicWriteLedger's single-active-
// writer callers below. A shared fixed tmp name lets two concurrent ticks interleave
// on the SAME tmp file: A writes, B overwrites the same tmp path, A renames it away,
// then B's rename of the now-vanished tmp throws ENOENT — an uncaught crash that
// would violate "every heartbeat tick exits 0" (Scenario 1) under real concurrency.
// A unique tmp name per call means each process only ever renames a file it alone
// created, so no rename can race another rename.
//
// Adversarial-review fix: a write/rename fault (run dir removed mid-tick, disk full,
// a permissions error) must never leave an orphaned tmp file OR throw uncaught —
// cmdHeartbeat's caller must still get a clean exit 0, never a crash, from a single
// liveness tick. On failure this best-effort unlinks the tmp file (never masking the
// original error if the unlink itself fails) then RE-THROWS — cmdHeartbeat is the one
// place that decides how a failed tick degrades (soft no-op, not a crash).
// Shared atomic single-value write: per-call-unique tmp name (see the block comment
// above), write, rename; on any fault best-effort unlink the tmp then RE-THROW —
// callers decide how a failed tick degrades. One home for both the run file and
// the FAFF-327 member file below, so the atomicity idiom never drifts between them.
function atomicWriteSingleValueFile(target, content) {
  const tmp = `${target}.tmp.${process.pid}.${crypto.randomBytes(6).toString("hex")}`;
  try {
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* best-effort — tmp may never have been created, or is already gone */ }
    throw e;
  }
}

function writeHeartbeatFile(runDir, nowIso) {
  atomicWriteSingleValueFile(path.join(runDir, "heartbeat"), nowIso + "\n");
}

// FAFF-327: the member-file counterpart — identical shape/atomicity, written only by
// the `--unit <issue>` tick, never by the run-level tick above.
function writeMemberHeartbeatFile(runDir, issue, nowIso) {
  atomicWriteSingleValueFile(path.join(runDir, memberHeartbeatFileName(issue)), nowIso + "\n");
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

// FAFF-527 — owner-epoch write fence (takeover safety). A resume of a *dead-running*
// run mints a new owner epoch (owner.epoch++ + a new session_id); the original driver
// may be live-but-quiet (its effective heartbeat aged past the staleness window while an
// isolated build subagent was legitimately mid-step). Every ledger write path re-reads
// `owner.{epoch, session_id}` immediately before writing and YIELDS — a no-op, never a
// crash — when its own epoch/session no longer matches, so the stale driver structurally
// cannot clobber the resumed ledger. This mirrors the status-monotonicity local-compare
// pattern (no CAS): a purely local pre-write check against the on-disk owner block.
//
// PURE: given the disk owner block and the writer's expected {epoch, session_id}, is the
// writer stale? A missing `expected` (a caller not participating in the fence) is NEVER
// stale — the fence is strictly opt-in, so unfenced callers keep byte-for-byte today's
// behaviour. Epoch is compared with the default-0 convention (absent ⇒ 0), so a pre-527
// ledger (no epoch anywhere) and an unfenced writer never trip. When a session_id is
// carried on both sides it must also match (a same-epoch different-session write is a
// race the epoch alone wouldn't catch on a legacy ledger).
function ownerEpochFenceStale(diskOwner, expected) {
  if (!expected || typeof expected !== "object") return false;
  const de = Number((diskOwner && diskOwner.epoch) || 0);
  const ee = Number(expected.epoch || 0);
  if (de !== ee) return true;
  const ds = diskOwner && diskOwner.session_id;
  const es = expected.session_id;
  if (es != null && ds != null && ds !== es) return true;
  return false;
}

// Fenced atomic ledger write. Re-reads the on-disk owner block and, if the writer's
// epoch/session no longer owns the run (a newer resume took it over), YIELDS: writes
// nothing, logs loudly to stderr, and returns { written:false, yielded:true }. On a
// clean match (or no `expected` — the unfenced default) it writes and returns
// { written:true }. Never throws on a stale fence — a yielded write is a designed no-op,
// not a fault (the takeover is the intended outcome).
function atomicWriteLedgerFenced(runDir, ledger, expected) {
  if (expected) {
    let disk = null;
    try { disk = readLedger(runDir); } catch { disk = null; }
    if (disk && ownerEpochFenceStale(disk.owner, expected)) {
      process.stderr.write(`ledger write yielded: owner epoch/session moved on in ${runDir} ` +
        `(writer epoch ${expected.epoch ?? 0}/${expected.session_id ?? "?"}, on-disk epoch ${(disk.owner && disk.owner.epoch) ?? 0}/${(disk.owner && disk.owner.session_id) ?? "?"}) — a newer resume owns this run\n`);
      return { written: false, yielded: true };
    }
  }
  atomicWriteLedger(runDir, ledger);
  return { written: true, yielded: false };
}

// Resolution order (spec §3): explicit arg → $FAFF_RUN_DIR → latest run under .faff/runs.
// A subagent should always pass RUN_DIR explicitly — "latest" can resolve the wrong
// ledger under concurrent/overlapping runs (the anti-pattern the spec calls out).
function resolveHeartbeatRunDir(arg, env) {
  const e = env || process.env;
  const cand = arg || e.FAFF_RUN_DIR || latestRunDir(findRoot());
  return cand || null;
}

// FAFF-327: the same shape as merge-gate's / admissibility's issue-id guard — one
// canonical pattern, no ad-hoc validation drift. Rejects an empty/traversal-shaped
// `--unit` value before it ever reaches a path.join.
const VALID_ISSUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function isValidIssueId(issue) {
  return typeof issue === "string" && VALID_ISSUE_ID_RE.test(issue) && !issue.includes("..");
}

function cmdHeartbeat(args) {
  if (args.includes("--selftest")) return heartbeatSelftest();
  const asJson = args.includes("--json");
  const unitIdx = args.indexOf("--unit");
  const unitRaw = unitIdx !== -1 ? (args[unitIdx + 1] || null) : null;
  if (unitRaw != null && !isValidIssueId(unitRaw)) {
    process.stderr.write(`heartbeat: --unit ${JSON.stringify(unitRaw)} is not a valid issue id\n`);
    return 2;
  }
  const unit = unitRaw;
  // Exclude --unit's own value from positional-arg extraction (it doesn't start with
  // "-", so a naive filter would otherwise treat it as RUN_DIR). Guard unitIdx===-1
  // (--unit absent) so the exclusion index never collapses onto position 0.
  const unitValueIdx = unitIdx !== -1 ? unitIdx + 1 : -1;
  const positional = args.filter((a, i) => !a.startsWith("-") && i !== unitValueIdx);
  const runDir = resolveHeartbeatRunDir(positional[0], process.env);
  const emit = (rd, lastHb, written) => {
    if (asJson) console.log(JSON.stringify({ run_dir: rd || null, last_heartbeat: lastHb ?? null, written, unit: unit || null }));
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
  try {
    writeHeartbeatFile(runDir, nowIso); // write #1: the run-level scalar, unchanged
  } catch (e) {
    // Adversarial-review fix: a transient fs fault (run dir removed mid-tick, disk
    // full, a permissions error) degrades to a soft no-op — never an uncaught crash.
    // A single failed liveness tick is not fatal; the caller (or the next tick) tries
    // again. Loud on stderr so a persistent fault is still visible, but exit 0.
    process.stderr.write(`heartbeat: could not write the heartbeat file in ${runDir}: ${e.message}\n`);
    const last = effectiveHeartbeatIso(readHeartbeatFile(runDir), owner.last_heartbeat ?? null);
    return emit(runDir, last, false);
  }
  // FAFF-327: write #2, IFF --unit — the member file. Best-effort/non-fatal by the
  // same contract as write #1 above: the run-level tick already succeeded (the
  // property every existing reader depends on), so a member-file fault degrades to
  // "the run ticked, the member didn't" rather than losing the run-level tick too.
  if (unit) {
    try {
      writeMemberHeartbeatFile(runDir, unit, nowIso);
    } catch (e) {
      process.stderr.write(`heartbeat: could not write the member heartbeat file for ${unit} in ${runDir}: ${e.message}\n`);
    }
  }
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

  // --- FAFF-327: memberHeartbeatFileName + isValidIssueId (pure, no fs) ---
  check("memberHeartbeatFileName suffixes the canonical shape", memberHeartbeatFileName("FAFF-1") === "heartbeat.FAFF-1");
  check("isValidIssueId accepts a normal issue id", isValidIssueId("FAFF-327") === true);
  check("isValidIssueId rejects empty/traversal/absent", isValidIssueId("") === false && isValidIssueId("..") === false &&
    isValidIssueId("../../etc/passwd") === false && isValidIssueId(null) === false && isValidIssueId(undefined) === false);

  if (failed) return 1;
  console.log("heartbeat --selftest: ok");
  return 0;
}


module.exports = {
  atomicWriteLedger, atomicWriteLedgerFenced, cmdHeartbeat, effectiveHeartbeatIso, heartbeatSelftest,
  isValidIssueId, memberHeartbeatFileName, overlayHeartbeat, ownerEpochFenceStale, readHeartbeatFile,
  readMemberHeartbeatFile, resolveHeartbeatRunDir, writeHeartbeatFile, writeMemberHeartbeatFile,
};
