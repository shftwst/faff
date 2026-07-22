// ===========================================================================
// === region:governance — events — FAFF-35 (slice 1): structured run-event log — the timeline substrate ===
// for run observability. An append-only JSONL log at .faff/runs/<run-id>/events.jsonl,
// one RunEvent per line. The CLI owns the envelope (schema/run_id/seq/ts); the caller
// supplies only the payload {phase,type,issue?,data?}. `seq` is the authoritative
// monotonic order — `ts` is best-effort annotation (sandbox clocks are unreliable).
// Multi-writer (FAFF-574): the parallel executor, per-member heartbeats, `contain
// --record`, lights-out mint/resume, and the detached sentry poller all append to the
// same file concurrently. So every append is serialised by an advisory lock file
// (<runDir>/events.jsonl.lock, atomic `wx` create) and mints the next seq from the
// log's own tail inside that critical section — unique + monotonic by construction, and
// O(1) per append instead of O(file size). Pure (no tracker/network), --selftest-able —
// mirrors `faff profile`/`fixtures`/`contract`. The in-flight view + morning report are
// later producers that READ this log; slice 1 only produces it.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { TOKEN_DELTA_CLASSES, measureTokensByClass } = require("./budget");
const { activeProfile, DELIVERY_PROFILE } = require("./governance-profile");
const { mutateLedgerUnderLock } = require("./heartbeat");
const { withFileLock } = require("./fs-lock");
const { findRoot } = require("./shared-infra");

// FAFF-362: EVENT_PHASES / EVENT_TYPES / EVENT_ISSUE_SCOPED / EVENT_LEDGER_OUTCOMES
// stay exported (contain.js — factory — reuses EVENT_PHASES directly) but are now
// DERIVED from the active-by-default delivery profile rather than independent
// literals — identical values, single-sourced in governance-profile.js's
// DELIVERY_PROFILE. terminal_states (runcheck, 6) vs ledger_outcomes (events, 7,
// adds "claimed-by-peer") are deliberately two distinct profile keys — see
// governance-profile.js's comment on why they are never unified.
const EVENT_PHASES = new Set(DELIVERY_PROFILE.event_phases);
const EVENT_TYPES = new Set(DELIVERY_PROFILE.event_types);
// Types that are about one specific issue → `issue` is required.
// "issue" — the unit key (compat dialect; rename deferred to extraction schema-v2)
const EVENT_ISSUE_SCOPED = new Set(DELIVERY_PROFILE.issue_scoped_types);
// The run-ledger outcome vocabulary an issue-outcome event's data.outcome must use.
const EVENT_LEDGER_OUTCOMES = new Set(DELIVERY_PROFILE.ledger_outcomes);
// FAFF-415: the closed reasoning-effort vocabulary a dispatch may tag onto its phase
// event via data.effort. Reasoning-effort is a REQUEST-TIME setting the transcript
// never records, so it is captured here at dispatch time (riding FAFF-408's token-tag
// lane) — the only place effort is attributable. Defined in this governance region as
// its canonical home; the economics effort axis (factory) reads it across the allowed
// factory→governance edge (FAFF-359). Kept in step with EFFORT_ORDER over there.
const EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);

// FAFF-418: the closed vocabulary of QUALITY gates a non-shipped build may have been
// caught by, tagged onto its issue-outcome event via data.gate. The quality mirror of
// the token/effort tags above (FAFF-408/415): a single closed-vocab label the
// orchestrator projects from the build's authoritative gate artifacts
// (review-verdict.json / ac-checklist.json / holdout verdict) onto the one terminal
// event, so `faff quality` can query gate-catch distribution without scraping them.
// Non-leak: a gate NAME only, never a finding or payload. Kept in step with
// QUALITY_GATE_ORDER (factory) which the report renders in.
const QUALITY_GATE_CATCHES = new Set(["structural", "adversarial", "holdout", "ci"]);

