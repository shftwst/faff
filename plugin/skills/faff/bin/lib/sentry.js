// ===========================================================================
// === region:governance — sentry — FAFF-49: live-run derailment detection + the hard kill-switch. ===
//
// The active L4 supervisory lane — a fourth lane peer to orchestrator / implementor
// / evaluator. Sentry READS a live run's out-of-band, append-only surface — the
// orchestrator-owned events.jsonl + run-ledger.json + owner.last_heartbeat, plus the
// pure `faff budget check` reading — WITHOUT mutating it, evaluates the v1 derailment
// triggers, and emits DerailmentVerdicts + the chosen intervention (continue | pause |
// correct | abort). `correct` (Sentry-2 / FAFF-278, built FAFF-326) is reachable ONLY
// under an explicit `authority:"available"` parameter — never a raw-signal field; in
// production that parameter is gated behind the still-narrow FAFF-373/FAFF-325
// corrective-integrity attestation, so today's real-world routing is unchanged.
//
// Un-subvertable BY CONSTRUCTION: evaluateDerailment reads ONLY the normalized
// orchestrator surface (a closed input allowlist). The supervised build subagent
// returns only a terminal token and owns no field in Sentry's decision inputs — no
// value it controls can flip a trip to continue (the no-write-path selftest pins this).
//
// CONSUME, never re-implement: budget-breach is `faff budget check`'s {breached,
// outcome} read via a CHILD invocation of THIS bin — Sentry owns no token/cost
// counter. Liveness is owner.last_heartbeat staleness — no new liveness mechanism.
//
// `abort` leaves RESUMABLE state: commit in-flight worktree WIP to its branch
// (park-protocol shape), mark the ledger `aborted-resumable`, never force-reset — the
// run is re-enterable (no corrupt half-state; the in-flight issue stays undispatched
// in the ledger so re-entry resumes it). Pure cores + a thin I/O wrapper + --selftest,
// mirroring budget / heartbeat / events.
//
// FAFF-425: `SentryCheck` gains optional `indeterminate?:bool` + `reason?:string`.
// `check`'s OWN inability to read the run's ledger (explicitly-named and absent, or
// present-but-corrupt) — or a budget consult that hit the same fault reading ITS
// ledger — is a distinct exit-3 own-fault, never coerced into "no derailment"
// (`verdicts:[]`, `intervention:"continue"`, `tripped:false` at exit 0). Resolved via
// the shared `resolveLedgerOrFault` (also used by `budget check`); a legitimately
// empty surface (no run requested, none found) is unaffected and stays the unchanged
// all-clear at exit 0.
//
// FAFF-326 (Sentry-2, Channel A — subtractive corrective authority): the ladder gains
// `correct`, BETWEEN `pause` and `abort` — never above abort, so a co-tripping abort
// signal always wins the ladder-max. `correct` is reachable ONLY when the caller
// passes an explicit `authority` parameter of `"available"` to `evaluateDerailment` —
// NEVER a raw-signal field (AC5's closed-allowlist property stays intact: no value a
// build subagent could inject into the signal bundle can flip this). `cmdSentry`
// derives that parameter from the FAFF-373/FAFF-325 corrective-integrity gate via a
// CHILD invocation of THIS bin (`corrective-integrity --consumer corrective`) —
// mirroring `sentryReadBudget` below — never a direct require of the factory-region
// gate module (this file stays a pure governance span; region direction, ADR 0042).
// Only `fix-review-thrash` maps to `correct` (and only under authority); every other
// signal's mapping, and every abort route, is UNCHANGED.
//
// FAFF-327 (fleet / member-resolved supervision): under the parallel executor, N
// build subagents share ONE run — so run-scoped liveness (evalWallClock, above) goes
// blind to a single stalled member for as long as ANY peer keeps ticking. Sentry stays
// ONE evaluator, member-resolved: `evalMemberStall` reads each in-flight member's OWN
// single-writer `heartbeat.<issue>` file (FAFF-355's named extension point, written by
// `faff heartbeat --unit <issue>`) and emits a verdict carrying `scope:"member"` +
// `member:<issue>` when that ONE member goes stale — never a new fleet-status write,
// never a per-member sentry. A member-scoped wall-clock-runaway caps at `pause`
// (park that member, the fleet runs on) — it NEVER escalates to run-wide `abort` by
// itself; the run-scoped `abort` route stays exactly as it was (all members silent ⇒
// the RUN heartbeat file itself goes stale ⇒ evalWallClock trips as today). Thrash /
// repeated-identical-failure verdicts additionally gain the SAME scope/member fields
// (their evidence already names a single issue) — purely additive attribution; their
// OWN mapped intervention (SIGNAL_TRIP_INTERVENTION, unchanged) is untouched by that
// annotation, so a fleet member that thrashes/repeat-fails still drives the same
// run-scoped response it always did. In-flight-member derivation and fleet
// evaluation are both auto-detected from the existing events+ledger surface — a run
// with no in-flight members computes an empty set and is byte-equivalent to pre-327.
// ===========================================================================


const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { readGovernanceConfig } = require("./budget");
const { atomicWriteLedger, overlayHeartbeat, readHeartbeatFile, readMemberHeartbeatFile } = require("./heartbeat");
const { RUN_HEARTBEAT_STALE_SECS_DEFAULT } = require("./runcheck");
const { ENTRYPOINT, dig, findRoot, latestRunDir, readLedger, resolveLedgerOrFault } = require("./shared-infra");

const DERAILMENT_SIGNALS = new Set([
  "fix-review-thrash", "budget-breach", "repeated-identical-failure",
  "wall-clock-runaway", "scope-drift", "forbidden-side-effect-attempt",
]);
// The v1+Sentry-2 intervention ladder, ASCENDING severity (index = rank). `correct`
// (FAFF-326) sits BETWEEN `pause` and `abort` — a narrowing of a pause-class response
// only, never a weakening of an abort route. Reachable only under an explicit
// `authority:"available"` parameter (see evaluateDerailment below) — never via a
// raw-signal field.
const SENTRY_INTERVENTIONS = ["continue", "pause", "correct", "abort"];
// The intervention a signal routes to WHEN IT TRIPS. warn-severity verdicts never
// escalate past `continue`; scope-drift is advisory (warn-only ⇒ never reaches here).
// fix-review-thrash's mapped value is upgraded pause→correct in evaluateDerailment's
// aggregation loop, IFF the explicit authority parameter is "available" — this map
// itself is UNCHANGED (still names "pause"), so a reader of this table alone sees
// exactly the v1 default/degraded behaviour.
const SIGNAL_TRIP_INTERVENTION = {
  "budget-breach": "abort",
  "wall-clock-runaway": "abort",
  "repeated-identical-failure": "abort",
  "forbidden-side-effect-attempt": "abort",
  "fix-review-thrash": "pause",
  "scope-drift": "continue",
};
// The one signal Channel A may upgrade to `correct`, and only when authority is
// available (ADR-0039: thrash-only at v1 — precisely the stop-and-redispatch shape).
const CORRECTABLE_SIGNAL = "fix-review-thrash";
// v1 default thresholds — config values (overridable via `.faffrc` sentry.*).
// stall_window mirrors the heartbeat staleness window for consistency.
const SENTRY_THRESHOLD_DEFAULTS = {
  thrash_n: 3,                                      // >=N build-starts on one issue, no ship → trip
  failure_k: 3,                                     // same failure fingerprint >=K times → trip
  stall_window_secs: RUN_HEARTBEAT_STALE_SECS_DEFAULT, // heartbeat staleness ceiling (900s)
  run_elapsed_ceiling_secs: 14400,                  // 4h wall-clock run-elapsed ceiling
};

// Resolve thresholds from config, falling back to the documented v1 defaults. A
// non-positive / non-numeric config value falls back (never weakens to 0/∞ silently).
function sentryThresholds(cfg) {
  const d = SENTRY_THRESHOLD_DEFAULTS;
  const num = (v, def) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : def; };
  return {
    thrash_n: num(dig(cfg, "sentry.thrash_n"), d.thrash_n),
    failure_k: num(dig(cfg, "sentry.failure_k"), d.failure_k),
    stall_window_secs: num(dig(cfg, "sentry.stall_window_secs"), d.stall_window_secs),
    run_elapsed_ceiling_secs: num(dig(cfg, "sentry.run_elapsed_ceiling_secs"), d.run_elapsed_ceiling_secs),
  };
}

