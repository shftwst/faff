// ===========================================================================
// === region:governance — events — FAFF-35 (slice 1): structured run-event log — the timeline substrate ===
// for run observability. An append-only JSONL log at .faff/runs/<run-id>/events.jsonl,
// one RunEvent per line. The CLI owns the envelope (schema/run_id/seq/ts/prev); the
// caller supplies only the payload {phase,type,issue?,data?}. `seq` is the authoritative
// monotonic order — `ts` is best-effort annotation (sandbox clocks are unreliable).
// Multi-writer (FAFF-574): the parallel executor, per-member heartbeats, `contain
// --record`, lights-out mint/resume, and the detached sentry poller all append to the
// same file concurrently. So every append is serialised by an advisory lock file
// (<runDir>/events.jsonl.lock, atomic `wx` create) and mints the next seq from the
// log's own tail inside that critical section — unique + monotonic by construction, and
// O(1) per append instead of O(file size).
// Tamper-evident chain (FAFF-564, schema 2): every record additionally carries `prev` —
// the SHA-256 (64 lowercase hex) of the previous PHYSICAL line's raw bytes, exclusive of
// its terminating newline; the genesis record's `prev` hashes the UTF-8 bytes of the
// record's own run_id. The chain is over physical lines, not parseable records, so no
// line (torn, malformed, or legacy schema-1) escapes it; editing or reordering any
// mid-log line breaks the hash of every following line. The hash is computed inside the
// SAME locked critical section as the seq mint (one tail read serves both), never at a
// call site, and never accepted from a caller. Ledger mutations join the chain as
// `ledger-write` events (data.ledger_sha256 = SHA-256 of the post-write run-ledger.json
// bytes, always CLI-computed) — emitted by atomicWriteLedger's fold (heartbeat.js) for
// every CLI-side writer, and by the prose-layer note rule for direct orchestrator edits.
// Anchoring the chain head + verifying it is FAFF-568, not this module: `events
// validate` stays shape-only and never re-hashes the chain. Pure (no tracker/network),
// --selftest-able — mirrors `faff profile`/`fixtures`/`contract`. The in-flight view +
// morning report are later producers that READ this log; slice 1 only produces it.
// ===========================================================================

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseArgs, usageError } = require("./argv");
const EVENTS_SPEC = { flags: {
  "--selftest": { arity: 0 }, "--tokens": { arity: 0 }, "--json": { arity: 0 },
  "--root": { arity: 1 }, "--run": { arity: 1 }, "--ts": { arity: 1 }, "--file": { arity: 1 },
  "--session-id": { arity: 1 }, "--type": { arity: 1 }, "--issue": { arity: 1 },
  // FAFF-568: verify/anchor sub-verb flags (re-hash + snapshot the chain).
  "--run-dir": { arity: 1 }, "--legacy-policy": { arity: 1 }, "--dest": { arity: 1 },
}, positionals: { min: 0, max: null, name: "verb" } };
const { TOKEN_DELTA_CLASSES, measureTokensByClass } = require("./budget");
const { activeProfile, DELIVERY_PROFILE } = require("./governance-profile");
const { mutateLedgerUnderLock } = require("./heartbeat");
const { withFileLock } = require("./fs-lock");
const { findRoot, resolveRunDir } = require("./shared-infra");

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

// FAFF-564: the chain-hash shape — 64 lowercase hex chars (SHA-256). Shared by the
// `prev` envelope check and the `ledger-write` data.ledger_sha256 check.
const HEX64_RE = /^[0-9a-f]{64}$/;

// FAFF-564: one SHA-256 helper for the chain — raw bytes in, lowercase hex out.
function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

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
    if (obj.schema !== 1 && obj.schema !== 2) v.push("schema must be 1 or 2");
    if (obj.run_id === undefined || obj.run_id === null || obj.run_id === "") v.push("missing run_id");
    if (!Number.isInteger(obj.seq)) v.push("seq must be an integer");
    if (obj.ts === undefined || obj.ts === null || obj.ts === "") v.push("missing ts");
    // FAFF-564: `prev` is a schema FACT, not an optional tag — a schema-2 record must
    // carry a well-formed chain hash; a schema-1 (legacy) record must not carry one.
    if (obj.schema === 2 && !HEX64_RE.test(typeof obj.prev === "string" ? obj.prev : "")) {
      v.push("schema 2 requires prev: 64 lowercase hex (SHA-256 of the previous line's raw bytes)");
    }
    if (obj.schema === 1 && obj.prev !== undefined) {
      v.push("schema 1 must not carry prev (legacy records are unchained)");
    }
    // FAFF-564: `ledger-write` carries the post-write ledger hash — ENVELOPE MODE ONLY.
    // The field is CLI-owned and injected before append (like the rest of the envelope),
    // so a payload-mode note command ({"phase":"run","type":"ledger-write"}, no data)
    // must validate clean pre-injection.
    if (obj.type === "ledger-write") {
      const h = obj.data && typeof obj.data === "object" && !Array.isArray(obj.data) ? obj.data.ledger_sha256 : undefined;
      if (!HEX64_RE.test(typeof h === "string" ? h : "")) {
        v.push("ledger-write requires data.ledger_sha256: 64 lowercase hex (SHA-256 of the post-write run-ledger.json bytes)");
      }
    }
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

// FAFF-564: the backward extension of the tail read. When the previous line's start
// lies OUTSIDE the tail window, extend the read backwards in chunks until the preceding
// newline (or file start) is found — the chain hash needs the exact full bytes, and
// unlike seq there is NO counting fallback that can substitute. `end` is the exclusive
// end of the previous line's bytes (its terminating newline already stripped);
// `searchFrom` is where the backward newline scan starts (the window start — the bytes
// in [searchFrom, end) are already known to contain no newline), so exactly as many
// extra chunks are read as the oversized line needs.
function readPrevLineExtendingBack(fd, end, searchFrom) {
  let lo = searchFrom;
  let start = 0;
  while (lo > 0) {
    const chunkLen = Math.min(TAIL_WINDOW_BYTES, lo);
    const chunk = Buffer.alloc(chunkLen);
    fs.readSync(fd, chunk, 0, chunkLen, lo - chunkLen);
    const idx = chunk.lastIndexOf(0x0a);
    if (idx !== -1) { start = lo - chunkLen + idx + 1; break; }
    lo -= chunkLen;
  }
  const line = Buffer.alloc(end - start);
  if (end - start > 0) fs.readSync(fd, line, 0, end - start, start);
  return line;
}