// Pure validator over one event object. `requireEnvelope` distinguishes a caller-supplied
// payload (append: CLI fills schema/run_id/seq/ts, so they're not required yet) from a
// full record read back off disk (validate: the envelope must be present + well-formed).
// FAFF-362: `profile` is a trailing defaulted parameter (mirrors runcheck's auditLedger)
// — the default resolves DELIVERY_PROFILE, byte-identical to the pre-profile literals;
// an explicit profile (e.g. SECOND_PROFILE) validates against a different dialect with
// no other code path change. `outcome_required_types` membership REPLACES the inline
// `obj.type === "issue-outcome"` conditional this used to carry (the closed-vocab guard
// as data, not a hardcoded type check).
// Returns an array of human-readable violation strings (empty ⇒ valid).
function eventViolations(obj, requireEnvelope, profile = activeProfile()) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return ["event must be a JSON object"];
  }
  const v = [];
  if (requireEnvelope) {
    if (obj.schema !== 1) v.push("schema must be 1");
    if (obj.run_id === undefined || obj.run_id === null || obj.run_id === "") v.push("missing run_id");
    if (!Number.isInteger(obj.seq)) v.push("seq must be an integer");
    if (obj.ts === undefined || obj.ts === null || obj.ts === "") v.push("missing ts");
  }
  const phases = new Set(profile.event_phases);
  const types = new Set(profile.event_types);
  const issueScoped = new Set(profile.issue_scoped_types);
  const outcomeRequired = new Set(profile.outcome_required_types);
  const ledgerOutcomes = new Set(profile.ledger_outcomes);
  if (!phases.has(obj.phase)) {
    v.push(`phase '${obj.phase}' not in Phase {${[...phases].join(", ")}}`);
  }
  if (!types.has(obj.type)) {
    v.push(`type '${obj.type}' not in EventType {${[...types].join(", ")}}`);
  }
  if (issueScoped.has(obj.type) && (obj.issue === undefined || obj.issue === null || obj.issue === "")) {
    v.push(`type '${obj.type}' is issue-scoped but missing required field 'issue'`);
  }
  if (outcomeRequired.has(obj.type)) {
    const outcome = obj.data && typeof obj.data === "object" ? obj.data.outcome : undefined;
    if (!ledgerOutcomes.has(outcome)) {
      v.push(`${obj.type}.data.outcome '${outcome}' not in ledger outcome vocabulary {${[...ledgerOutcomes].join(", ")}}`);
    }
  }
  // FAFF-408: optional token-tag telemetry under data (additive; schema stays 1).
  // When data.tokens is present it is either null (⇒ tokens_source "estimate") or a
  // counts-ONLY four-class object (⇒ tokens_source "transcript"). No other field may
  // appear under data.tokens — the non-leak invariant (no prompt/response payload).
  if (obj.data && typeof obj.data === "object" && !Array.isArray(obj.data) && "tokens" in obj.data) {
    const tok = obj.data.tokens;
    const src = obj.data.tokens_source;
    if (tok === null) {
      if (src !== "estimate") v.push(`data.tokens is null but data.tokens_source '${src}' != 'estimate'`);
    } else if (tok && typeof tok === "object" && !Array.isArray(tok)) {
      const extra = Object.keys(tok).filter((k) => !TOKEN_DELTA_CLASSES.includes(k));
      if (extra.length) v.push(`data.tokens has unexpected field(s) {${extra.join(", ")}} — counts-only {${TOKEN_DELTA_CLASSES.join(", ")}}`);
      for (const cls of TOKEN_DELTA_CLASSES) {
        const n = tok[cls];
        if (!Number.isInteger(n) || n < 0) v.push(`data.tokens.${cls} must be a non-negative integer (got ${JSON.stringify(n)})`);
      }
      if (src !== "transcript") v.push(`data.tokens is a delta object but data.tokens_source '${src}' != 'transcript'`);
    } else {
      v.push(`data.tokens must be null or a {${TOKEN_DELTA_CLASSES.join(", ")}} object`);
    }
  }
  // FAFF-415: optional reasoning-effort tag under data (additive; schema stays 1).
  // When present it must be a single closed-vocab label — never payload content
  // (non-leak). Absent ⇒ record unchanged.
  if (obj.data && typeof obj.data === "object" && !Array.isArray(obj.data) && "effort" in obj.data) {
    const eff = obj.data.effort;
    // Require a STRING member of the closed vocab. Guarding on typeof first keeps the
    // rejection message honest for non-string input (e.g. a number or ["high"] array
    // would otherwise stringify into a misleading "'high' not in ..." message).
    if (typeof eff !== "string" || !EFFORT_LEVELS.has(eff)) {
      v.push(`data.effort ${JSON.stringify(eff)} not in EffortLevel {${[...EFFORT_LEVELS].join(", ")}}`);
    }
  }
  // FAFF-418: optional quality-outcome telemetry under data (additive; schema stays 1).
  // gate = the closed-vocab quality gate that caught a non-shipped build; rework_turns
  // = a non-negative integer count of gate-driven fix-and-re-run loops (clean pass = 0).
  // Both are single scalars — never payload (non-leak). Absent ⇒ record unchanged.
  if (obj.data && typeof obj.data === "object" && !Array.isArray(obj.data) && "gate" in obj.data) {
    const g = obj.data.gate;
    if (typeof g !== "string" || !QUALITY_GATE_CATCHES.has(g)) {
      v.push(`data.gate ${JSON.stringify(g)} not in QualityGate {${[...QUALITY_GATE_CATCHES].join(", ")}}`);
    }
  }
  if (obj.data && typeof obj.data === "object" && !Array.isArray(obj.data) && "rework_turns" in obj.data) {
    const rt = obj.data.rework_turns;
    if (!Number.isInteger(rt) || rt < 0) {
      v.push(`data.rework_turns must be a non-negative integer (got ${JSON.stringify(rt)})`);
    }
  }
  return v;
}

