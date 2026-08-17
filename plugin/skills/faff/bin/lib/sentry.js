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
//
// FAFF-447: a NEW v1 predicate, `budget-metering-degraded` — closes FAFF-428's named
// follow-up ("teaching the kill-switch to react to the [estimate-only] degrade").
// `sentryReadBudget` now forwards `tokens_source` off the consumed `faff budget check`
// JSON (one additive field, no new child call, no re-derived math). `evalBudget
// MeteringDegraded` trips when a RUNNING ledger is reading `tokens_source: "estimate"`
// for longer than `sentry.estimate_metering_exposure_secs` (run-elapsed-since-
// `started_at`, the SAME proxy evalWallClock's run-elapsed check already uses — no
// new ledger-write surface). Run-scoped (no `scope`/`member` — one meter, one ledger,
// unlike the fleet-attributed signals above).
//
// FAFF-767: the predicate is now LEVEL-AGNOSTIC — an unattended L3 run leans on its
// budget ceiling as its runaway backstop exactly as an L4 run does, so a degraded
// meter is exactly as dangerous there; the `ledger.level === "L4"` gate that used to
// suppress the trip everywhere but L4 is gone (fail-safe direction: knowing you went
// blind on spend is strictly better than not). Its mapped intervention also moved off
// the issue-scoped `pause` — this signal is evaluated off the ledger and names no
// issue, so `pause`'s "park the implicated issue" handling was a silent no-op on an
// acting run. `surface` is the new run-scoped intervention (SIGNAL_TRIP_INTERVENTION):
// it writes to the run log + the `/faff-wtf`-visible surface and never attempts to
// park anything, sitting between `continue` and `pause` in the ladder (strictly
// softer than parking one issue) — a co-tripping hard-evidence signal (e.g. a genuine
// budget-breach on the same degraded run) still wins the ladder-max exactly as before.
// ===========================================================================


const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { readGovernanceConfig } = require("./budget");
const { activeProfile, DELIVERY_PROFILE } = require("./governance-profile");
const { mutateLedgerUnderLock, overlayHeartbeat, readHeartbeatFile, readMemberHeartbeatFile } = require("./heartbeat");
const { CONTAIN_ROOT, ENTRYPOINT, dig, findRoot, latestRunDir, parseAncestry, readLedger, resolveLedgerOrFault, subtreeContains } = require("./shared-infra");
const { parseArgs, usageError } = require("./argv");
// Union spec over both sub-verbs (check | abort). --budget-json / --detection-json /
// --member-beats-json / --authority / --now-ms / --now are hermetic test-only seams.
const SENTRY_SPEC = { flags: {
  "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--forbidden-side-effect": { arity: 0 },
  "--root": { arity: 1 }, "--run-dir": { arity: 1 },
  "--budget-json": { arity: 1 }, "--detection-json": { arity: 1 }, "--member-beats-json": { arity: 1 },
  "--authority": { arity: 1 }, "--now": { arity: 1 }, "--now-ms": { arity: 1 },
  "--issue": { arity: 1 }, "--signal": { arity: 1 }, "--worktree": { arity: 1 },
  // FAFF-608: verb-owned markdown summary renderer, mirroring governance-check's
  // --summary-md — applies to `check` only (`abort` ignores it, the flag is declared
  // once in this union spec exactly as the other check-only flags above are).
  "--summary-md": { arity: 1 },
}, positionals: { min: 0, max: 1, name: "verb" } };
const SENTRY_USAGE = "usage: faff sentry check|abort [--run-dir DIR] [--root DIR] [--json] [--forbidden-side-effect] [--issue ID] [--signal S] [--worktree DIR] [--summary-md FILE]";
// FAFF-628 — declared grammar. `--run-dir` resolves through a three-source fallback chain
// (flag → $FAFF_RUN_DIR → latestRunDir) rather than a flat required-flag check — conditional
// requiredness stays out of scope (spec §2) — so neither sub-verb declares a required flag.
const SENTRY_SURFACE = {
  kind: "subcommand_dispatch",
  spec: SENTRY_SPEC,
  subcommands: {
    check: { required_flags: [] },
    abort: { required_flags: [] },
  },
};

const DERAILMENT_SIGNALS = new Set([
  "fix-review-thrash", "budget-breach", "repeated-identical-failure",
  "wall-clock-runaway", "scope-drift", "forbidden-side-effect-attempt",
  "budget-metering-degraded",
]);
// The v1+Sentry-2 intervention ladder, ASCENDING severity (index = rank). `surface`
// (FAFF-767) sits BETWEEN `continue` and `pause` — the softest trip-response, a
// run-scoped log+/faff-wtf write that never parks an issue and never escalates.
// `correct` (FAFF-326) sits BETWEEN `pause` and `abort` — a narrowing of a
// pause-class response only, never a weakening of an abort route. Reachable only
// under an explicit `authority:"available"` parameter (see evaluateDerailment
// below) — never via a raw-signal field.
const SENTRY_INTERVENTIONS = ["continue", "surface", "pause", "correct", "abort"];
// The intervention a signal routes to WHEN IT TRIPS. warn-severity verdicts never
// escalate past `continue`. fix-review-thrash's mapped value is upgraded
// pause→correct in evaluateDerailment's aggregation loop, IFF the explicit
// authority parameter is "available" — this map itself is UNCHANGED (still names
// "pause"), so a reader of this table alone sees exactly the v1 default/degraded
// behaviour.
const SIGNAL_TRIP_INTERVENTION = {
  "budget-breach": "abort",
  "wall-clock-runaway": "abort",
  "repeated-identical-failure": "abort",
  "forbidden-side-effect-attempt": "abort",
  "fix-review-thrash": "pause",
  // FAFF-764: promoted from the vestigial "continue" — a confirmed scope-drift now
  // gives real teeth via the existing pause rung, un-gated, mirroring
  // budget-metering-degraded's "a blind spot, not a proven breach" precedent. Never
  // added to CORRECTABLE_SIGNAL/the authority upgrade path — the FAFF-354 trust
  // ceiling caps this at a detective pause surface, never correct/abort.
  "scope-drift": "pause",
  // FAFF-767: a blind meter is not a proven breach and is run-scoped (names no
  // issue to park) — a run-scoped surface, never escalated to pause/correct/abort.
  "budget-metering-degraded": "surface",
};
// The one signal Channel A may upgrade to `correct`, and only when authority is
// available (ADR-0039: thrash-only at v1 — precisely the stop-and-redispatch shape).
const CORRECTABLE_SIGNAL = "fix-review-thrash";

// FAFF-717/FAFF-765 — the literal-true coercion the attendedness readers share,
// FAIL-CLOSED: only an explicit affirmative reads true; every other value (false,
// "false", "yes", "1", a typo, unset) is false. Mirrors lights-out.js's
// engineBoundedFromConfig exactly, and for the same reason — the hand-rolled YAML
// parser returns the STRING "true" for a quoted scalar, so `"true" === true` is
// false; accept the string spelling too (trimmed, case-insensitive) while staying
// strict on everything unrecognised.
function literalTrue(raw) {
  return raw === true || String(raw).trim().toLowerCase() === "true";
}

// FAFF-717/FAFF-765 — the retained back-compat ALIAS reader. Reads the legacy
// autonomous.sentry_acting knob (the FAFF-717 abort opt-in), FAIL-CLOSED. Superseded
// by autonomous.unattended (FAFF-765) but kept as a working alias — it is shipped,
// documented, and tested, so retiring it inside a behaviour-change slice would break
// operators who set it for the kill-switch. OR-ed into declaredUnattendedFromConfig
// below; its retirement is a later deprecation-window slice (Open Question).
function sentryActingFromConfig(cfg) {
  return literalTrue(dig(cfg, "autonomous.sentry_acting"));
}

