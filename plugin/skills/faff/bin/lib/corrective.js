// ===========================================================================
// === region:factory — corrective — FAFF-326: Sentry-2 Channel A, subtractive corrective authority. ===
//
// The FAFF-278 spike concluded corrective authority is GO-narrow as Channel A:
// stop-and-redispatch with a machine-authored corrective input, consumed at the next
// dispatch boundary — NEVER a live write into a running lane. This module owns the
// two mechanical halves: `author` (validate + write a CorrectiveInput onto the
// FAFF-373 forge surface + append the audit event) and `check` (gate via
// corrective-integrity, then fold the cumulative constraint set into a mandate).
//
// SUBTRACTIVE ONLY, BY CONSTRUCTION (ADR-0039 limit 1): CORRECTIVE_OPS is a closed
// enum of narrowing operations. Additive intent is inexpressible in this schema —
// anything not in the enum fails validation at `author` (exit 1, nothing written)
// and is REJECTED (never applied) at `check`. There is no escape hatch.
//
// GATE-DEGRADED (FAFF-373 precedent): `check` gates every read through
// `integrityGate(correctiveIntegrityProbe(...), "corrective")`. Unasserted (the
// production-common state until a FAFF-325 declaration actually covers this run) →
// disposition "channel-D": an on-disk artifact is surfaced for HUMAN RELAY, never
// acted on as authentic. Only `asserted:true` folds the constraint set and appends
// `corrective-consumed`.
//
// Classified FACTORY (not governance): this module requires corrective-integrity.js
// directly (factory→factory, legal) and events.js's pure helpers (factory→governance,
// legal per the region-direction invariant — ADR 0042). `sentry.js` (governance)
// stays pure by deriving authority through a CHILD spawn of this same bin instead
// (see sentry.js's sentryReadCorrectiveAuthority) rather than requiring this file.
//
// Pure cores (validateCorrectiveInput, foldCorrectiveConstraints) + a thin I/O
// wrapper (cmdCorrective) + --selftest, mirroring sentry / corrective-integrity.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { realFsq } = require("./container-check");
const { correctiveIntegrityDirs, correctiveIntegrityProbe, integrityGate } = require("./corrective-integrity");
const { eventLineCount, eventViolations } = require("./events");
const { readGovernanceConfig } = require("./budget");
const { DERAILMENT_SIGNALS, sentryThresholds } = require("./sentry");
const { dig, findRoot } = require("./shared-infra");

const CORRECTIVE_SCHEMA = 1;
// The closed subtractive op vocabulary (ADR-0039 limit 1) — additive intent is
// INEXPRESSIBLE here; anything outside this set is rejected, never a special case.
const CORRECTIVE_OPS = ["park-with-cause", "forbid-surface", "tighten-threshold", "descope-to-subset"];
// tighten-threshold's `key` must name one of Sentry's own decidable numeric knobs —
// a closed set, so "strictly tighter" is mechanically checkable (never a free-text key).
const TIGHTENABLE_KEYS = ["thrash_n", "failure_k", "stall_window_secs", "run_elapsed_ceiling_secs"];

// --- pure: per-op payload shape ---------------------------------------------------

function payloadViolations(op, payload) {
  const v = [];
  const p = (payload && typeof payload === "object" && !Array.isArray(payload)) ? payload : {};
  if (op === "park-with-cause") {
    if (typeof p.cause !== "string" || !p.cause.trim()) v.push("park-with-cause requires a non-empty payload.cause");
  } else if (op === "forbid-surface") {
    if (!Array.isArray(p.surfaces) || p.surfaces.length === 0 || !p.surfaces.every((s) => typeof s === "string" && s.trim())) {
      v.push("forbid-surface requires a non-empty payload.surfaces array of strings");
    }
  } else if (op === "tighten-threshold") {
    const t = (p.threshold && typeof p.threshold === "object" && !Array.isArray(p.threshold)) ? p.threshold : null;
    if (!t || typeof t.key !== "string" || !t.key.trim() || !Number.isFinite(Number(t.value))) {
      v.push("tighten-threshold requires payload.threshold {key:string, value:number}");
    } else if (!TIGHTENABLE_KEYS.includes(t.key)) {
      v.push(`tighten-threshold key '${t.key}' not in the decidable set {${TIGHTENABLE_KEYS.join(", ")}}`);
    }
  } else if (op === "descope-to-subset") {
    if (!Array.isArray(p.subset) || !p.subset.every((s) => typeof s === "string" && s.trim())) {
      v.push("descope-to-subset requires payload.subset (an array of strings — may be EMPTY, which means an empty mandate)");
    }
  }
  return v;
}