// Count non-empty lines in a JSONL file (absent ⇒ 0). Retained as the module's public
// surface and as the in-window fallback below; NO production mint site calls it directly
// for seq any more (FAFF-574 — the tail-read core owns minting).
function eventLineCount(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const raw = fs.readFileSync(filePath, "utf8");
  if (raw === "") return 0;
  return raw.split("\n").filter((l) => l.trim() !== "").length;
}

// FAFF-574 — the lock-serialised append core. The acquisition loop and tuning constants
// live in the shared run-dir lock helper (fs-lock.js, one home for the idiom — FAFF-575
// extracted them so the run-ledger mutation core in heartbeat.js shares the exact same
// mechanics; never re-copy them here). TAIL_WINDOW_BYTES stays events-specific.
const TAIL_WINDOW_BYTES = 65536; // bytes read from the file's end to find the last record

// Tail-read the log to find the last parseable record, returning { seq, prevRecord } where
// `seq` is the NEXT seq to mint. Reads at most TAIL_WINDOW_BYTES from the file's end (O(1)),
// scanning backwards past any torn/malformed trailing line. Empty/absent ⇒ seq 0. A window
// with no parseable record at all (pathological — a single record larger than the window)
// falls back to the full-file line count — degraded, but never wrong-by-race, since the
// caller holds the lock. Exported for unit assertion of the bounded read.
function tailReadNextSeq(eventsPath) {
  let st;
  try { st = fs.statSync(eventsPath); }
  catch (e) { if (e && e.code === "ENOENT") return { seq: 0, prevRecord: null }; throw e; }
  if (st.size === 0) return { seq: 0, prevRecord: null };
  const readLen = Math.min(st.size, TAIL_WINDOW_BYTES);
  const buf = Buffer.alloc(readLen);
  const fd = fs.openSync(eventsPath, "r");
  try { fs.readSync(fd, buf, 0, readLen, st.size - readLen); }
  finally { fs.closeSync(fd); }
  const lines = buf.toString("utf8").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === "") continue;
    let obj;
    try { obj = JSON.parse(lines[i]); } catch { continue; } // torn/partial trailing line — skip
    if (obj && Number.isInteger(obj.seq)) return { seq: obj.seq + 1, prevRecord: obj };
  }
  return { seq: eventLineCount(eventsPath), prevRecord: null }; // window held no parseable record
}

