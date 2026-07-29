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
const { withFileLock } = require("./fs-lock");

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
// FAFF-355 has N *concurrent* writers by design here (every build subagent ticks the
// same file at once), and since FAFF-575 the ledger writers below are lock-serialised
// N-writer too, so BOTH write paths share this idiom (atomicWriteLedger now routes
// through this same function). A shared fixed tmp name lets two concurrent writers
// interleave on the SAME tmp file: A writes, B overwrites the same tmp path, A renames
// it away, then B's rename of the now-vanished tmp throws ENOENT — an uncaught crash
// that would violate "every heartbeat tick exits 0" (Scenario 1) under real concurrency.
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

// ── The run-ledger write region (FAFF-575) ─────────────────────────────────────────
//
// WRITER INVENTORY — every production run-ledger.json mutation routes through
// mutateLedgerUnderLock below; the set is lock-serialised MULTI-writer (the pre-575
// "single-active-writer" assumption is formally retired):
//   - `sentry abort` (sentry.js) — the detached poller's resumable abort mark
//   - `events append --tokens` (events.js) — the token-checkpoint advance
//   - `budget baseline` (budget.js) — the FAFF-552 write-once baseline merge
//   - `lights-out` mint + `--resume` (lights-out.js) — run creation and epoch takeover
// The next writer added MUST route through mutateLedgerUnderLock too — a direct
// atomicWriteLedger call from production code reintroduces the lost-update race.
// Out-of-scope residual (ADR-0077 territory): the ORCHESTRATOR SESSION's own ledger
// edits (`admitted` appends, outcome writes, the beep-boop run mint) are file edits made
// by the driving session, not CLI subprocess calls, so this CLI-side lock cannot
// serialise them; a follow-up routing them through a locked `faff` op would close it.
//
// FAFF-679 — Class A of the gateway's mid-bracket write rule (obligation 5): every
// writer above surfaces the before/after digest pair mutateLedgerUnderLock now returns,
// so the orchestrator can assert what the ledger WAS when the writer took the lock
// (against its held custody baseline) rather than only what it BECAME (which
// atomicWriteLedger serialises from an under-lock read the caller never sees).
//
// DURABILITY (stated posture, not an accident): ledger writes are rename-only — no
// fsync. The ledger is a re-derivable bookkeeping snapshot; a power loss can lose at
// most the latest rename, degrading to a slightly stale ledger every read seam
// tolerates. Adding per-write fsync would tax every mutation for that narrow window.

// Atomic ledger write: serialize to a PER-CALL-UNIQUE tmp then rename over the target,
// so a concurrent reader (runcheck) never observes a torn/partial file and two
// concurrent writers can never race each other's rename (the fixed `.tmp` sibling this
// replaced is exactly the ENOENT crash the atomicWriteSingleValueFile comment above
// documents — FAFF-575 closes it by reusing that same unique-tmp idiom). 2-space +
// trailing newline matches the other JSON writers in this CLI. Production callers:
// NONE directly — every production mutation goes through mutateLedgerUnderLock below
// (see the writer inventory above); this stays the write PRIMITIVE the core calls.
//
// FAFF-564 — the ledger fold: after the rename lands, append a chained `ledger-write`
// event (data.ledger_sha256 = SHA-256 of the exact bytes just written) through the
// shared locked events core, so every CLI-side ledger mutation joins the tamper-
// evidence chain at this one chokepoint — no per-caller emissions. run_id comes from
// ledger.run_id (fallback: the run-dir basename, corrective.js's convention). A failed
// append (for example the events lock budget is exhausted) WARNS loudly on stderr and
// returns normally — never throws, never rolls back the ledger write: the write is
// load-bearing for callers (sentry abort, lights-out mint) whose semantics must not
// break on an events-side fault, and the missing link is precisely what FAFF-568's
// verifier reports as an unrecorded ledger write. Fail toward detection, not blocking.
// LOCK ORDERING (load-bearing): this fold acquires the events lock while the caller
// (mutateLedgerUnderLock) may hold the ledger lock — ledger → events is the ONLY safe
// order. No code path may acquire the ledger lock while holding the events lock (the
// events append core's mintRecord closures never touch the ledger; `events append
// --tokens` runs its ledger mutation BEFORE its event append) — adding one would
// create the classic A→B / B→A deadlock. The fold's worst-case events-lock wait
// (ACQUIRE_BUDGET_MS) also stays well under the ledger lock's stale-takeover bound.
// The require is call-time (lazy): events.js requires this module at load (for
// mutateLedgerUnderLock), so a top-level import here would cycle.
// Returns the sha256 of the exact bytes just written (FAFF-679) — the same hash the
// ledger-write event fold below records, so a caller composing a before/after digest
// pair (mutateLedgerUnderLock) never re-hashes independently and can never drift from
// the chained event's own value.
function atomicWriteLedger(runDir, ledger) {
  const body = JSON.stringify(ledger, null, 2) + "\n";
  const sha = crypto.createHash("sha256").update(body).digest("hex");
  atomicWriteSingleValueFile(path.join(runDir, "run-ledger.json"), body);
  try {
    const { appendEventRecord } = require("./events");
    const runId = ledger && typeof ledger.run_id === "string" && ledger.run_id !== "" ? ledger.run_id : path.basename(runDir);
    appendEventRecord(runDir, runId, { phase: "run", type: "ledger-write", data: { ledger_sha256: sha } });
  } catch (e) {
    process.stderr.write(`ledger-write event append failed in ${runDir}: ${e && e.message ? e.message : e} — the ledger IS written; the chain gap will surface at FAFF-568 verification\n`);
  }
  return sha;
}