// --- pure: full CorrectiveInput validation (author AND check both funnel through
// this — the single source of the closed-schema / required-citation invariants) ----

// `effectiveThresholds` is the SENTRY_THRESHOLD_DEFAULTS-shaped object (sentryThresholds
// output) the tighten-threshold strictness check compares against; omit to skip that
// one check (still enforces shape + closed key set).
function validateCorrectiveInput(record, effectiveThresholds) {
  const v = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) return ["record must be a JSON object"];
  if (record.schema !== CORRECTIVE_SCHEMA) v.push(`schema must be ${CORRECTIVE_SCHEMA}`);
  if (typeof record.run_id !== "string" || !record.run_id) v.push("missing run_id");
  if (typeof record.issue !== "string" || !record.issue) v.push("missing issue");
  if (!CORRECTIVE_OPS.includes(record.op)) {
    v.push(`op '${record.op}' not in the closed subtractive enum {${CORRECTIVE_OPS.join(", ")}} — additive intent is inexpressible here`);
  } else {
    v.push(...payloadViolations(record.op, record.payload));
    // Subtractive-width check: STRICTLY tighter (smaller) than the effective config
    // value for every v1 sentry.* numeric knob — equal or looser fails (author never
    // writes it; check would reject it as a foreign/invalid artifact). FAIL CLOSED
    // when the strictness comparison can't be verified — a caller that PASSES an
    // effectiveThresholds object is asking for the check; an unresolvable baseline
    // (missing/non-finite key) must reject, never silently skip and let a looser
    // value through. `effectiveThresholds` OMITTED ENTIRELY (undefined/null) is the
    // one legitimate skip — the documented escape for a caller that doesn't have a
    // baseline to check against at all (shape-only validation).
    if (record.op === "tighten-threshold" && record.payload && record.payload.threshold) {
      const { key, value } = record.payload.threshold;
      if (effectiveThresholds != null && TIGHTENABLE_KEYS.includes(key)) {
        const current = Object.prototype.hasOwnProperty.call(effectiveThresholds, key) ? Number(effectiveThresholds[key]) : NaN;
        if (!Number.isFinite(current)) {
          v.push(`tighten-threshold key '${key}' has no verifiable effective config value — cannot confirm strictly-tighter, rejecting rather than silently skipping`);
        } else if (!(Number(value) < current)) {
          v.push(`tighten-threshold value ${value} is not strictly tighter than the effective config value ${current} for '${key}'`);
        }
      }
    }
  }
  const cites = record.cites;
  if (!cites || typeof cites !== "object" || Array.isArray(cites) || typeof cites.signal !== "string" || !cites.signal.trim()) {
    // CONSTRAINT: no un-cited corrective input ever validates (ADR-0039's steering
    // residual is discharged by this audit trail, not by trust).
    v.push("missing required cites.signal — no un-cited corrective input ever validates");
  } else if (!DERAILMENT_SIGNALS.has(cites.signal)) {
    // The record definition types cites.signal as "one of DERAILMENT_SIGNALS" (spec
    // §3 WHAT) — a citation naming a signal Sentry doesn't emit is not a real citation
    // (it can't be cross-checked against an actual DerailmentVerdict), so it is
    // rejected the same as a missing one, never silently accepted.
    v.push(`cites.signal '${cites.signal}' not in the derailment signal vocabulary {${[...DERAILMENT_SIGNALS].join(", ")}}`);
  }
  return v;
}

// --- pure: fold the cumulative constraint set into a mandate verdict --------------
// Called only over ALREADY-VALID, issue-matched inputs. `park-with-cause` never
// reaches this fold (spec: it is executed as a park via the shared protocol at
// authoring time) — filtered out by the caller before folding.