// The single under-lock tail read serving BOTH derivations (FAFF-574 + FAFF-564):
//   - seq: the NEXT seq to mint, from the last PARSEABLE record in the tail window
//     (scanning backwards past torn/malformed trailing lines; empty/absent ⇒ seq 0;
//     a window with no parseable record falls back to the full-file line count —
//     degraded, but never wrong-by-race, since the caller holds the lock).
//   - prevLineBuf: the raw bytes of the last PHYSICAL line (exclusive of its
//     terminating newline) — a well-formed record, a torn partial segment, or a legacy
//     line alike; null on an absent/empty file (⇒ genesis). The two deliberately read
//     different things from the same window: seq skips unparseable lines, the chain
//     hashes whatever bytes are physically last.
// Reads at most TAIL_WINDOW_BYTES (O(1)) except when the previous line itself exceeds
// the window (then readPrevLineExtendingBack reads exactly the extra chunks it needs).
function tailReadState(eventsPath) {
  let st;
  try { st = fs.statSync(eventsPath); }
  catch (e) { if (e && e.code === "ENOENT") return { seq: 0, prevRecord: null, prevLineBuf: null }; throw e; }
  if (st.size === 0) return { seq: 0, prevRecord: null, prevLineBuf: null };
  const readLen = Math.min(st.size, TAIL_WINDOW_BYTES);
  const buf = Buffer.alloc(readLen);
  const fd = fs.openSync(eventsPath, "r");
  let seq = null, prevRecord = null, prevLineBuf;
  try {
    fs.readSync(fd, buf, 0, readLen, st.size - readLen);
    // --- FAFF-574: seq from the last parseable record in the window ---
    const lines = buf.toString("utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim() === "") continue;
      let obj;
      try { obj = JSON.parse(lines[i]); } catch { continue; } // torn/partial trailing line — skip
      if (obj && Number.isInteger(obj.seq)) { seq = obj.seq + 1; prevRecord = obj; break; }
    }
    // --- FAFF-564: the last physical line's raw bytes ---
    const windowStart = st.size - readLen;
    const end = buf[readLen - 1] === 0x0a ? st.size - 1 : st.size; // torn file: hash the trailing partial segment as-is
    const endInBuf = end - windowStart;
    const nlIdx = endInBuf > 0 ? buf.lastIndexOf(0x0a, endInBuf - 1) : -1;
    if (nlIdx !== -1) {
      prevLineBuf = Buffer.from(buf.subarray(nlIdx + 1, endInBuf));
    } else if (windowStart === 0) {
      prevLineBuf = Buffer.from(buf.subarray(0, endInBuf)); // the line starts at file start, fully in window
    } else {
      prevLineBuf = readPrevLineExtendingBack(fd, end, windowStart); // line start outside the window
    }
  } finally { fs.closeSync(fd); }
  if (seq === null) seq = eventLineCount(eventsPath); // window held no parseable record
  return { seq, prevRecord, prevLineBuf };
}

// Tail-read the log to find the last parseable record, returning { seq, prevRecord } where
// `seq` is the NEXT seq to mint. A thin projection of tailReadState above (one shared
// read path). Exported for unit assertion of the bounded read.
function tailReadNextSeq(eventsPath) {
  const { seq, prevRecord } = tailReadState(eventsPath);
  return { seq, prevRecord };
}

