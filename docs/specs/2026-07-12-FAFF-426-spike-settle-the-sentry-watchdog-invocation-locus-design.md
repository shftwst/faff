# FAFF-426 — Spike: settle the sentry watchdog invocation locus

> Spec: faffter-dark-nlspec · 2026-07-11 · autonomous · confidence: high. Full spec on Linear FAFF-426.

This document is the spike spec for FAFF-426. It frames the question, the evidence to gather, the candidate loci, the decision criteria, the timebox, and the recorded-decision deliverable. The audience is the build agent running the spike and the human reviewing its output. **It is deliberately not an implementation plan** — the spike's deliverable is a settled design (an ADR) plus follow-up implementation tickets; implementing the chosen locus is out of scope.

## 1. WHY — Problem and principles

**Load-bearing model.** Every supervision trigger faff has today is *cooperative* — it fires only when the supervised party volunteers control. `faff sentry check` runs solely when the beep-boop prose loop reaches a between-units checkpoint (`plugin/skills/faff-beep-boop/SKILL.md`, "The interrupt"); the Stop hooks (`runcheck --hook`, `prepcheck --hook`) fire only when a session reaches turn-end (`plugin/skills/faff/bin/lib/runcheck.js:45`). A supervisor whose invocation depends on the supervised party's cooperation cannot catch a cooperation failure: a wall-clock-runaway orchestrator that stops reaching checkpoints — exactly the failure sentry's `wall-clock-runaway` verdict exists to catch — starves its own supervisor. The involuntary *evidence* already exists on disk (`owner.last_heartbeat` in the run ledger, staleness window `FAFF_RUN_HEARTBEAT_STALE_SECS`, default 900s); what does not exist is any *executor* that evaluates it from outside the orchestrator's control flow. This spike settles where that executor lives.

**Problem statement.** `faff sentry check` is report-only (exit 0 even on `tripped: true`; `sentry.js:403`) and is invoked by nothing except the orchestrator it supervises. Beep-boop's "no mid-issue cancellation" policy additionally means a runaway *unit* (a stuck graft) is uninterruptible even when a checkpoint would eventually fire. The result: the L4 supervisory lane detects derailment only in the runs healthy enough to ask.

**Design principles** (constraints that would reject an otherwise-valid design):