function foldCorrectiveConstraints(inputs) {
  const foldable = inputs.filter((i) => i.op !== "park-with-cause");
  const forbidSurfaces = new Set();
  const thresholds = {};
  let subset = null; // null = no descope-to-subset constraint applied yet (unbounded retained set)
  for (const inp of foldable) {
    const payload = (inp.payload && typeof inp.payload === "object" && !Array.isArray(inp.payload)) ? inp.payload : {};
    if (inp.op === "forbid-surface") {
      // Never-throws posture (module header): a malformed payload reaching the fold —
      // a hand-forged artifact that slipped past validation via a future code path —
      // degrades to an empty contribution, never a crash on `for...of` over a non-array.
      for (const s of Array.isArray(payload.surfaces) ? payload.surfaces : []) forbidSurfaces.add(s);
    } else if (inp.op === "tighten-threshold") {
      const t = (payload.threshold && typeof payload.threshold === "object") ? payload.threshold : null;
      if (t && typeof t.key === "string") {
        const { key, value } = t;
        // Intersection semantics (order-independent fold): keep the STRICTEST
        // (numerically smallest) value across multiple inputs targeting the same key.
        if (!(key in thresholds) || Number(value) < Number(thresholds[key])) thresholds[key] = value;
      }
    } else if (inp.op === "descope-to-subset") {
      // `new Set(x)` throws on a non-iterable (e.g. payload.subset:null) — coerce to
      // [] rather than propagate that crash into the fold.
      const s = new Set(Array.isArray(payload.subset) ? payload.subset : []);
      subset = subset === null ? s : new Set([...subset].filter((x) => s.has(x)));
    }
  }
  let mandate = "narrowed";
  if (subset !== null) {
    if (subset.size === 0) {
      mandate = "empty"; // an explicit empty descope-to-subset IS the empty mandate
    } else {
      const retainedExact = [...subset].filter((s) => !forbidSurfaces.has(s));
      if (retainedExact.length === 0) {
        mandate = "empty"; // every retained entry EXACTLY contradicted by a forbidden surface
      } else {
        // "comparable path-shaped entries only" (spec HOW → Empty-mandate detection):
        // the core does EXACT string membership only, never fuzzy path-prefix
        // reasoning. When a forbidden surface is a strict path-PREFIX (not an exact
        // match) of every still-retained entry, the core cannot safely decide whether
        // that constitutes real coverage — that semantic emptiness is beyond what the
        // CLI can decide, so it degrades to indeterminate (the orchestrator judges,
        // parks on doubt) rather than guessing either way.
        const prefixCovered = (item) => [...forbidSurfaces].some((f) => item !== f && item.startsWith(f.endsWith("/") ? f : f + "/"));
        if (retainedExact.every(prefixCovered)) mandate = "indeterminate";
      }
    }
  }
  const applied = foldable.map((i) => ({ op: i.op, issue: i.issue, authored_at: i.authored_at, cites: i.cites }));
  return {
    mandate,
    constraints: {
      forbid_surfaces: [...forbidSurfaces],
      thresholds,
      descope: subset === null ? null : [...subset],
    },
    applied,
  };
}

// --- I/O: the forge-surface corrective dir + artifact naming ----------------------

function correctiveDir(runDir) {
  return correctiveIntegrityDirs(runDir)[0]; // [corrective-dir, run-ledger.json] — index 0 by construction
}

// List + parse every artifact in the corrective dir. Never throws — an unreadable
// file or a directory that doesn't exist yet both degrade to an empty read, never a
// crash (mirrors the region's never-throws posture, spec HOW → Edge cases).
function readCorrectiveArtifacts(runDir) {
  const dir = correctiveDir(runDir);
  let files = [];
  try { files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : []; } catch { files = []; }
  const out = [];
  for (const f of files) {
    const full = path.join(dir, f);
    let record = null, parseError = null;
    try { record = JSON.parse(fs.readFileSync(full, "utf8")); } catch (e) { parseError = e.message; }
    out.push({ file: f, path: full, record, parseError });
  }
  return out;
}