// The single lock-guarded critical section every seq mint goes through (FAFF-574).
// `mintRecord(seq, prevRecord, prevHash)` returns the record to append, or null to abort
// WITHOUT writing (corrective.js uses null to preserve its never-write-malformed
// guarantee). FAFF-564: `prevHash` is the chain hash — SHA-256 of the previous physical
// line's raw bytes (genesis: of the UTF-8 run_id, which is the run-dir basename by the
// .faff/runs/<run-id> layout every writer uses) — computed HERE, under the same lock as
// the seq mint, from the same tail read. A hash computed outside this critical section
// can commit to a line that is no longer last; an agent-supplied hash is an untrusted
// claim in a trust artifact — neither is ever accepted. Every minter stamps
// `schema: 2, prev: prevHash` into the record it returns, and the core asserts the
// returned record carries the seq/prev it supplied (belt against a minter drifting).
// Newline-repairs a torn final line by prefixing "\n" (never rewriting existing bytes —
// the chain commits to raw bytes, so the repaired torn segment re-hashes to exactly
// what this writer hashed), then appends the record as one write. Releases the lock in
// a finally. Throws EVENTS_LOCKED (from acquire) on budget exhaustion.
function appendRecordUnderLock(dir, mintRecord) {
  const eventsPath = path.join(dir, "events.jsonl");
  const lockPath = eventsPath + ".lock";
  return withFileLock(lockPath, () => {
    const { seq, prevRecord, prevLineBuf } = tailReadState(eventsPath);
    const prevHash = sha256Hex(prevLineBuf === null ? Buffer.from(path.basename(dir), "utf8") : prevLineBuf);
    const record = mintRecord(seq, prevRecord, prevHash);
    if (record === null || record === undefined) return null; // aborted — nothing written
    if (record.seq !== seq || record.prev !== prevHash) {
      throw new Error(`events append core: minted record must carry the supplied seq/prev (want seq ${seq} prev ${prevHash}, got seq ${record.seq} prev ${record.prev})`);
    }
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
// which each surfaces per its own loudness contract. FAFF-564: stamps the schema-2
// chained envelope — `prev` comes from the core, never computed here.
function appendEventRecord(dir, run, payload, ts) {
  return appendRecordUnderLock(dir, (seq, _prevRecord, prevHash) => {
    const record = { schema: 2, run_id: run, seq, ts: ts || new Date().toISOString(), prev: prevHash, phase: payload.phase, type: payload.type };
    if (payload.issue !== undefined) record.issue = payload.issue;
    if (payload.data !== undefined) record.data = payload.data;
    return record;
  });
}

// ===========================================================================
// FAFF-568: post-hoc chain VERIFICATION — the read side of FAFF-564's write side.
// Re-derives each link exactly as the writer minted it: split events.jsonl on
// newlines into physical lines, SHA-256 each physical line's raw bytes (exclusive
// of the terminating newline), and confirm the NEXT record's `prev` equals it; the
// genesis record's `prev` must equal SHA-256 of that record's OWN run_id field (NOT
// the dir basename — so an anchor relocated to .faff/anchors/<run>/<issue>/ still
// verifies, where basename is the issue, not the run_id). Byte-exact, no
// canonicalisation — a foreign verifier re-implements it from the schema alone. The
// verb (`faff events verify`) and governance-check's integrity leg both compose this
// ONE core (never a second home for the hashing rule). Classifies rather than
// blanket-fails: broken (a prev/ledger mismatch among schema-2 records — the tamper
// signature), legacy-unverifiable (schema-1, no chain — honest), torn_tail (a crashed
// final partial write — honest), mixed (prev-carrying and prev-less records coexist —
// the chained records verify, the prev-less ones are unverifiable), witness-mismatch
// (the dir carries a chain-head.json witness whose recorded head_sha256 / line_count /
// schema_floor disagree with the re-derived values — a post-anchor rewrite, including
// the schema-downgrade spoof and the forged-torn-tail edit; always a gating FAIL,
// regardless of legacy-policy). `broken` and `witness-mismatch` are the gating FAILs.
// ===========================================================================

// Split a raw events.jsonl buffer into physical-line byte-buffers (each EXCLUSIVE of
// its terminating "\n"), plus whether the file's final byte was a newline. A trailing
// newline yields NO empty final element; a final non-empty segment with no trailing
// newline is the torn-tail candidate (the last element, lastHasNewline=false).
function splitPhysicalLines(buf) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) { lines.push(buf.subarray(start, i)); start = i + 1; }
  }
  let lastHasNewline = true;
  if (start < buf.length) { lines.push(buf.subarray(start, buf.length)); lastHasNewline = false; }
  return { lines, lastHasNewline };
}