// FAFF-527 — owner-epoch write fence (takeover safety). A resume of a *dead-running*
// run mints a new owner epoch (owner.epoch++ + a new session_id); the original driver
// may be live-but-quiet (its effective heartbeat aged past the staleness window while an
// isolated build subagent was legitimately mid-step). A fenced ledger mutation checks
// `owner.{epoch, session_id}` against the under-lock fresh read immediately before
// writing and YIELDS — a no-op, never a crash — when its own epoch/session no longer
// matches, so the stale driver structurally cannot clobber the resumed ledger. Since
// FAFF-575 the check runs INSIDE the locked critical section (mutateLedgerUnderLock),
// so the old check-then-write gap — two writers both passing the fence, then both
// writing — is structurally gone. The lock and the fence guard different failures:
// the lock serialises concurrent writers; the fence makes a superseded owner yield
// even when it is the only writer running. Neither subsumes the other.
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

// FAFF-575 — the locked ledger mutation core: the ONE critical section every production
// run-ledger.json mutation goes through (writer inventory above). Serialises the whole
// read-merge-write under the shared advisory file lock (<runDir>/run-ledger.json.lock,
// fs-lock.js mechanics — same constants as the events.jsonl lock), so a mutation derives
// ONLY from the fresh read taken inside the lock. The `mutate`-callback shape exists
// precisely so callers cannot hand this core a stale pre-built ledger object ("the
// ledger I read two lines ago" is the bug this closes).
//
//   mutate(freshLedger) -> the ledger to write, or null/undefined to abort WITHOUT
//   writing. `freshLedger` is null when run-ledger.json does not exist yet (the mint
//   path writes from scratch); a malformed ledger THROWS out of the core (caller's
//   loudness contract), never silently degrades to an empty object.
//
// `expectedOwner` ({epoch, session_id}, optional) arms the FAFF-527 fence: checked
// against the under-lock fresh read immediately before the write — a superseded owner
// yields ({written:false, yielded:true}, loud stderr), never throws, never writes.
//
// CRITICAL-SECTION HYGIENE: the lock-held span is one readLedger + the fence compare +
// the pure `mutate` transform + one serialise/write/rename — sub-millisecond. No
// subprocess, git, tracker, network, or token-measurement work belongs inside `mutate`;
// callers do that work BEFORE acquiring (sentry abort commits WIP first; events
// --tokens measures first). That is what keeps STALE_LOCK_MS ~1000× the section length.
//
// On acquisition-budget exhaustion this THROWS an error tagged code "LEDGER_LOCKED" —
// each caller surfaces it per its own loudness contract, and NEVER falls back to an
// unlocked write (that would reintroduce the race under exactly the contention that
// fires it).
// FAFF-679: reports the ledger digest this writer SAW and the digest it LEFT (Class A
// of the mid-bracket write rule — gateway obligation 5). `before_sha256` is the sha256
// of the raw on-disk bytes read under this same lock acquisition (null on a mint, where
// no prior file exists); `after_sha256` is atomicWriteLedger's return (null when
// nothing was written — yielded or a null-mutate abort). The before-hash is read from
// raw bytes, never a re-serialize of the parsed object, so it reflects exactly what a
// concurrent tamperer would have left — a byte comparison needs no JSON semantics.
function mutateLedgerUnderLock(runDir, mutate, expectedOwner) {
  const lockPath = path.join(runDir, "run-ledger.json.lock");
  return withFileLock(lockPath, () => {
    let fresh = null;
    let beforeSha256 = null;
    try {
      const raw = fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8");
      beforeSha256 = crypto.createHash("sha256").update(raw).digest("hex");
      fresh = JSON.parse(raw);
    } catch (e) { if (!e || e.code !== "ENOENT") throw e; } // absent ⇒ mint-from-scratch (fresh stays null); malformed throws
    if (expectedOwner && fresh && ownerEpochFenceStale(fresh.owner, expectedOwner)) {
      process.stderr.write(`ledger write yielded: owner epoch/session moved on in ${runDir} ` +
        `(writer epoch ${expectedOwner.epoch ?? 0}/${expectedOwner.session_id ?? "?"}, on-disk epoch ${(fresh.owner && fresh.owner.epoch) ?? 0}/${(fresh.owner && fresh.owner.session_id) ?? "?"}) — a newer resume owns this run\n`);
      return { written: false, yielded: true, before_sha256: beforeSha256, after_sha256: null };
    }
    const next = mutate(fresh);
    if (next === null || next === undefined) return { written: false, yielded: false, before_sha256: beforeSha256, after_sha256: null };
    const afterSha256 = atomicWriteLedger(runDir, next);
    return { written: true, yielded: false, before_sha256: beforeSha256, after_sha256: afterSha256 };
  }, { code: "LEDGER_LOCKED", label: "ledger lock" });
}

