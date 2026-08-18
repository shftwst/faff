# Heartbeat-freshness-vs-logged-progress correlation signal (FAFF-847)

> Spec: faffter-dark-nlspec · 2026-08-18 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-847.

This is the buildable spec for FAFF-847, the one mechanism ADR-0034 names but does not design: a live Sentry signal that catches a build lane whose heartbeat keeps ticking while it makes no forward progress (ADR-0034 forgery vector **4b** — "gamed liveness" via the sanctioned `faff heartbeat` command). Audience: the build agent implementing it, and the human reviewers gating this Low-priority slice. The design is a deliberately **warn-only first cut** — it makes the 4b signature visible without acting on it, because the false-positive risk is real and unquantified.

## 1. WHY — Problem and Principles

**The load-bearing model.** Sentry today measures liveness by *freshness alone*: `evalWallClock` (`sentry.js:336`) trips only when the heartbeat ages past `stall_window_secs` or the run passes its elapsed ceiling. A genuinely stalled lane that keeps calling the sanctioned `faff heartbeat` command stays "fresh" forever and never trips. The 4b residual is only visible by adding a **second freshness axis**: the age of the most-recent *forward-progress-bearing event* on the orchestrator-owned, chain-covered `events.jsonl`. When the heartbeat is fresh but progress is stale, that gap — fresh liveness over frozen progress — is the 4b signature. Everything below is the mechanics of measuring that one gap and surfacing it.

**Problem statement.** `sentry check`'s liveness predicate reads heartbeat age and nothing else, so a legitimate `faff heartbeat` tick issued while the lane is genuinely stalled produces a chain-clean, correctly-hashed ledger that every hash/fold check reads as `verified` (FAFF-511 accepts this as an honest open residual). This ticket adds a live correlation signal — heartbeat-freshness cross-checked against logged-progress-freshness — as ADR-0034's follow-up guard (line 95) prescribes. It ships **surface/warn-only**: the signal fires and is logged, but never pauses or aborts a run.

**Design principles.**

**AC5 — orchestrator-read, never subagent-supplied.** The progress evidence must come only from the closed orchestrator surface that `normalizeSentrySignals` (`sentry.js:266`) admits. This spec derives the signal from the *existing* `events` entry on that allowlist — already orchestrator-owned, already the input `evalThrash`/`evalRepeatedFailure` trust — so no new input key is introduced and the un-subvertable-by-construction property is preserved by construction. An implementation that reads a subagent-writable file (a per-issue progress sidecar, a build-lane scratch file) in the sentry hot path violates this and is rejected.

**Network-free hot path.** `sentry check` performs no git, PR, tracker, or network reads. The signal is computed purely from event timestamps already in memory. An implementation that reaches for `gh pr view` or a commit walk to measure "progress" is rejected.