// PURE. Verify the chain in `dir`/events.jsonl (+ optional `dir`/run-ledger.json ledger
// fold). Returns the VerifyResult shape; never throws on a chain problem (only genuine
// unreadability surfaces via status "malformed"). Classification is policy-free —
// `legacy_policy` only affects the exit-code mapping (see `verifyExitCode`).
function verifyChain(dir, opts = {}) {
  const eventsPath = path.join(dir, "events.jsonl");
  const base = { schema_floor: null, line_count: 0, head_sha256: null, first_break: null, ledger_fold: "absent", torn_tail: false, witness: "absent" };

  // FAFF-568 fix pass: the chain-head.json witness is CROSS-CHECKED, never decorative.
  // Anchored at anchor time by the CLI (head hash never caller-supplied) and pinned by
  // the PR head sha merge-gate observes, it is the independent record a post-anchor
  // rewrite cannot retrofit: stripping `prev` fields to spoof legacy-unverifiable
  // changes schema_floor; tampering the last record + truncating its newline (the
  // forged-torn-tail edit) changes head_sha256/line_count. Any disagreement between
  // the witness and the re-derived values is `witness-mismatch` — a gating FAIL that
  // no legacy-policy softens. A run dir has no chain-head.json → witness "absent",
  // behaviour unchanged. An unparseable witness in an anchor is a corrupt committed
  // artifact → malformed (fail-closed).
  let witnessHead = null;
  const witnessPath = path.join(dir, "chain-head.json");
  if (fs.existsSync(witnessPath)) {
    try { witnessHead = JSON.parse(fs.readFileSync(witnessPath, "utf8")); }
    catch (e) { return { ...base, status: "malformed", detail: `chain-head.json unreadable/invalid JSON: ${e.message}` }; }
    if (witnessHead === null || typeof witnessHead !== "object" || Array.isArray(witnessHead)) {
      return { ...base, status: "malformed", detail: "chain-head.json is not a JSON object" };
    }
  }
  // Compare only the fields the witness actually records (older witnesses may lack one).
  const witnessMismatches = () => {
    if (!witnessHead) return [];
    const out = [];
    if (typeof witnessHead.head_sha256 === "string" && witnessHead.head_sha256 !== base.head_sha256) {
      out.push(`head_sha256 (witness ${witnessHead.head_sha256.slice(0, 12)}… ≠ derived ${String(base.head_sha256).slice(0, 12)}…)`);
    }
    if (Number.isInteger(witnessHead.line_count) && witnessHead.line_count !== base.line_count) {
      out.push(`line_count (witness ${witnessHead.line_count} ≠ derived ${base.line_count})`);
    }
    if (Number.isInteger(witnessHead.schema_floor) && witnessHead.schema_floor !== base.schema_floor) {
      out.push(`schema_floor (witness ${witnessHead.schema_floor} ≠ derived ${base.schema_floor})`);
    }
    return out;
  };
  const witnessMismatchResult = (mm) => ({
    ...base, witness: "mismatch", status: "witness-mismatch",
    detail: `chain-head.json witness disagrees with the on-disk log: ${mm.join("; ")}`,
  });

  let buf;
  try { buf = fs.readFileSync(eventsPath); }
  catch (e) {
    if (e && e.code === "ENOENT") {
      if (witnessHead) {
        const mm = witnessMismatches();
        if (mm.length) return witnessMismatchResult(mm);
      }
      return { ...base, status: "verified", detail: "events.jsonl absent — nothing to verify" };
    }
    return { ...base, status: "malformed", detail: `events.jsonl unreadable: ${e.message}` };
  }
  const { lines, lastHasNewline } = splitPhysicalLines(buf);
  base.line_count = lines.length;
  if (lines.length === 0) {
    if (witnessHead) {
      const mm = witnessMismatches();
      if (mm.length) return witnessMismatchResult(mm);
    }
    return { ...base, status: "verified", detail: "empty events.jsonl — nothing to verify" };
  }
  base.head_sha256 = sha256Hex(lines[lines.length - 1]);

  // Parse pass: record per line (or null), separating an honest torn tail (the final
  // no-newline segment) from a mid-file non-record (which is malformed, exit 2).
  const parsed = new Array(lines.length).fill(null);
  let tornTail = false, schemaFloor = null, anyPrev = false, anyPrevless = false;
  for (let i = 0; i < lines.length; i++) {
    let obj;
    try { obj = JSON.parse(lines[i].toString("utf8")); }
    catch {
      if (i === lines.length - 1 && !lastHasNewline) { tornTail = true; break; } // honest crash
      return { ...base, status: "malformed", detail: `line ${i + 1}: non-JSON where a record is required` };
    }
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
      if (i === lines.length - 1 && !lastHasNewline) { tornTail = true; break; }
      return { ...base, status: "malformed", detail: `line ${i + 1}: not a JSON object` };
    }
    parsed[i] = obj;
    if (Number.isInteger(obj.schema)) schemaFloor = schemaFloor === null ? obj.schema : Math.min(schemaFloor, obj.schema);
    if (obj.prev !== undefined) anyPrev = true;
    else anyPrevless = true;
  }
  base.schema_floor = schemaFloor;
  base.torn_tail = tornTail;
  const mm = witnessMismatches();
  if (witnessHead && !mm.length) base.witness = "match";

  // No record carries a `prev` at all → legacy schema-1 log (honest, never a broken
  // FAIL) — UNLESS a witness recorded a chained log (schema_floor ≥ 2 / a different
  // head): then "reads as legacy" is the downgrade spoof, a witness-mismatch FAIL,
  // never legacy-under-policy. A torn-only file (no parseable records) is
  // nothing-to-verify, not legacy.
  if (!anyPrev) {
    if (mm.length) return witnessMismatchResult(mm);
    if (schemaFloor === null) return { ...base, status: "verified", detail: "no parseable records (torn-only) — nothing to verify" };
    return { ...base, status: "legacy-unverifiable", detail: "legacy schema-1 log, no prev chain" };
  }

  // Walk: each schema-2 record's `prev` must equal genesis (line 1) / the previous
  // physical line's hash (line >1). A schema-1 line in a MIXED log carries no `prev`
  // — unverifiable-but-not-broken (skipped), still the prev-hash source for the next.
  for (let i = 0; i < lines.length; i++) {
    const rec = parsed[i];
    if (rec === null) continue;            // torn tail — walk already stopped (defensive)
    if (rec.prev === undefined) continue;  // schema-1 line inside a mixed log
    if (typeof rec.prev !== "string" || !HEX64_RE.test(rec.prev)) {
      return { ...base, status: "malformed", detail: `line ${i + 1}: prev is not 64 lowercase hex` };
    }
    const expected = i === 0
      ? sha256Hex(Buffer.from(String(rec.run_id), "utf8"))  // genesis: the record's OWN run_id
      : sha256Hex(lines[i - 1]);                            // the previous physical line's raw bytes
    if (rec.prev !== expected) {
      return {
        ...base, status: "broken",
        first_break: { seq: Number.isInteger(rec.seq) ? rec.seq : null, line: i + 1, expected, actual: rec.prev },
        detail: `chain broken at line ${i + 1}${Number.isInteger(rec.seq) ? ` (seq ${rec.seq})` : ""}: prev ${rec.prev.slice(0, 12)}… ≠ expected ${expected.slice(0, 12)}…`,
      };
    }
  }

  // Ledger fold: the LAST ledger-write's recorded ledger_sha256 vs the on-disk
  // run-ledger.json bytes. Absent (no ledger-write, or no ledger file) → not a
  // failure; present-but-mismatch → broken (an unrecorded ledger rewrite).
  let lastLw = null;
  for (let i = 0; i < lines.length; i++) { if (parsed[i] && parsed[i].type === "ledger-write") lastLw = parsed[i]; }
  const ledgerPath = path.join(dir, "run-ledger.json");
  if (lastLw && fs.existsSync(ledgerPath)) {
    const recorded = lastLw.data && typeof lastLw.data === "object" ? lastLw.data.ledger_sha256 : undefined;
    let onDisk;
    try { onDisk = sha256Hex(fs.readFileSync(ledgerPath)); }
    catch (e) { return { ...base, status: "malformed", detail: `run-ledger.json unreadable: ${e.message}` }; }
    if (recorded === onDisk) base.ledger_fold = "match";
    else return { ...base, status: "broken", ledger_fold: "mismatch",
      detail: `ledger fold mismatch: run-ledger.json hashes ${onDisk.slice(0, 12)}… but the last ledger-write recorded ${String(recorded).slice(0, 12)}…` };
  }

  // Walk clean — but a witness disagreement still fails: with a witness present a torn
  // tail is only tolerated when the verified log STILL matches the recorded
  // head_sha256/line_count (a genuinely-torn-at-anchor-time file re-hashes identically;
  // a post-anchor tamper-plus-newline-truncation does not).
  if (mm.length) return witnessMismatchResult(mm);

  // Both prev-carrying and prev-less records coexist → `mixed`, never a blanket
  // "verified": the chained records verified above, but the prev-less lines' CONTENTS
  // are unverifiable (only their raw bytes fed the next link). Gating is the caller's
  // legacy-policy call, like legacy-unverifiable.
  const tornDetail = tornTail
    ? (base.witness === "match"
      ? "chain verified up to a torn final line (witness-corroborated)"
      : "chain verified up to a torn final line — NO witness corroboration (heuristic torn-tail tolerance)")
    : null;
  if (anyPrevless) {
    return { ...base, status: "mixed",
      detail: `mixed chain: prev-carrying records verified, but prev-less (schema-1) lines are content-unverifiable${tornDetail ? `; ${tornDetail}` : ""}` };
  }
  return { ...base, status: "verified", detail: tornDetail || "chain verified from genesis" };
}