// Coerce a raw signal bundle onto the CLOSED orchestrator-surface input set. This is
// the structural heart of the un-subvertable property (AC5): only these keys are ever
// read, so any foreign key a supervised subagent might inject is dropped here and never
// reaches a predicate. Never throws.
function normalizeSentrySignals(raw) {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
  const b = (r.budget && typeof r.budget === "object" && !Array.isArray(r.budget)) ? r.budget : {};
  return {
    events: Array.isArray(r.events) ? r.events.filter((e) => e && typeof e === "object") : [],
    ledger: (r.ledger && typeof r.ledger === "object" && !Array.isArray(r.ledger)) ? r.ledger : {},
    budget: {
      breached: Array.isArray(b.breached) ? b.breached.filter((x) => typeof x === "string") : [],
      outcome: typeof b.outcome === "string" ? b.outcome : "none",
    },
    now_ms: Number.isFinite(r.now_ms) ? r.now_ms : Date.now(),
    // Advisory hints the ORCHESTRATOR (never the build subagent) may set; default off.
    scope_drift: r.scope_drift === true,
    forbidden_side_effect: r.forbidden_side_effect === true,
    // FAFF-355: which liveness source the caller's overlayHeartbeat call reported
    // ("heartbeat-file" | "owner.last_heartbeat" | null) — threaded through to
    // evalWallClock's evidence so it never names a source it no longer reads.
    heartbeat_source: typeof r.heartbeat_source === "string" ? r.heartbeat_source : null,
    // FAFF-327: { issue -> iso|null } — the caller's per-member `heartbeat.<issue>`
    // reads (filesystem access happens in cmdSentry, never here). Sanitized to a
    // plain map of string keys to string|null values only — any other shape a
    // build subagent might forge onto this closed surface is dropped, mirroring the
    // rest of this normalizer's AC5 posture.
    member_beats: (() => {
      const raw = (r.member_beats && typeof r.member_beats === "object" && !Array.isArray(r.member_beats)) ? r.member_beats : {};
      const out = {};
      for (const k of Object.keys(raw)) {
        if (typeof raw[k] === "string" || raw[k] === null) out[k] = raw[k];
      }
      return out;
    })(),
  };
}

// owner.last_heartbeat age in seconds (null if absent/unparseable). Reused from the
// FAFF-205 liveness model — Sentry derives nothing new.
function sentryHeartbeatAgeSecs(ledger, nowMs) {
  const owner = ledger && ledger.owner;
  if (!owner) return null;
  const t = Date.parse(owner.last_heartbeat);
  return Number.isFinite(t) ? (nowMs - t) / 1000 : null;
}
function sentryRunElapsedSecs(ledger, nowMs) {
  const owner = ledger && ledger.owner;
  if (!owner) return null;
  const t = Date.parse(owner.started_at);
  return Number.isFinite(t) ? (nowMs - t) / 1000 : null;
}

// --- per-trigger predicates (PURE; each returns a DerailmentVerdict or null) ---

// budget-breach — CONSUMED from `faff budget check`'s {breached,outcome}; NO token/cost
// math here. stop/escalate are hard breaches (trip); narrow is a soften (warn).
function evalBudgetBreach(budget) {
  if (!budget || !Array.isArray(budget.breached) || budget.breached.length === 0) return null;
  const outcome = budget.outcome;
  const severity = (outcome === "stop" || outcome === "escalate") ? "trip" : "warn";
  return { signal: "budget-breach", severity, evidence: { budget_outcome: outcome, breached: budget.breached.slice() } };
}

// wall-clock-runaway — heartbeat staleness beyond the window OR run-elapsed beyond the
// ceiling. Only a RUNNING owner can run away (a done/unowned run never trips).
// `heartbeatSource` (FAFF-355) names WHICH liveness source produced ledger.owner.
// last_heartbeat — the caller overlays the dedicated heartbeat file before calling in,
// so evidence never claims a source ("owner.last_heartbeat") it no longer reads.
function evalWallClock(ledger, nowMs, th, heartbeatSource) {
  const owner = ledger && ledger.owner;
  if (!owner || owner.status !== "running") return null;
  const age = sentryHeartbeatAgeSecs(ledger, nowMs);
  const elapsed = sentryRunElapsedSecs(ledger, nowMs);
  const staleTrip = age != null && age > th.stall_window_secs;
  const elapsedTrip = elapsed != null && elapsed > th.run_elapsed_ceiling_secs;
  if (!staleTrip && !elapsedTrip) return null;
  return {
    signal: "wall-clock-runaway", severity: "trip",
    evidence: {
      heartbeat_source: heartbeatSource ?? null,
      heartbeat_age_secs: age != null ? Math.round(age) : null,
      run_elapsed_secs: elapsed != null ? Math.round(elapsed) : null,
      tripped_on: staleTrip ? "heartbeat-staleness" : "run-elapsed",
    },
  };
}

// fix-review-thrash — >= thrash_n build-start events for ONE issue with no shipped
// outcome (a re-dispatch loop making no progress). Event-derived → coarse by design.
function evalThrash(events, th) {
  const starts = {}, lastSeq = {}, shipped = new Set();
  for (const e of events) {
    if (e.type === "build-start" && e.issue) {
      starts[e.issue] = (starts[e.issue] || 0) + 1;
      if (Number.isInteger(e.seq)) lastSeq[e.issue] = e.seq;
    }
    if (e.type === "issue-outcome" && e.issue && e.data && e.data.outcome === "shipped") shipped.add(e.issue);
  }
  let worst = null;
  for (const issue of Object.keys(starts)) {
    if (shipped.has(issue)) continue;
    if (starts[issue] >= th.thrash_n && (!worst || starts[issue] > worst.count)) {
      worst = { issue, count: starts[issue], seq: lastSeq[issue] };
    }
  }
  if (!worst) return null;
  // FAFF-327: additive scope/member attribution — evidence already names a single
  // issue (worst.issue is by construction the one worst offender), so this always
  // applies. Purely informational: the roll-up in evaluateDerailment keys the
  // pause-cap off signal==="wall-clock-runaway" (evalMemberStall's own output), so
  // this annotation never changes fix-review-thrash's own SIGNAL_TRIP_INTERVENTION
  // mapping (already "pause", unaffected either way).
  return { signal: "fix-review-thrash", severity: "trip", scope: "member", member: worst.issue, evidence: { issue: worst.issue, build_starts: worst.count, event_seq: worst.seq ?? null } };
}

// repeated-identical-failure — same failure fingerprint >= failure_k times. A failure
// is a park event or an errored issue-outcome; the fingerprint prefers an explicit
// data.fingerprint, else issue + the failure key.
function sentryFailureFingerprint(e) {
  if (e.data && typeof e.data.fingerprint === "string" && e.data.fingerprint) return e.data.fingerprint;
  const issue = e.issue || "?";
  if (e.type === "park") return `${issue}:park:${(e.data && (e.data.reason || e.data.root_cause)) || "park"}`;
  if (e.type === "issue-outcome") return `${issue}:outcome:${(e.data && e.data.outcome) || "?"}`;
  return null;
}
function evalRepeatedFailure(events, th) {
  const counts = {}, lastSeq = {}, issuesByFp = {};
  for (const e of events) {
    const isFailure = (e.type === "park") || (e.type === "issue-outcome" && e.data && e.data.outcome === "errored");
    if (!isFailure) continue;
    const fp = sentryFailureFingerprint(e);
    if (!fp) continue;
    counts[fp] = (counts[fp] || 0) + 1;
    if (Number.isInteger(e.seq)) lastSeq[fp] = e.seq;
    // FAFF-327: track which issue(s) contributed to this fingerprint, so the verdict
    // can be attributed to a single member IFF every occurrence names the same one.
    if (!issuesByFp[fp]) issuesByFp[fp] = new Set();
    if (e.issue) issuesByFp[fp].add(e.issue);
  }
  let worst = null;
  for (const fp of Object.keys(counts)) {
    if (counts[fp] >= th.failure_k && (!worst || counts[fp] > worst.count)) worst = { fp, count: counts[fp], seq: lastSeq[fp] };
  }
  if (!worst) return null;
  const verdict = { signal: "repeated-identical-failure", severity: "trip", evidence: { fingerprint: worst.fp, count: worst.count, event_seq: worst.seq ?? null } };
  // FAFF-327: additive scope/member attribution, ONLY when the fingerprint is
  // unambiguously one issue's (a shared explicit data.fingerprint across issues
  // stays run-scoped — no false single-member attribution). Purely informational:
  // the roll-up keys the pause-cap off signal==="wall-clock-runaway", so this never
  // changes repeated-identical-failure's own mapped intervention ("abort", unchanged
  // — a fleet member that keeps failing identically still aborts the run, exactly as
  // a sequential run always did).
  const issues = issuesByFp[worst.fp];
  if (issues && issues.size === 1) {
    verdict.scope = "member";
    verdict.member = [...issues][0];
  }
  return verdict;
}