**Day-one must not act.** The signal *will* false-positive on a legitimately slow/quiet build (a long compile or test suite emits heartbeats but no progress events during the quiet step). A string of shipped bugs (FAFF-234, -553, -774, -795, -798) were healthy slow/quiet builds that the age-based sentry false-tripped, several causing real aborts of healthy runs. Escalation past `surface` is therefore deferred until real fire-rate data exists (FAFF-511's D3 precedent, directly reused). An implementation that maps this signal to `pause`/`abort` on day one is rejected.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `bin/lib/sentry.js` | JavaScript (Node) | Home of the new predicate, the signal registry, and the intervention map |
| `bin/lib/governance-profile.js` | JavaScript (Node) | Profile-driven event vocabulary; new `sentry.progress` sub-vocab lives here |
| `bin/lib/events.js` | JavaScript (Node) | The hash-chained, orchestrator-owned `events.jsonl` the progress signal reads |
| `records/adr/0034-*.md` | Markdown (ADR) | Names vector 4b and the exact remedy this ticket builds (line 95) |

(Note: the live source tree roots these under `plugin/skills/faff/bin/lib/*`.)

**Scope statement.** This is one non-acting predicate inside the existing `sentry check` derailment evaluator — the 4b-only signal that sits *beyond* FAFF-511's settled network-free substrate check, not a change to that floor.

## 2. OUT OF SCOPE

- **Re-opening FAFF-511's approach (iii) / the substrate-integrity floor** — Why excluded: FAFF-511 is settled; this ticket is strictly the 4b-only correlation signal on top of it. Extension point: none — do not touch `sentryReconcileCheck` / `detection_trust`.
- **Escalating the signal to `pause` or `abort`** — Why excluded: the false-positive rate is unquantified; acting day-one would abort healthy slow builds. Extension point: `SIGNAL_TRIP_INTERVENTION` (`sentry.js:152`) — a future slice re-maps the signal once fire-rate data justifies it (see Open Questions).
- **Poller-side diff-over-time enrichment** — Why excluded: the stateless `sentry check` cannot hold a progress count across ticks; the detached poller (`sentry-poller.js`) is the one long-lived process that can, but by its module contract it *consumes* predicates, it does not invent detection math. Extension point: `decideTick`/`gatherFacts` (`sentry-poller.js:153/219`) — a future slice can carry a per-tick progress-delta streak that consumes this predicate's evidence.
- **Run-end reconcile audit of the 4b signature** — Why excluded: ADR-0034 (line 77) explicitly critiques the post-hoc shape — a run-end audit has already let the run spend whatever budget/wall-clock the gamed liveness was hiding. Extension point: `DIVERGENCE_CLASSES` (`reconcile.js:23`) — available if a durable after-the-fact record is later wanted *in addition to* the live signal.
- **Reading per-issue progress sidecars (`build-progress.json`, `review-progress.json`, `landing-progress.json`)** — Why excluded: these carry finer mid-build movement timestamps but are un-chained, per-issue, build-lane-adjacent sidecars — reading them in the hot path costs new fs I/O and weakens the AC5 trust model. Extension point: `normalizeSentrySignals` allowlist (`sentry.js:266`) — a future richer progress input MUST enter there, read by `cmdSentry` from the orchestrator-owned surface, exactly as `member_beats` does.
- **Closing the sibling in-flight-grace hole** — Why excluded: the run-scoped in-flight staleness grace (`sentry.js:679-701`) caps a stale-heartbeat trip to `pause` while ≥1 member is "in-flight", keyed off a build-start proxy that is *exactly* as gameable as raw heartbeat freshness. Fixing it means changing acting behaviour, which day-one defers. See Open Questions — this spec surfaces the gamed-grace case (the new signal fires *while* the grace holds) but does not change the grace.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| forward-progress-bearing event | An `events.jsonl` event type that represents genuine run movement (a build starting, a fix-cycle turn, a ledger mutation, an outcome) — distinct from supervision-cadence events (`sentry-checkpoint`, `sentry-trip`) that fire on every consult regardless of progress |
| progress-age | `now − max(timestamp of the most-recent forward-progress-bearing event, owner.started_at)`, in seconds — the freshness of logged progress, symmetric to heartbeat-age |
| 4b signature | Heartbeat fresh (age ≤ window) AND progress stale (progress-age > window) — the gamed-liveness pattern this predicate detects |
| `surface` | The existing run-scoped, non-acting intervention (FAFF-767): writes the run log + the `/faff-wtf`-visible surface, never parks an issue, never escalates |

**Profile vocabulary (new).** The forward-progress set is profile-driven, mirroring `sentry.thrash` / `sentry.failure`, so it stays dialect-independent (the `SECOND_PROFILE` proof and the profile validator both extend to it — no hardcoded `"build-start"` string in the predicate).

```
RECORD profile.sentry.progress:          # NEW sub-vocab in DELIVERY_PROFILE.sentry
  forward_types: List<String>            # event types that count as forward progress
                                         # DELIVERY default (see Design Decision 1):
                                         #   ["build-start", "issue-outcome",
                                         #    "corrective-authored", "corrective-consumed",
                                         #    "ledger-write", "park", "issue-admitted"]
  CONSTRAINT: MUST NOT include "sentry-checkpoint" or "sentry-trip"
              (supervision cadence, not progress — would defeat the signal)
```

**Signal + evidence (new).**

```
CONST signal name: "heartbeat-progress-mismatch"
  # MUST be added to DERAILMENT_SIGNALS (sentry.js:~133) or the push() guard
  # (sentry.js:645) silently drops the verdict.
  # MUST be added to SIGNAL_TRIP_INTERVENTION (sentry.js:152) mapping to "surface".
  # SAFETY-CRITICAL: an unmapped signal falls through `|| "pause"` in the
  # aggregation loop (sentry.js:666) — i.e. it would ACT. The mapping is not optional.

RECORD HeartbeatProgressMismatchVerdict:   # the DerailmentVerdict this predicate returns
  signal: "heartbeat-progress-mismatch"
  severity: "trip"                          # counts toward tripped:true, like budget-metering-degraded
  evidence:
    heartbeat_age_secs: Int                 # rounded; the fresh side of the mismatch
    progress_age_secs: Int                  # rounded; the stale side
    window_secs: Int                        # the stall_window_secs used (reused knob, no new threshold)
    last_progress_event_type: String|null   # which forward type last moved (null if none seen — baseline was started_at)
    last_progress_event_seq: Int|null       # that event's seq, for traceability
```

**Predicate signature (new).** Pure, filesystem-free — mirrors every other predicate in `sentry.js`.

```
FUNCTION evalHeartbeatProgressMismatch(ledger, events, nowMs, th, profile) -> Verdict | null
```

**Payload.** The predicate's verdict rides the existing `result.verdicts` array in the `sentry check` payload (`sentry.js:1105`) exactly like every other signal — no new top-level payload key. `tripped` and `intervention` aggregate through the unchanged loop; because the signal maps to `surface`, it lifts `intervention` to at most `surface` (below `pause` in the ladder).

**Design decision markers** for this section are collected in §6 and §7.

## 4. HOW — Behavior

**Architecture.** One new pure predicate, registered in the existing evaluator, mapped to the existing non-acting intervention.

1. `evaluateDerailment` (`sentry.js:640`) gains one `push(evalHeartbeatProgressMismatch(s.ledger, s.events, s.now_ms, th, profile))` call, alongside the existing `push(evalWallClock(...))`.
2. `evalHeartbeatProgressMismatch` reads only `s.ledger` and `s.events` — both already on the normalized closed surface. No new `normalizeSentrySignals` key.
3. The verdict flows through the unchanged aggregation loop; `SIGNAL_TRIP_INTERVENTION["heartbeat-progress-mismatch"] === "surface"` keeps it non-acting.

**Behaviour summary.** The predicate fires exactly when a running owner has a *fresh* heartbeat but *stale* logged progress — the gamed-liveness gap — and stays silent in every other case (young run, genuinely dead run, healthy progressing run).

```
PROCEDURE evalHeartbeatProgressMismatch(ledger, events, nowMs, th, profile):
  1. owner ← ledger.owner
     IF no owner OR owner.status != "running": RETURN null      # only a running owner can game liveness
  2. hbAge ← (nowMs - Date.parse(owner.last_heartbeat)) / 1000
     IF hbAge is not finite: RETURN null                        # no heartbeat → wall-clock owns this, not us
     IF hbAge > th.stall_window_secs: RETURN null               # heartbeat STALE → evalWallClock already trips; suppress (no redundant noise)
  3. forwardTypes ← Set(profile.sentry.progress.forward_types)
     lastProgressMs ← max over events e WHERE e.type ∈ forwardTypes AND Date.parse(e.ts) finite: Date.parse(e.ts)
     baselineMs ← max(lastProgressMs, Date.parse(owner.started_at))   # started_at floors the baseline (young-run guard)
     IF baselineMs is not finite: RETURN null                   # no started_at and no progress event → insufficient evidence, fail toward silence
     progressAge ← (nowMs - baselineMs) / 1000
  4. IF progressAge <= th.stall_window_secs: RETURN null         # progress is fresh enough → no mismatch
  5. RETURN {
       signal: "heartbeat-progress-mismatch", severity: "trip",
       evidence: { heartbeat_age_secs: round(hbAge), progress_age_secs: round(progressAge),
                   window_secs: th.stall_window_secs,
                   last_progress_event_type: <type of the argmax event, or null>,
                   last_progress_event_seq: <its seq, or null> }
     }
```

**Window.** Reuse `th.stall_window_secs` (default 900s) — the same knob `evalWallClock` and `evalMemberStall` already use. No new threshold key (mirrors FAFF-327's "reused, not a new knob" precedent).

**Edge cases and error handling.**
- **No owner / not running** → `null` (mirrors `evalWallClock`'s guard). A done/unowned run cannot game liveness.
- **Heartbeat absent/unparseable** (`hbAge` not finite) → `null`. Without a fresh heartbeat there is no "gamed" freshness to contrast; the wall-clock predicate (or its absence) owns that case.
- **Heartbeat stale** (`hbAge > window`) → `null`. `evalWallClock` already trips on staleness; firing here too would be redundant noise and would blur the clean separation between the two axes.
- **Young run, no progress events yet** → `owner.started_at` floors the baseline, so `progressAge` stays small and no trip fires (mirrors `evalMemberStall` using build-start ts as a baseline).
- **Event with unparseable/absent `ts`** → skipped when computing `lastProgressMs` (mirrors `sentryInflightMembers`).
- **Neither `started_at` nor any forward event parseable** → `null` (insufficient evidence; fail toward silence — the safe direction for a warn-only day-one signal).

**Anti-pattern:** adding `"heartbeat-progress-mismatch"` to `DERAILMENT_SIGNALS` but forgetting the `SIGNAL_TRIP_INTERVENTION` entry. Why: the aggregation loop does `SIGNAL_TRIP_INTERVENTION[v.signal] || "pause"` — an unmapped trip silently defaults to `pause`, turning a warn-only signal into an acting one and violating the day-one principle.

**Anti-pattern:** counting `sentry-checkpoint` or `sentry-trip` as forward progress. Why: they fire on every consult (and on every trip) regardless of build progress — including them lets a stalled run's own supervision traffic reset the progress clock, defeating the signal entirely.

**Anti-pattern:** gating the trip on heartbeat *staleness* instead of *freshness*. Why: that reproduces `evalWallClock`; the whole point of 4b is the fresh-heartbeat case `evalWallClock` cannot see.

**Failure modes.**

- **The false-positive confound (the central risk).** A legitimately slow or quiet build (large compile, long test run) emits heartbeats but no forward-progress events during the quiet step, so `progressAge` crosses the window and the signal fires on a *healthy* run. **How you'd know:** the surfaced verdict appears on runs that subsequently ship normally; the fire-rate correlates with build duration, not with genuine stalls. **What it means:** proceed — but *only* at `surface`. This confound is exactly why escalation is deferred; the day-one job is to gather the fire-rate, not to act on it. If the benign fire-rate is high, the honest outcome may be that the signal never earns escalation — a valid result to record, not a gap to hide.
- **Progress events are only as trustworthy as `events.jsonl`.** A same-uid build lane can forge events (ADR-0034 vectors 1/2/7), so a lane that games heartbeat could also forge a progress event to suppress this signal. **How you'd know:** correlate with FAFF-511's substrate-integrity check — a forged progress event travels with the same chain-clean-but-untrue property. **What it means:** proceed at `surface` only; this signal is a corroborating detective aid, not a hardened control. Its trust model is identical to `evalThrash`'s, which is already event-derived and coarse by design.
- **The sibling in-flight-grace hole stays open.** The run-scoped grace (`sentry.js:679-701`) softens a stale-heartbeat abort to `pause` while a build-start proxy says a member is in-flight — a proxy as gameable as raw freshness. This signal *surfaces* the gamed-grace case (it fires on fresh-heartbeat + stale-progress even while the grace holds) but does not change the grace's capping. **How you'd know:** a run shows a `heartbeat-progress-mismatch` surface verdict concurrent with an `in-flight-unit` grace annotation on a wall-clock verdict. **What it means:** narrow — closing the grace hole is a separate acting-behaviour change, punted (§7).

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a running L3 run whose build lane keeps calling `faff heartbeat`
  (heartbeat age 60s) but whose last forward-progress-bearing event on
  events.jsonl is 1200s old and whose started_at is well over the window
When `sentry check` evaluates derailment
Then a verdict { signal: "heartbeat-progress-mismatch", severity: "trip" } is emitted
  with evidence.heartbeat_age_secs ≈ 60 and evidence.progress_age_secs ≈ 1200
  And the aggregate intervention is "surface" (never pause/abort) with tripped: true
```

```
Given a healthy running run with a fresh heartbeat (30s) AND a fresh
  forward-progress event (corrective-consumed 120s ago, inside the window)
When `sentry check` evaluates derailment
Then evalHeartbeatProgressMismatch returns null and no such verdict appears
```

- The predicate performs no git, PR, tracker, or network read — it consults only `ledger` and `events` already on the normalized surface (AC5 + network-free assertion).
- No key outside the existing `normalizeSentrySignals` allowlist is read to compute the signal.

## 6. DESIGN DECISION RATIONALE

**What is the progress-movement metric, and over what window?**
- *Options:* (a) count of appended events over the window (delta); (b) freshness of the most-recent forward-progress-bearing event (age); (c) `build-progress.json`/sidecar `updated_at` deltas; (d) PR/commit advance.
- (a) needs a remembered prior count — impossible for a stateless `sentry check`; it is the poller's strength, deferred. (c) reads un-chained, per-issue, build-lane-adjacent sidecars — new fs I/O, weaker trust, AC5 tension. (d) violates network-free.
- **Chosen:** (b) freshness-of-last-forward-progress-event, symmetric to heartbeat-age, computed statelessly from the `events` already on the closed surface; window reuses `stall_window_secs`. Rationale: stateless, network-free, AC5-clean (no new input), and the natural mirror of the heartbeat-age axis the signal contrasts against.

**Which event types count as forward progress?**
- *Options:* only the once-per-issue `build-start`; the repeating fix-cycle types; all event types; a curated profile-driven set.
- `build-start` alone is useless (it never repeats after the last real step). "All types" wrongly counts `sentry-checkpoint`/`sentry-trip`, which fire every consult and would let supervision traffic mask a stall.
- **Chosen:** a profile-driven `sentry.progress.forward_types` set (default: `build-start`, `issue-outcome`, `corrective-authored`, `corrective-consumed`, `ledger-write`, `park`, `issue-admitted`), explicitly excluding `sentry-checkpoint`/`sentry-trip`. Rationale: matches the codebase's FAFF-362 discipline (no embedded vocabulary literals; dialect-independent via `SECOND_PROFILE`), and the exclusion is load-bearing for the signal to work. Exact membership is tunable and affects only fire-rate, not safety (day-one is warn-only).

**Where does the signal live: new Sentry predicate, poller-side, or run-end reconcile?**
- *Options:* (i) new live Sentry predicate; (ii) poller-side check; (iii) run-end reconcile divergence class.
- (ii) contradicts the poller's module contract (it consumes predicates, does not invent detection math). (iii) is post-hoc — ADR-0034 line 77 critiques it directly (already spent the budget/wall-clock the gamed liveness hid).
- **Chosen:** (i) a new live predicate in `evaluateDerailment`. Rationale: LIVE / real-time, network-free, AC5-preserving, and closest to ADR-0034's "as it happens" framing. The poller and reconcile remain documented extension points (§2).

**What intervention does it map to?**
- *Options:* `continue`, `surface`, `pause`, `abort`.
- Acting (`pause`/`abort`) day-one would abort healthy slow/quiet builds (FAFF-234/-553/-774/-795/-798 precedent). `continue` would make the signal invisible.
- **Chosen:** `surface` (FAFF-767) — run-scoped, logged, `/faff-wtf`-visible, names no issue to park, never escalates. Exactly mirrors `budget-metering-degraded` ("a blind spot, not a proven breach"). Rationale: FAFF-511's D3 precedent — annotate/surface-only, defer escalation until real-world false-positive data exists.

**Do we introduce a new `normalizeSentrySignals` allowlist key?**
- *Options:* add a dedicated progress-evidence key (like `member_beats`); derive from the existing `events` entry.
- **Chosen:** derive from the existing `events` entry — no new key. Rationale: `events` is already orchestrator-owned, already on the closed allowlist, already the trust root for `evalThrash`/`evalRepeatedFailure`; deriving from it satisfies AC5 by construction with the smallest surface. A future *richer* progress input (sidecar deltas) would still have to enter via the allowlist — that constraint is recorded for the extension point, not exercised now.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.**

- **Punt:** The exact escalation trigger from `surface` to `pause`/`abort` — needs human. (decides: product) Requires real-world fire-rate data distinguishing benign slow-build fires from genuine 4b stalls; cannot be set responsibly before that data exists. Day-one ships `surface` only; a later slice re-maps `SIGNAL_TRIP_INTERVENTION` once the rate is known.
- **Punt:** Whether to *also* add a run-end reconcile divergence class as a durable after-the-fact record — needs human. (decides: architecture) The live predicate is the primary mechanism (ADR-0034 line 77 disfavours post-hoc); a complementary reconcile record is optional and not needed to close 4b's live-detection gap.
- **Punt:** Whether to close the sibling in-flight-grace hole (`sentry.js:679-701`) by letting a `heartbeat-progress-mismatch` withdraw the grace — needs human. (decides: architecture) That changes acting behaviour (a graced `pause` could re-escalate to `abort`), which day-one's warn-only posture defers. This spec surfaces the gamed-grace case but leaves the grace's capping untouched.
- **Punt:** Whether the poller should carry a cross-tick progress-delta streak to suppress single-tick benign fires — needs human. (decides: architecture) A poller-side dedup/streak would cut surface-log noise but belongs to a later poller slice consuming this predicate's evidence.

**Assumptions.**

- **Assumes:** `events.jsonl` is the orchestrator-owned, single-writer progress surface. Validate: confirm `events` on the `normalizeSentrySignals` allowlist and that `evalThrash`/`evalRepeatedFailure` already derive verdicts from it (`sentry.js:266`, `:361`, `:403`) — the same trust model this signal inherits.
- **Assumes:** the `surface` intervention exists and is non-acting. Validate: `SENTRY_INTERVENTIONS` includes `"surface"` between `continue` and `pause`, and `budget-metering-degraded` maps to it (`sentry.js:145`, `:166`).
- **Assumes:** `stall_window_secs` and the profile `sentry.*` sub-vocab shape are as read. Validate: `governance-profile.js:118` (`stall_window_secs`) and `:127-128` (`thrash`/`failure` sub-vocabs) — the `progress` sub-vocab is added in the same shape, with matching `SECOND_PROFILE` entry and profile-validator coverage.
- **Assumes (constraint, not a decision):** the sentry hot path is network-free and progress evidence is orchestrator-read only. These are ADR-0034 / AC5 hard constraints, taken as given, not relitigated here.

## 8. DONE — Definition of Done

### From WHY
- [ ] A running run with a fresh heartbeat and a last-forward-progress event older than `stall_window_secs` produces a `heartbeat-progress-mismatch` verdict from `sentry check`.
- [ ] The signal never raises the aggregate intervention above `surface` (asserted: no path maps it to `pause`/`abort`).

### From WHAT (vocabulary and profile)
- [ ] `DELIVERY_PROFILE.sentry.progress.forward_types` exists with the chosen default set and excludes `sentry-checkpoint` and `sentry-trip`.
- [ ] `SECOND_PROFILE` gains a corresponding `sentry.progress` entry and the profile validator (`governance-profile.js`) accepts/validates the new sub-vocab, so `profiles` selftest/tests pass.
- [ ] `"heartbeat-progress-mismatch"` is added to `DERAILMENT_SIGNALS`.
- [ ] `SIGNAL_TRIP_INTERVENTION["heartbeat-progress-mismatch"] === "surface"` (guards the safety-critical `|| "pause"` fallthrough).

### From HOW (behaviour)
- [ ] `evalHeartbeatProgressMismatch(ledger, events, nowMs, th, profile)` is pure and performs no filesystem/git/network I/O.
- [ ] It is registered via a single `push(...)` in `evaluateDerailment`.
- [ ] It reads only `s.ledger` and `s.events` (no new `normalizeSentrySignals` key added).
- [ ] Verdict evidence carries `heartbeat_age_secs`, `progress_age_secs`, `window_secs`, `last_progress_event_type`, `last_progress_event_seq`.
- [ ] The window used equals `th.stall_window_secs` (no new threshold key).

### From HOW (edge cases)
- [ ] No owner or non-running owner → `null`.
- [ ] Heartbeat absent/unparseable → `null`.
- [ ] Heartbeat stale (age > window) → `null` (suppressed; wall-clock owns it).
- [ ] Young run with `started_at` inside the window and no progress events → no trip.
- [ ] Events with unparseable `ts` are skipped; neither `started_at` nor any parseable forward event → `null`.

### From Scenarios
- [ ] Selftest/tests cover: the 4b-fires case, the healthy-fresh-progress no-fire case, and the stale-heartbeat suppression case (the holdout), asserting intervention stays `surface` when it fires.

**Integration smoke test.**

```
PROCEDURE smoke:
  1. mkRun with owner.status="running", started_at = now-2000s, last_heartbeat = now-60s
  2. append events: one build-start at now-1500s; NO forward event since
  3. run `sentry check --json --now-ms <now>`
  4. ASSERT payload.verdicts contains signal "heartbeat-progress-mismatch"
     AND payload.intervention === "surface" AND payload.tripped === true
  5. append a corrective-consumed event at now-60s; re-run
  6. ASSERT no "heartbeat-progress-mismatch" verdict (progress now fresh)
```

confidence: high
spec-review: approve
build-tier: complex