// Map a VerifyResult to the verb exit contract: 0 verified / legacy|mixed-under-pass|warn,
// 1 broken or witness-mismatch (or legacy|mixed under `fail`), 2 malformed.
function verifyExitCode(result, legacyPolicy) {
  if (result.status === "verified") return 0;
  if (result.status === "legacy-unverifiable" || result.status === "mixed") return legacyPolicy === "fail" ? 1 : 0;
  if (result.status === "broken" || result.status === "witness-mismatch") return 1;
  return 2; // malformed
}

// The compact ChainHead witness written into an anchor's chain-head.json. head_sha256
// is SHA-256 of the head (last) physical line's raw bytes — the value a subsequent
// record's `prev` would carry (FAFF-564 hashes a torn tail as-is, so a torn head hashes
// its partial bytes). head_seq is the last PARSEABLE record's seq (torn tail excluded).
function computeChainHead(eventsBuf, runId, issue) {
  const { lines } = splitPhysicalLines(eventsBuf);
  let headSeq = null, schemaFloor = null;
  for (let i = 0; i < lines.length; i++) {
    let obj;
    try { obj = JSON.parse(lines[i].toString("utf8")); } catch { continue; }
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      if (Number.isInteger(obj.schema)) schemaFloor = schemaFloor === null ? obj.schema : Math.min(schemaFloor, obj.schema);
      if (Number.isInteger(obj.seq)) headSeq = obj.seq; // last parseable seq wins
    }
  }
  return {
    run_id: runId,
    issue,
    head_seq: headSeq,
    head_sha256: lines.length ? sha256Hex(lines[lines.length - 1]) : null,
    line_count: lines.length,
    schema_floor: schemaFloor,
  };
}

function cmdEvents(args) {
  // FAFF-576: fail-closed flag gate — unknown flag / missing value exits 2 before any sub-verb work
  // (the append/read bodies below then read validated flags via the existing manual scan).
  const gate = parseArgs(args, EVENTS_SPEC);
  if (gate.errors.length) return usageError(gate.errors, "usage: faff events <append|validate|read|verify|anchor> [--run ID] [--file F] [--ts T] [--tokens] [--session-id ID] [--type T] [--issue ID] [--run-dir DIR] [--legacy-policy pass|warn|fail] [--dest DIR] [--json] [--root DIR]");
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
  // FAFF-591: an explicit --root is a strict escape hatch (no worktree fallback);
  // the default-from-findRoot() path may still resolve to the main checkout below.
  const rootExplicit = root !== null;
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
    // FAFF-591: from a linked build worktree, the run dir lives in the MAIN checkout's
    // .faff/runs/, not this cwd's — resolveRunDir falls back there (root-explicit only
    // ever uses the cwd-root path, unchanged).
    const dir = resolveRunDir(root, run, rootExplicit);
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
    // FAFF-564: a `ledger-write` note event's hash is CLI-COMPUTED from the on-disk
    // run-ledger.json bytes — any caller-supplied data.ledger_sha256 is overwritten
    // (an agent-computed hash is an untrusted claim in a trust artifact). Runs after
    // the --tokens block above so a tagged note hashes the post-checkpoint ledger.
    // No readable ledger ⇒ fail loud (exit 3): a ledger-write note records an on-disk
    // ledger; fabricating a hash for an absent file would be exactly the untrusted
    // claim this path exists to exclude.
    if (payload.type === "ledger-write") {
      let ledgerRaw;
      try { ledgerRaw = fs.readFileSync(path.join(dir, "run-ledger.json")); }
      catch {
        process.stderr.write(`faff events append: run-ledger.json missing/unreadable in ${path.join(".faff", "runs", run)} — a ledger-write note records an on-disk ledger\n`);
        return 3;
      }
      const base = { ...(data && typeof data === "object" && !Array.isArray(data) ? data : {}) };
      base.ledger_sha256 = sha256Hex(ledgerRaw);
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
    console.log("OK — run-event log valid.");
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

  // FAFF-568: `verify` — re-hash a run/anchor dir's events.jsonl chain (+ ledger fold).
  if (cmd === "verify") {
    let dirArg = null, legacyPolicy = "pass", jsonOut = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--run-dir") dirArg = args[i + 1];
      else if (args[i] === "--legacy-policy") legacyPolicy = args[i + 1];
      else if (args[i] === "--json") jsonOut = true;
    }
    if (!dirArg) { process.stderr.write("faff events verify: --run-dir <DIR> is required\n"); return 2; }
    if (!["pass", "warn", "fail"].includes(legacyPolicy)) {
      process.stderr.write(`faff events verify: --legacy-policy must be pass|warn|fail (got ${JSON.stringify(legacyPolicy)})\n`); return 2;
    }
    if (!fs.existsSync(dirArg) || !fs.statSync(dirArg).isDirectory()) {
      process.stderr.write(`faff events verify: --run-dir is not a directory: ${dirArg}\n`); return 2;
    }
    const result = verifyChain(dirArg, { legacyPolicy });
    if (jsonOut) console.log(JSON.stringify(result));
    else console.log(`events verify: ${result.status} — ${result.detail}${result.first_break ? ` [first break: line ${result.first_break.line}]` : ""}`);
    if (result.status === "legacy-unverifiable" && legacyPolicy === "warn") {
      process.stderr.write("faff events verify: legacy schema-1 log (no chain) — reported under --legacy-policy warn\n");
    }
    if (result.status === "mixed" && legacyPolicy === "warn") {
      process.stderr.write("faff events verify: mixed chain (prev-less lines content-unverifiable) — reported under --legacy-policy warn\n");
    }
    return verifyExitCode(result, legacyPolicy);
  }

  // FAFF-568: `anchor` — snapshot a run dir's chain evidence to an immutable, committable
  // per-PR anchor dir (events.jsonl + run-ledger.json byte-copies + a CLI-computed
  // chain-head.json). The head hash is computed here, never accepted from a caller.
  if (cmd === "anchor") {
    let dirArg = null, issueArg = null, destArg = null;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--run-dir") dirArg = args[i + 1];
      else if (args[i] === "--issue") issueArg = args[i + 1];
      else if (args[i] === "--dest") destArg = args[i + 1];
    }
    if (!dirArg || !issueArg || !destArg) {
      process.stderr.write("faff events anchor: --run-dir <DIR> --issue <X> --dest <D> are all required\n"); return 2;
    }
    if (!fs.existsSync(dirArg) || !fs.statSync(dirArg).isDirectory()) {
      process.stderr.write(`faff events anchor: --run-dir is not a directory: ${dirArg}\n`); return 2;
    }
    let eventsBuf;
    try { eventsBuf = fs.readFileSync(path.join(dirArg, "events.jsonl")); }
    catch { process.stderr.write(`faff events anchor: no events.jsonl in ${dirArg} — nothing to anchor\n`); return 3; }
    try { fs.mkdirSync(destArg, { recursive: true }); }
    catch (e) { process.stderr.write(`faff events anchor: cannot create dest ${destArg}: ${e.message}\n`); return 2; }
    fs.writeFileSync(path.join(destArg, "events.jsonl"), eventsBuf); // verbatim byte-copy
    const srcLedger = path.join(dirArg, "run-ledger.json");
    if (fs.existsSync(srcLedger)) fs.copyFileSync(srcLedger, path.join(destArg, "run-ledger.json"));
    const head = computeChainHead(eventsBuf, path.basename(dirArg), issueArg);
    fs.writeFileSync(path.join(destArg, "chain-head.json"), JSON.stringify(head, null, 2) + "\n");
    console.log(`events anchor: ${dirArg} → ${destArg} (head_seq ${head.head_seq}, head_sha256 ${head.head_sha256 ? head.head_sha256.slice(0, 12) + "…" : "null"}, ${head.line_count} lines, schema_floor ${head.schema_floor})`);
    return 0;
  }

  process.stderr.write("faff events: expected one of append | validate | read | verify | anchor (or --selftest)\n");
  return 2;
}