// Resolution order (spec §3): explicit arg → $FAFF_RUN_DIR → latest run under .faff/runs.
// A subagent should always pass RUN_DIR explicitly — "latest" can resolve the wrong
// ledger under concurrent/overlapping runs (the anti-pattern the spec calls out).
// FAFF-553: cmdHeartbeat now guards EXPLICIT targets itself (a named dir that is not
// a run dir fails loud, exit 3) — this resolver stays the shared explicit→ambient
// order, and the extension point if a future caller genuinely only has a run id.
function resolveHeartbeatRunDir(arg, env) {
  const e = env || process.env;
  const cand = arg || e.FAFF_RUN_DIR || latestRunDir(findRoot());
  return cand || null;
}

// FAFF-553: the closed flag set + usage line. `faff heartbeat --run <id>` used to be
// a SILENT no-op — the hand-rolled parser dropped the unknown flag and let its value
// leak into the positional slot, which then resolved to a non-run-dir and took the
// soft no-op branch (exit 0, nothing written) while the caller believed it ticked.
// Loud beats lenient at the resolution seam: any unknown `--*` token is a usage
// error, and flag values never leak into the positional slot.
const HEARTBEAT_USAGE = "usage: faff heartbeat [RUN_DIR] [--run-dir DIR] [--unit ISSUE] [--json] [--selftest]";
const HEARTBEAT_LEGAL_FLAGS = "legal flags: --run-dir DIR, --unit ISSUE, --json, --selftest";
function heartbeatUsageError(msg) {
  process.stderr.write(`heartbeat: ${msg}\n${HEARTBEAT_USAGE}\n`);
  return 2;
}