// Read the run's event log and return the most recent `corrective-consumed` event's
// data for this issue, or null (no prior consumption, or the log is absent/unreadable
// — never throws; a read fault degrades to "no prior record", which only costs one
// possibly-redundant re-append, never a crash or a false idempotency skip).
function lastCorrectiveConsumed(runDir, issue) {
  const p = path.join(runDir, "events.jsonl");
  if (!fs.existsSync(p)) return null;
  let lines;
  try { lines = fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== ""); } catch { return null; }
  let last = null;
  for (const l of lines) {
    let e;
    try { e = JSON.parse(l); } catch { continue; }
    if (e && e.type === "corrective-consumed" && e.issue === issue) last = e;
  }
  return last ? last.data : null;
}

// A stable fingerprint of a fold result — mandate + the applied set (op/issue/authored_at
// per applied input), independent of key order. Two `check` calls that recompute the
// SAME fold produce the same fingerprint; a genuinely new corrective input (or a
// rejected-set change) changes it.
function foldFingerprint(mandate, applied, rejected) {
  const a = applied.map((x) => `${x.op}:${x.authored_at}`).sort();
  const r = rejected.map((x) => x.file).sort();
  return JSON.stringify({ mandate, a, r });
}

// --- I/O: append one governance event (mirrors events.js's own append shape,
// reusing its pure validators — never a second, divergent event-writing path) -------

function appendCorrectiveEvent(runDir, type, issue, data) {
  const runId = path.basename(runDir);
  const eventsPath = path.join(runDir, "events.jsonl");
  const seq = eventLineCount(eventsPath);
  const record = { schema: 1, run_id: runId, seq, ts: new Date().toISOString(), phase: "build", type, issue, data };
  const violations = eventViolations(record, true);
  if (violations.length) return { appended: false, violations }; // never write a malformed record
  fs.appendFileSync(eventsPath, JSON.stringify(record) + "\n");
  return { appended: true, record };
}

// --- CLI: author -------------------------------------------------------------------

function parseFlags(args) {
  const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  const getAll = (f) => { const out = []; for (let i = 0; i < args.length; i++) if (args[i] === f) out.push(args[i + 1]); return out; };
  return { get, getAll };
}