// scope-drift — ADVISORY (warn only, never trips). v1 heuristic: surfaced when the
// orchestrator flags it (signals.scope_drift) or an event carries data.scope_drift.
function evalScopeDrift(signals) {
  let seq = null, hit = signals.scope_drift === true;
  for (const e of signals.events) {
    if (e.data && e.data.scope_drift === true) { hit = true; if (Number.isInteger(e.seq)) seq = e.seq; }
  }
  if (!hit) return null;
  return { signal: "scope-drift", severity: "warn", evidence: { event_seq: seq, advisory: true } };
}

// forbidden-side-effect-attempt — consumes the FAFF-42 boundary. DEGRADES to no-signal
// unless the orchestrator supplies the signal — via `sentry check`'s `--forbidden-side-
// effect` CLI flag (FAFF-352, the effects→sentry bridge: the orchestrator sets it IFF
// `faff effects check` reported any_escape at this checkpoint) or an event-path
// `data.forbidden_side_effect` key (signals.forbidden_side_effect / event.data, below).
function evalForbiddenSideEffect(signals) {
  let seq = null, hit = signals.forbidden_side_effect === true;
  for (const e of signals.events) {
    if (e.data && e.data.forbidden_side_effect === true) { hit = true; if (Number.isInteger(e.seq)) seq = e.seq; }
  }
  if (!hit) return null;
  return { signal: "forbidden-side-effect-attempt", severity: "trip", evidence: { event_seq: seq } };
}

// FAFF-327 — in-flight members: build-start events minus terminal ledger outcomes.
// PURE (reads only the already-normalized events array + ledger.outcomes — no fs).
// Dispatch is what starts a member's liveness obligation, so the member's LATEST
// build-start ts is also its age baseline (closes the never-ticked-member hole: a
// member that dies before its first heartbeat tick still ages from dispatch, not
// from "never"). An event with no issue or no parseable ts is skipped — no baseline,
// no obligation. This is the SAME derivation cmdSentry uses to decide which
// heartbeat.<issue> files to read, so the two never drift (one function, two callers).
function sentryInflightMembers(events, ledger) {
  const outcomes = (ledger && ledger.outcomes && typeof ledger.outcomes === "object" && !Array.isArray(ledger.outcomes)) ? ledger.outcomes : {};
  const lastStart = {};
  for (const e of (Array.isArray(events) ? events : [])) {
    if (!e || e.type !== "build-start" || !e.issue) continue;
    const ts = typeof e.ts === "string" ? e.ts : null;
    if (!ts || !Number.isFinite(Date.parse(ts))) continue;
    const prev = lastStart[e.issue];
    if (!prev || Date.parse(ts) > Date.parse(prev)) lastStart[e.issue] = ts;
  }
  return Object.keys(lastStart)
    .filter((issue) => !Object.prototype.hasOwnProperty.call(outcomes, issue))
    .map((issue) => ({ issue, last_build_start_ts: lastStart[issue] }));
}

// FAFF-327 — the fleet member-stall predicate. PURE: takes the already-derived
// in-flight list + an already-read member-heartbeat map (cmdSentry does the fs work);
// no filesystem access here, mirroring every other predicate in this file.
//
// Per member: age = now - max(heartbeat.<issue> timestamp, last build-start ts).
// Unparseable/absent on BOTH inputs -> no verdict for that member (fails TOWARD
// run-level supervision rather than manufacturing a false trip on ambiguous input —
// the same "absent is a legitimate liveness input" posture heartbeat.js already
// takes). Trips only past th.stall_window_secs, mirroring the run-level window
// (reused, not a new knob — see the spec's OUT-OF-SCOPE extension point).
function evalMemberStall(inflight, memberBeats, nowMs, th) {
  const beats = (memberBeats && typeof memberBeats === "object" && !Array.isArray(memberBeats)) ? memberBeats : {};
  const verdicts = [];
  for (const m of (Array.isArray(inflight) ? inflight : [])) {
    if (!m || typeof m.issue !== "string") continue;
    const beatIso = Object.prototype.hasOwnProperty.call(beats, m.issue) ? beats[m.issue] : null;
    const beatMs = beatIso != null ? Date.parse(beatIso) : NaN;
    const startMs = m.last_build_start_ts != null ? Date.parse(m.last_build_start_ts) : NaN;
    const beatOk = Number.isFinite(beatMs);
    const startOk = Number.isFinite(startMs);
    if (!beatOk && !startOk) continue; // both absent/unparseable -> no verdict (fail toward run-level supervision)
    const baseMs = beatOk && startOk ? Math.max(beatMs, startMs) : (beatOk ? beatMs : startMs);
    const source = beatOk && (!startOk || beatMs >= startMs) ? `heartbeat.${m.issue}` : "build-start";
    const age = (nowMs - baseMs) / 1000;
    if (age > th.stall_window_secs) {
      verdicts.push({
        signal: "wall-clock-runaway", severity: "trip", scope: "member", member: m.issue,
        evidence: { heartbeat_age_secs: Math.round(age), source },
      });
    }
  }
  return verdicts;
}

// Fold the surface into the verdict set + the chosen v1+Sentry-2 intervention. Reads
// ONLY the normalized orchestrator surface (AC5: no subagent-controlled field is
// consulted). The aggregate intervention is the ladder-max over tripped verdicts;
// warn-only ⇒ continue.
//
// FAFF-326: `authority` is a THIRD, EXPLICIT function parameter — deliberately NOT a
// member of `rawSignals` / `normalizeSentrySignals`'s closed allowlist, so no value a
// build subagent could inject into the signal bundle can reach it (AC5-shaped
// no-foreign-authorship). Default `"channel-D-only"` (unavailable) — matches v1
// production behaviour byte-for-byte when the caller passes nothing. Only
// `"available"` (the literal string) ever upgrades the CORRECTABLE_SIGNAL's mapped
// `pause` to `correct`; anything else (including a truthy-but-wrong-typed value)
// degrades to unavailable, never a silent enable.
function evaluateDerailment(rawSignals, thresholds, authority) {
  const s = normalizeSentrySignals(rawSignals);
  const th = thresholds || SENTRY_THRESHOLD_DEFAULTS;
  const authorityAvailable = authority === "available";
  const verdicts = [];
  const push = (v) => { if (v && DERAILMENT_SIGNALS.has(v.signal) && (v.severity === "warn" || v.severity === "trip")) verdicts.push(v); };
  push(evalBudgetBreach(s.budget));
  push(evalWallClock(s.ledger, s.now_ms, th, s.heartbeat_source));
  push(evalThrash(s.events, th));
  push(evalRepeatedFailure(s.events, th));
  push(evalScopeDrift(s));
  push(evalForbiddenSideEffect(s));
  // FAFF-327: fleet member-stall — auto-detected (no flag). In-flight members derive
  // from the SAME normalized events+ledger surface already in scope here; a run with
  // none (sequential/legacy/no build-start events) yields an empty list and
  // evalMemberStall trivially returns [] — byte-equivalent to pre-327 output.
  const inflight = sentryInflightMembers(s.events, s.ledger);
  for (const v of evalMemberStall(inflight, s.member_beats, s.now_ms, th)) push(v);

  let intervention = "continue", tripped = false;
  for (const v of verdicts) {
    if (v.severity !== "trip") continue;
    tripped = true;
    let mapped = SIGNAL_TRIP_INTERVENTION[v.signal] || "pause";
    // The ONLY upgrade path: fix-review-thrash's pause -> correct, gated on the
    // explicit authority parameter. Every other mapping (incl. every abort route) is
    // untouched — never a weakening, never a widening to another signal.
    if (v.signal === CORRECTABLE_SIGNAL && mapped === "pause" && authorityAvailable) mapped = "correct";
    // FAFF-327: the ONE cap path — a member-scoped wall-clock-runaway (evalMemberStall's
    // own output, identified by signal+scope together) never contributes more than
    // "pause" to the ladder-max. This checks BOTH signal and scope so thrash/repeated-
    // failure's own mapping is never touched merely because they also carry a
    // scope:"member" attribution annotation (additive metadata only — see their
    // predicates above); a member trip never escalates to run "abort" by itself, but
    // the run-scoped wall-clock-runaway (no scope field) is completely unaffected.
    if (v.signal === "wall-clock-runaway" && v.scope === "member") mapped = "pause";
    if (SENTRY_INTERVENTIONS.indexOf(mapped) > SENTRY_INTERVENTIONS.indexOf(intervention)) intervention = mapped;
  }
  return { verdicts, intervention, tripped };
}

