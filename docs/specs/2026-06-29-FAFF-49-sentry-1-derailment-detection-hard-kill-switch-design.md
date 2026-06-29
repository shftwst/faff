# Sentry (1) — derailment detection + hard kill-switch

> Spec: faffter-dark-nlspec · 2026-06-29 · interactive · confidence: high. Full spec on Linear FAFF-49.

**Refreshed 2026-06-29 (interactive)** — narrowed in place to the **slice-1** scope from the re-slice resolution (1eac6c3b, 2026-06-28): detection + hard kill-switch only. The three corrective-authority Punts that held the original at `confidence: medium` (corrective-redirect channel · who-watches-the-watcher · per-run-vs-fleet) are **out of scope → FAFF-278 (Sentry 2)** and have been dropped from this spec. What remains is all-`Chosen` on shipped rails, so the rating is re-rated to **high**.

This spec scopes **Sentry (1)**: the active live-supervision *detection + hard stop* layer for L4 `/faff-beep-boop` runs. Audience: the build agent and human reviewers.

## 1. WHY — Problem and Principles

**Load-bearing model.** A `/faff-beep-boop` run already emits an out-of-band, append-only signal surface the running build agent *cannot reach into*: the orchestrator's `events.jsonl` (FAFF-35), `run-ledger.json`, and `owner.last_heartbeat` (FAFF-205), plus the pure `faff budget check` reading (FAFF-36). Sentry is a watcher that **reads that surface live and acts at the orchestrator's dispatch boundary** — the one channel the watched agent has no handle on. That asymmetry (build = isolated subagent returning only `{issue,outcome,pr}`; orchestrator = holds the ledger on disk) is what makes an un-subvertable watcher *structurally* possible rather than aspirational.

**Problem.** Today the safety net is static — park protocol, run-ledger, review/merge gate fire only at fixed gates. Nothing watches a run *as it happens*, so a derailment (fix→review thrash, runaway spend, repeated-identical-failure, scope drift, forbidden-side-effect attempt, wall-clock runaway) burns budget and churns until a human looks in the morning. Sentry (1) adds the missing *live detection + hard stop* layer; it is the kill-switch the L4 runner (FAFF-225) needs.

**Design principles** (would reject an otherwise-valid implementation):

- **Consume, don't re-implement.** Sentry reads shipped deterministic signals; it never re-derives budget math, liveness, or the event log. Budget enforcement stays in FAFF-36 (deterministic-tools-over-prose).
- **Un-subvertable channel or it's not a watcher.** Sentry's authority must flow through a path the supervised agent cannot write to. If a proposed intervention requires a channel the build agent *can* influence, it's out of scope for this slice.
- **A kill must leave resumable state.** Abort must leave worktree/branch/ledger/PR intact and the run re-enterable — never a corrupt half-state.

**Reference context:**

| System | Form | Relevance |
|---|---|---|
| `faff events` → `.faff/runs/<id>/events.jsonl` | CLI + JSONL (FAFF-35) | the in-flight timeline Sentry tails |
| `run-ledger.json` (`owner.last_heartbeat`, `outcomes`) | JSON on disk | resumable state + liveness |
| `faff heartbeat` (FAFF-205) | CLI | staleness window = liveness derailment signal |
| `faff budget check` (FAFF-36) | pure CLI → `{breached,outcome}` | budget-breach trigger, consumed not re-enforced |
| concurrency slot (subagent-per-build) | dispatch boundary | where a hard-stop is enforced |

**Scope statement.** L4-only live supervision sitting beside (not replacing) the park protocol, review/merge gate, and run-ledger. **Slice 1 = detection + hard stop only.**

## 2. OUT OF SCOPE

- **Corrective-intervention authority** — the un-subvertable *redirect* channel (authority to *correct*, not just *stop*), concurrent-fleet supervision, and who-watches-the-watcher → **FAFF-278 (Sentry 2)** [spike-first]. v1's only intervention is *hard stop*. FAFF-225 does not depend on FAFF-278.
- **Real-side-effect rollback** — Sentry *stops* forward motion; undo is FAFF-37. Extension: FAFF-37 consumes Sentry's abort signal.
- **Post-hoc forensics / escaped-side-effect audit** — the durable after-the-fact record is FAFF-43. Sentry acts live; FAFF-43 records.
- **Defining the side-effect / blast-radius boundary** — FAFF-42 owns what "forbidden side-effect" *means*; Sentry consumes that definition as a trigger input.
- **Live budget *enforcement* math** — owned by FAFF-36; Sentry consumes its `breached`/`outcome`.

## 3. WHAT — Vocabulary, Types, Interfaces

**Vocabulary:** *derailment* = a run state matching a trigger predicate. *Intervention* = Sentry's response (continue / pause / abort). *Authority channel* = the un-subvertable path Sentry acts through.

```
ENUM DerailmentSignal:
  fix-review-thrash            # N fix→review cycles on one issue without progress
  budget-breach               # consumes faff budget check {breached,outcome}
  repeated-identical-failure  # same failure fingerprint K times
  wall-clock-runaway          # now - owner.last_heartbeat > stall window, OR run elapsed > ceiling
  scope-drift                 # build touching surface outside its spec's declared WHAT (heuristic, advisory)
  forbidden-side-effect-attempt  # consumes FAFF-42 boundary (trigger only; def owned there)

RECORD DerailmentVerdict:
  signal: DerailmentSignal
  severity: warn | trip       # warn = log+surface; trip = intervene
  evidence: { event_seq?, ledger_field?, budget_outcome? }   # cite the consumed signal

ENUM Intervention: continue | pause | abort     # v1 ladder STOPS at abort; `correct` is FAFF-278
```