// FAFF-765 — resolve the operator's DECLARED ATTENDEDNESS posture from config,
// FAIL-CLOSED to attended/advisory. The canonical key is autonomous.unattended; the
// legacy autonomous.sentry_acting is OR-ed in as the retained alias (Design Decision
// 2 — either positive assertion asserts unattended; a `false` on one key never
// silently overrides a `true` on the other, since both are positive assertions
// OR-ed together). Every unrecognised / unset / faulted value resolves to attended
// (false) — the safe direction: the un-fired state is the documented L3 advisory
// posture and an abort is a resumable ledger-mark, so a typo must never silently
// make L3 runs abortable. DECLARED, never env-sniffed (Design Decision 1 / ADR-0095:
// unattended-on-CI is admission criteria the operator asserts, not ambient state
// faff detects — the detached poller has no TTY to read regardless).
function declaredUnattendedFromConfig(cfg) {
  return literalTrue(dig(cfg, "autonomous.unattended")) || sentryActingFromConfig(cfg);
}

// FAFF-717/FAFF-765 — the SINGLE resolver for "does Sentry's ABORT act on this run?",
// re-keyed from the L4-mint proxy onto the real axis: ATTENDEDNESS. An UNATTENDED run
// acts; an attended L3 stays advisory (the human at the keyboard is the kill-switch).
// An L4-minted ledger is one sufficient (always-unattended) case, kept as the FIRST
// disjunct: the `||` is LAZY BY DESIGN so an L4 ledger short-circuits and NEVER reads
// config — a config fault can never regress the L4 kill-switch (ADR-0034
// un-subvertable-by-construction, preserved verbatim). The declared-unattended
// disjunct (autonomous.unattended, or the sentry_acting alias) is the ONLY config
// read, reached only for a non-L4 run. Scope is the abort row ONLY — surface/pause/
// correct stay L4-only-acts (the poller only ever dispatches on abort; the cooperative
// handling table keeps the softer interventions advisory for an unattended L3 run —
// de-levelling pause is FAFF-766, correct stays authority-gated per FAFF-326). The
// CONSULT is never forked on level/attendedness — only the abort HANDLING consults this.
function actsOnSentryAbort(ledger, cfg) {
  return (!!ledger && ledger.level === "L4") || declaredUnattendedFromConfig(cfg);
}

// FAFF-766 — the resolver for "does Sentry's PAUSE act on this run?". `pause` joins
// `abort` in the safe-stop CLASS (FAFF-763): both are keyed on the same attendedness
// axis, so this delegates to actsOnSentryAbort verbatim rather than re-implementing
// the L4-first lazy short-circuit — one copy of the unattended-stop condition, shared
// by both safe stops. `pause` is strictly gentler than `abort` (it parks one
// implicated issue and keeps draining, never a whole-run stop), so an operator who
// declared unattended and thereby armed abort-acting gets pause-acting a fortiori.
// This is checkpoint-only — the detached sentry-poller never acts on pause at any
// level (see sentry-poller.js) and is untouched by this resolver's existence.
function actsOnSentryPause(ledger, cfg) {
  return actsOnSentryAbort(ledger, cfg);
}
// FAFF-362: v1 default thresholds — now DERIVED from the active-by-default
// delivery profile (governance-profile.js's DELIVERY_PROFILE.sentry.thresholds)
// rather than an independent literal object; same 4 keys, same values,
// byte-identical. Config values (`.faffrc` sentry.*) still override, unchanged.
const SENTRY_THRESHOLD_DEFAULTS = DELIVERY_PROFILE.sentry.thresholds;