- **Consume, never re-derive.** Whatever locus is chosen invokes `faff sentry check` (and, where action is warranted, `faff sentry abort`) — it never re-implements trigger math outside `sentry.js`. Same rule beep-boop already follows.
- **Liveness is owner-emitted on-disk state** (ADR-0008). The watchdog reads the run ledger's heartbeat; it must not invent a second liveness channel or infer liveness from artifacts.
- **Un-subvertability extends upward** (ADR-0034). The existing threat model covers the build lane subverting detection. The locus decision extends the supervised set to include the *orchestrator*: invocation must not flow through any step the orchestrator has to take. A watchdog the orchestrator must invoke is theatre by ADR-0034's own standard.
- **Fail closed on own faults** (FAFF-425 precedent). A watchdog that cannot read the ledger escalates (`sentry` exit 3 → indeterminate); it never concludes all-clear.
- **Proportionate, minimal** (ADR-0039's regress warning). ADR-0039 rejected a dedicated watcher-of-watchers *lane* for v1 as infinite regress. The recorded decision must reconcile with that: either show the chosen locus is an invocation seam for the existing detector (not a new supervisory lane), or accept the regress argument and settle for alert-only escalation.

**Reference context:**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/sentry.js` | The detector + kill-switch this spike finds an invoker for; `check` (report-only) / `abort` (only write path); exit 0/2/3 map |
| `plugin/skills/faff/bin/lib/heartbeat.js`, `runcheck.js` | Heartbeat write path + the sole liveness predicate (`runIsHeld`: `owner.status === "running"` + heartbeat age ≤ 900s default) |
| `plugin/skills/faff/bin/lib/hooks-ensure.js` | Deterministic hook registration (Stop: runcheck/prepcheck; PreToolUse: merge-fence) — the install-wiring precedent any new hook or wiring must follow |
| `plugin/skills/faff-beep-boop/SKILL.md` | Between-units checkpoints (the only current sentry consult sites); "no mid-issue cancellation" |
| ADR-0007 / ADR-0008 / ADR-0015 | Run-ledger liveness contract; owner-emitted liveness; heartbeat CLI primitive (boundary-tick, not periodic — cooperative by construction) |
| ADR-0034 / ADR-0039 / ADR-0044 | Detection un-subvertability; watcher-of-watchers rejection + FAFF-324; run-done terminates sentry's remit |
| `.github/workflows/validate.yml`, `release-please.yml` | The only CI; PR/push-triggered — no `schedule:` trigger exists anywhere today |

**Scope statement.** This is the invocation-locus half of "T3 — supervision stands alone": FAFF-352 wires the *cooperative* consult (necessary, not sufficient); this spike settles the *non-cooperative* one.

## 2. OUT OF SCOPE

- **Implementing the chosen locus** — the spike's output is follow-up ticket(s); extension point: named in the ADR per chosen locus (e.g. `hooks-ensure.js` for a hook, a new `bin/lib/` module for a poller, `.github/workflows/` for CI).
- **FAFF-352 checkpoint wiring** — the cooperative consult ships there; this spike proceeds regardless of its state.
- **FAFF-386 andon alerting** — the delivery channel a watchdog *verdict* may need; this spike only names the seam it hands verdicts to.
- **Fleet supervision (FAFF-327), corrective authority (FAFF-326/328), shared-fs re-exam (FAFF-324)** — sibling T3 tickets; unchanged by this spike.
- **Changing sentry's detection math or verdict vocabulary** — the detector is settled; only its invocation is in question.

## 3. WHAT — The decision to make

**Vocabulary:**

| Term | Definition |
|---|---|
| Invocation locus | The mechanism + lifecycle owner that causes `faff sentry check` to execute |
| Cooperative supervision | Supervision that runs only when the supervised party volunteers control (checkpoint, turn-end) |
| Independent supervision | Supervision that executes with zero cooperation from the supervised run's own control flow |
| Cancellation story | What the watchdog may do to an in-flight unit: nothing / ledger-mark (`sentry abort` → `aborted-resumable`) / process interrupt |

**The decision record the spike must produce:**

```
RECORD WatchdogLocusDecision:
  chosen_locus: hook | daemon | cron | ci-side | alert-only-composite | <other>
  trigger: what causes execution (event, poll interval, schedule)
  executor: what process runs the check, who owns its lifecycle (start at run mint, stop at run-done per ADR-0044)
  action_channel: check-and-alert only | check + sentry abort (mint-scoped per ADR-0044)
  cancellation_story: in-flight-unit policy (none / ledger-mark / interrupt), reconciled with "no mid-issue cancellation"
  regress_termination: how "who watches the watchdog" ends (per ADR-0039)
  rejected: [ {locus, disqualifying evidence} ]
  follow_ups: [ implementation ticket(s) ]
```

**Candidate loci** (the closed starting set; the spike may add, never silently drop):

| Locus | Sketch | Known evidence going in |
|---|---|---|
| Heartbeat-staleness Stop hook | Extend the `hooks-ensure` Stop family: any session's turn-end runs a staleness-triggered sentry consult (runcheck-style, session-agnostic) | Infrastructure exists and is session-agnostic — but Stop only fires at *some* session's turn-end; a machine with no other live sessions never fires. Partial independence at best |
| Background daemon / detached poller | Run-mint spawns a detached poller (e.g. `faff sentry watch`) that loops `sentry check` until run-done | No daemon/watch subcommand or precedent exists in the repo; lifecycle + orphan management is the open cost; strongest independence |
| OS scheduler (cron / launchd) | A machine-level schedule polls the latest ledger | Survives everything; per-install wiring + platform variance; must be skill-owned/idempotent (FAFF-192 precedent) — no precedent exists |
| CI-side watchdog | A `schedule:`-triggered Actions workflow runs the check | No scheduled workflow exists; **run ledgers live in local gitignored `.faff/`** — CI cannot see heartbeats without a new push channel. Likely disqualified for in-flight supervision; adjacent to FAFF-363 (artifact-time attestation) |

**Decision criteria** (the ADR scores every candidate against all of these):

1. **Independence** — executes with zero orchestrator cooperation (defining criterion; a locus failing it is disqualified).
2. **Detection→action gap** — can it act (`sentry abort`, mint-scoped) or only alert (hands to FAFF-386)? Alert-only is admissible but must be named as such.
3. **Liveness-contract fit** — reads `owner.last_heartbeat`/`owner.status` per ADR-0007/0008; introduces no new liveness signal.
4. **Lifecycle** — starts with the run, stops at run-done (ADR-0044); no orphan watchers outliving their run.
5. **Install wiring** — skill-owned, deterministic, idempotent (the `hooks-ensure` bar); never a per-install hand-edit.
6. **Un-subvertability + executor isolation posture** — the supervised lanes (orchestrator included) cannot suppress or starve it by acting or by *not* acting (ADR-0034, noting FAFF-324's shared-fs caveat); and because a host-side executor (daemon, cron, hook) sits *outside* the container cage the supervised run lives in (ADR-0010), the ADR must state the watchdog's own privilege boundary — what it may read (the run ledger) and touch (nothing beyond `sentry check`/`abort`).
7. **Proportionality** — simplest mechanism covering the real risk; the composite "hook + alert-only escalation" counts as a candidate answer if the heavier loci overshoot.

## 4. HOW — Spike protocol

**Approach.** Evidence-first, probe-bounded: gather the disqualifying/qualifying evidence per locus, score against the criteria, record the decision. Probes are throwaway (never merged as product code).

```
PROCEDURE run_spike:
  1. Evidence per locus (bounded probes, throwaway):
     a. Hook locus — establish from harness behaviour/docs whether any hook event is
        time-based (expected: none); characterise exactly when Stop fires; assess the
        "another session's turn-end" partial trigger and its zero-other-session hole.
     b. Daemon locus — prototype a minimal detached poller (~20 lines, spawn-detach +
        loop `faff sentry check --json` against a fixture run dir); assess: survives
        parent death? lifecycle stop at run-done? orphan risk on crash?
     c. Cron locus — enumerate the wiring surface per platform (launchd vs cron);
        assess whether idempotent skill-owned (un)install is achievable to the
        hooks-ensure bar.
     d. CI locus — confirm ledger visibility from CI (expected: none — local gitignored
        .faff/); if confirmed, record as disqualified for in-flight supervision and
        note the FAFF-363 adjacency for artifact-time checks instead.
  2. Settle the cancellation story: given "no mid-issue cancellation" is beep-boop
     policy and `sentry abort` already exists (ledger-mark → aborted-resumable +
     best-effort WIP commit), decide what the watchdog may do to an in-flight unit:
     nothing / ledger-mark / process interrupt. FAFF-332 (live-resume spike) is the
     adjacent seam for anything richer — name it, do not build it.
  3. Score all candidates against the seven criteria; pick, or pick the alert-only
     composite if every heavier locus fails a defining criterion.
  4. Record: ADR via `faff adr new` (the spike branch's deliverable, ships in the PR);
     follow-up implementation ticket(s) recorded via the discovered-scope channel
     (record-and-file — the build lane records, the orchestrator/human files).
  5. Reconcile with ADR-0039 in the ADR text: state why the chosen locus is an
     invocation seam for the existing detector rather than the rejected
     watcher-of-watchers lane — or accept the regress argument and record alert-only.
```

**Timebox.** **Chosen:** one build unit — a single graft session — with probes capped to throwaway scripts; if the evidence cannot converge to a recorded decision inside that unit, the spike parks with findings attached to the ticket rather than extending. Rationale: all four loci already have most of their evidence gathered (Reference context); the remaining probes are small; a spike that can't converge in one unit is telling us the question needs a human, not more agent time. *(This discharges the ticket's "Timebox: to be determined during prep".)*

**Failure modes** (ways the approach could be wrong, and the observable):

- **All candidates fail a defining criterion.** CI can't see ledgers, cron isn't portably skill-ownable, a daemon re-opens the ADR-0039 regress, the hook stays cooperative. *How you'd know:* the criteria table has no all-green column. *What it means:* proceed anyway — record the alert-only composite (staleness escalation through FAFF-386) as the settled decision; a null result here is a valid spike outcome, not a park.
- **False-positive staleness on a healthy-but-slow unit.** Heartbeats are boundary ticks (ADR-0015), so freshness is bounded by the longest single blocking call. *How you'd know:* a probe shows staleness would have fired during a known-live long build step. *What it means:* the decision must tune the trigger (window vs `FAFF_RUN_HEARTBEAT_STALE_SECS`, or unit-boundary awareness) — a trigger-shape finding, not a different locus.
- **The regress objection holds.** Any independent executor is itself unsupervised. *How you'd know:* the ADR can't write an honest `regress_termination` line. *What it means:* terminate the regress at the human — the watchdog's own liveness is human-observable (andon / morning brief), never machine-supervised. Record that explicitly.

**Anti-pattern:** re-implementing staleness math in the watchdog. Why: `sentry check` already folds heartbeat staleness into `wall-clock-runaway`; a second implementation drifts (the consume-never-re-derive principle).
**Anti-pattern:** shipping the chosen locus inside the spike. Why: the deliverable is the decision; implementation is the follow-up ticket's, where it gets its own spec, review, and gates.

## 5. Scenarios

The settled design (verified on paper/probe at spike time; mechanically by the implementation ticket):

```
Given a run ledger with owner.status "running" and owner.last_heartbeat older than the
      staleness window
  And an orchestrator session that reaches no further checkpoint and no turn-end
When the recorded watchdog design operates
Then `faff sentry check` executes against that run dir within a bounded, stated delay
  And its verdict reaches the recorded action_channel (abort and/or alert)
      with no orchestrator step involved
```

The spike itself:

```
Given the spike unit completes
Then docs/adr/ contains the locus ADR with every WatchdogLocusDecision field populated,
      all four candidates scored against all seven criteria,
      and rejected candidates carrying their disqualifying evidence
  And follow-up implementation ticket(s) are recorded for filing
```

Non-functional assertion: the watchdog adds no new liveness signal and no new trigger math — its only reads are the run ledger, its only faff calls are `sentry check` / `sentry abort`.

## 6. Design decision rationale

- **What form does the recorded decision take — ADR or design note?** Options: gitignored `design/` note (cheap, invisible to the repo) vs `docs/adr/` ADR (durable, in the existing supervision decision chain 0034→0039→0044, ships in the PR). **Chosen:** an ADR via `faff adr new`, materialised on the spike's branch — this is an architecture decision constraining future slices, exactly what the ADR log is for.
- **Closed candidate set or open exploration?** Options: open-ended survey vs the ticket's four named loci plus an explicit alert-only composite. **Chosen:** the closed set above — the ticket names the loci; the composite is added so "every locus fails" has a recordable outcome; the spike may add a candidate with evidence but never silently drop one.
- **Fixed criteria or emergent judgement?** **Chosen:** the seven fixed criteria in WHAT — they encode the existing ADR constraints (0008, 0034, 0039, 0044) plus faff's install-wiring and proportionality norms, so the scoring is auditable rather than vibes.
- **Timebox.** **Chosen:** one build unit, park-with-findings on non-convergence (rationale under HOW).
- **Probe code disposition.** **Chosen:** throwaway — probes exist to produce evidence lines in the ADR, not artifacts; nothing from step 1 merges.

## 7. Open questions and assumptions

**Open questions:** none for a human to answer *before* build — the spike's core question (which locus) is deliberately open because answering it **is** the work, and it is resolved by the spike's own recorded decision, not by a pre-build human call.

**Assumptions:**

- **Assumes:** `faff sentry check` / `faff sentry abort` CLI surface (exit map 0/2/3, `--json`, report-only semantics) is stable as shipped. *Validate:* run `faff sentry --selftest` at spike start.
- **Assumes:** FAFF-352's checkpoint wiring may land before, during, or after this spike with no effect on it (necessary-not-sufficient; different seam). *Validate:* read FAFF-352's status at spike start; proceed in every case.
- **Assumes:** run ledgers remain local, gitignored `.faff/` state (the CI-locus evidence hinges on it). *Validate:* `git check-ignore .faff` at spike start.

## 8. DONE — definition of done

### From WHY
- [ ] The recorded decision names an invocation path that executes `faff sentry check` with zero orchestrator cooperation, or records the alert-only composite with the evidence that forced it.

### From WHAT
- [ ] Every `WatchdogLocusDecision` field is populated in the ADR — locus, trigger, executor + lifecycle, action channel, cancellation story, regress termination, rejected list, follow-ups.
- [ ] All four named candidates (+ the composite) are scored against all seven criteria; rejections carry concrete disqualifying evidence.

### From HOW
- [ ] The cancellation story explicitly reconciles with beep-boop's "no mid-issue cancellation" (keep / carve an exception / alert-only), and names FAFF-332 where relevant.
- [ ] The ADR's text reconciles with ADR-0039's watcher-of-watchers rejection (invocation-seam argument, or accepted regress → alert-only).
- [ ] Follow-up implementation ticket(s) are recorded via the discovered-scope record-and-file channel.
- [ ] No locus implementation ships: probe code is not merged; the spike PR contains the ADR (+ spec) only.

### Integration smoke
- [ ] Paper-trace the first Scenario against the recorded design and include the trace (or probe transcript) in the spike output — the "plumbing is connected" check for a design-only deliverable.

## Already shipped against this surface

Related, none superseding (premise holds — no Done ticket delivers a cooperation-independent invocation locus):

- FAFF-49 (Done) — shipped the detector + kill-switch this spike finds an invoker for; invocation locus explicitly out of its scope.
- FAFF-278 (Done, spike → ADR-0039) — settled corrective *authority* and rejected a dedicated watcher-of-watchers lane for v1; this spec binds the ADR to reconcile with that rejection.
- FAFF-312 (Done) — run-done/sentry governance (ADR-0044); supplies the lifecycle criterion, doesn't touch invocation.
- FAFF-425 (Done) — governance CLIs fail closed on own read faults; supplies the fail-closed principle the watchdog inherits.

## Methodology critique

*(agile-delivery lens, issue-critique, 2026-07-11 — advisory; does not gate.)*

- **Right-sized?** No issues — a single timeboxed spike unit (one graft session, park-with-findings on non-convergence); deliverable is one ADR plus recorded follow-ups.
- **Workstream fit?** No issues — "T3 — supervision stands alone" is outcome-named, and this spike is that outcome's defining question (the non-cooperative supervision seam FAFF-352's cooperative wiring cannot cover).
- **Deps surfaced?** No issues on this issue — FAFF-352 is correctly *not* a blocker (necessary-not-sufficient, spike proceeds regardless; `relatedTo` edges to FAFF-352/FAFF-386 already exist). One forward note: if the recorded decision is alert-only (or names an alert channel), the **follow-up implementation tickets** should carry a dependency edge to FAFF-386 (andon) when filed — an edge for the follow-ups, not this spike.
- **Risk profile?** No issues — this ticket *is* the principle-7 de-risking spike for T3's supervision-independence risk; running it before implementation tickets is the right sequence.

confidence: high
spec-review: approve