**Design decisions:**

- FAFF-35 prerequisite — **Chosen:** FAFF-35 `events.jsonl` + `run-ledger.json` are Sentry's hard upstream read surface (both SHIPPED). Sentry adds no new event types in v1; it tails the existing log.
- FAFF-36 overlap (enforce-vs-consume) — **Chosen:** Sentry **consumes** `faff budget check`'s `{breached,outcome}` as the `budget-breach` trigger; it does **not** own live budget enforcement (stays in FAFF-36, deterministic-tools-over-prose). `at_ceiling: escalate` is the breach that trips Sentry.
- Liveness signal — **Chosen:** `wall-clock-runaway` is computed from `owner.last_heartbeat` staleness (FAFF-205) + run-elapsed against a config ceiling — no new liveness mechanism.
- Authority channel for *hard stop* — **Chosen:** the kill-switch is enforced at the **orchestrator dispatch boundary** — Sentry signals the orchestrator (or a sibling isolated lane) which declines to dispatch the next unit and/or `TaskStop`s the in-flight subagent. Justification: the build subagent returns only a terminal token and cannot mutate the orchestrator's ledger/context, so this channel is un-subvertable *by construction* on the shipped isolation model. (No new IPC invented.)
- Resumable-abort contract — **Chosen:** abort commits the in-flight worktree WIP to its branch (park-protocol shape), leaves the ledger entry `aborted-resumable`, and never force-resets — mirrors the existing dirty-worktree park.
- FAFF-42 trigger input — **Assumes:** the forbidden-side-effect *boundary definition* exists (FAFF-42); Sentry consumes it as a trigger and degrades `forbidden-side-effect-attempt` to no-signal until it lands. (Degradable — does not block the rest of v1.)

**Resolved prep open questions (now `Chosen`, not deferred):**

- *Watcher topology* — **Chosen:** Sentry (1) runs as its **own isolated supervisory lane** (a fourth lane peer to orchestrator/implementor/evaluator) tailing the append-only surface, **not** an orchestrator-internal loop. Keeps the read/act path off the supervised agent's reach and matches the un-subvertable-channel principle.
- *Thresholds + tick cadence* — **Chosen:** per-signal thresholds (thrash N, failure K, stall window, run-elapsed ceiling) are **config values** with documented v1 defaults; ticks evaluate on event-boundary writes, with heartbeat-staleness + budget as the real-time floor between events. Tuning is config, not an architectural open question.

## 4. HOW — Behavior

**Architecture.** A watcher loop in its own isolated lane tails the run's append-only surface; on each tick it evaluates the trigger predicates against `events.jsonl` + `run-ledger.json` + `faff budget check` + heartbeat staleness, emits a `DerailmentVerdict`, and on `trip` routes to the v1 intervention (`pause` or `abort`) at the dispatch boundary.

```
PROCEDURE sentry_tick(run_dir):
  1. signals = read(events.jsonl tail) ∪ read(run-ledger.json) ∪ `faff budget check --json` ∪ heartbeat-staleness
  2. FOR each trigger predicate: verdict = evaluate(signals)
  3. IF any verdict.severity == trip:
     a. pick highest-severity intervention in v1 ladder (continue|pause|abort — never `correct`)
     b. IF abort: signal orchestrator → decline next dispatch + TaskStop subagent; commit WIP to branch; mark ledger aborted-resumable
     c. IF pause: surface to human (FAFF-35 event + run-ledger flag); halt new dispatch, leave in-flight to finish
  4. ELSE: log warn-level verdicts (FAFF-43 will durably record) and continue
```

**Failure modes (how the *approach* falls over):**

- *Detection lags the burn* — Sentry ticks on the event log, written at phase boundaries; a runaway *inside* a single long build step emits no events. **How you'd know:** budget breach trips before any thrash signal does. **Means:** heartbeat-staleness + budget are the real-time floor; event-derived triggers are coarse — name this, don't over-promise sub-step detection in v1.
- *Un-subvertable assumption is false* — if a future build lane gains a handle on the orchestrator context, the stop channel is compromised. **How you'd know:** FAFF-42's blast-radius review flags it. **Means:** the authority model is co-bound to FAFF-42 — abandon the "structurally un-subvertable" claim if that isolation weakens.

## Open Questions

None blocking slice 1. The research-shaped questions (corrective-redirect authority · who-watches-the-watcher · per-run-vs-fleet supervisor) are deferred to **FAFF-278 (Sentry 2)** [spike-first], not silently dropped.

## Assumptions

- **Assumes:** FAFF-42 forbidden-side-effect boundary exists (degrades that one trigger to no-signal until it ships).

## DONE — Acceptance criteria (v1 = detection + hard kill-switch slice)

1. A watcher reads a live run's `events.jsonl` + `run-ledger.json` + `faff budget check` + `owner.last_heartbeat` without mutating them, and emits a `DerailmentVerdict` per trigger.
2. `budget-breach` is the consumed `faff budget check` `{breached}` / `at_ceiling: escalate` signal — Sentry re-implements no budget math (asserted by a test that Sentry calls the CLI, not its own counter).
3. `wall-clock-runaway` trips when `now - owner.last_heartbeat` exceeds the configured stall window.
4. On `trip → abort`, the run's worktree WIP is committed to its branch, the ledger entry is marked `aborted-resumable`, and the run is demonstrably re-enterable (no corrupt half-state) — verified on a forced-abort fixture.
5. The stop is enforced at the orchestrator dispatch boundary; a test demonstrates the supervised subagent has no write-path to Sentry's context.
6. Corrective-redirect, fleet supervision, and who-watches-the-watcher are explicitly deferred to FAFF-278 (documented), not silently dropped.

confidence: high