// PURE ledger-mark for `abort` (mirrors applyHeartbeat). Records an `aborted-resumable`
// abort entry + flips a RUNNING owner to status aborted-resumable. NEVER resurrects a
// done/unowned run, NEVER force-resets, NEVER writes outcomes — the in-flight issue
// stays undispatched so the run is re-enterable. Returns { marked }.
function applySentryAbort(ledger, rec) {
  if (!ledger || typeof ledger !== "object") return { marked: false };
  // "issue" — the unit key (compat dialect; rename deferred to extraction schema-v2)
  ledger.abort = {
    status: "aborted-resumable",
    at: rec.at,
    ...(rec.issue ? { issue: rec.issue } : {}),
    ...(rec.signal ? { signal: rec.signal } : {}),
    ...(rec.wip_commit ? { wip_commit: rec.wip_commit } : {}),
    // FAFF-457: record any secret-class paths the WIP stage deliberately omitted,
    // so the operator knows the resumable WIP does not carry them.
    ...(Array.isArray(rec.wip_skipped_secret_class) && rec.wip_skipped_secret_class.length
      ? { wip_skipped_secret_class: rec.wip_skipped_secret_class } : {}),
  };
  const owner = ledger.owner;
  if (owner && owner.status === "running") owner.status = "aborted-resumable";
  return { marked: true };
}