// The single lock-guarded critical section every seq mint goes through (FAFF-574).
// `mintRecord(seq, prevRecord)` returns the record to append, or null to abort WITHOUT
// writing (corrective.js uses null to preserve its never-write-malformed guarantee).
// Newline-repairs a torn final line by prefixing "\n" (never rewriting existing bytes),
// then appends the record as one write. Releases the lock in a finally. Throws
// EVENTS_LOCKED (from acquire) on budget exhaustion.
function appendRecordUnderLock(dir, mintRecord) {
  const eventsPath = path.join(dir, "events.jsonl");
  const lockPath = eventsPath + ".lock";
  return withFileLock(lockPath, () => {
    const { seq, prevRecord } = tailReadNextSeq(eventsPath);
    const record = mintRecord(seq, prevRecord);
    if (record === null || record === undefined) return null; // aborted — nothing written
    let prefix = "";
    try {
      const st = fs.statSync(eventsPath);
      if (st.size > 0) {
        const fd = fs.openSync(eventsPath, "r");
        const last = Buffer.alloc(1);
        try { fs.readSync(fd, last, 0, 1, st.size - 1); }
        finally { fs.closeSync(fd); }
        if (last[0] !== 0x0a) prefix = "\n"; // torn write from a crashed holder — don't concatenate
      }
    } catch (e) { if (!e || e.code !== "ENOENT") throw e; }
    fs.appendFileSync(eventsPath, prefix + JSON.stringify(record) + "\n");
    return record;
  }, { code: "EVENTS_LOCKED", label: "events lock" });
}

// Classify a seq against the previous seq for `events validate` (FAFF-574). Returns a
// finding string (without the "line N: " prefix) or null. A duplicate/regression
// (seq <= prev) breaks ordering ⇒ HARD (no [advisory] tag); a forward gap (seq > prev+1)
// leaves order intact ⇒ [advisory], unchanged. Pure — unit-assertable on message class.
function seqFinding(prevSeq, seq) {
  if (!Number.isInteger(seq)) return null;
  if (seq <= prevSeq) return `duplicate/regressed seq (expected > ${prevSeq}, got ${seq})`;
  if (seq > prevSeq + 1) return `non-contiguous seq (expected ${prevSeq + 1}, got ${seq}) [advisory]`;
  return null;
}

// The shared envelope-append core (FAFF-354): builds the CLI-owned envelope
// (schema/run_id/seq/ts) around a caller-supplied payload and appends it to
// `<dir>/events.jsonl`. One home for the seq/envelope logic — both `events append`
// (below) and `contain --record` call this rather than each hand-rolling their own.
// `dir` must already be a validated, existing run directory — this function does
// NOT check for one, because its two callers need different exit codes on a
// missing run dir (events append: 3; contain --record: 2, since contain's own
// exit 3 already means "outward") and so validate it themselves before calling in.
// FAFF-574: a thin wrapper over the lock-guarded core. Signature and returned-record
// shape are unchanged for its callers (`events append`, `contain --record`, sentry-poller);
// they gain only the possibility of a thrown EVENTS_LOCKED under lock-budget exhaustion,
// which each surfaces per its own loudness contract.
function appendEventRecord(dir, run, payload, ts) {
  return appendRecordUnderLock(dir, (seq) => {
    const record = { schema: 1, run_id: run, seq, ts: ts || new Date().toISOString(), phase: payload.phase, type: payload.type };
    if (payload.issue !== undefined) record.issue = payload.issue;
    if (payload.data !== undefined) record.data = payload.data;
    return record;
  });
}

