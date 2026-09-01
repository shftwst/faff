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
const { parseArgs, requireFlags, usageError } = require("./argv");
const { spawnSync } = require("node:child_process");
const EVENTS_SPEC = { flags: {
  "--selftest": { arity: 0 }, "--tokens": { arity: 0 }, "--json": { arity: 0 },
  "--root": { arity: 1 }, "--run": { arity: 1 }, "--ts": { arity: 1 }, "--file": { arity: 1 },
  "--session-id": { arity: 1 }, "--type": { arity: 1 }, "--issue": { arity: 1 },
  // FAFF-568: verify/anchor sub-verb flags (re-hash + snapshot the chain).
  "--run-dir": { arity: 1 }, "--legacy-policy": { arity: 1 }, "--dest": { arity: 1 },
}, positionals: { min: 0, max: null, name: "verb" } };
// FAFF-628 — declared grammar for `faff cli-surface --json` + the drift-guard's flag-layer
// assertions. `validate` takes only a positional file path (spec §2 OUT OF SCOPE: value-level
// checks, not this ticket), so it declares no required flags.
const EVENTS_SURFACE = {
  kind: "subcommand_dispatch",
  spec: EVENTS_SPEC,
  subcommands: {
    append: { required_flags: ["--run"] },
    validate: { required_flags: [] },
    read: { required_flags: ["--run"] },
    verify: { required_flags: ["--run-dir"] },
    anchor: { required_flags: ["--run-dir", "--issue", "--dest"] },
    "anchor-run": { required_flags: ["--run-dir"] },
  },
};
const { TOKEN_DELTA_CLASSES, measureTokensByClass } = require("./budget");
const { activeProfile, DELIVERY_PROFILE } = require("./governance-profile");
const { mutateLedgerUnderLock } = require("./heartbeat");
const { withFileLock } = require("./fs-lock");
// FAFF-107: exact known-secret redaction at the durable-write boundary — governance→
// governance edge (redact.js requires only budget.js + shared-infra), legal under
// ADR-0042. See appendEventRecord below for the wiring.
const { resolveKnownSecretValues, redactKnownSecrets, redactSelftest } = require("./redact");
const { ENTRYPOINT, findRoot, resolveRunDir } = require("./shared-infra");

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

// FAFF-700: the closed vocabulary an `agent-dispatch` event's data.kind must be a
// member of — WHAT KIND of subagent cluster this fan-out claims (mirrors the
// producer/build/reader/verify split the audit's own dispatch sites use).
const DISPATCH_KINDS = new Set(["producer", "build", "reader", "verify"]);

// FAFF-700: the closed, ENUMERATED top-level `data.*` field set an `agent-dispatch`
// event may carry — the four dispatch-claim fields plus the pre-existing global-
// optional telemetry tags (tokens/tokens_source/effort/gate/rework_turns). This is a
// NEW kind of check (no other event type scans its top-level `data` keys — the
// data.tokens "unexpected field(s)" reject a few lines down is a NESTED sub-key scan
// inside data.tokens, not a top-level one): without it a stray data.prompt /
// data.transcript would pass clean, which is exactly the non-leak invariant this
// event exists to hold (the dispatch claim carries counts and ids only, never a
// child's prompt/response payload).
const DISPATCH_ALLOWED_DATA_KEYS = new Set([
  "kind", "dispatch_id", "cluster_id", "cluster_size",
  "tokens", "tokens_source", "effort", "gate", "rework_turns",
]);

// FAFF-564: the chain-hash shape — 64 lowercase hex chars (SHA-256). Shared by the
// `prev` envelope check, the `ledger-write` data.ledger_sha256 check, and (FAFF-821)
// decision-capture's `causation.sha256` check — exported so decision-capture.js's own
// delegating validator reuses this exact regex rather than a second copy.
const HEX64_RE = /^[0-9a-f]{64}$/;