// FAFF-553: strict left-to-right scan over a CLOSED flag set. Returns either
// { error: <exit code already emitted> } or the parsed fields. Known value-flags
// (--run-dir, --unit) consume their value (missing value → exit 2); --json is the
// one boolean; any other "-"-prefixed token exits 2 (the message special-cases
// --run — the exact flag the F4 testbed agent invented); a second bare token
// exits 2. Pure aside from the usage-error stderr writes.
function parseHeartbeatArgs(args) {
  let asJson = false, unitRaw = null, runDirFlag = null, positional = null, positionalGiven = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") { asJson = true; continue; }
    if (a === "--run-dir" || a === "--unit") {
      if (i + 1 >= args.length) return { error: heartbeatUsageError(`${a} requires a value — ${HEARTBEAT_LEGAL_FLAGS}`) };
      const val = args[++i];
      if (a === "--run-dir") runDirFlag = val; else unitRaw = val;
      continue;
    }
    if (a.startsWith("-")) {
      const hint = a === "--run"
        ? " — did you mean --run-dir <dir>, or positional RUN_DIR?"
        : "";
      return { error: heartbeatUsageError(`unknown flag ${a} — ${HEARTBEAT_LEGAL_FLAGS}${hint}`) };
    }
    if (positionalGiven) return { error: heartbeatUsageError(`unexpected extra positional ${JSON.stringify(a)} — ${HEARTBEAT_LEGAL_FLAGS}`) };
    positional = a;
    positionalGiven = true;
  }
  if (positionalGiven && runDirFlag != null) {
    return { error: heartbeatUsageError(`RUN_DIR positional and --run-dir are mutually exclusive — give one target`) };
  }
  // "" coerces to nil (an unset shell var stays AMBIENT, preserving "safe to call
  // unconditionally"); --run-dir "" likewise.
  const explicitTarget = (positionalGiven ? positional : runDirFlag) || null;
  return { asJson, unitRaw, explicitTarget };
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
  // FAFF-553: strict, closed flag parsing — an unknown flag (e.g. --run) exits 2
  // instead of silently leaking its value into the positional slot.
  const parsed = parseHeartbeatArgs(args);
  if (parsed.error != null) return parsed.error;
  const { asJson, unitRaw, explicitTarget } = parsed;
  if (unitRaw != null && !isValidIssueId(unitRaw)) {
    process.stderr.write(`heartbeat: --unit ${JSON.stringify(unitRaw)} is not a valid issue id\n`);
    return 2;
  }
  const unit = unitRaw;
  const emit = (rd, lastHb, written) => {
    if (asJson) console.log(JSON.stringify({ run_dir: rd || null, last_heartbeat: lastHb ?? null, written, unit: unit || null }));
    return 0;
  };

  // FAFF-553: an EXPLICIT target (positional or --run-dir) that is missing or has no
  // run-ledger.json fails LOUD — exit 3, path named on stderr (mirrors sentry's
  // no-run-dir convention). The soft no-op contract below is scoped to AMBIENT
  // resolution only: a caller that NAMES a target wrongly is the F4 footgun and must
  // hear about it, while "an interactive non-run context must never error" holds for
  // callers that named nothing.
  let runDir;
  if (explicitTarget) {
    let isDir = false;
    try { isDir = fs.statSync(explicitTarget).isDirectory(); } catch { isDir = false; }
    if (!isDir || !fs.existsSync(path.join(explicitTarget, "run-ledger.json"))) {
      process.stderr.write(`heartbeat: ${explicitTarget} is not a run dir (no run-ledger.json)\n`);
      return 3;
    }
    runDir = explicitTarget;
  } else {
    runDir = resolveHeartbeatRunDir(null, process.env);
    // Ambient resolution found no run / no ledger → soft no-op (unchanged). exit 0,
    // written:false.
    if (!runDir || !fs.existsSync(path.join(runDir, "run-ledger.json"))) return emit(runDir, null, false);
  }

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

  // --- FAFF-553: parseHeartbeatArgs — the strict, closed flag set (adversarial-review
  // follow-up: the parser is a pure core and must be selftest-covered like every other,
  // so a future refactor that regresses it — e.g. re-introduces the value-leak — is
  // caught by the CLI's own selftest, not only the external test suite). The parser
  // writes usage lines to stderr on the error path; capture them so the selftest's
  // own output stays clean.
  {
    const errLines = [];
    const origWrite = process.stderr.write;
    process.stderr.write = (s) => { errLines.push(String(s)); return true; };
    let pUnknown, pLeak, pBoth, pEmpty, pRunDir, pTwoBare, pMissingVal, pClean;
    try {
      pUnknown = parseHeartbeatArgs(["--run", "run-xyz"]);
      pLeak = parseHeartbeatArgs(["--frobnicate", "/some/dir"]);
      pBoth = parseHeartbeatArgs(["/a/dir", "--run-dir", "/b/dir"]);
      pEmpty = parseHeartbeatArgs(["", "--json"]);
      pRunDir = parseHeartbeatArgs(["--run-dir", "/a/dir", "--unit", "FAFF-1", "--json"]);
      pTwoBare = parseHeartbeatArgs(["/a/dir", "stray"]);
      pMissingVal = parseHeartbeatArgs(["--run-dir"]);
      pClean = parseHeartbeatArgs(["/a/dir", "--json"]);
    } finally { process.stderr.write = origWrite; }
    check("parse: unknown flag --run errors (exit 2), usage names --run-dir", pUnknown.error === 2 &&
      errLines.some((l) => l.includes("--run-dir <dir>, or positional RUN_DIR")));
    check("parse: any unknown flag errors — its value never leaks into the positional slot", pLeak.error === 2);
    check("parse: positional + --run-dir together error", pBoth.error === 2);
    check("parse: empty-string positional coerces to nil (ambient)", pEmpty.error == null && pEmpty.explicitTarget === null && pEmpty.asJson === true);
    check("parse: --run-dir + --unit consume their values", pRunDir.error == null && pRunDir.explicitTarget === "/a/dir" && pRunDir.unitRaw === "FAFF-1");
    check("parse: a second bare token errors", pTwoBare.error === 2);
    check("parse: a value-flag missing its value errors", pMissingVal.error === 2);
    check("parse: positional target parses clean", pClean.error == null && pClean.explicitTarget === "/a/dir");
  }

  // --- FAFF-327: memberHeartbeatFileName + isValidIssueId (pure, no fs) ---
  check("memberHeartbeatFileName suffixes the canonical shape", memberHeartbeatFileName("FAFF-1") === "heartbeat.FAFF-1");
  check("isValidIssueId accepts a normal issue id", isValidIssueId("FAFF-327") === true);
  check("isValidIssueId rejects empty/traversal/absent", isValidIssueId("") === false && isValidIssueId("..") === false &&
    isValidIssueId("../../etc/passwd") === false && isValidIssueId(null) === false && isValidIssueId(undefined) === false);

  // --- FAFF-679: mutateLedgerUnderLock reports the before/after ledger digest pair
  // (Class A of the gateway's mid-bracket write rule) ---
  {
    const os = require("node:os");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-hb-digest-"));
    try {
      const mintRes = mutateLedgerUnderLock(tmp, () => ({ run_id: "t", owner: { status: "running" } }));
      check("mint: before_sha256 is null (nothing existed to bracket)", mintRes.before_sha256 === null);
      check("mint: after_sha256 equals an independent digest of the written bytes", mintRes.written &&
        mintRes.after_sha256 === crypto.createHash("sha256").update(fs.readFileSync(path.join(tmp, "run-ledger.json"), "utf8")).digest("hex"));
      const preEditBytes = fs.readFileSync(path.join(tmp, "run-ledger.json"), "utf8");
      const editRes = mutateLedgerUnderLock(tmp, (fresh) => ({ ...fresh, note: "edited" }));
      check("edit: before_sha256 equals the digest of the pre-write bytes", editRes.before_sha256 ===
        crypto.createHash("sha256").update(preEditBytes).digest("hex"));
      check("edit: before_sha256 differs from after_sha256 on a real content change", editRes.before_sha256 !== editRes.after_sha256);
      // Simulate an out-of-band edit landing between an orchestrator's baseline and its
      // next write: a caller holding the mint's after_sha256 as its baseline should see
      // the next writer's before_sha256 disagree once a third party has touched the file.
      fs.writeFileSync(path.join(tmp, "run-ledger.json"), JSON.stringify({ run_id: "t", tampered: true }) + "\n");
      const afterTamperRes = mutateLedgerUnderLock(tmp, (fresh) => ({ ...fresh, note: "post-tamper" }));
      check("a baseline held from the mint no longer matches the before-hash after an out-of-band edit",
        afterTamperRes.before_sha256 !== mintRes.after_sha256);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  if (failed) return 1;
  console.log("heartbeat --selftest: ok");
  return 0;
}


module.exports = {
  atomicWriteLedger, cmdHeartbeat, effectiveHeartbeatIso, heartbeatSelftest,
  isValidIssueId, memberHeartbeatFileName, mutateLedgerUnderLock, overlayHeartbeat, ownerEpochFenceStale, readHeartbeatFile,
  readMemberHeartbeatFile, resolveHeartbeatRunDir, writeHeartbeatFile, writeMemberHeartbeatFile,
};