function cmdEvents(args) {
  let root = null, run = null, ts = null, file = null, tokensFlag = false, sessionIdFlag = null;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
    else if (args[i] === "--run") run = args[++i];
    else if (args[i] === "--ts") ts = args[++i];
    else if (args[i] === "--file") file = args[++i];
    else if (args[i] === "--tokens") tokensFlag = true;
    else if (args[i] === "--session-id") sessionIdFlag = args[++i];
    else rest.push(args[i]);
  }
  if (rest.includes("--selftest")) return eventsSelftest();
  root = root || findRoot();
  // FAFF-488: an optional `--session-id` selects which session's transcript is
  // metered by --tokens, overriding $CLAUDE_CODE_SESSION_ID in the EFFECTIVE env
  // (never process.env itself, never written into any event `data`) — a selector,
  // not a payload; non-leak by construction. Absent ⇒ effectiveEnv IS process.env,
  // byte-for-byte today's resolution.
  const effectiveEnv = sessionIdFlag ? { ...process.env, CLAUDE_CODE_SESSION_ID: sessionIdFlag } : process.env;
  const cmd = rest[0];

  if (cmd === "append") {
    if (!run) { process.stderr.write("faff events append: --run <run-id> is required\n"); return 2; }
    const dir = path.join(root, ".faff", "runs", run);
    // A missing path OR a non-directory at that path is "no valid run dir" → exit 3 (fail-loud),
    // never an uncaught ENOTDIR crash when appendFileSync hits a file-where-a-dir-was-expected.
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      process.stderr.write(`faff events append: run dir missing (${path.join(".faff", "runs", run)}) — initialise the run first\n`);
      return 3;
    }
    let raw;
    try { raw = fs.readFileSync(0, "utf8"); }
    catch { process.stderr.write("faff events append: cannot read payload from stdin\n"); return 2; }
    let payload;
    try { payload = JSON.parse(raw); }
    catch { process.stderr.write("faff events append: malformed payload (invalid JSON)\n"); return 2; }
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      process.stderr.write("faff events append: payload must be a JSON object\n"); return 1;
    }
    const violations = eventViolations(payload, false);
    if (violations.length) {
      for (const x of violations) process.stderr.write(`- ${x}\n`);
      return 1;
    }
    let data = payload.data;
    // FAFF-408: opt-in token-tagging. Absent --tokens ⇒ NO measurement, NO ledger
    // read, and `data` is exactly payload.data — the record is byte-identical to the
    // pre-change CLI (backward-compat). With --tokens, the CLI (which owns the
    // envelope) also owns the measurement: it computes the four-class delta since the
    // run's last checkpoint, injects {tokens, tokens_source} into data, and advances
    // the ledger checkpoint. schema stays 1 (additive under the free-form data field).
    if (tokensFlag) {
      const ledgerPath = path.join(dir, "run-ledger.json");
      // A first read is only for the runStartMs mtime pre-filter (best-effort — a
      // null value just disables the pre-filter, never changes the total).
      let ledger0 = null;
      try { ledger0 = JSON.parse(fs.readFileSync(ledgerPath, "utf8")); } catch { ledger0 = null; }
      const ownerStart = ledger0 && ledger0.owner && ledger0.owner.started_at ? Date.parse(ledger0.owner.started_at) : null;
      const runStartMs = Number.isFinite(ownerStart) ? ownerStart : null;
      const measured = measureTokensByClass({ cwd: root, env: effectiveEnv, runStartMs });
      const base = { ...(data && typeof data === "object" && !Array.isArray(data) ? data : {}) };
      // A transcript delta is emitted ONLY if the advancing checkpoint is durably
      // persisted in the same step — persist-then-emit, atomic in effect. Otherwise
      // (no readable ledger, or the write fails) we degrade to a null `estimate`:
      // emitting a delta whose checkpoint did NOT advance would make the NEXT append
      // re-measure against the stale checkpoint and double-count this window (an
      // un-advanced transcript delta is worse than an honest gap).
      let emitted = false;
      if (measured.source === "transcript") {
        try {
          // FAFF-575: the checkpoint read + delta + advance all run INSIDE the locked
          // ledger core (mutateLedgerUnderLock), so the whole read-merge-write is one
          // critical section — the checkpoint the delta baselines against and the object
          // written are the SAME under-lock fresh read, and a concurrent writer (sentry
          // abort mark, budget baseline, lights-out resume) landing in the old
          // read-to-write window can no longer be clobbered. The ledger writer set is
          // lock-serialised multi-writer now — the pre-575 "the orchestrator is the
          // single writer of the budget block" claim is retired (writer inventory:
          // heartbeat.js, above mutateLedgerUnderLock). The token MEASUREMENT stays
          // outside the lock (critical-section hygiene — the transcript walk is the
          // expensive part; only the checkpoint math moves inside).
          let delta = null;
          const res = mutateLedgerUnderLock(dir, (fresh) => {
            if (!fresh) return null; // ledger vanished since the pre-read → estimate degrade
            const b = fresh.budget && typeof fresh.budget === "object" ? fresh.budget : {};
            const checkpoint = (b.tokens_at_last_event && typeof b.tokens_at_last_event === "object")
              ? b.tokens_at_last_event
              : (b.tokens_at_start_by_class && typeof b.tokens_at_start_by_class === "object")
                ? b.tokens_at_start_by_class
                : { input: 0, output: 0, cache_write: 0, cache_read: 0 };
            delta = {};
            for (const cls of TOKEN_DELTA_CLASSES) {
              delta[cls] = Math.max(0, (measured.tokens[cls] || 0) - (checkpoint[cls] || 0));
            }
            fresh.budget = b;
            fresh.budget.tokens_at_last_event = {
              input: measured.tokens.input, output: measured.tokens.output,
              cache_write: measured.tokens.cache_write, cache_read: measured.tokens.cache_read,
            };
            return fresh; // if the write throws, the catch degrades to estimate
          });
          if (res.written && delta) {
            base.tokens = delta;
            base.tokens_source = "transcript";
            emitted = true;
          }
        } catch { /* unreadable/unwritable/LEDGER_LOCKED ledger → estimate below (no fabricated delta; checkpoint NOT advanced) */ }
      }
      if (!emitted) {
        // No transcript readable, OR no durable checkpoint could be maintained ⇒ honest
        // null delta, estimate source, checkpoint NOT advanced (the next transcript
        // append's delta spans the gap once — no tokens lost, no double-count).
        base.tokens = null;
        base.tokens_source = "estimate";
      }
      data = base;
    }
    let record;
    try {
      record = appendEventRecord(dir, run, { phase: payload.phase, type: payload.type, issue: payload.issue, data }, ts);
    } catch (e) {
      // FAFF-574: a lock-budget exhaustion is loud — exit 1, mirroring the validation-failure
      // exit above; never a silent unlocked append.
      if (e && e.code === "EVENTS_LOCKED") { process.stderr.write(`faff events append: ${e.message}\n`); return 1; }
      throw e;
    }
    console.log(JSON.stringify(record));
    return 0;
  }

  if (cmd === "validate") {
    let raw;
    try { raw = fs.readFileSync(file !== null ? file : 0, "utf8"); }
    catch { process.stderr.write("faff events validate: cannot read input (no --file PATH and no stdin)\n"); return 2; }
    const lines = raw.split("\n");
    const violations = [];
    let prevSeq = -1;
    lines.forEach((line, idx) => {
      if (line.trim() === "") return;
      const n = idx + 1;
      let obj;
      try { obj = JSON.parse(line); }
      catch { violations.push(`line ${n}: malformed (invalid JSON)`); return; }
      for (const x of eventViolations(obj, true)) violations.push(`line ${n}: ${x}`);
      // FAFF-574: duplicate/regressed seq (ordering broken) is a HARD finding; a forward
      // gap (order intact) stays [advisory]. Any finding still exits 1 (unchanged).
      if (Number.isInteger(obj.seq)) {
        const f = seqFinding(prevSeq, obj.seq);
        if (f) violations.push(`line ${n}: ${f}`);
        prevSeq = obj.seq;
      }
    });
    if (violations.length) {
      for (const x of violations) process.stderr.write(`${x}\n`);
      return 1;
    }
    console.log("OK — run-event log valid (schema 1).");
    return 0;
  }

  if (cmd === "read") {
    if (!run) { process.stderr.write("faff events read: --run <run-id> is required\n"); return 2; }
    const eventsPath = path.join(root, ".faff", "runs", run, "events.jsonl");
    if (!fs.existsSync(eventsPath)) { process.stderr.write("faff events read: no events for this run\n"); return 3; }
    const raw = fs.readFileSync(eventsPath, "utf8");
    const records = raw.split("\n").filter((l) => l.trim() !== "").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (records.length === 0) { process.stderr.write("faff events read: no events for this run\n"); return 3; }
    // --type / --issue are optional value-taking filters, read from the raw args.
    let tFilter = null, iFilter = null;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--type") tFilter = args[i + 1];
      else if (args[i] === "--issue") iFilter = args[i + 1];
    }
    const filtered = records.filter((r) => (tFilter === null || r.type === tFilter) && (iFilter === null || r.issue === iFilter));
    if (args.includes("--json")) {
      console.log(JSON.stringify(filtered));
    } else {
      for (const r of filtered) console.log(`${String(r.seq).padStart(4)}  ${r.phase}/${r.type}${r.issue ? "  " + r.issue : ""}`);
    }
    return 0;
  }

  process.stderr.write("faff events: expected one of append | validate | read (or --selftest)\n");
  return 2;
}