// Read the run's append-only event log into a record array (absent ⇒ []). Tolerant of
// blank/unparseable lines (parity with `events read`). READ-ONLY.
function sentryReadEvents(runDir) {
  const p = path.join(runDir, "events.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== "")
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// CONSUME `faff budget check --json` via a CHILD invocation of THIS bin — FAFF-36 owns
// the math; Sentry never re-derives a counter. FAFF-425: a fault reading the child's
// OWN ledger must never be read as "no breach" — a clean parse carrying
// outcome:"indeterminate" propagates as-is, and any non-zero exit / unparseable
// stdout (the child crashed, or couldn't even get as far as its own JSON) is ITSELF
// a read fault and degrades to indeterminate too (was the unbreached default before
// FAFF-425 — that swallow is exactly the "quietly blind" failure this closes).
function sentryReadBudget(runDir) {
  try {
    const r = spawnSync(process.execPath, [ENTRYPOINT, "budget", "check", "--json", "--run-dir", runDir], { encoding: "utf8" });
    if (r.status === 0 && r.stdout) {
      const j = JSON.parse(r.stdout.trim());
      if (j.outcome === "indeterminate") return { breached: [], outcome: "indeterminate" };
      return { breached: Array.isArray(j.breached) ? j.breached : [], outcome: typeof j.outcome === "string" ? j.outcome : "none" };
    }
    // FAFF-425 (adversarial-review follow-up): the child itself faulted — exit 3
    // (its OWN ledger fault) lands here (status!==0), as does exit 2/any other
    // non-zero and a zero-status-but-empty-stdout. EXPLICIT, not a fall-through
    // relying on the catch below's default: a non-OK child is itself a read
    // fault and must never be read as "no breach".
    return { breached: [], outcome: "indeterminate" };
  } catch {
    // spawnSync/JSON.parse threw outright (e.g. the child binary itself is
    // unreachable) — same own-fault classification as above.
    return { breached: [], outcome: "indeterminate" };
  }
}

// FAFF-326: derive the `authority` parameter from the FAFF-373/FAFF-325
// corrective-integrity gate via a CHILD invocation of THIS bin — Sentry owns no
// direct require of the factory-region gate module (region direction, ADR 0042: a
// governance span never references a factory identifier; a self-spawn of this same
// bin is a process boundary, invisible to that lint by design — mirrors
// sentryReadBudget exactly). Fail-safe: ANY non-OK child (non-zero exit, unparseable
// stdout, spawn failure) degrades to "channel-D-only" — NEVER "available". Only a
// clean { trusted: true } reply from `corrective-integrity --consumer corrective`
// (FAFF-373's own asserted/degraded gate — no crypto, no signature) ever returns
// "available".
function sentryReadCorrectiveAuthority(runDir) {
  try {
    const r = spawnSync(process.execPath, [ENTRYPOINT, "corrective-integrity", "--consumer", "corrective", "--run-dir", runDir, "--json"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout) {
      const j = JSON.parse(r.stdout.trim());
      return j.trusted === true ? "available" : "channel-D-only";
    }
    return "channel-D-only";
  } catch {
    return "channel-D-only";
  }
}

// Hermetic, TEST-ONLY clock seam for `sentry check` (FAFF-301). Resolves the
// instant time-based signals (wall-clock-runaway) are computed against, so a test
// can pin `now` across two subprocess calls and stop flaking on the time of day.
// Precedence: --now-ms > --now <ISO> > Date.now() (production default).
// An injected-but-unparseable value is a HARD ERROR (never a silent Date.now()
// fall-through), mirroring `park-history --now`.
//
// Deliberately EXPLICIT-FLAG-ONLY — no ambient/env form. The seam is exercised
// only via per-invocation flags a caller types; there is no inherited `$FAFF_NOW_MS`
// that a child process could carry up into a parent's invocation. `sentry check` is
// the orchestrator-owned supervisory surface (gateway: "un-subvertable by
// construction"); keeping the only override explicit means an isolated build
// subagent has no ambient channel into the orchestrator's clock either. (And
// budget-breach, the abort driver, is clock-independent regardless, so no clock
// value can relax it — AC5 asserts this directly.)
function resolveSentryNow(get) {
  const nowMsArg = get("--now-ms");
  if (nowMsArg != null) {
    const n = Number(nowMsArg);
    if (!Number.isFinite(n)) return { error: `--now-ms '${nowMsArg}' is not a finite epoch-millis value` };
    return { now_ms: n };
  }
  const nowArg = get("--now");
  if (nowArg != null) {
    const n = Date.parse(nowArg);
    if (Number.isNaN(n)) return { error: `--now '${nowArg}' is not a parseable ISO-8601 timestamp` };
    return { now_ms: n };
  }
  return { now_ms: Date.now() }; // unchanged production default
}

// FAFF-425: the loud, fail-closed reply for `sentry check`'s own-fault path — the
// run's ledger could not be read at all (explicitly-named and absent, or
// present-but-corrupt), OR the budget consult it depends on hit the same fault.
// NEVER folds into the unbreached/no-derailment default; a distinct exit 3,
// mirroring `faff budget check`'s own-fault reply and the existing `effects check`
// exit-3 convention ("run-dir/ledger missing"). `intervention` stays "continue" and
// `tripped` stays false — indeterminate is its OWN state, not a synthesized trip.
function sentryIndeterminate(reason, asJson, runDir = null) {
  const payload = { run_dir: runDir, verdicts: [], intervention: "continue", tripped: false, indeterminate: true, reason };
  if (asJson) console.log(JSON.stringify(payload));
  else process.stderr.write(`sentry: INDETERMINATE — ${reason} (fail closed)\n`);
  return 3;
}

function cmdSentry(args) {
  if (args.includes("--selftest")) return sentrySelftest();
  const sub = args.find((a) => !a.startsWith("-"));
  const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  const asJson = args.includes("--json");
  const root = get("--root") || findRoot();

  let runDir = get("--run-dir") || process.env.FAFF_RUN_DIR || null;
  if (runDir && !fs.existsSync(path.join(runDir, "run-ledger.json"))) runDir = null;
  if (!runDir) runDir = latestRunDir(root);

  if (sub === "check") {
    // FAFF-352: the CLI surface of the effects→sentry bridge. The orchestrator runs
    // `faff effects check` immediately before this call and passes the flag IFF
    // any_escape is true — a two-line reach onto the signals.forbidden_side_effect
    // seam that already existed (normalizeSentrySignals / evalForbiddenSideEffect,
    // untouched). Boolean, no value; absent ⇒ unchanged degraded (no-signal) behaviour.
    const forbiddenSideEffect = args.includes("--forbidden-side-effect");
    const cfg = readGovernanceConfig(root);
    const th = sentryThresholds(cfg);
    const nowRes = resolveSentryNow(get); // hermetic test-only clock seam (FAFF-301) — checked before ledger resolution
    if (nowRes.error) { process.stderr.write(`faff sentry check: ${nowRes.error}\n`); return 2; }

    // FAFF-425: the run's own inability to read its ledger is a distinct, loud
    // "indeterminate" fault — never silently coerced into "no derailment". A
    // legitimately empty surface (no run requested, none found) is unaffected.
    const resolved = resolveLedgerOrFault(get, root);
    if (resolved.fault) return sentryIndeterminate(resolved.fault, asJson, resolved.runDir || null);

    let ledger = {}, events = [], budget = { breached: [], outcome: "none" }, heartbeatSource = null;
    if (!resolved.empty) {
      ledger = resolved.ledger;
      // FAFF-355: overlay the dedicated heartbeat file over owner.last_heartbeat ONCE,
      // here, where the ledger is loaded — evalWallClock stays filesystem-free and
      // its evidence carries whichever source the overlay reports.
      heartbeatSource = overlayHeartbeat(ledger, readHeartbeatFile(resolved.runDir)).source;
      events = sentryReadEvents(resolved.runDir);
      const injected = get("--budget-json"); // hermetic-test hook; default CONSUMES the CLI
      // FAFF-425 (adversarial-review follow-up): unparseable injected JSON is itself an
      // own-fault — it must NOT fall back to "none" (that is exactly the "quietly blind"
      // swallow this ticket closes, just relocated to the test-hook seam instead of the
      // real sentryReadBudget path).
      budget = injected
        ? (() => { try { return JSON.parse(injected); } catch { return { breached: [], outcome: "indeterminate" }; } })()
        : sentryReadBudget(resolved.runDir);
      // FAFF-425: a budget consult that couldn't read ITS ledger is an own-fault too
      // — handled here, not routed through evalBudgetBreach (breached stays [] for
      // "indeterminate", so that predicate would just null out, silently losing the
      // fault rather than surfacing it).
      if (budget.outcome === "indeterminate") {
        return sentryIndeterminate("budget consult indeterminate (ledger unreadable)", asJson, resolved.runDir);
      }
    }
    const checkedRunDir = resolved.empty ? null : resolved.runDir;
    // FAFF-326: authority is an EXPLICIT parameter, never a raw-signal field.
    // --authority is a hermetic TEST-ONLY seam (explicit-flag-only, mirrors
    // --budget-json / --now-ms — no ambient/env form); production always derives it
    // from the corrective-integrity gate via sentryReadCorrectiveAuthority (a
    // self-spawn child call, "channel-D-only" today until FAFF-325's declaration is
    // actually asserted for this run).
    const authorityFlag = get("--authority");
    let authority;
    if (authorityFlag != null) {
      if (authorityFlag !== "available" && authorityFlag !== "channel-D-only") {
        process.stderr.write(`faff sentry check: --authority '${authorityFlag}' must be 'available' or 'channel-D-only'\n`);
        return 2;
      }
      authority = authorityFlag;
    } else {
      authority = resolved.empty ? "channel-D-only" : sentryReadCorrectiveAuthority(resolved.runDir);
    }
    // FAFF-327: read each in-flight member's OWN heartbeat.<issue> file (the only
    // filesystem access for the fleet path — evalMemberStall itself stays pure). Uses
    // the SAME in-flight derivation evaluateDerailment applies internally, so the two
    // never diverge on which issues get evaluated. A member-shaped hermetic override
    // (--member-beats-json) mirrors --budget-json for deterministic tests; production
    // always reads real files.
    let memberBeats = {};
    if (!resolved.empty) {
      const injectedBeats = get("--member-beats-json");
      if (injectedBeats != null) {
        try { memberBeats = JSON.parse(injectedBeats); } catch { memberBeats = {}; }
      } else {
        for (const m of sentryInflightMembers(events, ledger)) {
          memberBeats[m.issue] = readMemberHeartbeatFile(resolved.runDir, m.issue);
        }
      }
    }
    const result = evaluateDerailment({ events, ledger, budget, now_ms: nowRes.now_ms, heartbeat_source: heartbeatSource, forbidden_side_effect: forbiddenSideEffect, member_beats: memberBeats }, th, authority);
    const payload = { run_dir: checkedRunDir, verdicts: result.verdicts, intervention: result.intervention, tripped: result.tripped, thresholds: th, authority };
    if (asJson) { console.log(JSON.stringify(payload)); return 0; }
    if (!result.verdicts.length) console.log("sentry: no derailment — intervention: continue");
    else {
      console.log(`sentry: ${result.verdicts.length} verdict(s) — intervention: ${result.intervention}${result.tripped ? " (TRIP)" : ""}`);
      for (const v of result.verdicts) console.log(`  - ${v.signal} [${v.severity}]`);
    }
    return 0; // report-only; the orchestrator acts on the intervention
  }

  if (sub === "abort") {
    if (!runDir) { process.stderr.write("faff sentry abort: no run dir (pass --run-dir, set $FAFF_RUN_DIR, or run inside a run)\n"); return 3; }
    let ledger;
    try { ledger = readLedger(runDir); }
    catch (e) { process.stderr.write(`faff sentry abort: malformed ledger in ${runDir}: ${e.message}\n`); return 2; }
    const issue = get("--issue"), signal = get("--signal"), worktree = get("--worktree");
    let wipCommit = null;
    let wipSkipped = [];   // FAFF-457: secret-class paths the WIP stage deliberately omitted
    if (worktree) {
      // Commit in-flight WIP to the branch — park-protocol shape, NEVER force-reset.
      // FAFF-457: stage SELECTIVELY (never `git add -A`) so a stray untracked secret
      // (e.g. a live `.env`) is never swept into the resumable WIP commit. The
      // selective-stage discipline lives in ONE home (bin/lib/stage.js); this
      // governance span reaches it through a CHILD spawn of the bin (`stage-guard
      // --mode wip`), NOT a require of the factory module (ADR-0042 direction rule) —
      // the same child-invocation pattern sentry uses for corrective-integrity.
      try {
        const isRepo = spawnSync("git", ["-C", worktree, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
        if (isRepo.status === 0) {
          const wip = spawnSync(process.execPath, [ENTRYPOINT, "stage-guard", "--worktree", worktree, "--mode", "wip", "--json"], { encoding: "utf8" });
          let stagedNonempty = false;
          if (wip.status === 0 && wip.stdout.trim()) {
            try { const j = JSON.parse(wip.stdout); stagedNonempty = !!j.staged_nonempty; wipSkipped = Array.isArray(j.skipped) ? j.skipped : []; }
            catch { /* fall through — nothing staged recorded */ }
          } else if (wip.status !== 0) {
            // FAFF-457: the selective-stage child failed (best-effort). Fall back to
            // staging TRACKED changes only — a tracked file is already in history so it
            // can never be a stray untracked secret — preserving tracked WIP resumability
            // without a bulk `git add -A`, even when the guard child is unavailable.
            spawnSync("git", ["-C", worktree, "add", "-u"], { encoding: "utf8" });
            const dq = spawnSync("git", ["-C", worktree, "diff", "--cached", "--quiet"], { encoding: "utf8" });
            stagedNonempty = dq.status === 1;
          }
          if (stagedNonempty) {
            const msg = `wip: sentry abort (resumable)${issue ? " " + issue : ""}${signal ? " — " + signal : ""}`;
            const ci = spawnSync("git", ["-C", worktree, "commit", "-m", msg], { encoding: "utf8" });
            if (ci.status === 0) {
              const sha = spawnSync("git", ["-C", worktree, "rev-parse", "HEAD"], { encoding: "utf8" });
              if (sha.status === 0) wipCommit = sha.stdout.trim();
            }
          }
        }
      } catch { /* WIP commit is best-effort; the ledger mark still records the abort */ }
    }
    applySentryAbort(ledger, { issue, signal, wip_commit: wipCommit, wip_skipped_secret_class: wipSkipped, at: new Date().toISOString() });
    atomicWriteLedger(runDir, ledger);
    const payload = { run_dir: runDir, aborted: true, status: "aborted-resumable", issue: issue || null, signal: signal || null, wip_commit: wipCommit, wip_skipped_secret_class: wipSkipped };
    if (asJson) console.log(JSON.stringify(payload));
    else console.log(`sentry: run aborted (resumable)${wipCommit ? ` — WIP committed ${wipCommit.slice(0, 8)}` : ""}${wipSkipped.length ? ` — omitted ${wipSkipped.length} secret-class path(s) from WIP` : ""}; ledger marked aborted-resumable`);
    return 0;
  }

  process.stderr.write("faff sentry: expected one of check | abort (or --selftest)\n");
  return 2;
}

// In-memory selftest of the pure cores (mirrors budget/heartbeat/events --selftest).
// No filesystem, no tracker, no child process — drives the predicates, the aggregation,
// the abort mark, and the AC5 no-write-path property directly.
function sentrySelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { fail++; console.log(`FAIL ${name}`); } else console.log(`ok   ${name}`); };
  const NOW = Date.parse("2026-06-29T12:00:00Z");
  const ago = (s) => new Date(NOW - s * 1000).toISOString();
  const TH = SENTRY_THRESHOLD_DEFAULTS;

  // --- budget-breach: consumes {breached,outcome}, no own counter (AC2) ---
  const b1 = evalBudgetBreach({ breached: ["max_attempts"], outcome: "escalate" });
  ok("budget escalate → trip", b1 && b1.severity === "trip" && b1.evidence.budget_outcome === "escalate");
  ok("budget stop → trip", evalBudgetBreach({ breached: ["until"], outcome: "stop" }).severity === "trip");
  ok("budget narrow → warn", evalBudgetBreach({ breached: ["tokens"], outcome: "narrow" }).severity === "warn");
  ok("budget unbreached → null", evalBudgetBreach({ breached: [], outcome: "none" }) === null);

  // --- wall-clock-runaway: heartbeat staleness (AC3) + run-elapsed ceiling ---
  const stale = { owner: { status: "running", last_heartbeat: ago(TH.stall_window_secs + 60), started_at: ago(100) } };
  const w1 = evalWallClock(stale, NOW, TH);
  ok("stale heartbeat → trip (AC3)", w1 && w1.severity === "trip" && w1.evidence.tripped_on === "heartbeat-staleness");
  // FAFF-355: evidence names the true liveness source (heartbeat_source), never a
  // hardcoded "ledger_field" — a null caller-supplied source still surfaces as null.
  ok("evidence carries a caller-supplied heartbeat_source, never a hardcoded field name",
    evalWallClock(stale, NOW, TH, "heartbeat-file").evidence.heartbeat_source === "heartbeat-file" &&
    evalWallClock(stale, NOW, TH, "owner.last_heartbeat").evidence.heartbeat_source === "owner.last_heartbeat" &&
    w1.evidence.heartbeat_source === null);
  ok("fresh heartbeat → null", evalWallClock({ owner: { status: "running", last_heartbeat: ago(10), started_at: ago(100) } }, NOW, TH) === null);
  const longrun = { owner: { status: "running", last_heartbeat: ago(10), started_at: ago(TH.run_elapsed_ceiling_secs + 60) } };
  ok("run-elapsed over ceiling → trip", evalWallClock(longrun, NOW, TH).evidence.tripped_on === "run-elapsed");
  ok("done owner never runs away", evalWallClock({ owner: { status: "done", last_heartbeat: ago(99999), started_at: ago(99999) } }, NOW, TH) === null);
  ok("ownerless ledger → null", evalWallClock({}, NOW, TH) === null);

  // --- fix-review-thrash ---
  const thr = [{ type: "build-start", issue: "A", seq: 0 }, { type: "build-start", issue: "A", seq: 1 }, { type: "build-start", issue: "A", seq: 2 }];
  const t1 = evalThrash(thr, TH);
  ok("3 build-starts no ship → trip", t1 && t1.signal === "fix-review-thrash" && t1.evidence.build_starts === 3);
  ok("2 build-starts → null", evalThrash(thr.slice(0, 2), TH) === null);
  ok("3 build-starts then shipped → null", evalThrash([...thr, { type: "issue-outcome", issue: "A", data: { outcome: "shipped" }, seq: 3 }], TH) === null);

  // --- repeated-identical-failure ---
  const fEv = [0, 1, 2].map((seq) => ({ type: "issue-outcome", issue: "B", data: { outcome: "errored", fingerprint: "boom" }, seq }));
  const r1 = evalRepeatedFailure(fEv, TH);
  ok("3 identical failures → trip", r1 && r1.signal === "repeated-identical-failure" && r1.evidence.count === 3);
  ok("2 identical failures → null", evalRepeatedFailure(fEv.slice(0, 2), TH) === null);
  ok("distinct failures under K → null", evalRepeatedFailure([
    { type: "park", issue: "C", data: { reason: "x" }, seq: 0 }, { type: "park", issue: "C", data: { reason: "y" }, seq: 1 },
  ], TH) === null);

  // --- scope-drift advisory (warn, never trip); forbidden-side-effect degraded ---
  const sd = evalScopeDrift(normalizeSentrySignals({ scope_drift: true }));
  ok("scope-drift → warn advisory", sd && sd.severity === "warn" && sd.evidence.advisory === true);
  ok("no scope-drift → null", evalScopeDrift(normalizeSentrySignals({})) === null);
  ok("forbidden-side-effect degraded → null", evalForbiddenSideEffect(normalizeSentrySignals({})) === null);
  ok("forbidden-side-effect flagged → trip", evalForbiddenSideEffect(normalizeSentrySignals({ forbidden_side_effect: true })).severity === "trip");

  // --- intervention aggregation (ladder-max) ---
  const aggAbort = evaluateDerailment({ budget: { breached: ["max_attempts"], outcome: "escalate" }, events: thr, ledger: {} }, TH);
  ok("escalate+thrash → abort (max of pause,abort)", aggAbort.intervention === "abort" && aggAbort.tripped === true);
  const aggPause = evaluateDerailment({ events: thr, ledger: {}, budget: { breached: [], outcome: "none" } }, TH);
  ok("thrash only → pause", aggPause.intervention === "pause" && aggPause.tripped === true);
  const aggCont = evaluateDerailment({ scope_drift: true, ledger: {}, budget: { breached: [], outcome: "none" }, events: [] }, TH);
  ok("warn-only (scope-drift) → continue, not tripped", aggCont.intervention === "continue" && aggCont.tripped === false && aggCont.verdicts.length === 1);
  const aggNone = evaluateDerailment({ ledger: {}, budget: { breached: [], outcome: "none" }, events: [] }, TH);
  ok("clean run → continue, no verdicts", aggNone.intervention === "continue" && aggNone.verdicts.length === 0);

  // --- FAFF-326: `correct` reachable ONLY under the explicit authority parameter ---
  const aggPauseNoAuth = evaluateDerailment({ events: thr, ledger: {}, budget: { breached: [], outcome: "none" } }, TH, "channel-D-only");
  ok("thrash + explicit channel-D-only authority → still pause (unchanged)", aggPauseNoAuth.intervention === "pause");
  const aggCorrect = evaluateDerailment({ events: thr, ledger: {}, budget: { breached: [], outcome: "none" } }, TH, "available");
  ok("thrash + authority available → correct (the ONE upgrade path)", aggCorrect.intervention === "correct" && aggCorrect.tripped === true);
  // correct sits BELOW abort in the ladder — a co-tripping abort signal still wins.
  const aggAbortBeatsCorrect = evaluateDerailment({ budget: { breached: ["max_attempts"], outcome: "escalate" }, events: thr, ledger: {} }, TH, "available");
  ok("escalate+thrash+authority available → abort still wins (correct never outranks abort)", aggAbortBeatsCorrect.intervention === "abort");
  // authority "available" alone (no trip) never manufactures a verdict.
  const aggAuthNoTrip = evaluateDerailment({ ledger: {}, budget: { breached: [], outcome: "none" }, events: [] }, TH, "available");
  ok("authority available with nothing tripped → continue, no verdicts", aggAuthNoTrip.intervention === "continue" && aggAuthNoTrip.verdicts.length === 0);
  // only fix-review-thrash upgrades — a different trip signal is never routed to correct.
  const aggOtherTripAuth = evaluateDerailment({ ledger: { owner: { status: "running", last_heartbeat: ago(0), started_at: ago(TH.run_elapsed_ceiling_secs + 60) } }, budget: { breached: [], outcome: "none" }, events: [] }, TH, "available");
  ok("run-elapsed trip + authority available → still abort, never correct (only fix-review-thrash upgrades)", aggOtherTripAuth.intervention === "abort");

  // --- AC5: no-write-path — a supervised subagent's injected fields cannot flip a trip ---
  const hostile = {
    budget: { breached: ["max_attempts"], outcome: "escalate" }, // real orchestrator-surface trip
    events: [], ledger: {},
    // fields a build subagent might forge to subvert the kill — ALL must be ignored:
    intervention: "continue", override: "continue", suppress: true, tripped: false,
    terminal_token: { issue: "X", outcome: "shipped", pr: 1 }, verdicts: [], owner: { status: "done" },
  };
  const hv = evaluateDerailment(hostile, TH);
  ok("AC5 hostile injected fields ignored — still aborts", hv.intervention === "abort" && hv.tripped === true);
  ok("AC5 normalizer keeps only the surface allowlist", Object.keys(normalizeSentrySignals(hostile)).sort().join(",") === "budget,events,forbidden_side_effect,heartbeat_source,ledger,member_beats,now_ms,scope_drift");

  // --- FAFF-326 AC5-shaped no-foreign-authorship: an `authority` field INSIDE the raw
  // signal bundle (as opposed to the explicit 3rd function parameter) must be inert —
  // a build subagent controls the signal bundle, never the explicit parameter.
  const hostileThrashWithAuthorityField = { events: thr, ledger: {}, budget: { breached: [], outcome: "none" }, authority: "available", corrective_authority: "available" };
  const hvThrash = evaluateDerailment(hostileThrashWithAuthorityField, TH); // no 3rd arg — default unavailable
  ok("AC5-shaped: an `authority`/`corrective_authority` key INSIDE the signal bundle is inert — still pause, never correct", hvThrash.intervention === "pause");
  ok("AC5-shaped: normalizeSentrySignals never reads an authority-shaped key at all", !("authority" in normalizeSentrySignals(hostileThrashWithAuthorityField)) && !("corrective_authority" in normalizeSentrySignals(hostileThrashWithAuthorityField)));

  // --- FAFF-327: sentryInflightMembers — build-start minus terminal outcomes --------
  const inflightEvents = [
    { type: "build-start", issue: "M1", ts: ago(2000) },
    { type: "build-start", issue: "M1", ts: ago(1000) }, // latest wins as the baseline
    { type: "build-start", issue: "M2", ts: ago(500) },
    { type: "build-start", issue: "M3", ts: ago(500) },
    { type: "build-start", issue: "M4" }, // no ts -> no baseline, excluded
  ];
  const inflightLedger = { outcomes: { M2: "shipped" } };
  const inflight = sentryInflightMembers(inflightEvents, inflightLedger);
  ok("sentryInflightMembers: build-start minus terminal outcomes, ts-less events excluded",
    inflight.length === 2 && inflight.some((m) => m.issue === "M1" && m.last_build_start_ts === ago(1000)) &&
    inflight.some((m) => m.issue === "M3") && !inflight.some((m) => m.issue === "M2") && !inflight.some((m) => m.issue === "M4"));
  ok("sentryInflightMembers: no build-start events -> empty (sequential/legacy byte-equivalence)", sentryInflightMembers([], {}).length === 0);

  // --- FAFF-327: evalMemberStall — the fleet member-stall predicate -----------------
  const memberTH = SENTRY_THRESHOLD_DEFAULTS;
  const staleMember = [{ issue: "S1", last_build_start_ts: ago(2000) }];
  const s1 = evalMemberStall(staleMember, { S1: ago(memberTH.stall_window_secs + 60) }, NOW, memberTH);
  ok("evalMemberStall: stale member-file baseline -> trip, scope member, member set",
    s1.length === 1 && s1[0].signal === "wall-clock-runaway" && s1[0].severity === "trip" &&
    s1[0].scope === "member" && s1[0].member === "S1" && s1[0].evidence.source === "heartbeat.S1");
  const s2 = evalMemberStall([{ issue: "S2", last_build_start_ts: ago(memberTH.stall_window_secs + 60) }], {}, NOW, memberTH);
  ok("evalMemberStall: no member file, build-start baseline stale -> trip, source build-start",
    s2.length === 1 && s2[0].member === "S2" && s2[0].evidence.source === "build-start");
  const s3 = evalMemberStall([{ issue: "S3", last_build_start_ts: ago(10) }], { S3: ago(10) }, NOW, memberTH);
  ok("evalMemberStall: fresh member -> no verdict", s3.length === 0);
  const s4 = evalMemberStall([{ issue: "S4", last_build_start_ts: null }], { S4: null }, NOW, memberTH);
  ok("evalMemberStall: absent on both inputs -> no verdict (fails toward run-level supervision)", s4.length === 0);
  const s5 = evalMemberStall(
    [{ issue: "S5", last_build_start_ts: ago(memberTH.stall_window_secs + 60) }, { issue: "S6", last_build_start_ts: ago(10) }],
    { S5: ago(memberTH.stall_window_secs + 60), S6: ago(10) }, NOW, memberTH);
  ok("evalMemberStall: multiple in-flight, only the stale one trips", s5.length === 1 && s5[0].member === "S5");

  // --- FAFF-327: aggregation — member-scoped wall-clock-runaway caps at "pause", NEVER
  // escalates to run "abort" by itself; the all-members-stalled case still routes
  // through the RUN-scoped wall-clock-runaway (the run heartbeat file itself is
  // stale) and that still trips "abort" exactly as before. ------------------------
  const staleMemberLedger = { owner: { status: "running", last_heartbeat: ago(10), started_at: ago(100) } }; // run itself fresh
  const aggMemberPause = evaluateDerailment({
    ledger: staleMemberLedger, budget: { breached: [], outcome: "none" }, events: [], now_ms: NOW,
    member_beats: { MSTALL: ago(memberTH.stall_window_secs + 60) },
  }, memberTH);
  // no in-flight members derived (no build-start events) -> member_beats alone never
  // manufactures a verdict; confirms member_beats is inert without a matching in-flight entry.
  ok("member_beats alone (no in-flight event) manufactures no verdict", aggMemberPause.verdicts.length === 0 && aggMemberPause.intervention === "continue");

  const memberEvents = [{ type: "build-start", issue: "MSTALL", ts: ago(memberTH.run_elapsed_ceiling_secs) }];
  const aggMemberPause2 = evaluateDerailment({
    ledger: staleMemberLedger, budget: { breached: [], outcome: "none" }, events: memberEvents, now_ms: NOW,
    member_beats: { MSTALL: ago(memberTH.stall_window_secs + 60) },
  }, memberTH);
  ok("a genuine member-scoped wall-clock-runaway caps the ladder at pause, never abort",
    aggMemberPause2.intervention === "pause" && aggMemberPause2.tripped === true &&
    aggMemberPause2.verdicts.some((v) => v.signal === "wall-clock-runaway" && v.scope === "member" && v.member === "MSTALL"));

  // All members stalled AND the run heartbeat itself is stale -> the RUN-scoped
  // wall-clock-runaway (no scope field) still trips "abort" — the kill-switch story
  // is preserved by construction (nothing ticks the run file when every member is dead).
  const allStalledLedger = { owner: { status: "running", last_heartbeat: ago(memberTH.stall_window_secs + 60), started_at: ago(100) } };
  const aggAllStalled = evaluateDerailment({
    ledger: allStalledLedger, budget: { breached: [], outcome: "none" }, events: memberEvents, now_ms: NOW,
    member_beats: { MSTALL: ago(memberTH.stall_window_secs + 60) },
  }, memberTH);
  ok("all-members-stalled + stale run file -> run-scoped abort still trips (kill-switch preserved)",
    aggAllStalled.intervention === "abort" &&
    aggAllStalled.verdicts.some((v) => v.signal === "wall-clock-runaway" && v.scope === undefined));

  // --- FAFF-327: a run with NO member evidence is byte-equivalent to pre-327 -------
  const aggNoMemberEvidence = evaluateDerailment({ ledger: {}, budget: { breached: [], outcome: "none" }, events: [], now_ms: NOW }, memberTH);
  ok("no member evidence -> continue, zero verdicts (unchanged from pre-327)",
    aggNoMemberEvidence.intervention === "continue" && aggNoMemberEvidence.verdicts.length === 0);

  // --- FAFF-327: thrash/repeated-failure gain scope/member annotation but their OWN
  // mapped intervention is untouched — a fleet member that thrashes still "pause"s
  // (unchanged), and a fleet member that repeat-fails still "abort"s the run (unchanged,
  // matching sequential-run behaviour — repeated-identical-failure was never member-safe). ---
  const thrashVerdict = evalThrash(thr, TH);
  ok("evalThrash gains scope/member annotation, trigger math unchanged",
    thrashVerdict.scope === "member" && thrashVerdict.member === "A" && thrashVerdict.evidence.build_starts === 3);
  const aggThrashStillPause = evaluateDerailment({ events: thr, ledger: {}, budget: { breached: [], outcome: "none" } }, TH);
  ok("a scope:member fix-review-thrash still maps to pause (unaffected by the annotation)", aggThrashStillPause.intervention === "pause");

  const repeatEv = [0, 1, 2].map((seq) => ({ type: "issue-outcome", issue: "RFAIL", data: { outcome: "errored", fingerprint: "boom" }, seq }));
  const repeatVerdict = evalRepeatedFailure(repeatEv, TH);
  ok("evalRepeatedFailure gains scope/member annotation when unambiguous", repeatVerdict.scope === "member" && repeatVerdict.member === "RFAIL");
  const aggRepeatStillAbort = evaluateDerailment({ events: repeatEv, ledger: {}, budget: { breached: [], outcome: "none" } }, TH);
  ok("a scope:member repeated-identical-failure still maps to abort (unchanged — never downgraded by the annotation)",
    aggRepeatStillAbort.intervention === "abort");
  // A fingerprint shared across TWO issues stays run-scoped — no false single-member claim.
  const mixedIssueRepeatEv = [
    { type: "issue-outcome", issue: "RA", data: { outcome: "errored", fingerprint: "shared" }, seq: 0 },
    { type: "issue-outcome", issue: "RB", data: { outcome: "errored", fingerprint: "shared" }, seq: 1 },
    { type: "issue-outcome", issue: "RA", data: { outcome: "errored", fingerprint: "shared" }, seq: 2 },
  ];
  const mixedRepeatVerdict = evalRepeatedFailure(mixedIssueRepeatEv, TH);
  ok("evalRepeatedFailure: a fingerprint spanning >1 issue stays run-scoped (no false single-member attribution)",
    mixedRepeatVerdict && mixedRepeatVerdict.scope === undefined && mixedRepeatVerdict.member === undefined);

  // --- FAFF-327 AC5-shaped: hostile member-file content can only refresh ITS OWN
  // member's liveness — it must never suppress a run-scoped trip, nor manufacture a
  // verdict attributed to a DIFFERENT member. -------------------------------------
  const hostileFleetEvents = [
    { type: "build-start", issue: "VICTIM", ts: ago(memberTH.stall_window_secs + 60) },
    { type: "build-start", issue: "ATTACKER", ts: ago(10) },
  ];
  const hostileFleetLedger = { owner: { status: "running", last_heartbeat: ago(10), started_at: ago(TH.run_elapsed_ceiling_secs + 60) } }; // run-elapsed trip too
  const hostileFleet = evaluateDerailment({
    ledger: hostileFleetLedger, budget: { breached: [], outcome: "none" }, events: hostileFleetEvents, now_ms: NOW,
    // ATTACKER forges a fresh-looking timestamp for itself (fine — that's its own
    // liveness) AND tries to claim VICTIM's slot / inject an unrelated key — both inert.
    member_beats: { ATTACKER: ago(0), VICTIM: "not-a-real-timestamp", intervention: "continue", suppress: true },
  }, memberTH);
  ok("hostile member evidence cannot suppress the run-scoped trip",
    hostileFleet.tripped === true && hostileFleet.verdicts.some((v) => v.signal === "wall-clock-runaway" && v.scope === undefined));
  ok("VICTIM (unparseable member file, but stale build-start) still trips its OWN member verdict",
    hostileFleet.verdicts.some((v) => v.signal === "wall-clock-runaway" && v.scope === "member" && v.member === "VICTIM"));
  ok("ATTACKER's fresh self-tick correctly suppresses only ITS OWN member verdict, nothing else's",
    !hostileFleet.verdicts.some((v) => v.scope === "member" && v.member === "ATTACKER"));

  // --- abort marker: resumable, outcomes preserved, owner flipped, no force-reset (AC4) ---
  const led = { admitted: ["Z"], outcomes: {}, owner: { status: "running", last_heartbeat: ago(10), started_at: ago(100) } };
  applySentryAbort(led, { issue: "Z", signal: "budget-breach", wip_commit: "abc1234", at: ago(0) });
  ok("abort marks ledger aborted-resumable", led.abort && led.abort.status === "aborted-resumable" && led.abort.wip_commit === "abc1234");
  ok("abort flips running owner to aborted-resumable", led.owner.status === "aborted-resumable");
  ok("abort preserves admitted/outcomes (resumable, no force-reset)", JSON.stringify(led.admitted) === JSON.stringify(["Z"]) && Object.keys(led.outcomes).length === 0);
  const ledDone = { owner: { status: "done" } };
  applySentryAbort(ledDone, { at: ago(0) });
  ok("abort never resurrects a done owner", ledDone.owner.status === "done");

  // --- FAFF-326: `correct` is now IN the ladder, between pause and abort — abort is
  // still the ladder-max terminal rung, and correct is unreachable without the
  // explicit authority parameter (pinned above; this asserts the shape). ---
  ok("ladder is exactly continue|pause|correct|abort, abort still terminal",
    JSON.stringify(SENTRY_INTERVENTIONS) === JSON.stringify(["continue", "pause", "correct", "abort"]) &&
    SENTRY_INTERVENTIONS[SENTRY_INTERVENTIONS.length - 1] === "abort");
  ok("correct sits strictly between pause and abort",
    SENTRY_INTERVENTIONS.indexOf("pause") < SENTRY_INTERVENTIONS.indexOf("correct") &&
    SENTRY_INTERVENTIONS.indexOf("correct") < SENTRY_INTERVENTIONS.indexOf("abort"));
  ok("correct is UNREACHABLE while unasserted — the default (no authority arg) call never yields it for any trip",
    evaluateDerailment({ events: thr, ledger: {}, budget: { breached: [], outcome: "none" } }, TH).intervention !== "correct");

  // --- FAFF-425: an own-fault reading the run's ledger is INDETERMINATE, never a
  // silent "no derailment" — covered here at the pure-core level; the full
  // resolveLedgerOrFault + sentryReadBudget child-process propagation is exercised
  // end-to-end in test/sentry.test.mjs (this selftest stays filesystem/child-process
  // free, per the region's contract). ---

  // normalizeSentrySignals passes budget.outcome through as an ARBITRARY string —
  // no closed-set coercion between sentryReadBudget's "indeterminate" and the
  // predicate that consumes it (confirms the FAFF-425 no-regression constraint).
  ok("normalizeSentrySignals passes budget.outcome=\"indeterminate\" through untouched",
    normalizeSentrySignals({ budget: { breached: [], outcome: "indeterminate" } }).budget.outcome === "indeterminate");

  // evalBudgetBreach must NOT be the path that surfaces an indeterminate budget —
  // by contract breached stays [] for it, so this predicate correctly nulls out
  // (cmdSentry intercepts budget.outcome==="indeterminate" BEFORE calling it).
  ok("evalBudgetBreach on an indeterminate budget (breached:[]) → null, never a trip via this path",
    evalBudgetBreach({ breached: [], outcome: "indeterminate" }) === null);

  // sentryIndeterminate: the loud, fail-closed payload shape — no verdicts, not
  // tripped, intervention stays "continue" (indeterminate is its OWN state).
  // Capture arrays (not a single overwritten slot) so the assertion checks BEHAVIOUR
  // (exactly one console.log call, its content) rather than assuming it — a future
  // multi-line emission would show up as an extra captured entry, not a silently
  // overwritten one.
  const siLogCalls = [], siErrCalls = [];
  const origLog = console.log, origErrWrite = process.stderr.write;
  console.log = (s) => { siLogCalls.push(s); };
  process.stderr.write = (s) => { siErrCalls.push(s); return true; };
  let siExit;
  try { siExit = sentryIndeterminate("test-reason", true, "/some/run/dir"); }
  finally { console.log = origLog; process.stderr.write = origErrWrite; }
  const siPayload = siLogCalls.length === 1 ? JSON.parse(siLogCalls[0]) : null;
  ok("sentryIndeterminate: exit 3, exactly one console.log call, JSON payload carries indeterminate+reason, no verdicts, continue/not-tripped",
    siExit === 3 && siLogCalls.length === 1 && siErrCalls.length === 0 && siPayload &&
    siPayload.run_dir === "/some/run/dir" && Array.isArray(siPayload.verdicts) && siPayload.verdicts.length === 0 &&
    siPayload.intervention === "continue" && siPayload.tripped === false && siPayload.indeterminate === true && siPayload.reason === "test-reason");

  siLogCalls.length = 0; siErrCalls.length = 0;
  console.log = (s) => { siLogCalls.push(s); };
  process.stderr.write = (s) => { siErrCalls.push(s); return true; };
  let siExit2;
  try { siExit2 = sentryIndeterminate("other-reason", false, null); }
  finally { console.log = origLog; process.stderr.write = origErrWrite; }
  ok("sentryIndeterminate: non-JSON mode writes exactly one fail-closed stderr line (no console.log), still exit 3",
    siExit2 === 3 && siLogCalls.length === 0 && siErrCalls.length === 1 && /INDETERMINATE — other-reason \(fail closed\)/.test(siErrCalls[0]));

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (sentry --selftest, ${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { CORRECTABLE_SIGNAL, DERAILMENT_SIGNALS, SENTRY_INTERVENTIONS, SENTRY_THRESHOLD_DEFAULTS, SIGNAL_TRIP_INTERVENTION, applySentryAbort, cmdSentry, evalBudgetBreach, evalForbiddenSideEffect, evalMemberStall, evalRepeatedFailure, evalScopeDrift, evalThrash, evalWallClock, evaluateDerailment, normalizeSentrySignals, resolveSentryNow, sentryFailureFingerprint, sentryHeartbeatAgeSecs, sentryIndeterminate, sentryInflightMembers, sentryReadBudget, sentryReadCorrectiveAuthority, sentryReadEvents, sentryRunElapsedSecs, sentrySelftest, sentryThresholds };