// Resolve thresholds from config, falling back to the profile's declared defaults
// (delivery by default). A non-positive / non-numeric config value falls back
// (never weakens to 0/∞ silently). `profile` is a trailing defaulted parameter
// (mirrors the other threaded engine cores) — SECOND_PROFILE resolves DIFFERENT
// defaults (e.g. thrash_n 5), config still overrides on top.
function sentryThresholds(cfg, profile = activeProfile()) {
  const d = profile.sentry.thresholds;
  const num = (v, def) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : def; };
  return {
    thrash_n: num(dig(cfg, "sentry.thrash_n"), d.thrash_n),
    failure_k: num(dig(cfg, "sentry.failure_k"), d.failure_k),
    stall_window_secs: num(dig(cfg, "sentry.stall_window_secs"), d.stall_window_secs),
    run_elapsed_ceiling_secs: num(dig(cfg, "sentry.run_elapsed_ceiling_secs"), d.run_elapsed_ceiling_secs),
    // FAFF-447: how long (run-elapsed secs) an L4 run may read tokens_source:
    // "estimate" before budget-metering-degraded trips.
    estimate_metering_exposure_secs: num(dig(cfg, "sentry.estimate_metering_exposure_secs"), d.estimate_metering_exposure_secs),
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
      // FAFF-447: sanitized passthrough (string or null) — mirrors `outcome`'s
      // closed-allowlist posture; consumed only by evalBudgetMeteringDegraded.
      tokens_source: typeof b.tokens_source === "string" ? b.tokens_source : null,
    },
    now_ms: Number.isFinite(r.now_ms) ? r.now_ms : Date.now(),
    // Advisory hint the ORCHESTRATOR (never the build subagent) may set; default off.
    // FAFF-764: scope_drift's self-report companion key is REMOVED — evalScopeDrift
    // no longer reads a self-report flag at all; it derives its verdict from
    // ledger + events (both already on this closed surface).
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
// FAFF-362: `profile` is a trailing defaulted parameter — the thrash vocabulary
// (which type starts a re-dispatch, which type+outcome counts as shipped) is read
// from profile.sentry.thrash rather than embedded as literals; the trip LOGIC
// (the loop, the >= th.thrash_n test) is unchanged engine code.
function evalThrash(events, th, profile = activeProfile()) {
  const T = profile.sentry.thrash;
  const starts = {}, lastSeq = {}, shipped = new Set();
  for (const e of events) {
    if (e.type === T.start_type && e.issue) {
      starts[e.issue] = (starts[e.issue] || 0) + 1;
      if (Number.isInteger(e.seq)) lastSeq[e.issue] = e.seq;
    }
    if (e.type === T.ship_type && e.issue && e.data && e.data.outcome === T.ship_outcome) shipped.add(e.issue);
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
// FAFF-362: `profile` is a trailing defaulted parameter — which type is a "park"
// (park_type), which type+outcome is "errored" (outcome_type/errored_outcome) are
// read from profile.sentry.failure. The fingerprint STRING's own "park"/"outcome"
// tags are descriptive label text (not vocabulary being validated), left as-is.
function sentryFailureFingerprint(e, profile = activeProfile()) {
  const F = profile.sentry.failure;
  if (e.data && typeof e.data.fingerprint === "string" && e.data.fingerprint) return e.data.fingerprint;
  const issue = e.issue || "?";
  if (e.type === F.park_type) return `${issue}:park:${(e.data && (e.data.reason || e.data.root_cause)) || F.park_type}`;
  if (e.type === F.outcome_type) return `${issue}:outcome:${(e.data && e.data.outcome) || "?"}`;
  return null;
}
function evalRepeatedFailure(events, th, profile = activeProfile()) {
  const F = profile.sentry.failure;
  const counts = {}, lastSeq = {}, issuesByFp = {};
  for (const e of events) {
    const isFailure = (e.type === F.park_type) || (e.type === F.outcome_type && e.data && e.data.outcome === F.errored_outcome);
    if (!isFailure) continue;
    const fp = sentryFailureFingerprint(e, profile);
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

// budget-metering-degraded (FAFF-447; level-agnostic since FAFF-767) — a RUNNING
// run whose consumed budget check reads tokens_source:"estimate" for longer than
// the configured exposure window. PURE, mirrors evalWallClock's shape exactly: only
// a RUNNING owner can be "currently" degraded (a done/aborted run cannot burn
// further); exposure is approximated by run-elapsed-since-`started_at`
// (sentryRunElapsedSecs, the SAME proxy evalWallClock's run-elapsed check already
// uses — no separate "degrade started at" timestamp exists anywhere on the ledger).
// FAFF-767: trips regardless of `ledger.level` (absent, "L3", or "L4") — an
// unattended L3 run's budget ceiling is exactly as defeated by a blind meter as an
// L4 run's, so the level gate that used to suppress this everywhere but L4 is gone
// (fail-safe direction: knowing you went blind on spend is strictly better than
// not). Strict `>` (never `>=`), mirroring evalWallClock's `age > th.stall_window_
// secs` convention.
function evalBudgetMeteringDegraded(ledger, budget, nowMs, th) {
  const owner = ledger && ledger.owner;
  if (!owner || owner.status !== "running") return null;
  if (!budget || budget.tokens_source !== "estimate") return null;
  const elapsed = sentryRunElapsedSecs(ledger, nowMs);
  if (elapsed == null || elapsed <= th.estimate_metering_exposure_secs) return null;
  return {
    signal: "budget-metering-degraded", severity: "trip",
    evidence: {
      tokens_source: "estimate",
      run_elapsed_secs: Math.round(elapsed),
      exposure_threshold_secs: th.estimate_metering_exposure_secs,
    },
  };
}

// scope-drift (FAFF-764) — a behaviour-derived DETECTIVE, not a self-report. Derives
// "has this run drifted from its mandate?" from the recorded `containment-check`
// event stream (`faff contain --record`) + `ledger.prd_root_container` (the L4
// accepted-root envelope), reusing the EXACT comparators `faff contain`/`faff audit`
// already share (subtreeContains/parseAncestry/CONTAIN_ROOT, shared-infra.js) — never
// a second, parallel notion of scope. L4-first (mirrors evalBudgetMeteringDegraded's
// level gate): L3/legacy runs have no accepted-root envelope to recompute against, so
// they return null unconditionally, byte-equivalent to today. PURE — reads only
// signals.ledger/signals.events, no filesystem/subprocess I/O of its own.
//
// FAFF-354 trust ceiling (inherited, not worsened): containment ancestry is
// agent-sourced, so this binds STRUCTURE not TRUTHFULNESS — an honest-but-false
// self-consistent fabrication recomputes clean. The verdict's evidence carries
// `detective:true` to say so; this is a recompute-and-compare audit, never a hard
// preventive (no abort/correct route — see SIGNAL_TRIP_INTERVENTION above).
//
// Mirrors audit.js's `recompute the SAME primitives that produced the record`
// posture (audit.js buildReconstruction's containment_mismatches, ~line 332) exactly
// — same comparator, same CONTAIN_ROOT sentinel, same fail-to-"unreproducible" on a
// malformed ancestry_raw.
function scopeDriftRecomputeVerdict(d) {
  if (d.ancestry_raw === null || d.ancestry_raw === undefined) {
    return subtreeContains(d.mandate, d.root ? CONTAIN_ROOT : d.parent, new Map());
  }
  let entryOf;
  try { entryOf = parseAncestry(d.ancestry_raw); }
  catch { return "unreproducible"; }
  return subtreeContains(d.mandate, d.root ? CONTAIN_ROOT : d.parent, entryOf);
}

function evalScopeDrift(signals) {
  const ledger = signals.ledger;
  if (!ledger || ledger.level !== "L4") return null; // out of scope (spec §2): L3/legacy

  const checks = signals.events.filter((e) => e.type === "containment-check");
  const filed = typeof ledger.discovered_scope_filed === "number" ? ledger.discovered_scope_filed : 0;
  const accepted_root = ledger.prd_root_container ?? null;

  // (a) recompute-mismatch — a recorded verdict that no longer reproduces. First
  // offender (ascending seq — `events` is already the run's append order) is enough.
  let mismatch = null;
  for (const e of checks) {
    const d = e.data && typeof e.data === "object" ? e.data : {};
    const recomputed = scopeDriftRecomputeVerdict(d);
    if (recomputed !== d.verdict) { mismatch = { seq: e.seq ?? null, issue: e.issue ?? null, recorded: d.verdict, recomputed }; break; }
  }

  // (b) unrecorded-create — the ledger says scope was filed but the timeline holds
  // NO recorded containment walk at all (mirrors audit.js's unrecorded_creates).
  const unrecorded = filed > 0 && checks.length === 0;

  // (c) outward-boundary-reach — a NON-root pre-create walk that came back
  // "outward". `root:true` is the SANCTIONED discovered-scope filing floor
  // (faff contain --root) and never contributes here — only a walk that reached the
  // boundary against an INTENDED existing parent counts as a drift.
  let outward = null;
  for (const e of checks) {
    const d = e.data && typeof e.data === "object" ? e.data : {};
    if (d.verdict === "outward" && d.root !== true) { outward = { seq: e.seq ?? null, issue: e.issue ?? null, mandate: d.mandate ?? null, parent: d.parent ?? null }; break; }
  }

  if (!mismatch && !unrecorded && !outward) return null;

  // Precedence: an incoherent record is the strongest signal, then a missing
  // record, then a recorded reach-past-the-boundary. Exactly one verdict — the
  // others are not separately surfaced (matches the single-worst-verdict shape of
  // evalThrash/evalRepeatedFailure).
  let drift_kind, detail;
  if (mismatch) { drift_kind = "recompute-mismatch"; detail = mismatch; }
  else if (unrecorded) { drift_kind = "unrecorded-create"; detail = { discovered_scope_filed: filed }; }
  else { drift_kind = "outward-boundary-reach"; detail = outward; }

  return { signal: "scope-drift", severity: "trip", evidence: { drift_kind, accepted_root, detective: true, ...detail } };
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
// FAFF-362: `profile` is a trailing defaulted parameter — "build-start" (the type
// that starts a member's liveness obligation) is read from
// profile.sentry.thrash.start_type rather than embedded as a literal.
function sentryInflightMembers(events, ledger, profile = activeProfile()) {
  const startType = profile.sentry.thrash.start_type;
  const outcomes = (ledger && ledger.outcomes && typeof ledger.outcomes === "object" && !Array.isArray(ledger.outcomes)) ? ledger.outcomes : {};
  const lastStart = {};
  for (const e of (Array.isArray(events) ? events : [])) {
    if (!e || e.type !== startType || !e.issue) continue;
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
// FAFF-362: `profile` is a trailing defaulted parameter — the evidence.source
// fallback label names the dispatch-event type from profile.sentry.thrash.
// start_type rather than a hardcoded "build-start", so the label stays honest
// under a non-delivery dialect (e.g. SECOND_PROFILE's "job-start").
function evalMemberStall(inflight, memberBeats, nowMs, th, profile = activeProfile()) {
  const startType = profile.sentry.thrash.start_type;
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
    const source = beatOk && (!startOk || beatMs >= startMs) ? `heartbeat.${m.issue}` : startType;
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
// FAFF-362: `profile` is a FOURTH, trailing defaulted parameter (mirrors the other
// threaded engine cores) — the default resolves DELIVERY_PROFILE, byte-identical.
// It sits AFTER `authority` (not before) so it never disturbs the AC5-shaped
// no-foreign-authorship property of that parameter's position/semantics.
function evaluateDerailment(rawSignals, thresholds, authority, profile = activeProfile()) {
  const s = normalizeSentrySignals(rawSignals);
  const th = thresholds || profile.sentry.thresholds;
  const authorityAvailable = authority === "available";
  const verdicts = [];
  const push = (v) => { if (v && DERAILMENT_SIGNALS.has(v.signal) && (v.severity === "warn" || v.severity === "trip")) verdicts.push(v); };
  push(evalBudgetBreach(s.budget));
  // FAFF-447: adjacent to budget-breach — the other consumer of the sanitized
  // budget object, no new I/O.
  push(evalBudgetMeteringDegraded(s.ledger, s.budget, s.now_ms, th));
  push(evalWallClock(s.ledger, s.now_ms, th, s.heartbeat_source));
  push(evalThrash(s.events, th, profile));
  push(evalRepeatedFailure(s.events, th, profile));
  push(evalScopeDrift(s));
  push(evalForbiddenSideEffect(s));
  // FAFF-327: fleet member-stall — auto-detected (no flag). In-flight members derive
  // from the SAME normalized events+ledger surface already in scope here; a run with
  // none (sequential/legacy/no build-start events) yields an empty list and
  // evalMemberStall trivially returns [] — byte-equivalent to pre-327 output.
  const inflight = sentryInflightMembers(s.events, s.ledger, profile);
  for (const v of evalMemberStall(inflight, s.member_beats, s.now_ms, th, profile)) push(v);

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
    // FAFF-553: the run-scoped in-flight staleness grace. A stale RUN heartbeat during
    // one legitimately long build turn is indistinguishable from a hung run — the
    // cooperative checkpoint can't fire mid-turn — so while ≥1 member is provably in
    // flight (a build-start with no terminal outcome, the SAME FAFF-327 derivation
    // above) the run-scoped staleness trip contributes at most "pause", mirroring the
    // member cap's shape. The verdict itself still TRIPS (visible, logged); only the
    // contributed intervention softens, and evidence is annotated so a consumer can
    // see exactly why. Guards, in order: run-scoped only (scope absent — the member
    // cap above owns scope:"member"); tripped on heartbeat-staleness only (a
    // run-elapsed trip is never graced); run_elapsed_secs provably UNDER the ceiling
    // (staleness + elapsed-over-ceiling keeps "abort" — the grace never masks the
    // elapsed backstop, and a null/absent elapsed also fails toward "abort", the same
    // "ambiguous input fails toward supervision" posture evalMemberStall takes).
    // A genuinely dead mid-build run therefore pauses until the unchanged
    // run_elapsed_ceiling_secs backstop trips abort — the accepted trade (spec §4).
    if (v.signal === "wall-clock-runaway" && v.scope === undefined
        && v.evidence && v.evidence.tripped_on === "heartbeat-staleness"
        && v.evidence.run_elapsed_secs != null && v.evidence.run_elapsed_secs < th.run_elapsed_ceiling_secs
        && inflight.length > 0) {
      v.evidence.in_flight = inflight.map((m) => m.issue);
      v.evidence.grace = "in-flight-unit";
      mapped = "pause";
    }
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
      // FAFF-447: tokens_source forwarded verbatim (string, else null) — the ONE
      // field this ticket plumbs through the existing CONSUME boundary; no new
      // token/cost math, no second child call.
      if (j.outcome === "indeterminate") return { breached: [], outcome: "indeterminate", tokens_source: null };
      return {
        breached: Array.isArray(j.breached) ? j.breached : [],
        outcome: typeof j.outcome === "string" ? j.outcome : "none",
        tokens_source: typeof j.tokens_source === "string" ? j.tokens_source : null,
      };
    }
    // FAFF-425 (adversarial-review follow-up): the child itself faulted — exit 3
    // (its OWN ledger fault) lands here (status!==0), as does exit 2/any other
    // non-zero and a zero-status-but-empty-stdout. EXPLICIT, not a fall-through
    // relying on the catch below's default: a non-OK child is itself a read
    // fault and must never be read as "no breach".
    return { breached: [], outcome: "indeterminate", tokens_source: null };
  } catch {
    // spawnSync/JSON.parse threw outright (e.g. the child binary itself is
    // unreachable) — same own-fault classification as above.
    return { breached: [], outcome: "indeterminate", tokens_source: null };
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

// Sanitize a raw { trusted, disposition, basis }-shaped reply — from either the real
// spawned child or the --detection-json hermetic test hook — into a well-formed
// DetectionTrust. `trusted` is derived ONLY from a strict `=== true` check on the
// raw value, so a truthy-but-wrong-typed field (e.g. "yes") is NEVER coerced to
// trust, regardless of the reply's source.
function sanitizeDetectionTrust(j) {
  const trusted = j && j.trusted === true;
  return {
    trusted,
    disposition: trusted ? "trusted" : (j && typeof j.disposition === "string" ? j.disposition : "reconcile-only"),
    basis: j && typeof j.basis === "string" ? j.basis : "unknown",
  };
}

// FAFF-466: derive `detection_trust` from the FAFF-373/FAFF-325 corrective-integrity
// gate's `detection` consumer, via the SAME child-invocation pattern as
// sentryReadCorrectiveAuthority above — sentry.js owns no direct require of the
// factory-region gate module (region direction, ADR-0042). Fail-safe: ANY non-OK
// child (non-zero exit, unparseable stdout, spawn failure) degrades to
// { trusted: false, disposition: "reconcile-only", basis: "read-fault" } — NEVER
// "trusted". A clean reply is sanitized via sanitizeDetectionTrust above.
function sentryReadDetectionIntegrity(runDir) {
  try {
    const r = spawnSync(process.execPath, [ENTRYPOINT, "corrective-integrity", "--consumer", "detection", "--run-dir", runDir, "--json"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout) {
      return sanitizeDetectionTrust(JSON.parse(r.stdout.trim()));
    }
    return { trusted: false, disposition: "reconcile-only", basis: "read-fault" };
  } catch {
    return { trusted: false, disposition: "reconcile-only", basis: "read-fault" };
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
// FAFF-608: renders the SAME `check` verdict as a markdown summary — the verb owns
// rendering (mirrors governance-check.js's renderGovernanceCheckSummaryMd), so a
// local terminal readout and a CI job summary never drift. Pure: no I/O, no process
// access. `payload` is the exact object cmdSentry's check branch builds. Remedy
// wording (when tripped) is reused verbatim from sentrycheck.js's trippedNotice —
// one home for that wording, not two that can drift.
function renderSentryCheckSummaryMd(payload) {
  const lines = ["# faff sentry check", "", `**run:** ${payload.run_dir || "(no run resolved)"}`];
  if (payload.tripped) lines.push(`**verdict:** ❌ TRIP — intervention: ${payload.intervention}`);
  else if (Array.isArray(payload.verdicts) && payload.verdicts.length) {
    lines.push(`**verdict:** ⚠️ ${payload.verdicts.length} verdict(s) — intervention: ${payload.intervention}`);
  } else lines.push("**verdict:** ✅ no derailment — intervention: continue");
  lines.push("");
  if (payload.config_malformed) {
    lines.push("> ⚠️ base config malformed — thresholds are built-in defaults (config_malformed)", "");
  }
  if (Array.isArray(payload.verdicts) && payload.verdicts.length) {
    lines.push("| signal | severity |", "|---|---|");
    for (const v of payload.verdicts) lines.push(`| ${v.signal} | ${v.severity} |`);
    lines.push("");
  }
  if (payload.tripped) {
    lines.push(
      "**Nothing was acted on.** Inspect: `faff sentry check --run-dir " + payload.run_dir + "`; " +
      "abort resumably: `faff sentry abort --run-dir " + payload.run_dir + " --worktree <path>`",
      "",
    );
  }
  return lines.join("\n") + "\n";
}

function sentryIndeterminate(reason, asJson, runDir = null) {
  const payload = { run_dir: runDir, verdicts: [], intervention: "continue", tripped: false, indeterminate: true, reason };
  if (asJson) console.log(JSON.stringify(payload));
  else process.stderr.write(`sentry: INDETERMINATE — ${reason} (fail closed)\n`);
  return 3;
}

function cmdSentry(args) {
  if (args.includes("--selftest")) return sentrySelftest();
  const parsed = parseArgs(args, SENTRY_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, SENTRY_USAGE);
  const sub = parsed.positionals[0];
  const get = (f) => (parsed.values[f] === undefined ? null : parsed.values[f]);
  const asJson = !!parsed.values["--json"];
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
    // FAFF-577: the watchdog must never die of a config fault. The poller counts any
    // non-zero exit as a fault and fault-caps out, so a strict exit here would kill
    // the very kill-switch machinery whose ceilings strictness protects. Degrade
    // LOUD instead: catch the strict base failure (the chokepoint + governance
    // warnings already fired on stderr), proceed on built-in default thresholds
    // (the conservative floor — the kill-switch still functions), and flag
    // `config_malformed: true` in the payload so the degradation is visible in the
    // poller log, never silent.
    let cfg, configMalformed = false;
    try { cfg = readGovernanceConfig(root); }
    catch (e) {
      if (e && e.message === "base-parse-error") { cfg = {}; configMalformed = true; }
      else throw e;
    }
    // FAFF-362: resolve the active profile ONCE for this invocation (may throw
    // GovernanceProfileError on a bad $FAFF_GOVERNANCE_PROFILE override — caught
    // at bin/faff's dispatch boundary, loud exit 2, never a silent delivery
    // fallback) and thread it through every profile-consuming call below.
    const profile = activeProfile();
    const th = sentryThresholds(cfg, profile);
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
    // FAFF-466: `detection_trust` — the FAFF-373/FAFF-325 corrective-integrity gate's
    // `detection` consumer, wired via the same child-spawn pattern as `authority`
    // above. --detection-json is a hermetic TEST-ONLY seam mirroring --budget-json:
    // an unparseable injected value is itself a read-fault (never a silent "trusted"
    // fall-through), a well-formed injected value is consumed verbatim; production
    // always derives it from sentryReadDetectionIntegrity (a self-spawn child call).
    // Predicate evaluation below (evaluateDerailment) is UNCHANGED by this value in
    // both dispositions (Scenario 2) — it is attached to the output payload only.
    const injectedDetection = get("--detection-json");
    let detectionTrust;
    if (injectedDetection != null) {
      try { detectionTrust = sanitizeDetectionTrust(JSON.parse(injectedDetection)); }
      catch { detectionTrust = { trusted: false, disposition: "reconcile-only", basis: "read-fault" }; }
    } else {
      detectionTrust = resolved.empty
        ? { trusted: false, disposition: "reconcile-only", basis: "no-run-dir" }
        : sentryReadDetectionIntegrity(resolved.runDir);
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
        for (const m of sentryInflightMembers(events, ledger, profile)) {
          memberBeats[m.issue] = readMemberHeartbeatFile(resolved.runDir, m.issue);
        }
      }
    }
    const result = evaluateDerailment({ events, ledger, budget, now_ms: nowRes.now_ms, heartbeat_source: heartbeatSource, forbidden_side_effect: forbiddenSideEffect, member_beats: memberBeats }, th, authority, profile);
    // FAFF-577: config_malformed rides every payload (false in the healthy case) so
    // a degraded-thresholds check is machine-visible, not inferred from stderr.
    const payload = { run_dir: checkedRunDir, verdicts: result.verdicts, intervention: result.intervention, tripped: result.tripped, thresholds: th, authority, detection_trust: detectionTrust, config_malformed: configMalformed };
    // FAFF-608: verb-owned markdown summary — a pure side-artifact that must NEVER
    // perturb the exit contract. Composes with --json (runs independently of it,
    // mirroring governance-check); best-effort write, wrapped in try/catch, warns
    // on stderr only and never re-throws.
    const summaryMdPath = get("--summary-md");
    if (summaryMdPath) {
      try { fs.appendFileSync(summaryMdPath, renderSentryCheckSummaryMd(payload)); }
      catch (e) { process.stderr.write(`faff sentry check: warning — could not write --summary-md: ${e.message}\n`); }
    }
    if (asJson) { console.log(JSON.stringify(payload)); return 0; }
    if (configMalformed) console.log("sentry: WARNING — base config malformed; thresholds are built-in defaults (config_malformed)");
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
    // FAFF-575: the abort mark is a locked ledger mutation — applied to the FRESH
    // under-lock read, so a concurrent writer's landed mutation (a --tokens checkpoint
    // advance, a budget baseline) is preserved, never clobbered by this whole-object
    // write. The WIP commit above deliberately ran BEFORE acquiring the lock
    // (critical-section hygiene — no subprocess/git work inside the lock-held span).
    const abortRec = { issue, signal, wip_commit: wipCommit, wip_skipped_secret_class: wipSkipped, at: new Date().toISOString() };
    let ledgerWriteRes;
    try {
      ledgerWriteRes = mutateLedgerUnderLock(runDir, (fresh) => {
        // The mark derives ONLY from the under-lock read — never the pre-lock copy
        // (which only gated the malformed-ledger exit 2 above). A ledger that vanished
        // between that read and lock acquisition is a fault, not "the same ledger":
        // writing the stale copy back would be the exact lost-update the lock removes.
        if (!fresh) { const e = new Error(`run-ledger.json missing in ${runDir} at lock time`); e.code = "ENOENT"; throw e; }
        applySentryAbort(fresh, abortRec);
        return fresh;
      });
    } catch (e) {
      // The abort mark IS the abort — a silent skip would leave a killed run looking
      // alive. Loud exit 1 naming the lock; the poller/operator retries.
      if (e && e.code === "LEDGER_LOCKED") { process.stderr.write(`faff sentry abort: ${e.message} — abort mark NOT written, retry\n`); return 1; }
      if (e && e.code === "ENOENT") { process.stderr.write(`faff sentry abort: ${e.message} — abort mark NOT written\n`); return 2; }
      throw e;
    }
    // FAFF-679: the before/after ledger digest pair — Class A of the gateway's
    // mid-bracket write rule — so a custody-holding orchestrator can assert what the
    // ledger WAS when this write took the lock, not only what it became.
    const payload = {
      run_dir: runDir, aborted: true, status: "aborted-resumable", issue: issue || null, signal: signal || null,
      wip_commit: wipCommit, wip_skipped_secret_class: wipSkipped,
      ledger_sha256_before: ledgerWriteRes.before_sha256, ledger_sha256_after: ledgerWriteRes.after_sha256,
    };
    if (asJson) console.log(JSON.stringify(payload));
    else console.log(`sentry: run aborted (resumable)${wipCommit ? ` — WIP committed ${wipCommit.slice(0, 8)}` : ""}${wipSkipped.length ? ` — omitted ${wipSkipped.length} secret-class path(s) from WIP` : ""}; ledger marked aborted-resumable (${ledgerWriteRes.before_sha256 ? ledgerWriteRes.before_sha256.slice(0, 8) : "none"} → ${ledgerWriteRes.after_sha256.slice(0, 8)})`);
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

  // --- FAFF-447: budget-metering-degraded — L4 + estimate-only + past exposure ---
  const l4Running = (startedAgoSecs) => ({ level: "L4", owner: { status: "running", started_at: ago(startedAgoSecs), last_heartbeat: ago(0) } });
  const estBudget = { tokens_source: "estimate" };
  const measuredBudget = { tokens_source: "transcript" };
  const pastThreshold = TH.estimate_metering_exposure_secs + 60;
  const m1 = evalBudgetMeteringDegraded(l4Running(pastThreshold), estBudget, NOW, TH);
  ok("L4 + estimate-only past the exposure window → trip", m1 && m1.signal === "budget-metering-degraded" && m1.severity === "trip"
    && m1.evidence.tokens_source === "estimate" && m1.evidence.exposure_threshold_secs === TH.estimate_metering_exposure_secs);
  ok("L4 + estimate-only WITHIN the exposure window → null", evalBudgetMeteringDegraded(l4Running(10), estBudget, NOW, TH) === null);
  ok("exactly at the threshold → null (strict > , mirrors evalWallClock)",
    evalBudgetMeteringDegraded(l4Running(TH.estimate_metering_exposure_secs), estBudget, NOW, TH) === null);
  ok("L4 + measured transcript past the window → null (never keyed on elapsed alone)",
    evalBudgetMeteringDegraded(l4Running(pastThreshold), measuredBudget, NOW, TH) === null);
  // FAFF-767: the predicate is level-agnostic — a ledger with no level field, or an
  // L3 ledger, trips exactly like L4 (the un-fired state was the ONLY thing tying
  // this signal to L4; an unattended L3 run's budget ceiling is defeated by a blind
  // meter exactly as an L4 run's is).
  ok("no level field + estimate-only past the window → trip (level-agnostic)",
    (() => { const v = evalBudgetMeteringDegraded({ owner: { status: "running", started_at: ago(pastThreshold), last_heartbeat: ago(0) } }, estBudget, NOW, TH);
      return v && v.signal === "budget-metering-degraded" && v.severity === "trip"; })());
  ok("level:L3 + estimate-only past the window → trip (level-agnostic)",
    (() => { const v = evalBudgetMeteringDegraded({ ...l4Running(pastThreshold), level: "L3" }, estBudget, NOW, TH);
      return v && v.signal === "budget-metering-degraded" && v.severity === "trip"; })());
  ok("done owner never trips (mirrors evalWallClock's running-only guard)",
    evalBudgetMeteringDegraded({ level: "L4", owner: { status: "done", started_at: ago(pastThreshold), last_heartbeat: ago(0) } }, estBudget, NOW, TH) === null);
  ok("no budget object → null", evalBudgetMeteringDegraded(l4Running(pastThreshold), null, NOW, TH) === null);
  ok("ownerless ledger → null", evalBudgetMeteringDegraded({ level: "L4" }, estBudget, NOW, TH) === null);

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

  // --- FAFF-764: scope-drift — behaviour-derived DETECTIVE, L4-first, over the
  // recorded containment-check stream + ledger.prd_root_container ------------------
  ok("scope-drift: non-L4 (absent level) → null regardless of events", evalScopeDrift(normalizeSentrySignals({
    ledger: {}, events: [{ type: "containment-check", seq: 1, issue: "X", data: { mandate: "M", parent: null, root: false, verdict: "outward" } }],
  })) === null);
  ok("scope-drift: L3 → null", evalScopeDrift(normalizeSentrySignals({
    ledger: { level: "L3" }, events: [{ type: "containment-check", seq: 1, issue: "X", data: { mandate: "M", parent: null, root: false, verdict: "outward" } }],
  })) === null);
  ok("scope-drift: L4, no containment-check events, discovered_scope_filed 0 → null", evalScopeDrift(normalizeSentrySignals({
    ledger: { level: "L4", discovered_scope_filed: 0 }, events: [],
  })) === null);
  // Recompute-mismatch: a recorded "contained" verdict with a malformed
  // ancestry_raw recomputes to "unreproducible" ≠ "contained" — trips, mirroring
  // audit.js's own fail-to-"unreproducible" behaviour.
  const sdMismatch = evalScopeDrift(normalizeSentrySignals({
    ledger: { level: "L4", prd_root_container: "FAFF-700" },
    events: [{ type: "containment-check", seq: 5, issue: "FAFF-900", data: { mandate: "FAFF-700", parent: "FAFF-401", root: false, ancestry_raw: "not-json", verdict: "contained" } }],
  }));
  ok("scope-drift: recompute-mismatch trips with recorded/recomputed", sdMismatch
    && sdMismatch.signal === "scope-drift" && sdMismatch.severity === "trip"
    && sdMismatch.evidence.drift_kind === "recompute-mismatch"
    && sdMismatch.evidence.accepted_root === "FAFF-700" && sdMismatch.evidence.detective === true
    && sdMismatch.evidence.recorded === "contained" && sdMismatch.evidence.recomputed === "unreproducible"
    && sdMismatch.evidence.seq === 5 && sdMismatch.evidence.issue === "FAFF-900");
  // Unrecorded-create: ledger says scope was filed, timeline holds zero
  // containment-check events at all.
  const sdUnrecorded = evalScopeDrift(normalizeSentrySignals({
    ledger: { level: "L4", discovered_scope_filed: 2 }, events: [],
  }));
  ok("scope-drift: unrecorded-create trips with discovered_scope_filed echoed", sdUnrecorded
    && sdUnrecorded.evidence.drift_kind === "unrecorded-create" && sdUnrecorded.evidence.discovered_scope_filed === 2);
  // Outward-boundary-reach: a NON-root pre-create walk that came back "outward",
  // and recomputes cleanly (no ancestry_raw → subtreeContains(mandate, parent, {})).
  const sdOutward = evalScopeDrift(normalizeSentrySignals({
    ledger: { level: "L4", prd_root_container: "FAFF-700" },
    events: [{ type: "containment-check", seq: 5, issue: "FAFF-900", data: { mandate: "FAFF-700", parent: "FAFF-401", root: false, verdict: "outward" } }],
  }));
  ok("scope-drift: outward-boundary-reach trips carrying seq/issue/mandate/parent", sdOutward
    && sdOutward.evidence.drift_kind === "outward-boundary-reach"
    && sdOutward.evidence.seq === 5 && sdOutward.evidence.issue === "FAFF-900"
    && sdOutward.evidence.mandate === "FAFF-700" && sdOutward.evidence.parent === "FAFF-401");
  // The sanctioned filing floor (root:true outward) never contributes to
  // outward-boundary-reach — cleanly recomputing, discovered_scope_filed matching
  // its one recorded check → null (the designed floor is not drift).
  ok("scope-drift: root:true outward filing floor, coherent → null", evalScopeDrift(normalizeSentrySignals({
    ledger: { level: "L4", prd_root_container: "FAFF-700", discovered_scope_filed: 1 },
    events: [{ type: "containment-check", seq: 1, issue: "FAFF-900", data: { mandate: "FAFF-700", parent: null, root: true, verdict: "outward" } }],
  })) === null);
  ok("scope-drift: all-contained, cleanly-recomputing, nothing filed → null", evalScopeDrift(normalizeSentrySignals({
    ledger: { level: "L4", prd_root_container: "FAFF-700" },
    events: [{ type: "containment-check", seq: 1, issue: "FAFF-900", data: { mandate: "FAFF-700", parent: "FAFF-700", root: false, verdict: "contained" } }],
  })) === null);
  // Precedence: recompute-mismatch > unrecorded-create > outward-boundary-reach —
  // when a mismatch AND an outward reach are both present, exactly one verdict
  // (the mismatch) is returned.
  const sdPrecedence = evalScopeDrift(normalizeSentrySignals({
    ledger: { level: "L4", prd_root_container: "FAFF-700" },
    events: [
      { type: "containment-check", seq: 1, issue: "A", data: { mandate: "FAFF-700", parent: "FAFF-401", root: false, ancestry_raw: "not-json", verdict: "contained" } },
      { type: "containment-check", seq: 2, issue: "B", data: { mandate: "FAFF-700", parent: "FAFF-402", root: false, verdict: "outward" } },
    ],
  }));
  ok("scope-drift: precedence — mismatch beats a co-present outward reach", sdPrecedence
    && sdPrecedence.evidence.drift_kind === "recompute-mismatch");
  // No self-report path: setting the removed signals.scope_drift / an event's
  // data.scope_drift key produces no verdict by itself (the self-report is gone).
  ok("scope-drift: self-report flag alone (non-L4) → null", evalScopeDrift(normalizeSentrySignals({
    scope_drift: true, ledger: {}, events: [{ type: "containment-check", seq: 1, data: { scope_drift: true } }],
  })) === null);
  ok("scope-drift: self-report flag alone (L4, no containment activity) → null", evalScopeDrift(normalizeSentrySignals({
    scope_drift: true, ledger: { level: "L4" }, events: [{ type: "build-start", issue: "X", data: { scope_drift: true } }],
  })) === null);
  // normalizeSentrySignals no longer emits a scope_drift key at all.
  ok("normalizeSentrySignals drops the removed scope_drift key", !("scope_drift" in normalizeSentrySignals({ scope_drift: true })));

  ok("forbidden-side-effect degraded → null", evalForbiddenSideEffect(normalizeSentrySignals({})) === null);
  ok("forbidden-side-effect flagged → trip", evalForbiddenSideEffect(normalizeSentrySignals({ forbidden_side_effect: true })).severity === "trip");

  // --- intervention aggregation (ladder-max) ---
  const aggAbort = evaluateDerailment({ budget: { breached: ["max_attempts"], outcome: "escalate" }, events: thr, ledger: {} }, TH);
  ok("escalate+thrash → abort (max of pause,abort)", aggAbort.intervention === "abort" && aggAbort.tripped === true);
  const aggPause = evaluateDerailment({ events: thr, ledger: {}, budget: { breached: [], outcome: "none" } }, TH);
  ok("thrash only → pause", aggPause.intervention === "pause" && aggPause.tripped === true);
  const aggCont = evaluateDerailment({ ledger: {}, budget: { breached: ["tokens"], outcome: "narrow" }, events: [] }, TH);
  ok("warn-only (budget-breach narrow) → continue, not tripped", aggCont.intervention === "continue" && aggCont.tripped === false && aggCont.verdicts.length === 1);
  const aggNone = evaluateDerailment({ ledger: {}, budget: { breached: [], outcome: "none" }, events: [] }, TH);
  ok("clean run → continue, no verdicts", aggNone.intervention === "continue" && aggNone.verdicts.length === 0);

  // --- FAFF-764: scope-drift flows through evaluateDerailment with no authority
  // parameter → aggregate intervention is at least "pause"; no CORRECTABLE_SIGNAL/
  // authority upgrade is consulted for it (the spec §5 integration smoke test) ---
  const aggScopeDrift = evaluateDerailment({
    ledger: { level: "L4", prd_root_container: "FAFF-700", discovered_scope_filed: 1 },
    events: [{ type: "containment-check", seq: 5, issue: "FAFF-900", data: { mandate: "FAFF-700", parent: "FAFF-401", root: false, verdict: "outward" } }],
  }, TH);
  ok("scope-drift trip → aggregate intervention pause, no authority consulted", aggScopeDrift.tripped === true
    && aggScopeDrift.intervention === "pause"
    && aggScopeDrift.verdicts.some((v) => v.signal === "scope-drift" && v.evidence.drift_kind === "outward-boundary-reach"));
  const aggScopeDriftAuth = evaluateDerailment({
    ledger: { level: "L4", discovered_scope_filed: 3 }, events: [],
  }, TH, "available");
  ok("scope-drift + authority available → still pause, never correct (only fix-review-thrash upgrades)",
    aggScopeDriftAuth.intervention === "pause");

  // --- FAFF-447: budget-metering-degraded through the full aggregation fold ---
  const degradedL4Ledger = { level: "L4", owner: { status: "running", started_at: ago(TH.estimate_metering_exposure_secs + 60), last_heartbeat: ago(0) } };
  // now_ms: NOW is pinned explicitly here (unlike the ago()-relative fixtures
  // above) — this predicate is elapsed-time-sensitive, and evaluateDerailment
  // defaults now_ms to the real Date.now() when absent, which against a fixed
  // 2026-06-29 started_at would ALSO spuriously trip wall-clock-runaway's
  // run_elapsed_ceiling_secs (a real multi-day gap), masking the very isolation
  // ("alone" / "never upgrades") these assertions are testing for.
  const aggDegradedAlone = evaluateDerailment({ ledger: degradedL4Ledger, budget: { breached: [], outcome: "none", tokens_source: "estimate" }, events: [], now_ms: NOW }, TH);
  ok("estimate-only degrade alone → surface, tripped (FAFF-767: run-scoped, not pause)", aggDegradedAlone.intervention === "surface" && aggDegradedAlone.tripped === true
    && aggDegradedAlone.verdicts.some((v) => v.signal === "budget-metering-degraded"));
  const aggDegradedPlusBreach = evaluateDerailment({ ledger: degradedL4Ledger, budget: { breached: ["max_attempts"], outcome: "escalate", tokens_source: "estimate" }, events: [], now_ms: NOW }, TH);
  ok("estimate-only degrade + a co-tripping budget-breach → abort wins the ladder-max, degrade verdict still present",
    aggDegradedPlusBreach.intervention === "abort"
    && aggDegradedPlusBreach.verdicts.some((v) => v.signal === "budget-metering-degraded")
    && aggDegradedPlusBreach.verdicts.some((v) => v.signal === "budget-breach"));
  const aggDegradedAuthAvailable = evaluateDerailment({ ledger: degradedL4Ledger, budget: { breached: [], outcome: "none", tokens_source: "estimate" }, events: [], now_ms: NOW }, TH, "available");
  ok("authority available never upgrades budget-metering-degraded (only fix-review-thrash upgrades)",
    aggDegradedAuthAvailable.intervention === "surface");

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
  ok("AC5 normalizer keeps only the surface allowlist", Object.keys(normalizeSentrySignals(hostile)).sort().join(",") === "budget,events,forbidden_side_effect,heartbeat_source,ledger,member_beats,now_ms");

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

  // FAFF-553: the run-scoped in-flight staleness grace — a stale run heartbeat with
  // ≥1 in-flight member (build-start, no terminal outcome) and run-elapsed under the
  // ceiling contributes at most "pause"; the verdict still TRIPS (visible), evidence
  // carries the in-flight members + the grace tag. (Supersedes the pre-553 contract
  // that all-members-stalled always tripped run-scoped "abort".)
  const allStalledLedger = { owner: { status: "running", last_heartbeat: ago(memberTH.stall_window_secs + 60), started_at: ago(100) } };
  const aggAllStalled = evaluateDerailment({
    ledger: allStalledLedger, budget: { breached: [], outcome: "none" }, events: memberEvents, now_ms: NOW,
    member_beats: { MSTALL: ago(memberTH.stall_window_secs + 60) },
  }, memberTH);
  const rsGraced = aggAllStalled.verdicts.find((v) => v.signal === "wall-clock-runaway" && v.scope === undefined);
  ok("FAFF-553: stale run file + in-flight member + elapsed under ceiling -> run-scoped trip capped at pause (in-flight grace)",
    aggAllStalled.intervention === "pause" && aggAllStalled.tripped === true &&
    rsGraced && rsGraced.evidence.tripped_on === "heartbeat-staleness" &&
    JSON.stringify(rsGraced.evidence.in_flight) === JSON.stringify(["MSTALL"]) &&
    rsGraced.evidence.grace === "in-flight-unit");

  // FAFF-553: the SAME staleness with ZERO in-flight members -> abort (unchanged).
  const aggStaleNoInflight = evaluateDerailment({
    ledger: { owner: { status: "running", last_heartbeat: ago(memberTH.stall_window_secs + 60), started_at: ago(100) } },
    budget: { breached: [], outcome: "none" }, events: [], now_ms: NOW,
  }, memberTH);
  const rsNoInflight = aggStaleNoInflight.verdicts.find((v) => v.signal === "wall-clock-runaway" && v.scope === undefined);
  ok("FAFF-553: stale run file with NO in-flight member -> abort, no grace annotation (unchanged)",
    aggStaleNoInflight.intervention === "abort" &&
    rsNoInflight && rsNoInflight.evidence.grace === undefined && rsNoInflight.evidence.in_flight === undefined);

  // FAFF-553: a member whose ledger outcome is terminal is NOT in flight -> abort too.
  const aggStaleAllDone = evaluateDerailment({
    ledger: { outcomes: { MSTALL: "shipped" }, owner: { status: "running", last_heartbeat: ago(memberTH.stall_window_secs + 60), started_at: ago(100) } },
    budget: { breached: [], outcome: "none" }, events: memberEvents, now_ms: NOW,
  }, memberTH);
  ok("FAFF-553: stale run file whose only member reached a terminal outcome -> abort (not in flight, no grace)",
    aggStaleAllDone.intervention === "abort");

  // FAFF-553: the elapsed-ceiling backstop — staleness trip + in-flight member but
  // run-elapsed OVER the ceiling -> abort regardless (the grace never survives the
  // elapsed backstop; tripped_on stays heartbeat-staleness because staleTrip wins
  // the ternary, which is exactly why the cap re-checks the elapsed evidence).
  const aggOverCeiling = evaluateDerailment({
    ledger: { owner: { status: "running", last_heartbeat: ago(memberTH.stall_window_secs + 60), started_at: ago(memberTH.run_elapsed_ceiling_secs + 60) } },
    budget: { breached: [], outcome: "none" }, events: memberEvents, now_ms: NOW,
    member_beats: { MSTALL: ago(memberTH.stall_window_secs + 60) },
  }, memberTH);
  const rsOverCeiling = aggOverCeiling.verdicts.find((v) => v.signal === "wall-clock-runaway" && v.scope === undefined);
  ok("FAFF-553: run-elapsed over the ceiling -> abort regardless of in-flight members (grace never survives the backstop)",
    aggOverCeiling.intervention === "abort" &&
    rsOverCeiling && rsOverCeiling.evidence.tripped_on === "heartbeat-staleness" &&
    rsOverCeiling.evidence.grace === undefined);

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
  // explicit authority parameter (pinned above; this asserts the shape).
  // FAFF-767: `surface` is now IN the ladder too, between continue and pause. ---
  ok("ladder is exactly continue|surface|pause|correct|abort, abort still terminal",
    JSON.stringify(SENTRY_INTERVENTIONS) === JSON.stringify(["continue", "surface", "pause", "correct", "abort"]) &&
    SENTRY_INTERVENTIONS[SENTRY_INTERVENTIONS.length - 1] === "abort");
  ok("surface sits strictly between continue and pause",
    SENTRY_INTERVENTIONS.indexOf("continue") < SENTRY_INTERVENTIONS.indexOf("surface") &&
    SENTRY_INTERVENTIONS.indexOf("surface") < SENTRY_INTERVENTIONS.indexOf("pause"));
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

  // --- FAFF-608: renderSentryCheckSummaryMd fixture — a tripped payload renders the
  // TRIP line + a verdicts table + the two remedy commands (matching sentrycheck.js's
  // trippedNotice wording); a clean payload renders the ✅ line and no remedy lines. ---
  const trippedPayload = {
    run_dir: "/some/run/dir", verdicts: [{ signal: "wall-clock-runaway", severity: "trip" }],
    intervention: "abort", tripped: true, config_malformed: false,
  };
  const trippedMd = renderSentryCheckSummaryMd(trippedPayload);
  ok("renderSentryCheckSummaryMd: tripped payload renders the TRIP line",
    trippedMd.includes("❌ TRIP — intervention: abort"));
  ok("renderSentryCheckSummaryMd: tripped payload renders a verdicts table naming the signal",
    trippedMd.includes("| signal | severity |") && trippedMd.includes("| wall-clock-runaway | trip |"));
  ok("renderSentryCheckSummaryMd: tripped payload names the remedy commands verbatim (matching sentrycheck.js trippedNotice)",
    trippedMd.includes("faff sentry check --run-dir /some/run/dir") &&
    trippedMd.includes("faff sentry abort --run-dir /some/run/dir --worktree <path>"));
  ok("renderSentryCheckSummaryMd: markdown ends in a single trailing newline (governance-check parity)",
    trippedMd.endsWith("\n") && !trippedMd.endsWith("\n\n\n"));

  const cleanPayload = { run_dir: "/some/run/dir", verdicts: [], intervention: "continue", tripped: false, config_malformed: false };
  const cleanMd = renderSentryCheckSummaryMd(cleanPayload);
  ok("renderSentryCheckSummaryMd: clean payload renders the ✅ no-derailment line",
    cleanMd.includes("✅ no derailment — intervention: continue"));
  ok("renderSentryCheckSummaryMd: clean payload names no remedy commands and no verdicts table",
    !cleanMd.includes("faff sentry abort") && !cleanMd.includes("| signal | severity |"));

  const malformedPayload = { run_dir: null, verdicts: [], intervention: "continue", tripped: false, config_malformed: true };
  const malformedMd = renderSentryCheckSummaryMd(malformedPayload);
  ok("renderSentryCheckSummaryMd: config_malformed payload notes the degradation and falls back the run label",
    malformedMd.includes("config_malformed") && malformedMd.includes("(no run resolved)"));

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (sentry --selftest, ${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { CORRECTABLE_SIGNAL, DERAILMENT_SIGNALS, SENTRY_INTERVENTIONS, SENTRY_SPEC, SENTRY_SURFACE, SENTRY_THRESHOLD_DEFAULTS, SIGNAL_TRIP_INTERVENTION, actsOnSentryAbort, actsOnSentryPause, applySentryAbort, cmdSentry, declaredUnattendedFromConfig, sentryActingFromConfig, evalBudgetBreach, evalBudgetMeteringDegraded, evalForbiddenSideEffect, evalMemberStall, evalRepeatedFailure, evalScopeDrift, evalThrash, evalWallClock, evaluateDerailment, normalizeSentrySignals, renderSentryCheckSummaryMd, resolveSentryNow, sentryFailureFingerprint, sentryHeartbeatAgeSecs, sentryIndeterminate, sentryInflightMembers, sentryReadBudget, sentryReadCorrectiveAuthority, sentryReadDetectionIntegrity, sentryReadEvents, sentryRunElapsedSecs, sentrySelftest, sentryThresholds };