// In-memory self-test of the pure validator core (mirrors the `faff profile`/`fixtures` style).
function eventsSelftest() {
  const cases = [
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "run-start" }, 0, "valid run-start (envelope)"],
    [{ schema: 1, run_id: "r", seq: 1, ts: "t", phase: "build", type: "issue-outcome", issue: "FAFF-35", data: { outcome: "shipped" } }, 0, "valid issue-outcome"],
    [{ schema: 1, run_id: "r", seq: 1, ts: "t", phase: "build", type: "issue-outcome", issue: "FAFF-551", data: { outcome: "superseded" } }, 0, "FAFF-571: valid issue-outcome with 'superseded' outcome"],
    [{ schema: 2, run_id: "r", seq: 0, ts: "t", phase: "run", type: "run-start" }, 1, "wrong schema version"],
    [{ schema: 1, seq: 0, ts: "t", phase: "run", type: "run-start" }, 1, "missing run_id"],
    [{ schema: 1, run_id: "r", ts: "t", phase: "run", type: "run-start" }, 1, "missing seq"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "no-such-type" }, 1, "unknown type"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "nope", type: "run-start" }, 1, "unknown phase"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "build", type: "build-start" }, 1, "issue-scoped type missing issue"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "bogus" } }, 1, "outcome not in ledger vocab"],
    [[], 1, "not an object"],
    // FAFF-408 — token-tag telemetry under data.tokens (additive; schema stays 1).
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "prep", type: "prep-done", issue: "FAFF-1", data: { tokens: { input: 100, output: 20, cache_write: 5, cache_read: 0 }, tokens_source: "transcript" } }, 0, "valid 4-class transcript delta"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "prep", type: "prep-done", issue: "FAFF-1", data: { tokens: null, tokens_source: "estimate" } }, 0, "valid null estimate delta"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "prep", type: "prep-done", issue: "FAFF-1", data: { tokens: { input: 1, output: 2, cache_write: 3, cache_read: 4 }, tokens_source: "estimate" } }, 1, "4-class delta but source estimate (mismatch)"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "prep", type: "prep-done", issue: "FAFF-1", data: { tokens: null, tokens_source: "transcript" } }, 1, "null delta but source transcript (mismatch)"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "prep", type: "prep-done", issue: "FAFF-1", data: { tokens: { input: -1, output: 0, cache_write: 0, cache_read: 0 }, tokens_source: "transcript" } }, 1, "negative class rejected"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "prep", type: "prep-done", issue: "FAFF-1", data: { tokens: { input: 1.5, output: 0, cache_write: 0, cache_read: 0 }, tokens_source: "transcript" } }, 1, "non-integer class rejected"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "prep", type: "prep-done", issue: "FAFF-1", data: { tokens: { input: 1, output: 2, cache_write: 3, cache_read: 4, prompt: "secret" }, tokens_source: "transcript" } }, 1, "extra field rejected (non-leak)"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "prep", type: "prep-done", issue: "FAFF-1", data: { tokens: { input: 1, output: 2, cache_write: 3 }, tokens_source: "transcript" } }, 1, "missing class rejected"],
    // FAFF-415 — reasoning-effort tag under data.effort (additive; schema stays 1).
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "build", type: "build-start", issue: "FAFF-1", data: { effort: "high" } }, 0, "valid effort label"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "build", type: "build-start", issue: "FAFF-1", data: { effort: "max" } }, 0, "valid effort label (max)"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "build", type: "build-start", issue: "FAFF-1", data: { effort: "extreme" } }, 1, "effort not in vocabulary rejected"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "build", type: "build-start", issue: "FAFF-1", data: { effort: 5 } }, 1, "non-string effort (number) rejected"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "build", type: "build-start", issue: "FAFF-1", data: { effort: ["high"] } }, 1, "non-string effort (array) rejected"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "prep", type: "prep-done", issue: "FAFF-1", data: { effort: "medium", tokens: { input: 1, output: 2, cache_write: 3, cache_read: 4 }, tokens_source: "transcript" } }, 0, "effort alongside a valid token delta"],
    // FAFF-418 — quality-outcome tags under data.gate / data.rework_turns (additive; schema stays 1).
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "parked", gate: "adversarial", rework_turns: 2 } }, 0, "valid gate + rework_turns"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "shipped", rework_turns: 0 } }, 0, "clean ship, zero rework, no gate"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "parked", gate: "bogus" } }, 1, "gate not in vocabulary rejected"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "parked", gate: 5 } }, 1, "non-string gate rejected"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "shipped", rework_turns: -1 } }, 1, "negative rework_turns rejected"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "shipped", rework_turns: 1.5 } }, 1, "non-integer rework_turns rejected"],
    // FAFF-352 — sentry-checkpoint: run-scoped (no issue), data = the sentry check payload.
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "sentry-checkpoint", data: { run_dir: "/r", verdicts: [], intervention: "continue", tripped: false, thresholds: {} } }, 0, "valid sentry-checkpoint (envelope, no issue)"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "sentry-checkpoint" }, 0, "valid sentry-checkpoint with no data"],
    // FAFF-354 — containment-check: issue-scoped (issue = mandate), data = the recorded
    // contain invocation (mandate/parent/root/ancestry_raw/verdict/exit).
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "containment-check", issue: "FAFF-1", data: { mandate: "FAFF-1", parent: "FAFF-2", root: false, ancestry_raw: '[{"id":"FAFF-2","parentId":"FAFF-1"}]', verdict: "contained", exit: 0 } }, 0, "valid containment-check record"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "containment-check", data: { mandate: "FAFF-1", parent: null, root: true, ancestry_raw: null, verdict: "outward", exit: 3 } }, 1, "containment-check missing required issue field"],
    // FAFF-539 — self-intake-check: issue-scoped (issue = mandate), data = the recorded
    // self-intake invocation (mandate/target_raw/self snapshot/verdict/reason/exit).
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "self-intake-check", issue: "FAFF-1", data: { mandate: "FAFF-1", target_raw: '{"team":null,"repo":"shftwst/faff"}', self: { team: null, repo: "shftwst/faff", lane_on: true }, verdict: "self", reason: "repo-match", exit: 0 } }, 0, "valid self-intake-check record"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "self-intake-check", data: { mandate: "FAFF-1", target_raw: "{}", self: { team: null, repo: null, lane_on: false }, verdict: "not-self", reason: "lane-off", exit: 3 } }, 1, "self-intake-check missing required issue field"],
  ];
  let failed = 0;
  for (const [obj, wantViol, label] of cases) {
    const got = eventViolations(obj, true).length > 0 ? 1 : 0;
    if (got !== wantViol) { process.stderr.write(`events --selftest FAIL: ${label} (want ${wantViol}, got ${got})\n`); failed++; }
  }
  // payload-mode (no envelope required): the same payload checks still apply.
  const payloadOk = eventViolations({ phase: "run", type: "run-start" }, false).length === 0 ? 0 : 1;
  if (payloadOk !== 0) { process.stderr.write("events --selftest FAIL: valid payload (no envelope) (want 0, got 1)\n"); failed++; }
  const payloadBad = eventViolations({ phase: "build", type: "build-start" }, false).length > 0 ? 1 : 0;
  if (payloadBad !== 1) { process.stderr.write("events --selftest FAIL: payload missing issue (want 1, got 0)\n"); failed++; }
  // FAFF-574 — seq classification: duplicate/regression is HARD (no [advisory]), a forward
  // gap is [advisory], contiguous/first is clean. [prevSeq, seq, wantClass] where wantClass
  // is "hard" | "advisory" | "none".
  const seqCases = [
    [-1, 0, "none", "first record seq 0"],
    [3, 4, "none", "contiguous"],
    [4, 4, "hard", "duplicate seq"],
    [5, 3, "hard", "regressed seq"],
    [4, 7, "advisory", "forward gap"],
    [-1, 5, "advisory", "forward gap from empty log"],
  ];
  for (const [prev, s, want, label] of seqCases) {
    const f = seqFinding(prev, s);
    const got = f === null ? "none" : (/\[advisory\]/.test(f) ? "advisory" : "hard");
    if (got !== want) { process.stderr.write(`events --selftest FAIL: seq ${label} (want ${want}, got ${got})\n`); failed++; }
  }
  if (failed) return 1;
  console.log("events --selftest: ok");
  return 0;
}


module.exports = { EFFORT_LEVELS, EVENT_ISSUE_SCOPED, EVENT_LEDGER_OUTCOMES, EVENT_PHASES, EVENT_TYPES, QUALITY_GATE_CATCHES, TAIL_WINDOW_BYTES, appendEventRecord, appendRecordUnderLock, cmdEvents, eventLineCount, eventViolations, eventsSelftest, seqFinding, tailReadNextSeq };