function cmdCorrectiveAuthor(args) {
  const { get, getAll } = parseFlags(args);
  const asJson = args.includes("--json");
  const runDir = get("--run-dir");
  const issue = get("--issue");
  const op = get("--op");
  if (!runDir) { process.stderr.write("faff corrective author: --run-dir is required\n"); return 2; }
  if (!fs.existsSync(path.join(runDir, "run-ledger.json"))) { process.stderr.write(`faff corrective author: no run dir (${runDir} has no run-ledger.json)\n`); return 3; }
  if (!issue) { process.stderr.write("faff corrective author: --issue is required\n"); return 2; }
  if (!op) { process.stderr.write("faff corrective author: --op is required\n"); return 2; }
  const citesSignal = get("--cites-signal");
  if (!citesSignal) { process.stderr.write("faff corrective author: --cites-signal is required — no un-cited corrective input is ever authored\n"); return 2; }

  let payload = {};
  if (op === "park-with-cause") payload = { cause: get("--cause") };
  else if (op === "forbid-surface") payload = { surfaces: getAll("--surface") };
  else if (op === "tighten-threshold") {
    const key = get("--threshold-key"), value = get("--threshold-value");
    payload = { threshold: { key, value: value !== null ? Number(value) : undefined } };
  } else if (op === "descope-to-subset") payload = { subset: getAll("--subset") };
  else payload = {}; // unknown op — validateCorrectiveInput below rejects it structurally

  const citesSeqRaw = get("--cites-seq");
  const record = {
    schema: CORRECTIVE_SCHEMA,
    run_id: path.basename(runDir),
    issue, op, payload,
    cites: {
      signal: citesSignal,
      event_seq: citesSeqRaw !== null && Number.isFinite(Number(citesSeqRaw)) ? Number(citesSeqRaw) : null,
      evidence: get("--cites-evidence") || "",
    },
    authored_at: new Date().toISOString(),
    authored_by: "orchestrator", // informational only — trust comes from the gate at `check`, never this field
  };

  const root = get("--root") || findRoot();
  const cfg = readGovernanceConfig(root);
  const th = sentryThresholds(cfg);
  const violations = validateCorrectiveInput(record, th);
  if (violations.length) {
    for (const x of violations) process.stderr.write(`- ${x}\n`);
    process.stderr.write("faff corrective author: invalid corrective input — nothing written\n");
    return 1;
  }

  const dir = correctiveDir(runDir);
  fs.mkdirSync(dir, { recursive: true });
  // Collision-safe naming: derive the next seq from the HIGHEST existing numeric
  // prefix + 1 (never a bare directory-listing COUNT — a deleted/compacted earlier
  // artifact would make a count-based seq collide with a survivor and silently
  // overwrite it, corrupting the audit trail an authored event already points at).
  // `wx` (write-exclusive) is the second belt: even the max+1 guess can still
  // collide under a genuine concurrent author (two orchestrator sessions), so probe
  // upward on EEXIST rather than ever overwrite silently.
  const existing = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  let maxSeq = -1;
  for (const f of existing) {
    const m = f.match(/^(\d+)-/);
    if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
  }
  let seq = maxSeq + 1;
  let fname, fullPath;
  for (;;) {
    fname = `${String(seq).padStart(4, "0")}-${issue}.json`;
    fullPath = path.join(dir, fname);
    try {
      fs.writeFileSync(fullPath, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      seq++; // occupied (race, or a gap this scan didn't see) — never overwrite, try the next slot
    }
  }

  // data = the full written CorrectiveInput record (events.js's documenting comment
  // for this type) — the audit trail is only as reviewable as what it actually carries.
  const eventResult = appendCorrectiveEvent(runDir, "corrective-authored", issue, { ...record, artifact: fname });

  const out = { written: true, path: fullPath, run_id: record.run_id, issue, op, event_appended: eventResult.appended };
  if (asJson) console.log(JSON.stringify(out));
  else console.log(`corrective: authored ${op} for ${issue} → ${fullPath}${eventResult.appended ? "" : " (WARNING: event append failed)"}`);
  return 0;
}

// --- CLI: check ----------------------------------------------------------------

function cmdCorrectiveCheck(args) {
  const { get } = parseFlags(args);
  const asJson = args.includes("--json");
  const runDir = get("--run-dir");
  const issue = get("--issue");
  if (!runDir) { process.stderr.write("faff corrective check: --run-dir is required\n"); return 2; }
  if (!fs.existsSync(path.join(runDir, "run-ledger.json"))) { process.stderr.write(`faff corrective check: no run dir (${runDir} has no run-ledger.json)\n`); return 3; }
  if (!issue) { process.stderr.write("faff corrective check: --issue is required\n"); return 2; }

  const root = get("--root") || findRoot();
  const cfg = readGovernanceConfig(root);
  const th = sentryThresholds(cfg);

  const artifacts = readCorrectiveArtifacts(runDir);
  // Scope to THIS issue only — an artifact naming a different issue is not ours to
  // report (it is another unit's corrective input, filtered silently, never a false
  // "rejected" for a file this check call has no business judging).
  const mine = artifacts.filter((a) => a.file.endsWith(`-${issue}.json`) || (a.record && a.record.issue === issue));

  const valid = [], rejected = [];
  for (const a of mine) {
    if (a.parseError) { rejected.push({ file: a.file, reasons: [`unparseable JSON: ${a.parseError}`] }); continue; }
    const violations = validateCorrectiveInput(a.record, th);
    if (violations.length) { rejected.push({ file: a.file, reasons: violations }); continue; }
    if (a.record.issue !== issue) { rejected.push({ file: a.file, reasons: [`record.issue '${a.record.issue}' does not match --issue '${issue}'`] }); continue; }
    valid.push(a.record);
  }

  const dirs = correctiveIntegrityDirs(runDir);
  const probe = correctiveIntegrityProbe(process.env, realFsq(), dirs);
  const gate = integrityGate(probe, "corrective");

  if (!gate.trusted) {
    const out = { run_dir: runDir, issue, disposition: gate.disposition, consumed: false, inputs: mine.map((a) => a.record).filter(Boolean), rejected };
    if (asJson) console.log(JSON.stringify(out));
    else console.log(`corrective: check ${issue} → disposition=${out.disposition} consumed=false (${mine.length} artifact(s) surfaced for human relay, never acted on as authentic)`);
    return 0;
  }

  // park-with-cause never reaches the fold — it is executed as a park at authoring
  // time (see the module header); still counted in `applied` reporting via the fold's
  // own filter, so callers see it was recognised, just not folded as a constraint.
  const parkInputs = valid.filter((i) => i.op === "park-with-cause");
  const { mandate, constraints, applied } = foldCorrectiveConstraints(valid);

  // Idempotent re-consumption (spec HOW → edge cases): re-running `check` recomputes
  // the same fold, so `corrective-consumed` is appended per ACTUAL new consumption,
  // not per read — never a phantom duplicate on a wave re-entry that re-checks an
  // unchanged constraint set. Compare against the LAST recorded consumption for this
  // issue; only append when the fold's fingerprint actually changed (a new corrective
  // input arrived, or the rejected set changed).
  const fp = foldFingerprint(mandate, applied, rejected);
  const priorData = lastCorrectiveConsumed(runDir, issue);
  const priorFp = priorData ? foldFingerprint(priorData.mandate, priorData.applied || [], priorData.rejected || []) : null;
  let eventResult;
  if (priorFp !== null && priorFp === fp) {
    eventResult = { appended: false, skipped: "idempotent-duplicate" };
  } else {
    // data = {disposition,mandate,applied,rejected} (events.js's documenting comment
    // for this type) — the full applied/rejected arrays, not just counts, so the
    // trail is actually reviewable (>=2 corrective inputs on one issue must be
    // inspectable here).
    eventResult = appendCorrectiveEvent(runDir, "corrective-consumed", issue, {
      disposition: "trusted", mandate, applied, rejected, parks: parkInputs.length,
    });
  }

  const out = {
    run_dir: runDir, issue, disposition: "trusted", consumed: true,
    mandate, constraints, applied, parks: parkInputs.map((i) => ({ cause: i.payload.cause, cites: i.cites })),
    rejected, event_appended: eventResult.appended, event_skipped: eventResult.skipped || null,
  };
  if (asJson) console.log(JSON.stringify(out));
  else {
    console.log(`corrective: check ${issue} → trusted, mandate=${mandate}, applied=${applied.length}, rejected=${rejected.length}, parks=${parkInputs.length}`);
  }
  return 0;
}

function cmdCorrective(args) {
  if (args.includes("--selftest")) return correctiveSelftest();
  const sub = args.find((a) => !a.startsWith("-"));
  if (sub === "author") return cmdCorrectiveAuthor(args);
  if (sub === "check") return cmdCorrectiveCheck(args);
  process.stderr.write("faff corrective: expected one of author | check (or --selftest)\n");
  return 2;
}

// --- selftest: pure cores only (no filesystem) — mirrors sentry/corrective-integrity ---

function correctiveSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { fail++; console.log(`FAIL ${name}`); } else console.log(`ok   ${name}`); };

  // --- closed op enum: additive is inexpressible ---
  ok("closed op enum has exactly the four subtractive ops", CORRECTIVE_OPS.length === 4 &&
    ["park-with-cause", "forbid-surface", "tighten-threshold", "descope-to-subset"].every((o) => CORRECTIVE_OPS.includes(o)));
  ok("an additive-shaped op is rejected", validateCorrectiveInput({
    schema: 1, run_id: "r", issue: "X", op: "grant-surface", payload: {}, cites: { signal: "fix-review-thrash" },
  }).some((m) => m.includes("closed subtractive enum")));
  ok("an unknown op is rejected the same way (no special-casing)", validateCorrectiveInput({
    schema: 1, run_id: "r", issue: "X", op: "add-scope", payload: { surfaces: ["x"] }, cites: { signal: "fix-review-thrash" },
  }).length > 0);

  // --- required citation: no un-cited input ever validates ---
  ok("missing cites.signal is rejected", validateCorrectiveInput({
    schema: 1, run_id: "r", issue: "X", op: "forbid-surface", payload: { surfaces: ["a"] },
  }).some((m) => m.includes("cites.signal")));
  ok("empty cites.signal is rejected", validateCorrectiveInput({
    schema: 1, run_id: "r", issue: "X", op: "forbid-surface", payload: { surfaces: ["a"] }, cites: { signal: "" },
  }).some((m) => m.includes("cites.signal")));
  ok("a cites.signal not in DERAILMENT_SIGNALS is rejected (a real citation must trace to an actual trigger)", validateCorrectiveInput({
    schema: 1, run_id: "r", issue: "X", op: "forbid-surface", payload: { surfaces: ["a"] }, cites: { signal: "banana" },
  }).some((m) => m.includes("derailment signal vocabulary")));
  ok("every DERAILMENT_SIGNALS member is itself a valid citation", [...DERAILMENT_SIGNALS].every((sig) =>
    validateCorrectiveInput({ schema: 1, run_id: "r", issue: "X", op: "forbid-surface", payload: { surfaces: ["a"] }, cites: { signal: sig } }).length === 0));

  // --- per-op payload shape ---
  ok("forbid-surface requires a non-empty surfaces array", payloadViolations("forbid-surface", {}).length > 0);
  ok("forbid-surface with surfaces passes shape", payloadViolations("forbid-surface", { surfaces: ["a/b"] }).length === 0);
  ok("descope-to-subset accepts an EMPTY subset (shape-valid — semantically the empty mandate)", payloadViolations("descope-to-subset", { subset: [] }).length === 0);
  ok("park-with-cause requires a non-empty cause", payloadViolations("park-with-cause", { cause: "" }).length > 0);
  ok("tighten-threshold requires {key,value}", payloadViolations("tighten-threshold", { threshold: { key: "thrash_n" } }).length > 0);
  ok("tighten-threshold rejects an undecidable key", payloadViolations("tighten-threshold", { threshold: { key: "not_a_real_knob", value: 1 } }).length > 0);

  // --- subtractive-width: strictly tighter only ---
  const th = { thrash_n: 3, failure_k: 3, stall_window_secs: 900, run_elapsed_ceiling_secs: 14400 };
  const mkTighten = (value) => ({ schema: 1, run_id: "r", issue: "X", op: "tighten-threshold", payload: { threshold: { key: "thrash_n", value } }, cites: { signal: "fix-review-thrash" } });
  ok("tighten-threshold strictly SMALLER than effective config → valid", validateCorrectiveInput(mkTighten(2), th).length === 0);
  ok("tighten-threshold EQUAL to effective config → rejected (not strictly tighter)", validateCorrectiveInput(mkTighten(3), th).length > 0);
  ok("tighten-threshold LOOSER than effective config → rejected", validateCorrectiveInput(mkTighten(5), th).length > 0);

  // --- fold: empty mandate detection (decidable core) ---
  const cites = { signal: "fix-review-thrash", event_seq: 1, evidence: "e" };
  const descopeEmpty = { op: "descope-to-subset", issue: "X", authored_at: "t", payload: { subset: [] }, cites };
  ok("explicit empty descope-to-subset → mandate empty", foldCorrectiveConstraints([descopeEmpty]).mandate === "empty");

  const descopeA = { op: "descope-to-subset", issue: "X", authored_at: "t", payload: { subset: ["a", "b"] }, cites };
  const forbidBoth = { op: "forbid-surface", issue: "X", authored_at: "t", payload: { surfaces: ["a", "b"] }, cites };
  ok("descope retains {a,b}, forbid EXACTLY removes both → mandate empty (decidable contradiction)",
    foldCorrectiveConstraints([descopeA, forbidBoth]).mandate === "empty");

  const forbidA = { op: "forbid-surface", issue: "X", authored_at: "t", payload: { surfaces: ["a"] }, cites };
  ok("descope retains {a,b}, forbid removes only 'a' → mandate narrowed (b survives)",
    foldCorrectiveConstraints([descopeA, forbidA]).mandate === "narrowed");

  ok("forbid-surface alone (no descope baseline) → mandate narrowed, never a guessed empty",
    foldCorrectiveConstraints([forbidA]).mandate === "narrowed");

  ok("no inputs at all → mandate narrowed with empty constraints (a no-op)",
    (() => { const r = foldCorrectiveConstraints([]); return r.mandate === "narrowed" && r.constraints.forbid_surfaces.length === 0 && r.constraints.descope === null; })());

  const descopeNested = { op: "descope-to-subset", issue: "X", authored_at: "t", payload: { subset: ["src/foo.js"] }, cites };
  const forbidPrefix = { op: "forbid-surface", issue: "X", authored_at: "t", payload: { surfaces: ["src"] }, cites };
  ok("a forbidden surface that is only a PATH-PREFIX (not exact) of the sole retained entry → indeterminate (semantic emptiness the CLI can't decide)",
    foldCorrectiveConstraints([descopeNested, forbidPrefix]).mandate === "indeterminate");

  // --- fold: multiple corrective inputs — order-independent (intersection) ---
  const tighten5 = { op: "tighten-threshold", issue: "X", authored_at: "t", payload: { threshold: { key: "thrash_n", value: 2 } }, cites };
  const tighten1 = { op: "tighten-threshold", issue: "X", authored_at: "t", payload: { threshold: { key: "thrash_n", value: 1 } }, cites };
  const foldedAB = foldCorrectiveConstraints([tighten5, tighten1]);
  const foldedBA = foldCorrectiveConstraints([tighten1, tighten5]);
  ok("fold keeps the STRICTEST threshold value across multiple inputs, order-independent",
    foldedAB.constraints.thresholds.thrash_n === 1 && foldedBA.constraints.thresholds.thrash_n === 1);

  // --- park-with-cause never reaches the fold ---
  const parkInput = { op: "park-with-cause", issue: "X", authored_at: "t", payload: { cause: "budget" }, cites };
  ok("park-with-cause is filtered out of the fold (executed as a park at authoring time, not a constraint)",
    foldCorrectiveConstraints([parkInput, forbidA]).applied.every((a) => a.op !== "park-with-cause"));

  // --- adversarial-review follow-up: never-throws on a malformed payload reaching
  // the fold (a hand-forged artifact that slipped past validation via some future
  // code path — the module's own claim must hold at the fold too, not just at
  // readCorrectiveArtifacts' JSON-parse boundary) ---
  ok("a forbid-surface payload with a non-array surfaces field degrades to empty, never throws",
    (() => { try { return foldCorrectiveConstraints([{ op: "forbid-surface", issue: "X", authored_at: "t", payload: { surfaces: null }, cites }]).constraints.forbid_surfaces.length === 0; } catch { return false; } })());
  ok("a descope-to-subset payload with subset:null degrades to an empty retained set, never throws",
    (() => { try { const r = foldCorrectiveConstraints([{ op: "descope-to-subset", issue: "X", authored_at: "t", payload: { subset: null }, cites }]); return r.mandate === "empty"; } catch { return false; } })());
  ok("a tighten-threshold payload with a malformed threshold object is skipped, never throws",
    (() => { try { return foldCorrectiveConstraints([{ op: "tighten-threshold", issue: "X", authored_at: "t", payload: { threshold: "not-an-object" }, cites }]).constraints.thresholds !== undefined; } catch { return false; } })());

  // --- adversarial-review follow-up: tighten-threshold FAILS CLOSED when the
  // strictness baseline can't be verified, rather than silently skipping the check ---
  const mkTightenPartial = (value) => ({ schema: 1, run_id: "r", issue: "X", op: "tighten-threshold", payload: { threshold: { key: "thrash_n", value } }, cites: { signal: "fix-review-thrash" } });
  ok("tighten-threshold with a PARTIAL effectiveThresholds missing the target key → rejected (fail closed, never a silent skip)",
    validateCorrectiveInput(mkTightenPartial(1), { failure_k: 3 }).length > 0);
  ok("tighten-threshold with effectiveThresholds OMITTED ENTIRELY (undefined) → shape-only validation, no strictness claim made",
    validateCorrectiveInput(mkTightenPartial(1)).length === 0);

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (corrective --selftest, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  CORRECTIVE_OPS, CORRECTIVE_SCHEMA, TIGHTENABLE_KEYS,
  cmdCorrective, cmdCorrectiveAuthor, cmdCorrectiveCheck,
  correctiveDir, correctiveSelftest, foldCorrectiveConstraints,
  payloadViolations, readCorrectiveArtifacts, validateCorrectiveInput,
};