// FAFF-821: the DecisionCapture record's closed coverage-class vocabulary (spec §3).
const DECISION_CAPTURE_COVERAGE_VALUES = new Set(["replayable", "non-replayable", "uncovered"]);

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
  // FAFF-700: agent-dispatch — the dispatch-CLAIM event, one per subagent-cluster
  // fan-out, emitted before the children run. Mirrors the data.effort / data.gate
  // closed-vocab checks above for the four required fields, PLUS a NEW top-level
  // data.* allow-set scan (non-leak: counts/ids only, never a prompt/response
  // payload — see DISPATCH_ALLOWED_DATA_KEYS above).
  if (obj.type === "agent-dispatch") {
    const d = obj.data && typeof obj.data === "object" && !Array.isArray(obj.data) ? obj.data : {};
    const kind = d.kind;
    if (typeof kind !== "string" || !DISPATCH_KINDS.has(kind)) {
      v.push(`data.kind ${JSON.stringify(kind)} not in DispatchKind {${[...DISPATCH_KINDS].join(", ")}}`);
    }
    if (typeof d.dispatch_id !== "string" || d.dispatch_id === "") {
      v.push("data.dispatch_id must be a non-empty string");
    }
    if (typeof d.cluster_id !== "string" || d.cluster_id === "") {
      v.push("data.cluster_id must be a non-empty string");
    }
    if (!Number.isInteger(d.cluster_size) || d.cluster_size < 1) {
      v.push(`data.cluster_size must be an integer >= 1 (got ${JSON.stringify(d.cluster_size)})`);
    }
    const extraTop = Object.keys(d).filter((k) => !DISPATCH_ALLOWED_DATA_KEYS.has(k));
    if (extraTop.length) {
      v.push(`agent-dispatch data has unexpected field(s) {${extraTop.join(", ")}} — allowed {${[...DISPATCH_ALLOWED_DATA_KEYS].join(", ")}}`);
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
  // FAFF-821: decision-capture — the DecisionCapture record shape (spec §3). Mirrors the
  // agent-dispatch block above: a structured, closed-vocab `data.*` payload, checked at
  // the same point. Deliberately DUPLICATED (not required) from decision-capture.js's own
  // `decisionCaptureViolations` — decision-capture.js already requires this module for
  // appendEventRecord (factory→governance is a legal require edge, ADR-0042), and
  // governance must never require factory back, so a require edge the other way is not
  // available. The two copies share the same RULES, kept in sync by hand; see the mirror
  // comment on decisionCaptureViolations in decision-capture.js.
  if (obj.type === "decision-capture") {
    const d = obj.data && typeof obj.data === "object" && !Array.isArray(obj.data) ? obj.data : {};
    if (typeof d.kernel !== "string" || d.kernel === "") {
      v.push("data.kernel must be a non-empty string");
    }
    if (typeof d.kernel_version !== "string") {
      v.push("data.kernel_version must be a string");
    }
    if (!DECISION_CAPTURE_COVERAGE_VALUES.has(d.coverage)) {
      v.push(`data.coverage ${JSON.stringify(d.coverage)} not in {${[...DECISION_CAPTURE_COVERAGE_VALUES].join(", ")}}`);
    }
    if (d.normalised_inputs === null || typeof d.normalised_inputs !== "object" || Array.isArray(d.normalised_inputs)) {
      v.push("data.normalised_inputs must be a plain object");
    }
    const actionOk = typeof d.selected_action === "string"
      || (d.selected_action !== null && typeof d.selected_action === "object" && !Array.isArray(d.selected_action));
    if (!actionOk) {
      v.push("data.selected_action must be an object or a string");
    }
    if (!Array.isArray(d.missing_inputs) || !d.missing_inputs.every((x) => typeof x === "string")) {
      v.push("data.missing_inputs must be an array of strings");
    } else if (d.coverage === "non-replayable" && d.missing_inputs.length === 0) {
      v.push("data.missing_inputs must be non-empty when coverage is non-replayable");
    } else if (d.coverage !== "non-replayable" && d.missing_inputs.length > 0) {
      v.push(`data.missing_inputs must be empty when coverage is ${JSON.stringify(d.coverage)}`);
    }
    const c = d.causation;
    if (c === null || typeof c !== "object" || Array.isArray(c)) {
      v.push("data.causation must be an object {seq, sha256}");
    } else {
      if (!Number.isInteger(c.seq)) v.push("data.causation.seq must be an integer");
      if (typeof c.sha256 !== "string" || !HEX64_RE.test(c.sha256)) v.push("data.causation.sha256 must be 64 lowercase hex chars (SHA-256)");
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
// FAFF-621: the events lock descriptor + ledger filename, hoisted so the N=1 shim below
// drives the same generalised core the effects ledger uses (with its own descriptor).
const EVENTS_CFG = { ledgerFile: "events.jsonl", lock: { code: "EVENTS_LOCKED", label: "events lock" } };

// FAFF-621: the BATCH-capable generalisation of the single-record mint core. Mints an
// array of N records under ONE lock acquisition — one tail read, contiguous seqs
// s..s+N-1, each `prev` threaded in sequence (the first from the tail's last physical
// line, each subsequent from the exact serialised bytes of the line just minted in this
// batch). This is what lets `appendEffectEntries` land N effect descriptors as one atomic,
// gap-free run with no honest interleave: one batch = one lock = one contiguous seq run,
// so ONLY tampering (never legitimate concurrent traffic) can break the chain.
//   dir        — run dir absolute path (genesis hashes basename(dir))
//   cfg        — { ledgerFile, lock: { code, label } }  (events or declared-effects)
//   mintCount  — N (>= 1)
//   mintOne(index, seq, prevRecord, prevHash) -> record | null
//                called N times under the ONE lock; index 0..N-1, seq threaded s..s+N-1,
//                prevHash/prevRecord threaded. Returning null from ANY call aborts the
//                WHOLE batch, writing nothing.
// Returns the array of N minted records, or null if aborted. The within-batch next-`prev`
// hashes `JSON.stringify(rec)`'s UTF-8 bytes — byte-identical to the physical line appended
// — so the verifier re-hashing physical lines re-derives exactly these values. The
// torn-tail "\n" repair is applied ONCE at batch head only (the records inside the batch are
// newline-joined by this same writer, so no torn tail exists between them).
function appendRecordsUnderLock(dir, cfg, mintCount, mintOne) {
  const ledgerPath = path.join(dir, cfg.ledgerFile);
  const lockPath = ledgerPath + ".lock";
  return withFileLock(lockPath, () => {
    const { seq, prevRecord, prevLineBuf } = tailReadState(ledgerPath); // ONE tail read
    let curPrevRecord = prevRecord;
    let prevHash = sha256Hex(prevLineBuf === null ? Buffer.from(path.basename(dir), "utf8") : prevLineBuf);
    const minted = [];
    for (let index = 0; index < mintCount; index++) {
      const record = mintOne(index, seq + index, curPrevRecord, prevHash);
      if (record === null || record === undefined) return null; // abort the WHOLE batch — nothing written
      if (record.seq !== seq + index || record.prev !== prevHash) {
        throw new Error(`append core: minted record must carry the supplied seq/prev (want seq ${seq + index} prev ${prevHash}, got seq ${record.seq} prev ${record.prev})`);
      }
      minted.push(record);
      curPrevRecord = record;
      prevHash = sha256Hex(Buffer.from(JSON.stringify(record), "utf8")); // next link = THIS serialised line's bytes
    }
    if (minted.length === 0) return minted; // empty batch — never append a stray newline
    let prefix = "";
    try {
      const st = fs.statSync(ledgerPath);
      if (st.size > 0) {
        const fd = fs.openSync(ledgerPath, "r");
        const last = Buffer.alloc(1);
        try { fs.readSync(fd, last, 0, 1, st.size - 1); }
        finally { fs.closeSync(fd); }
        if (last[0] !== 0x0a) prefix = "\n"; // torn write from a crashed holder — don't concatenate
      }
    } catch (e) { if (!e || e.code !== "ENOENT") throw e; }
    fs.appendFileSync(ledgerPath, prefix + minted.map((r) => JSON.stringify(r)).join("\n") + "\n"); // ONE atomic append
    return minted;
  }, cfg.lock);
}

// FAFF-574/621: the single-record shim — RETAINED byte-unchanged in signature + semantics
// over the batch core, so `appendEventRecord`, corrective.js's mint, and both lights-out
// mints need zero edits. A null mintRecord return aborts (batch of 1 → null) and writes
// nothing — today's abort path, preserved. GUARD the unwrap: a batch-of-1 abort returns
// null, never [null].
function appendRecordUnderLock(dir, mintRecord) {
  const r = appendRecordsUnderLock(dir, EVENTS_CFG, 1, (index, seq, prevRecord, prevHash) => mintRecord(seq, prevRecord, prevHash));
  return r === null ? null : r[0];
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
// FAFF-107: redact known secret values out of the caller-controlled payload
// BEFORE the record is constructed/serialized — the by-construction guarantee
// every event writer (this core's sole entry point) inherits without having
// to remember it. Scoped to nested `data` string leaves only: structural
// `phase`/`type`/`issue` (caller-supplied) and the CLI-minted envelope
// (`schema`/`run_id`/`seq`/`ts`/`prev`) are never passed through the
// redactor, so a known secret that happens to collide with a protocol token
// (e.g. equal to "run-start") can never corrupt the event schema or the
// chain hash. `resolveKnownSecretValues()` resolves fresh each call — a
// malformed base config fails loud (never silently caught here), matching
// the existing governance config-read contract (readGovernanceConfig).
function appendEventRecord(dir, run, payload, ts) {
  const redactedData = payload.data !== undefined
    ? redactKnownSecrets(payload.data, resolveKnownSecretValues())
    : undefined;
  return appendRecordUnderLock(dir, (seq, _prevRecord, prevHash) => {
    const record = { schema: 2, run_id: run, seq, ts: ts || new Date().toISOString(), prev: prevHash, phase: payload.phase, type: payload.type };
    if (payload.issue !== undefined) record.issue = payload.issue;
    if (redactedData !== undefined) record.data = redactedData;
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

// FAFF-621: the PURE physical-chain walk, extracted out of verifyChain so BOTH ledgers'
// verifiers compose the ONE genesis/prev-hash rule — never a second home for it. Splits
// the buffer into physical lines, runs the parse pass (record / honest torn tail / mid-file
// malformed), and walks the genesis/prev chain, classifying the walk-only status. It knows
// NOTHING about witnesses (chain-head.json) or the events run-ledger fold — those the caller
// (verifyLedgerChain) layers on. Returns the primitives:
//   { status, line_count, head_sha256, schema_floor, first_break, torn_tail,
//     any_prev, any_prevless, records, detail }
// status ∈ verified | broken | legacy-unverifiable | mixed | malformed (walk-only —
// `verified`/`mixed` may still take a witness/torn-corroboration suffix the caller composes,
// so their `detail` is left null here). `records` is the per-line parsed array (null on a
// torn/unparseable line) the events run-ledger fold consumes.
function walkPhysicalChain(buf) {
  const out = {
    status: null, line_count: 0, head_sha256: null, schema_floor: null,
    first_break: null, torn_tail: false, any_prev: false, any_prevless: false,
    records: [], detail: null,
  };
  const { lines, lastHasNewline } = splitPhysicalLines(buf);
  out.line_count = lines.length;
  if (lines.length === 0) { out.status = "verified"; return out; } // empty — caller names the file
  out.head_sha256 = sha256Hex(lines[lines.length - 1]);

  // Parse pass: record per line (or null), separating an honest torn tail (the final
  // no-newline segment) from a mid-file non-record (which is malformed, exit 2).
  const parsed = new Array(lines.length).fill(null);
  out.records = parsed;
  let tornTail = false, schemaFloor = null, anyPrev = false, anyPrevless = false;
  for (let i = 0; i < lines.length; i++) {
    let obj;
    try { obj = JSON.parse(lines[i].toString("utf8")); }
    catch {
      if (i === lines.length - 1 && !lastHasNewline) { tornTail = true; break; } // honest crash
      out.status = "malformed"; out.detail = `line ${i + 1}: non-JSON where a record is required`; return out;
    }
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
      if (i === lines.length - 1 && !lastHasNewline) { tornTail = true; break; }
      out.status = "malformed"; out.detail = `line ${i + 1}: not a JSON object`; return out;
    }
    parsed[i] = obj;
    if (Number.isInteger(obj.schema)) schemaFloor = schemaFloor === null ? obj.schema : Math.min(schemaFloor, obj.schema);
    if (obj.prev !== undefined) anyPrev = true;
    else anyPrevless = true;
  }
  out.schema_floor = schemaFloor;
  out.torn_tail = tornTail;
  out.any_prev = anyPrev;
  out.any_prevless = anyPrevless;

  // No record carries a `prev` at all → legacy schema-1 log (honest) or a torn-only file
  // (nothing to verify). The witness-downgrade-spoof precedence is the caller's.
  if (!anyPrev) {
    if (schemaFloor === null) { out.status = "verified"; out.detail = "no parseable records (torn-only) — nothing to verify"; return out; }
    out.status = "legacy-unverifiable"; out.detail = "legacy schema-1 log, no prev chain"; return out;
  }

  // Walk: each schema-2 record's `prev` must equal genesis (line 1) / the previous physical
  // line's hash (line >1). A schema-1 line in a MIXED log carries no `prev` — skipped, still
  // the prev-hash source for the next.
  for (let i = 0; i < lines.length; i++) {
    const rec = parsed[i];
    if (rec === null) continue;            // torn tail — walk already stopped (defensive)
    if (rec.prev === undefined) continue;  // schema-1 line inside a mixed log
    if (typeof rec.prev !== "string" || !HEX64_RE.test(rec.prev)) {
      out.status = "malformed"; out.detail = `line ${i + 1}: prev is not 64 lowercase hex`; return out;
    }
    const expected = i === 0
      ? sha256Hex(Buffer.from(String(rec.run_id), "utf8"))  // genesis: the record's OWN run_id
      : sha256Hex(lines[i - 1]);                            // the previous physical line's raw bytes
    if (rec.prev !== expected) {
      out.status = "broken";
      out.first_break = { seq: Number.isInteger(rec.seq) ? rec.seq : null, line: i + 1, expected, actual: rec.prev };
      out.detail = `chain broken at line ${i + 1}${Number.isInteger(rec.seq) ? ` (seq ${rec.seq})` : ""}: prev ${rec.prev.slice(0, 12)}… ≠ expected ${expected.slice(0, 12)}…`;
      return out;
    }
  }

  // Walk clean — verified (all prev-carrying) or mixed (prev-carrying + prev-less coexist).
  // The witness/torn-corroborated terminal detail is the caller's to compose.
  out.status = anyPrevless ? "mixed" : "verified";
  return out;
}

// FAFF-621: the events-only run-ledger fold — the LAST ledger-write's recorded ledger_sha256
// vs the on-disk run-ledger.json bytes. Absent → not a failure; present-but-mismatch →
// broken (an unrecorded ledger rewrite). Sets base.ledger_fold = "match" on a match. Returns
// a result to RETURN (malformed/broken) or null to continue. The effects ledger has no
// run-ledger, so verifyEffectsChain passes no fold.
function eventsLedgerFold(dir, records, base) {
  let lastLw = null;
  for (let i = 0; i < records.length; i++) { if (records[i] && records[i].type === "ledger-write") lastLw = records[i]; }
  const ledgerPath = path.join(dir, "run-ledger.json");
  if (lastLw && fs.existsSync(ledgerPath)) {
    const recorded = lastLw.data && typeof lastLw.data === "object" ? lastLw.data.ledger_sha256 : undefined;
    let onDisk;
    try { onDisk = sha256Hex(fs.readFileSync(ledgerPath)); }
    catch (e) { return { ...base, status: "malformed", detail: `run-ledger.json unreadable: ${e.message}` }; }
    if (recorded === onDisk) { base.ledger_fold = "match"; return null; }
    return { ...base, status: "broken", ledger_fold: "mismatch",
      detail: `ledger fold mismatch: run-ledger.json hashes ${onDisk.slice(0, 12)}… but the last ledger-write recorded ${String(recorded).slice(0, 12)}…` };
  }
  return null;
}

// FAFF-621: the shared verifier body — composes walkPhysicalChain with the witness
// cross-check (chain-head.json / effects-chain-head.json) and, for events only, the
// run-ledger fold. Both ledgers' verifiers are thin wrappers over this, so the genesis/prev
// rule, the witness precedence, and the classification are single-homed. Returns the
// VerifyResult shape; never throws on a chain problem (only genuine unreadability surfaces
// via status "malformed"). Classification is policy-free — `legacy_policy` only affects the
// exit-code mapping (see `verifyExitCode`).
//
// FAFF-568: the witness (chain-head.json / effects-chain-head.json) is CROSS-CHECKED, never
// decorative. Anchored at anchor time by the CLI (head hash never caller-supplied) and pinned
// by the PR head sha merge-gate observes, it is the independent record a post-anchor rewrite
// cannot retrofit: stripping `prev` fields to spoof legacy-unverifiable changes schema_floor;
// tampering the last record + truncating its newline changes head_sha256/line_count. Any
// disagreement is `witness-mismatch` — a gating FAIL no legacy-policy softens. A dir with no
// witness → witness "absent", behaviour unchanged. An unparseable witness is a corrupt
// committed artifact → malformed (fail-closed).
function verifyLedgerChain(dir, { ledgerFile, witnessFile, ledgerFold }) {
  const ledgerPath = path.join(dir, ledgerFile);
  const base = { schema_floor: null, line_count: 0, head_sha256: null, first_break: null, ledger_fold: "absent", torn_tail: false, witness: "absent" };

  let witnessHead = null;
  const witnessPath = path.join(dir, witnessFile);
  if (fs.existsSync(witnessPath)) {
    try { witnessHead = JSON.parse(fs.readFileSync(witnessPath, "utf8")); }
    catch (e) { return { ...base, status: "malformed", detail: `${witnessFile} unreadable/invalid JSON: ${e.message}` }; }
    if (witnessHead === null || typeof witnessHead !== "object" || Array.isArray(witnessHead)) {
      return { ...base, status: "malformed", detail: `${witnessFile} is not a JSON object` };
    }
  }
  // Compare only the fields the witness actually records (older witnesses may lack one).
  const witnessMismatches = () => {
    if (!witnessHead) return [];
    const mmOut = [];
    if (typeof witnessHead.head_sha256 === "string" && witnessHead.head_sha256 !== base.head_sha256) {
      mmOut.push(`head_sha256 (witness ${witnessHead.head_sha256.slice(0, 12)}… ≠ derived ${String(base.head_sha256).slice(0, 12)}…)`);
    }
    if (Number.isInteger(witnessHead.line_count) && witnessHead.line_count !== base.line_count) {
      mmOut.push(`line_count (witness ${witnessHead.line_count} ≠ derived ${base.line_count})`);
    }
    if (Number.isInteger(witnessHead.schema_floor) && witnessHead.schema_floor !== base.schema_floor) {
      mmOut.push(`schema_floor (witness ${witnessHead.schema_floor} ≠ derived ${base.schema_floor})`);
    }
    return mmOut;
  };
  const witnessMismatchResult = (mm) => ({
    ...base, witness: "mismatch", status: "witness-mismatch",
    detail: `${witnessFile} witness disagrees with the on-disk log: ${mm.join("; ")}`,
  });

  let buf;
  try { buf = fs.readFileSync(ledgerPath); }
  catch (e) {
    if (e && e.code === "ENOENT") {
      if (witnessHead) { const mm = witnessMismatches(); if (mm.length) return witnessMismatchResult(mm); }
      return { ...base, status: "verified", detail: `${ledgerFile} absent — nothing to verify` };
    }
    return { ...base, status: "malformed", detail: `${ledgerFile} unreadable: ${e.message}` };
  }

  const walk = walkPhysicalChain(buf);
  base.line_count = walk.line_count;
  base.head_sha256 = walk.head_sha256;
  base.schema_floor = walk.schema_floor;
  base.torn_tail = walk.torn_tail;

  if (walk.line_count === 0) {
    if (witnessHead) { const mm = witnessMismatches(); if (mm.length) return witnessMismatchResult(mm); }
    return { ...base, status: "verified", detail: `empty ${ledgerFile} — nothing to verify` };
  }
  // malformed takes precedence over the witness cross-check (a corrupt log is not softened).
  if (walk.status === "malformed") return { ...base, status: "malformed", detail: walk.detail };

  const mm = witnessMismatches();
  if (witnessHead && !mm.length) base.witness = "match";

  // broken takes precedence over witness-mismatch (keep the more specific forensics).
  if (walk.status === "broken") return { ...base, status: "broken", first_break: walk.first_break, detail: walk.detail };

  // No `prev` at all → legacy / torn-only, unless a witness recorded a chained log (spoof).
  if (!walk.any_prev) {
    if (mm.length) return witnessMismatchResult(mm);
    return { ...base, status: walk.status, detail: walk.detail };
  }

  // Clean prev-walk (verified | mixed). Events layers its run-ledger fold here; a fold
  // mismatch is broken.
  if (ledgerFold) {
    const folded = ledgerFold(dir, walk.records, base);
    if (folded) return folded;
  }
  // Walk clean — but a witness disagreement still fails (a post-anchor tamper-plus-newline
  // truncation does not re-hash to the recorded head_sha256/line_count).
  if (mm.length) return witnessMismatchResult(mm);

  const tornDetail = walk.torn_tail
    ? (base.witness === "match"
      ? "chain verified up to a torn final line (witness-corroborated)"
      : "chain verified up to a torn final line — NO witness corroboration (heuristic torn-tail tolerance)")
    : null;
  if (walk.status === "mixed") {
    return { ...base, status: "mixed",
      detail: `mixed chain: prev-carrying records verified, but prev-less (schema-1) lines are content-unverifiable${tornDetail ? `; ${tornDetail}` : ""}` };
  }
  return { ...base, status: "verified", detail: tornDetail || "chain verified from genesis" };
}

// PURE. Verify the events.jsonl chain (+ run-ledger fold + chain-head.json witness).
// Byte-identical to the pre-FAFF-621 inline verifier — now a thin composition of the shared
// walkPhysicalChain + verifyLedgerChain. `opts` (legacy_policy) is accepted for signature
// compatibility; classification is policy-free (only verifyExitCode reads the policy).
function verifyChain(dir, opts = {}) { // eslint-disable-line no-unused-vars
  return verifyLedgerChain(dir, { ledgerFile: "events.jsonl", witnessFile: "chain-head.json", ledgerFold: eventsLedgerFold });
}

// FAFF-621. PURE. Verify the declared-effects.jsonl chain (+ effects-chain-head.json
// witness). Composes the SAME walkPhysicalChain — never a forked hash-walk. No run-ledger
// fold (the effects ledger has none). Same status vocabulary + verifyExitCode mapping as
// verifyChain. An absent declared-effects.jsonl → verified (nothing to verify), exit 0.
function verifyEffectsChain(dir, opts = {}) { // eslint-disable-line no-unused-vars
  return verifyLedgerChain(dir, { ledgerFile: "declared-effects.jsonl", witnessFile: "effects-chain-head.json", ledgerFold: null });
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
  if (gate.errors.length) return usageError(gate.errors, "usage: faff events <append|validate|read|verify|anchor|anchor-run> [--run ID] [--file F] [--ts T] [--tokens] [--session-id ID] [--type T] [--issue ID] [--run-dir DIR] [--legacy-policy pass|warn|fail] [--dest DIR] [--json] [--root DIR]");
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
    const reqErr = requireFlags({ "--run": run }, EVENTS_SURFACE.subcommands.append, "events", "append");
    if (reqErr) { process.stderr.write(reqErr + "\n"); return 2; }
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
            // FAFF-679: Class A of the gateway's mid-bracket write rule — the digest
            // pair this locked write saw/left, so an --tokens caller holding a custody
            // baseline can tell "I only appended an event" from "I also touched the
            // bracketed ledger member" without a second read.
            base.ledger_sha256_before = res.before_sha256;
            base.ledger_sha256_after = res.after_sha256;
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
    const reqErr = requireFlags({ "--run": run }, EVENTS_SURFACE.subcommands.read, "events", "read");
    if (reqErr) { process.stderr.write(reqErr + "\n"); return 2; }
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
    const verifyReqErr = requireFlags({ "--run-dir": dirArg }, EVENTS_SURFACE.subcommands.verify, "events", "verify");
    if (verifyReqErr) { process.stderr.write(verifyReqErr + "\n"); return 2; }
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
    const anchorReqErr = requireFlags({ "--run-dir": dirArg, "--issue": issueArg, "--dest": destArg }, EVENTS_SURFACE.subcommands.anchor, "events", "anchor");
    if (anchorReqErr) { process.stderr.write(anchorReqErr + "\n"); return 2; }
    if (!fs.existsSync(dirArg) || !fs.statSync(dirArg).isDirectory()) {
      process.stderr.write(`faff events anchor: --run-dir is not a directory: ${dirArg}\n`); return 2;
    }
    // FAFF-623 adversarial review: --issue is joined onto --run-dir to locate the per-issue
    // merge-floor files (below) — a source-path read, not just the label already accepted
    // unsanitised into chain-head.json. Same shape check merge-gate.js's --issue already
    // applies (defence-in-depth, never a forked rule): reject anything that isn't a bare
    // issue-id token, so a malformed/malicious --issue can't walk the read path outside
    // --run-dir via a ".." segment.
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(issueArg) || issueArg.includes("..")) {
      process.stderr.write(`faff events anchor: --issue ${JSON.stringify(issueArg)} is not a valid issue id\n`); return 2;
    }
    // FAFF-958: refuse to anchor a run dir whose ledger fold has drifted (an unrecorded
    // run-ledger.json rewrite) — mirrors HALF of anchor-run's precondition above: the
    // eventsLedgerFold hash-match core, reused verbatim, never a forked comparison. Unlike
    // anchor-run, this does NOT port the presence assertion — a per-issue Step-9b anchor
    // legitimately runs before the run has reached its run-close choke-point, so a run dir may
    // carry no `ledger-write` event yet, and eventsLedgerFold already returns null (no
    // refusal) for that case. Refusing here must never mutate the source run dir (no ledger
    // write, no event append) and must run before mintIssueAnchor creates --dest, so a refusal
    // leaves no partial anchor on disk.
    let anchorEventsBuf;
    try { anchorEventsBuf = fs.readFileSync(path.join(dirArg, "events.jsonl")); }
    catch { anchorEventsBuf = null; } // unreadable/absent — let mintIssueAnchor own the "no-events" outcome below, unchanged
    if (anchorEventsBuf) {
      const { lines: anchorEventLines } = splitPhysicalLines(anchorEventsBuf);
      const anchorRecords = [];
      for (const l of anchorEventLines) { try { anchorRecords.push(JSON.parse(l.toString("utf8"))); } catch { /* malformed line — mintIssueAnchor/governance-check classify this, not this precondition */ } }
      const anchorFold = eventsLedgerFold(dirArg, anchorRecords, {});
      // Adversarial review (FAFF-958): eventsLedgerFold itself returns null (no refusal) when
      // run-ledger.json is simply ABSENT, regardless of whether a ledger-write was chained — by
      // design, so a run dir that never wrote a ledger at all is never refused. But a ledger-write
      // event that WAS chained records a fold the ledger file must still be able to satisfy; if the
      // file has since been deleted, "absent" and "no ledger-write yet" are no longer the same case
      // — the recorded fold can never match a file that isn't there. This is an orthogonal PRESENCE
      // assertion alongside the reused hash-match core, never a second hash comparison (the "one
      // detector" rule is about the hash-match logic, not this file-existence check).
      const anchorHasLedgerWrite = anchorRecords.some((r) => r && r.type === "ledger-write");
      const anchorLedgerMissing = anchorHasLedgerWrite && !fs.existsSync(path.join(dirArg, "run-ledger.json"));
      if (anchorFold || anchorLedgerMissing) {
        const detail = anchorFold ? anchorFold.detail : "run-ledger.json is missing but a ledger-write event is chained — the recorded fold cannot be satisfied";
        // The recovery command takes a run ID (joined internally as .faff/runs/<run>), not a
        // filesystem path — dirArg is --run-dir's path value, so pass its basename.
        process.stderr.write(`faff events anchor: precondition failed — ${detail}; append a ledger-write to re-sync the ledger fold before anchoring (echo '{"phase":"run","type":"ledger-write"}' | faff events append --run ${path.basename(dirArg)}), then re-run\n`);
        return 1;
      }
    }
    const result = mintIssueAnchor(dirArg, issueArg, destArg);
    if (!result.ok) {
      process.stderr.write(`faff events anchor: ${result.message}\n`);
      return result.code === "no-events" ? 3 : 2;
    }
    const { head, copiedFloorFiles, effectsAnchored } = result;
    const floorNote = copiedFloorFiles.length ? ` + ${copiedFloorFiles.join(", ")}` : "";
    const effectsNote = effectsAnchored ? " + declared-effects.jsonl, effects-chain-head.json" : "";
    console.log(`events anchor: ${dirArg} → ${destArg} (head_seq ${head.head_seq}, head_sha256 ${head.head_sha256 ? head.head_sha256.slice(0, 12) + "…" : "null"}, ${head.line_count} lines, schema_floor ${head.schema_floor})${floorNote}${effectsNote}`);
    return 0;
  }

  // FAFF-796: `anchor-run` — the git-only run-level sibling of `anchor` (per ADR 0109). Mints
  // ONE per-issue anchor subdir per issue the run touched (reusing mintIssueAnchor — the SAME
  // core `anchor` uses, never a forked byte-copy/witness), copies the run-level summary.md
  // best-effort, then self-verifies every minted subdir via evaluateAnchorDir before returning —
  // a broken anchor is never handed to the orchestrator to commit. Precondition: the caller
  // (beep-boop's orchestrator-exit) has already written owner.status:"done" + stop_reason to
  // run-ledger.json AND appended the mandatory post-edit `ledger-write` event, so the ledger
  // close is already the chain head — asserted below, never assumed.
  if (cmd === "anchor-run") {
    let dirArg = null, destArg = null;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--run-dir") dirArg = args[i + 1];
      else if (args[i] === "--dest") destArg = args[i + 1];
    }
    const reqErr = requireFlags({ "--run-dir": dirArg }, EVENTS_SURFACE.subcommands["anchor-run"], "events", "anchor-run");
    if (reqErr) { process.stderr.write(reqErr + "\n"); return 2; }
    if (!fs.existsSync(dirArg) || !fs.statSync(dirArg).isDirectory()) {
      process.stderr.write(`faff events anchor-run: --run-dir is not a directory: ${dirArg}\n`); return 2;
    }
    const dest = destArg || path.join(root, ".faff", "anchors", path.basename(dirArg));

    let eventsBuf;
    try { eventsBuf = fs.readFileSync(path.join(dirArg, "events.jsonl")); }
    catch { process.stderr.write(`faff events anchor-run: no events.jsonl in ${dirArg} — nothing to anchor\n`); return 3; }

    // Precondition (spec §4 step 2): the on-disk run-ledger.json must be the recorded head of
    // the chain — i.e. a `ledger-write` event is present AND its recorded hash matches. Reuses
    // eventsLedgerFold's hash-match core (never a forked comparison); the PRESENCE assertion on
    // top is anchor-run's own — a run dir with no ledger-write yet has not reached the run-close
    // choke-point at all, which eventsLedgerFold alone (used generically by `verify`, where an
    // absent ledger-write is legitimately "not applicable yet") would silently let through.
    const { lines: eventLines } = splitPhysicalLines(eventsBuf);
    const records = [];
    for (const l of eventLines) { try { records.push(JSON.parse(l.toString("utf8"))); } catch { /* malformed line — walkPhysicalChain (via verify/self-verify below) is what flags this, not this presence check */ } }
    if (!records.some((r) => r && r.type === "ledger-write")) {
      process.stderr.write(`faff events anchor-run: precondition failed — no ledger-write event in ${dirArg}/events.jsonl; the run-close edit must be chained before anchor-run runs\n`);
      return 1;
    }
    const fold = eventsLedgerFold(dirArg, records, {});
    if (fold) {
      process.stderr.write(`faff events anchor-run: precondition failed — ${fold.detail}\n`);
      return 1;
    }

    let ledgerObj;
    try { ledgerObj = JSON.parse(fs.readFileSync(path.join(dirArg, "run-ledger.json"), "utf8")); }
    catch (e) { process.stderr.write(`faff events anchor-run: run-ledger.json missing/unreadable in ${dirArg}: ${e.message}\n`); return 3; }
    const admitted = Array.isArray(ledgerObj.admitted) ? ledgerObj.admitted : [];
    const outcomeKeys = (ledgerObj.outcomes && typeof ledgerObj.outcomes === "object" && !Array.isArray(ledgerObj.outcomes)) ? Object.keys(ledgerObj.outcomes) : [];
    const issues = Array.from(new Set([...admitted, ...outcomeKeys])).sort();

    try { fs.mkdirSync(dest, { recursive: true }); }
    catch (e) { process.stderr.write(`faff events anchor-run: cannot create dest ${dest}: ${e.message}\n`); return 2; }

    // Adversarial review (FAFF-796): a mint failure partway through this loop must never leave
    // an orphaned PARTIAL set on disk — a bare `mkdirSync(dest, {recursive:true})` on the next
    // re-run is a no-op over an existing dir, so a silent re-run would overwrite (and so mask)
    // the prior partial failure rather than surfacing it. Wipe the whole `dest` tree before
    // returning non-zero, so every failure path leaves either nothing or a fully self-verified
    // set — never an ambiguous in-between the caller could mistake for complete.
    const mintedDirs = [];
    for (const issue of issues) {
      const destSub = path.join(dest, issue);
      const r = mintIssueAnchor(dirArg, issue, destSub);
      if (!r.ok) {
        process.stderr.write(`faff events anchor-run: mint failed for ${issue}: ${r.message}\n`);
        try { fs.rmSync(dest, { recursive: true, force: true }); } catch { /* best-effort cleanup — the mint failure is the reported cause either way */ }
        return r.code === "no-events" ? 3 : 2;
      }
      mintedDirs.push(destSub);
    }

    // Best-effort: the run-level summary.md, if present. Not leg-verified (too shallow for
    // deriveAnchorDirs's 3-segment floor — it lives at <dest>/summary.md, not <dest>/<issue>/…).
    const srcSummary = path.join(dirArg, "summary.md");
    let summaryCopied = false;
    if (fs.existsSync(srcSummary)) {
      try { fs.copyFileSync(srcSummary, path.join(dest, "summary.md")); summaryCopied = true; }
      catch (e) { process.stderr.write(`faff events anchor-run: warning — could not copy summary.md: ${e.message}\n`); }
    }

    // Self-verify every minted subdir before returning — a broken anchor must never reach the
    // orchestrator's commit step. `governance-check` lives in the factory region (ADR 0042); this
    // module is governance, and governance must never `require()` factory (`faff regions check`
    // enforces the direction mechanically) — so self-verify goes through a SELF-SPAWN of the same
    // CLI binary (the sentry.js precedent: a governance file reaching factory functionality via
    // `spawnSync(process.execPath, [ENTRYPOINT, …])`, a process boundary, not a require edge, and
    // so invisible to the lint by design) rather than an in-process require of the module.
    //
    // Adversarial review (FAFF-796): `governance-check`'s own `evaluateAnchorDir` overrides
    // whatever `--level` is passed here whenever the anchored run-ledger.json itself carries a
    // `level` field (FAFF-690) — true for every ledger this codebase writes — so `selfVerifyLevel`
    // below is a residual FALLBACK ONLY, for a level-less/legacy ledger. Resolve it from the LIVE
    // run's OWN ledger (`ledgerObj`, already parsed above) rather than hardcoding either floor:
    // hardcoding "L3" risks under-verifying an L4 run's holdout leg on that residual path;
    // hardcoding "L4" risks over-verifying a legitimate L1–L3 shipped issue (requiring a holdout it
    // was never meant to produce). The live ledger's own level is the correct answer either way; an
    // invalid value is rejected by `governance-check`'s own `--level` flag validation (exit 2),
    // which this treats as a self-verify failure like any other non-zero exit.
    const selfVerifyLevel = typeof ledgerObj.level === "string" && ledgerObj.level ? ledgerObj.level : "L3";
    for (const destSub of mintedDirs) {
      const r = spawnSync(process.execPath, [ENTRYPOINT, "governance-check", "--anchor-dir", destSub, "--legacy-policy", "pass", "--level", selfVerifyLevel], { encoding: "utf8" });
      if (r.status !== 0) {
        process.stderr.write(`faff events anchor-run: self-verify failed for ${destSub} (governance-check exit ${r.status}):\n${r.stdout || ""}${r.stderr || ""}`);
        try { fs.rmSync(dest, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
        return 1;
      }
    }

    console.log(`events anchor-run: ${dirArg} → ${dest} (${mintedDirs.length} issue(s) minted + self-verified${summaryCopied ? ", summary.md" : ""})`);
    return 0;
  }

  process.stderr.write("faff events: expected one of append | validate | read | verify | anchor | anchor-run (or --selftest)\n");
  return 2;
}

// FAFF-796: the shared per-issue anchor mint core — byte-copy events.jsonl + run-ledger.json
// (+ optional declared-effects.jsonl/witness and merge-floor floor files) from runDir into
// destDir, and write the CLI-computed chain-head.json witness. Extracted from `events anchor`'s
// inner body (FAFF-568/623) so both `anchor` (per-PR, one issue) and `anchor-run` (git-only, one
// call per issue in the run) call the SAME core — never a forked byte-copy or witness format
// (FAFF-621's composition rule). Pure filesystem work; callers validate --run-dir/--issue shape
// themselves (this function trusts its arguments — each call site keeps its own error text/exit
// codes). Returns `{ ok: true, head, copiedFloorFiles, effectsAnchored }` on success, or
// `{ ok: false, code, message }` — `code: "no-events"` mirrors the original "nothing to anchor"
// case (exit 3 at the `anchor` call site), `code: "dest-mkdir"` mirrors the original
// dest-creation failure (exit 2).
function mintIssueAnchor(runDir, issue, destDir) {
  let eventsBuf;
  try { eventsBuf = fs.readFileSync(path.join(runDir, "events.jsonl")); }
  catch { return { ok: false, code: "no-events", message: `no events.jsonl in ${runDir} — nothing to anchor` }; }
  try { fs.mkdirSync(destDir, { recursive: true }); }
  catch (e) { return { ok: false, code: "dest-mkdir", message: `cannot create dest ${destDir}: ${e.message}` }; }
  fs.writeFileSync(path.join(destDir, "events.jsonl"), eventsBuf); // verbatim byte-copy
  const srcLedger = path.join(runDir, "run-ledger.json");
  if (fs.existsSync(srcLedger)) fs.copyFileSync(srcLedger, path.join(destDir, "run-ledger.json"));
  // FAFF-621: when a declared-effects.jsonl is present, byte-copy it too and write a
  // CLI-computed effects-chain-head.json witness (computeChainHead is ledger-agnostic — it
  // takes a buffer). Absent effects ledger → nothing copied, no effects witness (so the
  // gate's requireWitness fail-closed never fires — witness-absent applies only when the
  // ledger is present). The head hash is computed here, never accepted from a caller.
  const srcEffects = path.join(runDir, "declared-effects.jsonl");
  let effectsAnchored = false;
  if (fs.existsSync(srcEffects)) {
    const effectsBuf = fs.readFileSync(srcEffects);
    fs.writeFileSync(path.join(destDir, "declared-effects.jsonl"), effectsBuf); // verbatim byte-copy
    const effHead = computeChainHead(effectsBuf, path.basename(runDir), issue);
    fs.writeFileSync(path.join(destDir, "effects-chain-head.json"), JSON.stringify(effHead, null, 2) + "\n");
    effectsAnchored = true;
  }
  // FAFF-623: also carry the merge-floor evidence `evaluateMergeFloorLeg` (governance-check.js)
  // needs — `ac-checklist.json` + `review-verdict.json` always, `holdout.json` +
  // `build-progress.json` at L4 (the latter required ALONGSIDE holdout.json, not optional to
  // it — `readHoldout` compares the holdout verdict's timestamp against build-progress.json's
  // checkpoint to reject a stale holdout; without it the freshness check has nothing to compare
  // against and reports "blocked" even for a genuinely valid holdout). Each file is independently
  // best-effort-present: a run dir that hasn't reached Step 9 yet legitimately has no
  // review-verdict.json, and that's a normal merge_floor "not yet passed" reason, not an
  // anchor-command error — never required, unlike events.jsonl above. FAFF-845: also
  // landing-progress.json (FAFF-846's per-issue fix-cycle counter), so it rides the anchor's
  // existing generic byte-copy into the `anchors` bundle member and is restorable after a
  // Phase-0 recovery (bundle-recover.js's reconstructProjection copies it back out).
  const optionalFloorFiles = ["ac-checklist.json", "review-verdict.json", "holdout.json", "build-progress.json", "landing-progress.json"];
  const issueDir = path.join(runDir, issue);
  const copiedFloorFiles = [];
  for (const f of optionalFloorFiles) {
    const src = path.join(issueDir, f);
    if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(destDir, f)); copiedFloorFiles.push(f); }
  }
  const head = computeChainHead(eventsBuf, path.basename(runDir), issue);
  fs.writeFileSync(path.join(destDir, "chain-head.json"), JSON.stringify(head, null, 2) + "\n");
  return { ok: true, head, copiedFloorFiles, effectsAnchored };
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
    // FAFF-700 — agent-dispatch: run-scoped (no issue field, mirrors sentry-checkpoint),
    // data = the dispatch CLAIM (kind/dispatch_id/cluster_id/cluster_size). The audit
    // recomputes it against child transcripts; this event is only the claim it checks.
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "agent-dispatch", data: { kind: "reader", dispatch_id: "d1", cluster_id: "R1", cluster_size: 3 } }, 0, "valid agent-dispatch"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "agent-dispatch", data: { kind: "reader", dispatch_id: "d1", cluster_id: "R1", cluster_size: 3, tokens: null, tokens_source: "estimate", effort: "high", gate: "adversarial", rework_turns: 0 } }, 0, "valid agent-dispatch with every telemetry tag"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "agent-dispatch", data: { kind: "bogus", dispatch_id: "d1", cluster_id: "R1", cluster_size: 3 } }, 1, "agent-dispatch kind not in vocabulary rejected"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "agent-dispatch", data: { kind: "reader", dispatch_id: "", cluster_id: "R1", cluster_size: 3 } }, 1, "agent-dispatch empty dispatch_id rejected"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "agent-dispatch", data: { kind: "reader", dispatch_id: "d1", cluster_id: "", cluster_size: 3 } }, 1, "agent-dispatch empty cluster_id rejected"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "agent-dispatch", data: { kind: "reader", dispatch_id: "d1", cluster_id: "R1", cluster_size: 0 } }, 1, "agent-dispatch cluster_size below 1 rejected"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "agent-dispatch", data: { kind: "reader", dispatch_id: "d1", cluster_id: "R1", cluster_size: 1.5 } }, 1, "agent-dispatch non-integer cluster_size rejected"],
    [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "agent-dispatch", data: { kind: "reader", dispatch_id: "d1", cluster_id: "R1", cluster_size: 3, transcript: "child said X" } }, 1, "agent-dispatch unexpected top-level data key rejected (non-leak)"],
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
    // FAFF-958: `anchor` precondition — refuse a drifted ledger fold (an unrecorded run-ledger.json
    // rewrite) instead of byte-copying it into a committable anchor. Mirrors HALF of the
    // anchor-run drift test below (the eventsLedgerFold mismatch case), never the presence
    // assertion — a per-issue anchor legitimately precedes any chained ledger-write.
    { // mismatch → non-zero exit, nothing minted (dest not created), stderr names the mismatch + the fix
      const src = mkDir(), destRoot = mkDir();
      const dest = path.join(destRoot, "anchor-dest");
      try {
        const ledgerBefore = JSON.stringify({ run_id: "run-anchor-drift", admitted: [], outcomes: {} }, null, 2) + "\n";
        const ledgerShaBefore = sha256Hex(Buffer.from(ledgerBefore, "utf8"));
        buildChain(src, "run-anchor-drift", [
          { phase: "run", type: "run-start" },
          { phase: "build", type: "build-start", issue: "FAFF-1" },
          { phase: "run", type: "ledger-write", data: { ledger_sha256: ledgerShaBefore } },
        ], ledgerBefore);
        // Unrecorded rewrite: run-ledger.json changes on disk with no corresponding chained ledger-write.
        fs.writeFileSync(path.join(src, "run-ledger.json"), ledgerBefore + " ");

        const origStderr = process.stderr.write;
        let stderrBuf = "";
        process.stderr.write = (chunk) => { stderrBuf += chunk; return true; };
        let rc;
        try { rc = cmdEvents(["anchor", "--run-dir", src, "--issue", "FAFF-1", "--dest", dest]); }
        finally { process.stderr.write = origStderr; }

        vcheck("anchor: drifted ledger fold → exit 1 (precondition-failed, per spec)", rc === 1);
        vcheck("anchor: drifted ledger fold → dest not created (no partial mint)", !fs.existsSync(dest));
        vcheck("anchor: drifted ledger fold → stderr names the mismatch + the re-sync fix", /ledger fold mismatch/.test(stderrBuf) && /ledger-write/.test(stderrBuf) && /faff events append/.test(stderrBuf));
        // Adversarial review (FAFF-958): the recovery command's --run value must be a run ID
        // (joined internally as .faff/runs/<run>), not the --run-dir filesystem path — assert
        // the message carries the basename and never the full source path.
        vcheck("anchor: drifted ledger fold → recovery command's --run is the run ID (basename), not the --run-dir path", stderrBuf.includes(`--run ${path.basename(src)}`) && !stderrBuf.includes(`--run ${src}`));
      } finally { fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(destRoot, { recursive: true, force: true }); }
    }
    { // Adversarial review (FAFF-958): a ledger-write IS chained but run-ledger.json has since been
      // deleted — eventsLedgerFold alone returns null here (it treats "file absent" the same as "no
      // ledger-write yet"), so the orthogonal presence assertion above is what refuses this case;
      // without it, mintIssueAnchor would silently mint an anchor with no run-ledger.json at all.
      const src = mkDir(), destRoot = mkDir();
      const dest = path.join(destRoot, "anchor-dest");
      try {
        const ledger = JSON.stringify({ run_id: "run-anchor-deleted-ledger", admitted: [], outcomes: {} }, null, 2) + "\n";
        const ledgerSha = sha256Hex(Buffer.from(ledger, "utf8"));
        buildChain(src, "run-anchor-deleted-ledger", [
          { phase: "run", type: "run-start" },
          { phase: "build", type: "build-start", issue: "FAFF-1" },
          { phase: "run", type: "ledger-write", data: { ledger_sha256: ledgerSha } },
        ], ledger);
        fs.rmSync(path.join(src, "run-ledger.json")); // the ledger vanishes after the ledger-write chained

        const origStderr = process.stderr.write;
        let stderrBuf = "";
        process.stderr.write = (chunk) => { stderrBuf += chunk; return true; };
        let rc;
        try { rc = cmdEvents(["anchor", "--run-dir", src, "--issue", "FAFF-1", "--dest", dest]); }
        finally { process.stderr.write = origStderr; }

        vcheck("anchor: ledger-write chained but run-ledger.json deleted → exit 1, refused", rc === 1);
        vcheck("anchor: ledger-write chained but run-ledger.json deleted → dest not created", !fs.existsSync(dest));
        vcheck("anchor: ledger-write chained but run-ledger.json deleted → stderr names the cause + the fix", /run-ledger\.json is missing/.test(stderrBuf) && /faff events append/.test(stderrBuf));
      } finally { fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(destRoot, { recursive: true, force: true }); }
    }
    { // no ledger-write event yet (normal pre-run-close Step-9b) → still mints, absence is not a refusal
      const src = mkDir(), destRoot = mkDir();
      const dest = path.join(destRoot, "anchor-dest");
      try {
        const ledger = JSON.stringify({ run_id: "run-anchor-nolw", admitted: [], outcomes: {} }, null, 2) + "\n";
        buildChain(src, "run-anchor-nolw", [
          { phase: "run", type: "run-start" },
          { phase: "build", type: "build-start", issue: "FAFF-1" },
        ], ledger); // run-ledger.json present, but no ledger-write event chained yet
        const rc = cmdEvents(["anchor", "--run-dir", src, "--issue", "FAFF-1", "--dest", dest]);
        vcheck("anchor: no ledger-write event present → exit 0, mints (absence is not a refusal)", rc === 0 && fs.existsSync(path.join(dest, "chain-head.json")));
      } finally { fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(destRoot, { recursive: true, force: true }); }
    }
    { // matching fold → mints (pinned explicitly to this ticket's DoD, distinct from the general round-trip test above)
      const src = mkDir(), destRoot = mkDir();
      const dest = path.join(destRoot, "anchor-dest");
      try {
        const ledger = JSON.stringify({ run_id: "run-anchor-match", admitted: [], outcomes: {} }, null, 2) + "\n";
        const ledgerSha = sha256Hex(Buffer.from(ledger, "utf8"));
        buildChain(src, "run-anchor-match", [
          { phase: "run", type: "run-start" },
          { phase: "build", type: "build-start", issue: "FAFF-1" },
          { phase: "run", type: "ledger-write", data: { ledger_sha256: ledgerSha } },
        ], ledger);
        const rc = cmdEvents(["anchor", "--run-dir", src, "--issue", "FAFF-1", "--dest", dest]);
        vcheck("anchor: matching ledger fold → exit 0, mints", rc === 0 && fs.existsSync(path.join(dest, "chain-head.json")));
      } finally { fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(destRoot, { recursive: true, force: true }); }
    }
    { // post-resync re-run: the documented recovery (append a ledger-write, then re-anchor) succeeds
      const src = mkDir(), destRoot = mkDir();
      const dest = path.join(destRoot, "anchor-dest");
      try {
        const ledgerBefore = JSON.stringify({ run_id: "run-anchor-resync", admitted: [], outcomes: {} }, null, 2) + "\n";
        const ledgerShaBefore = sha256Hex(Buffer.from(ledgerBefore, "utf8"));
        const initialLines = buildChain(src, "run-anchor-resync", [
          { phase: "run", type: "run-start" },
          { phase: "build", type: "build-start", issue: "FAFF-1" },
          { phase: "run", type: "ledger-write", data: { ledger_sha256: ledgerShaBefore } },
        ], ledgerBefore);
        const ledgerAfter = ledgerBefore + " "; // the same unrecorded rewrite as the drift case above
        fs.writeFileSync(path.join(src, "run-ledger.json"), ledgerAfter);

        const preResync = cmdEvents(["anchor", "--run-dir", src, "--issue", "FAFF-1", "--dest", dest]);
        vcheck("anchor: pre-resync attempt on drifted ledger → exit 1 (precondition-failed, per spec)", preResync === 1);

        // `faff events append` self-computes ledger_sha256 from the on-disk bytes — reproduced
        // here as a chained ledger-write over the CURRENT (post-rewrite) ledger bytes.
        const ledgerShaAfter = sha256Hex(Buffer.from(ledgerAfter, "utf8"));
        const lastLine = initialLines[initialLines.length - 1];
        const resyncLine = JSON.stringify({
          schema: 2, run_id: "run-anchor-resync", seq: initialLines.length, ts: "t",
          prev: sha256Hex(Buffer.from(lastLine, "utf8")), phase: "run", type: "ledger-write",
          data: { ledger_sha256: ledgerShaAfter },
        });
        fs.appendFileSync(path.join(src, "events.jsonl"), resyncLine + "\n");

        const rc = cmdEvents(["anchor", "--run-dir", src, "--issue", "FAFF-1", "--dest", dest]);
        vcheck("anchor: post-resync re-run → exit 0, mints", rc === 0 && fs.existsSync(path.join(dest, "chain-head.json")));
      } finally { fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(destRoot, { recursive: true, force: true }); }
    }
    { // FAFF-623: merge-floor evidence copy — best-effort per-file, none required.
      const src = mkDir(), dest = mkDir();
      try {
        buildChain(src, "run-floor", [
          { phase: "run", type: "run-start" },
          { phase: "build", type: "build-start", issue: "FAFF-1" },
        ]);
        // No FAFF-1/ subdir at all yet — anchor must still succeed (chain-only), copying nothing extra.
        let rc = cmdEvents(["anchor", "--run-dir", src, "--issue", "FAFF-1", "--dest", dest]);
        vcheck("anchor: no per-issue floor files present → exit 0, none copied", rc === 0
          && !fs.existsSync(path.join(dest, "ac-checklist.json")) && !fs.existsSync(path.join(dest, "review-verdict.json")));

        // Now populate ac-checklist.json + review-verdict.json only (holdout/build-progress absent —
        // the normal case below L4) and re-anchor to a fresh dest.
        const dest2 = mkDir();
        fs.mkdirSync(path.join(src, "FAFF-1"), { recursive: true });
        fs.writeFileSync(path.join(src, "FAFF-1", "ac-checklist.json"), JSON.stringify({ all_verified: true }));
        fs.writeFileSync(path.join(src, "FAFF-1", "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
        rc = cmdEvents(["anchor", "--run-dir", src, "--issue", "FAFF-1", "--dest", dest2]);
        vcheck("anchor: ac-checklist.json + review-verdict.json present → exit 0, both copied verbatim", rc === 0
          && fs.readFileSync(path.join(dest2, "ac-checklist.json"), "utf8") === fs.readFileSync(path.join(src, "FAFF-1", "ac-checklist.json"), "utf8")
          && fs.readFileSync(path.join(dest2, "review-verdict.json"), "utf8") === fs.readFileSync(path.join(src, "FAFF-1", "review-verdict.json"), "utf8"));
        vcheck("anchor: holdout.json/build-progress.json absent below L4 → not copied (no error)",
          !fs.existsSync(path.join(dest2, "holdout.json")) && !fs.existsSync(path.join(dest2, "build-progress.json")));
        fs.rmSync(dest2, { recursive: true, force: true });

        // L4: add holdout.json + build-progress.json too — all four copy.
        const dest3 = mkDir();
        fs.writeFileSync(path.join(src, "FAFF-1", "holdout.json"), JSON.stringify({ aggregate: "meets-spec", code_blind: true, criteria: [] }));
        fs.writeFileSync(path.join(src, "FAFF-1", "build-progress.json"), JSON.stringify({ updated_at: new Date().toISOString() }));
        rc = cmdEvents(["anchor", "--run-dir", src, "--issue", "FAFF-1", "--dest", dest3]);
        vcheck("anchor: all four merge-floor files present → exit 0, all four copied", rc === 0
          && fs.existsSync(path.join(dest3, "ac-checklist.json")) && fs.existsSync(path.join(dest3, "review-verdict.json"))
          && fs.existsSync(path.join(dest3, "holdout.json")) && fs.existsSync(path.join(dest3, "build-progress.json")));
        fs.rmSync(dest3, { recursive: true, force: true });
      } finally { fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(dest, { recursive: true, force: true }); }
    }
    // FAFF-796 — `anchor-run`: clean round-trip for a shipped issue, an all-parked run (no floor
    // files → merge_floor n/a via evaluateAnchorDir → self-verify pass), broken-chain fails,
    // un-chained close (no ledger-write) fails loud, empty-run case mints nothing but exits 0.
    {
      // Clean round-trip: two admitted issues, both parked, no floor files at all — the
      // feature's primary case (a git-only run with nothing to ship still anchors cleanly).
      const src = mkDir(), destRoot = mkDir();
      try {
        const ledger = JSON.stringify({ run_id: "run-anchorrun-ok", admitted: ["FAFF-1", "FAFF-2"], outcomes: { "FAFF-1": "parked", "FAFF-2": "errored" }, owner: { status: "done" } }, null, 2) + "\n";
        const ledgerSha = sha256Hex(Buffer.from(ledger, "utf8"));
        buildChain(src, "run-anchorrun-ok", [
          { phase: "run", type: "run-start" },
          { phase: "run", type: "ledger-write", data: { ledger_sha256: ledgerSha } },
        ], ledger);
        fs.writeFileSync(path.join(src, "summary.md"), "# ok\n");
        const dest = path.join(destRoot, "run-anchorrun-ok");
        const rc = cmdEvents(["anchor-run", "--run-dir", src, "--dest", dest]);
        vcheck("anchor-run: all-parked, clean close → exit 0 (self-verify passed, merge_floor n/a)", rc === 0);
        vcheck("anchor-run: mints one subdir per admitted issue", fs.existsSync(path.join(dest, "FAFF-1", "chain-head.json")) && fs.existsSync(path.join(dest, "FAFF-2", "chain-head.json")));
        vcheck("anchor-run: copies the run-level summary.md best-effort", fs.readFileSync(path.join(dest, "summary.md"), "utf8") === "# ok\n");
      } finally { fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(destRoot, { recursive: true, force: true }); }
    }
    {
      // A shipped issue still requires its merge-floor evidence — the outcome-aware n/a branch
      // never waves through a genuinely shipped issue on file absence.
      const src = mkDir(), destRoot = mkDir();
      try {
        const ledger = JSON.stringify({ run_id: "run-anchorrun-shipped", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" }, owner: { status: "done" } }, null, 2) + "\n";
        const ledgerSha = sha256Hex(Buffer.from(ledger, "utf8"));
        buildChain(src, "run-anchorrun-shipped", [
          { phase: "run", type: "run-start" },
          { phase: "run", type: "ledger-write", data: { ledger_sha256: ledgerSha } },
        ], ledger);
        const dest = path.join(destRoot, "run-anchorrun-shipped");
        const noFloor = cmdEvents(["anchor-run", "--run-dir", src, "--dest", dest]);
        vcheck("anchor-run: shipped issue with NO floor files → self-verify fails, non-zero exit", noFloor !== 0);

        fs.mkdirSync(path.join(src, "FAFF-1"), { recursive: true });
        fs.writeFileSync(path.join(src, "FAFF-1", "ac-checklist.json"), JSON.stringify({ all_verified: true }));
        fs.writeFileSync(path.join(src, "FAFF-1", "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
        const dest2 = path.join(destRoot, "run-anchorrun-shipped-2");
        const withFloor = cmdEvents(["anchor-run", "--run-dir", src, "--dest", dest2]);
        vcheck("anchor-run: shipped issue WITH floor files → exit 0", withFloor === 0);
      } finally { fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(destRoot, { recursive: true, force: true }); }
    }
    {
      // Un-chained close: no ledger-write event at all → the precondition refuses (never
      // witnesses over a close that hasn't joined the chain).
      const src = mkDir(), destRoot = mkDir();
      try {
        buildChain(src, "run-anchorrun-unchained", [{ phase: "run", type: "run-start" }],
          JSON.stringify({ run_id: "run-anchorrun-unchained", admitted: [], outcomes: {} }, null, 2) + "\n");
        const rc = cmdEvents(["anchor-run", "--run-dir", src, "--dest", path.join(destRoot, "x")]);
        vcheck("anchor-run: no ledger-write event → precondition fails, non-zero exit", rc !== 0);
      } finally { fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(destRoot, { recursive: true, force: true }); }
    }
    {
      // Broken chain (a post-hoc ledger rewrite the last ledger-write's recorded hash no longer
      // matches) → the precondition's ledger-fold cross-check refuses.
      const src = mkDir(), destRoot = mkDir();
      try {
        const ledger = JSON.stringify({ run_id: "run-anchorrun-broken", admitted: [], outcomes: {} }, null, 2) + "\n";
        const ledgerSha = sha256Hex(Buffer.from(ledger, "utf8"));
        buildChain(src, "run-anchorrun-broken", [
          { phase: "run", type: "run-start" },
          { phase: "run", type: "ledger-write", data: { ledger_sha256: ledgerSha } },
        ], ledger);
        fs.writeFileSync(path.join(src, "run-ledger.json"), ledger + " "); // silent post-hoc rewrite
        const rc = cmdEvents(["anchor-run", "--run-dir", src, "--dest", path.join(destRoot, "x")]);
        vcheck("anchor-run: ledger-fold mismatch (post-hoc rewrite) → precondition fails, non-zero exit", rc !== 0);
      } finally { fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(destRoot, { recursive: true, force: true }); }
    }
    {
      // run-ledger.json genuinely absent (no ledger to fold against — eventsLedgerFold's own
      // fs.existsSync(ledgerPath) guard degrades that case to "not applicable", so the explicit
      // post-fold read is what fails this loud) → non-zero exit, never a fabricated witness.
      const src = mkDir(), destRoot = mkDir();
      try {
        buildChain(src, "run-anchorrun-noledger", [
          { phase: "run", type: "run-start" },
          { phase: "run", type: "ledger-write", data: { ledger_sha256: "deadbeef" } },
        ]); // no run-ledger.json written at all
        const rc = cmdEvents(["anchor-run", "--run-dir", src, "--dest", path.join(destRoot, "x")]);
        vcheck("anchor-run: run-ledger.json genuinely absent → non-zero exit (fail loud, never fabricated)", rc !== 0);
      } finally { fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(destRoot, { recursive: true, force: true }); }
    }
    {
      // Malformed run-ledger.json (present, but not parseable JSON) → non-zero exit.
      const src = mkDir(), destRoot = mkDir();
      try {
        const badBytes = "{ not json";
        buildChain(src, "run-anchorrun-badledger", [
          { phase: "run", type: "run-start" },
          { phase: "run", type: "ledger-write", data: { ledger_sha256: sha256Hex(Buffer.from(badBytes, "utf8")) } },
        ]);
        fs.writeFileSync(path.join(src, "run-ledger.json"), badBytes);
        const rc = cmdEvents(["anchor-run", "--run-dir", src, "--dest", path.join(destRoot, "x")]);
        vcheck("anchor-run: malformed run-ledger.json → non-zero exit (fail loud)", rc !== 0);
      } finally { fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(destRoot, { recursive: true, force: true }); }
    }
    {
      // Empty run (nothing admitted, no outcomes) → mints no issue subdirs but still exits 0.
      const src = mkDir(), destRoot = mkDir();
      try {
        const ledger = JSON.stringify({ run_id: "run-anchorrun-empty", admitted: [], outcomes: {}, owner: { status: "done" } }, null, 2) + "\n";
        const ledgerSha = sha256Hex(Buffer.from(ledger, "utf8"));
        buildChain(src, "run-anchorrun-empty", [
          { phase: "run", type: "run-start" },
          { phase: "run", type: "ledger-write", data: { ledger_sha256: ledgerSha } },
        ], ledger);
        const dest = path.join(destRoot, "run-anchorrun-empty");
        const rc = cmdEvents(["anchor-run", "--run-dir", src, "--dest", dest]);
        vcheck("anchor-run: empty run (no admitted issues) → exit 0, no issue subdirs minted", rc === 0 && fs.readdirSync(dest).filter((f) => fs.statSync(path.join(dest, f)).isDirectory()).length === 0);
      } finally { fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(destRoot, { recursive: true, force: true }); }
    }
    {
      // --run-dir missing entirely → usage error (exit 2), and a directory that is not a
      // valid --run-dir (no events.jsonl) → the "nothing to anchor" exit 3, mirroring `anchor`.
      const missingFlag = cmdEvents(["anchor-run"]);
      vcheck("anchor-run: missing --run-dir → exit 2 (usage)", missingFlag === 2);
      const emptyDir = mkDir();
      try {
        const rc = cmdEvents(["anchor-run", "--run-dir", emptyDir, "--dest", path.join(emptyDir, "out")]);
        vcheck("anchor-run: --run-dir with no events.jsonl → exit 3 (nothing to anchor)", rc === 3);
      } finally { fs.rmSync(emptyDir, { recursive: true, force: true }); }
    }
  }

  // FAFF-107: redact.js's pure-core assertions (collectKnownSecretValues /
  // redactKnownSecrets) — appendEventRecord above is this module's sole
  // consumer, so its selftest rides along here rather than opening a second
  // `--selftest` surface for a module with no CLI verb of its own.
  if (redactSelftest() !== 0) failed++;

  if (failed) return 1;
  console.log("events --selftest: ok");
  return 0;
}


module.exports = { DISPATCH_ALLOWED_DATA_KEYS, DISPATCH_KINDS, EFFORT_LEVELS, EVENTS_SPEC, EVENTS_SURFACE, EVENT_ISSUE_SCOPED, EVENT_LEDGER_OUTCOMES, EVENT_PHASES, EVENT_TYPES, DECISION_CAPTURE_COVERAGE_VALUES, HEX64_RE, QUALITY_GATE_CATCHES, TAIL_WINDOW_BYTES, appendEventRecord, appendRecordUnderLock, appendRecordsUnderLock, cmdEvents, computeChainHead, eventLineCount, eventViolations, eventsSelftest, mintIssueAnchor, seqFinding, sha256Hex, splitPhysicalLines, tailReadNextSeq, tailReadState, verifyChain, verifyEffectsChain, walkPhysicalChain, verifyExitCode };