// In-memory self-test of the pure validator core (mirrors the `faff profile`/`fixtures` style).
function eventsSelftest() {
  const cases = [
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "run-start" }, 0, "valid run-start (envelope)"],
    [{ schema: 1, run_id: "r", seq: 1, ts: "t", phase: "build", type: "issue-outcome", issue: "FAFF-35", data: { outcome: "shipped" } }, 0, "valid issue-outcome"],
    [{ schema: 1, run_id: "r", seq: 1, ts: "t", phase: "build", type: "issue-outcome", issue: "FAFF-551", data: { outcome: "superseded" } }, 0, "FAFF-571: valid issue-outcome with 'superseded' outcome"],
    // FAFF-564 — the schema-2 chained envelope: schema 1 or 2 accepted; schema 2
    // requires 64-hex prev; schema 1 forbids prev; ledger-write requires
    // data.ledger_sha256 (envelope mode).
    [{ schema: 2, run_id: "r", seq: 0, ts: "t", prev: "a".repeat(64), phase: "run", type: "run-start" }, 0, "valid schema-2 record with prev"],
    [{ schema: 2, run_id: "r", seq: 0, ts: "t", phase: "run", type: "run-start" }, 1, "schema 2 missing prev rejected"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", prev: "a".repeat(64), phase: "run", type: "run-start" }, 1, "schema 1 carrying prev rejected"],
    [{ schema: 2, run_id: "r", seq: 0, ts: "t", prev: "A".repeat(64), phase: "run", type: "run-start" }, 1, "malformed prev (uppercase hex) rejected"],
    [{ schema: 2, run_id: "r", seq: 0, ts: "t", prev: "abc123", phase: "run", type: "run-start" }, 1, "malformed prev (short hex) rejected"],
    [{ schema: 3, run_id: "r", seq: 0, ts: "t", prev: "a".repeat(64), phase: "run", type: "run-start" }, 1, "schema 3 rejected"],
    [{ schema: 2, run_id: "r", seq: 0, ts: "t", prev: "a".repeat(64), phase: "run", type: "ledger-write", data: { ledger_sha256: "b".repeat(64) } }, 0, "valid ledger-write record"],
    [{ schema: 2, run_id: "r", seq: 0, ts: "t", prev: "a".repeat(64), phase: "run", type: "ledger-write" }, 1, "ledger-write missing ledger_sha256 rejected"],
    [{ schema: 2, run_id: "r", seq: 0, ts: "t", prev: "a".repeat(64), phase: "run", type: "ledger-write", data: { ledger_sha256: "nope" } }, 1, "ledger-write malformed ledger_sha256 rejected"],
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
  // FAFF-564: a payload-mode ledger-write note ({"phase":"run","type":"ledger-write"},
  // no data) must validate clean pre-injection — the hash is CLI-owned envelope work.
  const payloadNote = eventViolations({ phase: "run", type: "ledger-write" }, false).length === 0 ? 0 : 1;
  if (payloadNote !== 0) { process.stderr.write("events --selftest FAIL: payload-mode ledger-write with no data must validate clean (want 0, got 1)\n"); failed++; }
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
  // FAFF-568 — verify/anchor over real tmp fixtures: clean → verified; mid-line edit →
  // broken at the FOLLOWING line; torn tail → verified+torn_tail; schema-1 →
  // legacy-unverifiable; ledger-fold match/mismatch/absent; malformed mid-file → exit 2;
  // anchor round-trip verifies clean and head_sha256 == SHA-256(head line bytes).
  {
    const mkDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "faff-events-verify-"));
    const buildChain = (dir, runId, payloads, ledger) => {
      let prevBytes = null;
      const lines = [];
      payloads.forEach((p, i) => {
        const prev = prevBytes === null ? sha256Hex(Buffer.from(runId, "utf8")) : sha256Hex(prevBytes);
        const line = JSON.stringify({ schema: 2, run_id: runId, seq: i, ts: "t", prev, ...p });
        lines.push(line);
        prevBytes = Buffer.from(line, "utf8");
      });
      fs.writeFileSync(path.join(dir, "events.jsonl"), lines.join("\n") + "\n");
      if (ledger !== undefined) fs.writeFileSync(path.join(dir, "run-ledger.json"), ledger);
      return lines;
    };
    const vcheck = (label, cond) => { if (!cond) { process.stderr.write(`events --selftest FAIL: ${label}\n`); failed++; } };

    { // clean chain → verified, exit 0
      const d = mkDir();
      try {
        buildChain(d, "run-clean", [
          { phase: "run", type: "run-start" },
          { phase: "build", type: "build-start", issue: "FAFF-1" },
          { phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "shipped" } },
        ]);
        const r = verifyChain(d, {});
        vcheck("verify: clean chain → verified", r.status === "verified");
        vcheck("verify: clean chain → exit 0", verifyExitCode(r, "pass") === 0);
      } finally { fs.rmSync(d, { recursive: true, force: true }); }
    }
    { // mid-line edit → broken at the following line
      const d = mkDir();
      try {
        buildChain(d, "run-broke", [
          { phase: "run", type: "run-start" },
          { phase: "build", type: "build-start", issue: "FAFF-1" },
          { phase: "build", type: "build-start", issue: "FAFF-2" },
          { phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "shipped" } },
        ]);
        const p = path.join(d, "events.jsonl");
        const ls = fs.readFileSync(p, "utf8").split("\n");
        ls[2] = ls[2].replace('"FAFF-2"', '"FAFF-9"'); // equal-length in-place byte edit of line 3
        fs.writeFileSync(p, ls.join("\n"));
        const r = verifyChain(d, {});
        vcheck("verify: mid-line edit → broken", r.status === "broken");
        vcheck("verify: mid-line edit → first_break names the FOLLOWING line (4)", r.first_break && r.first_break.line === 4);
        vcheck("verify: mid-line edit → exit 1", verifyExitCode(r, "pass") === 1);
      } finally { fs.rmSync(d, { recursive: true, force: true }); }
    }
    { // torn tail → verified + torn_tail
      const d = mkDir();
      try {
        buildChain(d, "run-torn", [
          { phase: "run", type: "run-start" },
          { phase: "build", type: "build-start", issue: "FAFF-1" },
        ]);
        fs.appendFileSync(path.join(d, "events.jsonl"), '{"schema":2,"run_id":"run-torn","seq":2,"ts":"t","prev":"' + "a".repeat(64) + '","phase":"build","typ');
        const r = verifyChain(d, {});
        vcheck("verify: torn tail → verified", r.status === "verified");
        vcheck("verify: torn tail → torn_tail true", r.torn_tail === true);
        vcheck("verify: torn tail → exit 0", verifyExitCode(r, "pass") === 0);
      } finally { fs.rmSync(d, { recursive: true, force: true }); }
    }
    { // schema-1 → legacy-unverifiable (policy-graded exit)
      const d = mkDir();
      try {
        fs.writeFileSync(path.join(d, "events.jsonl"),
          JSON.stringify({ schema: 1, run_id: "run-legacy", seq: 0, ts: "t", phase: "run", type: "run-start" }) + "\n" +
          JSON.stringify({ schema: 1, run_id: "run-legacy", seq: 1, ts: "t", phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "shipped" } }) + "\n");
        const r = verifyChain(d, {});
        vcheck("verify: schema-1 → legacy-unverifiable", r.status === "legacy-unverifiable");
        vcheck("verify: schema-1 under pass → exit 0", verifyExitCode(r, "pass") === 0);
        vcheck("verify: schema-1 under fail → exit 1", verifyExitCode(r, "fail") === 1);
      } finally { fs.rmSync(d, { recursive: true, force: true }); }
    }
    { // ledger fold match / mismatch
      const d = mkDir();
      try {
        const ledger = JSON.stringify({ run_id: "run-fold", admitted: [], outcomes: {} }, null, 2) + "\n";
        const ledgerSha = sha256Hex(Buffer.from(ledger, "utf8"));
        buildChain(d, "run-fold", [
          { phase: "run", type: "run-start" },
          { phase: "run", type: "ledger-write", data: { ledger_sha256: ledgerSha } },
        ], ledger);
        const r = verifyChain(d, {});
        vcheck("verify: ledger fold match → verified", r.status === "verified" && r.ledger_fold === "match");
        fs.writeFileSync(path.join(d, "run-ledger.json"), ledger + " "); // silent post-hoc ledger rewrite
        const r2 = verifyChain(d, {});
        vcheck("verify: ledger fold mismatch → broken", r2.status === "broken" && r2.ledger_fold === "mismatch");
        vcheck("verify: ledger fold mismatch → exit 1", verifyExitCode(r2, "pass") === 1);
      } finally { fs.rmSync(d, { recursive: true, force: true }); }
    }
    { // ledger fold absent (no ledger-write) → not a failure
      const d = mkDir();
      try {
        buildChain(d, "run-nofold", [{ phase: "run", type: "run-start" }]);
        const r = verifyChain(d, {});
        vcheck("verify: no ledger-write → ledger_fold absent, verified", r.status === "verified" && r.ledger_fold === "absent");
      } finally { fs.rmSync(d, { recursive: true, force: true }); }
    }
    { // malformed mid-file line → exit 2
      const d = mkDir();
      try {
        buildChain(d, "run-malformed", [
          { phase: "run", type: "run-start" },
          { phase: "build", type: "build-start", issue: "FAFF-1" },
        ]);
        const p = path.join(d, "events.jsonl");
        const ls = fs.readFileSync(p, "utf8").split("\n");
        ls[0] = "{ not json";
        fs.writeFileSync(p, ls.join("\n"));
        const r = verifyChain(d, {});
        vcheck("verify: malformed mid-file line → malformed", r.status === "malformed");
        vcheck("verify: malformed mid-file line → exit 2", verifyExitCode(r, "pass") === 2);
      } finally { fs.rmSync(d, { recursive: true, force: true }); }
    }
    { // FAFF-568 fix pass: witness cross-check — the schema-downgrade spoof is caught
      const d = mkDir();
      try {
        buildChain(d, "run-spoof", [
          { phase: "run", type: "run-start" },
          { phase: "build", type: "build-start", issue: "FAFF-1" },
        ]);
        const ep = path.join(d, "events.jsonl");
        fs.writeFileSync(path.join(d, "chain-head.json"),
          JSON.stringify(computeChainHead(fs.readFileSync(ep), "run-spoof", "FAFF-1"), null, 2) + "\n");
        vcheck("verify: honest log against its witness → witness match, verified", (() => { const r = verifyChain(d, {}); return r.status === "verified" && r.witness === "match"; })());
        // Strip every prev + downgrade schema — the "tampered chain reads as legacy" spoof.
        const recs = fs.readFileSync(ep, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
        fs.writeFileSync(ep, recs.map((r) => { const { prev, ...rest } = r; return JSON.stringify({ ...rest, schema: 1 }); }).join("\n") + "\n");
        const r = verifyChain(d, {});
        vcheck("verify: legacy-downgrade spoof → witness-mismatch, never legacy", r.status === "witness-mismatch");
        vcheck("verify: witness-mismatch → exit 1 even under legacy-policy pass", verifyExitCode(r, "pass") === 1);
      } finally { fs.rmSync(d, { recursive: true, force: true }); }
    }
    { // FAFF-568 fix pass: forged torn tail (tamper + newline truncation) caught by the witness
      const d = mkDir();
      try {
        buildChain(d, "run-forge", [
          { phase: "run", type: "run-start" },
          { phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "shipped" } },
        ]);
        const ep = path.join(d, "events.jsonl");
        fs.writeFileSync(path.join(d, "chain-head.json"),
          JSON.stringify(computeChainHead(fs.readFileSync(ep), "run-forge", "FAFF-1"), null, 2) + "\n");
        // Tamper the last record and truncate its trailing newline — reads as an
        // "honest crash" to the heuristic, but the witness head no longer matches.
        const raw = fs.readFileSync(ep, "utf8").replace(/\n$/, "");
        fs.writeFileSync(ep, raw.slice(0, -5)); // chop the tail — unparseable, no newline
        const r = verifyChain(d, {});
        vcheck("verify: forged torn tail with witness → witness-mismatch", r.status === "witness-mismatch");
        vcheck("verify: forged torn tail → exit 1", verifyExitCode(r, "pass") === 1);
      } finally { fs.rmSync(d, { recursive: true, force: true }); }
    }
    { // FAFF-568 fix pass: prev-carrying + prev-less coexisting → mixed, policy-gated
      const d = mkDir();
      try {
        const legacy = JSON.stringify({ schema: 1, run_id: "run-mixed", seq: 0, ts: "t", phase: "run", type: "run-start" });
        const chained = JSON.stringify({ schema: 2, run_id: "run-mixed", seq: 1, ts: "t", prev: sha256Hex(Buffer.from(legacy, "utf8")), phase: "build", type: "build-start", issue: "FAFF-1" });
        fs.writeFileSync(path.join(d, "events.jsonl"), legacy + "\n" + chained + "\n");
        const r = verifyChain(d, {});
        vcheck("verify: mixed log → status mixed, never a blanket verified", r.status === "mixed");
        vcheck("verify: mixed under pass → exit 0", verifyExitCode(r, "pass") === 0);
        vcheck("verify: mixed under fail → exit 1", verifyExitCode(r, "fail") === 1);
      } finally { fs.rmSync(d, { recursive: true, force: true }); }
    }
    { // anchor round-trip
      const src = mkDir(), dest = mkDir();
      try {
        const ledger = JSON.stringify({ run_id: "run-anchor", admitted: [], outcomes: {} }, null, 2) + "\n";
        const ledgerSha = sha256Hex(Buffer.from(ledger, "utf8"));
        const lines = buildChain(src, "run-anchor", [
          { phase: "run", type: "run-start" },
          { phase: "build", type: "build-start", issue: "FAFF-1" },
          { phase: "run", type: "ledger-write", data: { ledger_sha256: ledgerSha } },
        ], ledger);
        const rc = cmdEvents(["anchor", "--run-dir", src, "--issue", "FAFF-1", "--dest", dest]);
        vcheck("anchor: exit 0", rc === 0);
        const r = verifyChain(dest, {});
        vcheck("anchor: round-trip verifies clean", r.status === "verified" && r.ledger_fold === "match");
        const head = JSON.parse(fs.readFileSync(path.join(dest, "chain-head.json"), "utf8"));
        vcheck("anchor: head_sha256 == SHA-256(head line bytes)", head.head_sha256 === sha256Hex(Buffer.from(lines[lines.length - 1], "utf8")));
        vcheck("anchor: line_count matches", head.line_count === lines.length);
        vcheck("anchor: issue recorded", head.issue === "FAFF-1");
        vcheck("anchor: run_id is the run-dir basename", head.run_id === path.basename(src));
      } finally { fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(dest, { recursive: true, force: true }); }
    }
  }

  if (failed) return 1;
  console.log("events --selftest: ok");
  return 0;
}


module.exports = { EFFORT_LEVELS, EVENT_ISSUE_SCOPED, EVENT_LEDGER_OUTCOMES, EVENT_PHASES, EVENT_TYPES, QUALITY_GATE_CATCHES, TAIL_WINDOW_BYTES, appendEventRecord, appendRecordUnderLock, cmdEvents, computeChainHead, eventLineCount, eventViolations, eventsSelftest, seqFinding, sha256Hex, splitPhysicalLines, tailReadNextSeq, tailReadState, verifyChain, verifyExitCode };
