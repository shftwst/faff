# Spec — FAFF-900: Graceful spec-review outage — in-turn retry + resumable hold

> Spec: faffter-dark-nlspec · 2026-08-27 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-900.
> build-tier: complex
> spec-review: approve

This spec defines how faff-prep handles a **mandatory spec-review outage** (the adversarial `spec_review` occupant's backend chain is down) gracefully instead of parking a human: retry the fan-out in-turn while a transient 429 chain clears, and — if it does not clear — record a **resumable outage-hold** the next prep drain auto-resumes at review. It ports the shipped build-side shape (FAFF-403 retry-later, FAFF-398 fail-closed, FAFF-405 `unavailable` verdict) up to the prep / spec-review altitude, and builds on FAFF-854's turn-survival guard. Audience: the prep orchestrator and human reviewers. It changes **behaviour and one contract enum** — the `unavailable` spec-review verdict member — and nothing on the build side.

## 1. WHY

**Load-bearing model:** a spec-review outage means *the reviewer was down*, not *the spec is suspect*. Today the occupant's transport floor coerces any down refuter to `needs-human`, and prep parks it. That wakes a human for a transient provider failure although the spec is fine and the recovery — re-run the review when the chain is back — is fully mechanical. Two of the three pieces already exist: the occupant already computes a per-lens `unavailable` outcome and already knows whether a missing lens can swing the verdict; FAFF-854 already refuses a non-terminal turn-end. What is missing is the disposition that turns a swing-capable outage into a hold instead of a park.

**Problem:** once FAFF-854's turn-survival guard lands, a spec-review outage during a drain fail-closes to a `needs-human` park — the honest floor, but a needlessly expensive one. A 429 chain often clears in seconds; a held review costs nobody a night's sleep.

**Design principles:**

- **Fail-closed is untouched.** An outage never reads as `approve`. A swing-capable outage becomes a first-class `unavailable` verdict, held; a config-fault outage still parks `needs-human`. Neither promotes the issue.
- **A hold is not a park.** `faff-parked` routes `needs-human` and would block re-queue. The hold uses a distinct control label the transition function reads as *re-enter prep*, so the next drain resumes it with no human touch.
- **Never silent-forever.** Every hold leaves a tracker marker (label + hold-notice comment + run-summary subsection); a persistent outage escalates to `needs-human` after a bounded number of held drains.
- **Two bounds, two jobs.** An **in-turn** ceiling caps re-attempts inside a single turn (rides out a transient 429); a **cross-drain** ceiling caps how many drains may hold the same item before a human is called (bounds a persistent outage).
- **Reuse the build-side machinery.** The resume store, the ledger-annotation shape, the control-label manifest, and the disposition-owns-the-loop split are all FAFF-403's — this ports them, it does not reinvent them.

**Reference context:**

| Surface | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/contract-defs.js` | `SPEC_REVIEW_VERDICTS` / `computeSpecReviewVerdict` — gains the `unavailable` member (symmetric with `review-verdict`'s FAFF-405 member) |
| `plugin/skills/faff/bin/lib/labels.js`, `label.js` | `CONTROL_LABELS` manifest + `faff label` op — gains `faff-awaiting-spec-review` |
| `plugin/skills/faff/bin/lib/config.js` | `DEFAULTS` registry — gains `prep.spec_review_outage_retry_limit` (2) + `prep.spec_review_outage_hold_limit` (3) |
| `plugin/skills/faff/bin/lib/resume.js` | resume-store read/reconstruct — the hold artifact rides the existing `.faff/resume/<ISSUE>/` layout |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | the aggregation transport floor — swing-capable outage now surfaces `unavailable`, not `needs-human` |
| `plugin/skills/faff-prep/SKILL.md` | the spec-review consumer-fold — a fourth `unavailable` arm: in-turn retry, then hold-or-escalate |
| `plugin/skills/faff-beep-boop/SKILL.md` | ledger annotation + prep-queue re-entry + run-summary subsection |
| `plugin/skills/faff/bin/lib/disposition.js`, `next` | hold surfacing + the `faff next` re-enter-prep arm |
| `plugin/skills/faff-wtf/SKILL.md`, `faff-tidy/SKILL.md` | interim surfacing + stale-label auto-clear |

**Scope:** the prep-altitude twin of the build-side review-tail-resilience chain (FAFF-398 → FAFF-405 → FAFF-403). An outage never silently skips the gate, is now a first-class signal at prep, and is now retryable and holdable rather than a straight park.

## Already shipped against this surface

Related Done work — none supersedes this delta (verified in-repo; queried the project's Done set):

- **FAFF-854 (Done, PR #744)** — the state-based turn-survival Stop hook (`turncheck`) + disposition backstop. This ticket *builds on* it: the in-turn retry runs inside the turn `turncheck` protects, and the hold record is what `turncheck`/disposition detect if the harness reaps mid-retry.
- **FAFF-403 / FAFF-398 / FAFF-405 (Done)** — the build-side retry-later hold, fail-closed chain-exhaustion, and `unavailable` review-verdict member. This ticket ports their *shape* to a different altitude (spec-review, not code-review); no build-side code changes.
- **FAFF-465 / FAFF-793 / FAFF-885 (Done)** — adversarial-chain fallback, killable spawner, streaming-timeout fixes. Consumed as-is; the fan-out this holds on is exactly that hardened chain. None dispositions a spec-review outage.
- **FAFF-909 (related, NOT Done)** — spec-review convergence-window persistence across restart/unpark. Adjacent but separate: see OUT OF SCOPE.

## 2. OUT OF SCOPE

- **The per-lens `unavailable` outcome + swing analysis** — already in the occupant (`faffter-dark-spec-review` aggregation). This spec consumes them; it only changes what the *aggregate* verdict is when the outage can swing.
- **The build-side `faff-awaiting-review` hold** (FAFF-403) — untouched. The prep hold is a deliberately separate label + annotation + ledger array so the two altitudes stay distinguishable in `faff disposition` / `/faff-wtf`.
- **Convergence-window persistence (FAFF-909)** — the outage-hold artifact persists the *outage* state (hold count, outaged lenses), not the revise/reject convergence window. **Assumes:** the two stores compose (both under `.faff/resume/<ISSUE>/`); FAFF-909 owns window durability, this owns outage durability. If FAFF-909 lands first, the hold artifact is an additional member of the same store, not a competing one.
- **A durable disposition sink** — interim surfacing here is the run-summary subsection + the `faff-awaiting-spec-review` label query, exactly as FAFF-403 left it pending FAFF-396.
- **Config-fault outages** — a misconfigured or unsupported backend (`config-fault` kind) still parks `needs-human`: that is a human fix, not a transient the retry loop can ride out. Only the transient `infra-configured` kind (host unreachable / persistent transport failure, e.g. a 429 chain) is retryable and holdable.
- **Within-run re-entry** — a held item is re-picked by the **next** prep drain, never the same run (mirrors FAFF-403's "once held this run, held this run"). Recovery time ≈ provider-recovery time regardless.

## 3. WHAT

**Vocabulary:**

| Term | Definition |
|---|---|
| spec-review outage | the mandatory `spec_review` occupant returns `unavailable` — its backend chain is down (transient `infra-configured` kind), distinct from a `config-fault` |
| swing-capable | the outaged lens set could change the aggregate verdict if it voted — the occupant's existing transport-floor analysis |
| in-turn retry | prep re-dispatches the occupant for the still-outaged lenses inside the same turn, bounded by `prep.spec_review_outage_retry_limit` (default 2), each attempt bounded by the existing adversarial deadline — the turn never ends between attempts |
| outage-hold | the held state of a spec-reviewed-but-outaged issue: Backlog + attached spec + `faff-awaiting-spec-review`, **not** `faff-parked` |
| hold counter | `outage_holds` — held drains so far for this issue, persisted in the resume store; absent = 0; bounded by `prep.spec_review_outage_hold_limit` (default 3) |
| resume store | `.faff/resume/<ISSUE>/spec-review-hold.json` — run-agnostic outage-hold state, the cross-drain handoff |

**New/changed surfaces:**

1. **Contract enum** — `SPEC_REVIEW_VERDICTS` gains `unavailable` (contract-defs.js), symmetric with `review-verdict`'s FAFF-405 member. `computeSpecReviewVerdict` treats `unavailable` like the other non-`approve` verdicts for the founded-verdict invariant: it **carries the outaged lens(es) as objections** (so the "non-approve carries objections" rule holds unchanged), and never coerces toward `approve`. The `spec-review-verdict.schema.json` enum + `--describe` semantics + the `contract-defs.js` selftest cases are updated.
2. **Occupant aggregation** — `faffter-dark-spec-review`'s transport floor splits the current single `needs-human` outage arm: a **swing-capable `infra-configured`** outage now surfaces the aggregate verdict `unavailable` (was `needs-human`); a `config-fault` outage still surfaces `needs-human`; a **non-swing** outage is unchanged (the verdict is decided by the surviving lenses).
3. **Control label** — `CONTROL_LABELS` (labels.js) gains `faff-awaiting-spec-review` (machine-writable, no `tracker_owned` flag, like `faff-awaiting-review`). Manifest-driven `faff label add|remove` accepts it with no further code change. The gateway's control-label prose recitations gain it.
4. **Config knobs** — `prep.spec_review_outage_retry_limit` (default `"2"`, the in-turn ceiling) and `prep.spec_review_outage_hold_limit` (default `"3"`, the cross-drain escalation), both registered in `DEFAULTS` + `config defaults --selftest`. The `prep.*` namespace: prep owns the disposition loop, as `graft.*` owns the build-side one.
5. **Resume store** — `.faff/resume/<ISSUE>/spec-review-hold.json` holding `{ outage_holds, outaged_lenses, pinned_reviewer? }`, mirroring the FAFF-403 store layout. Stash/clear are prose ops at prep's disposition/terminal sites — no new CLI subcommand; the existing `resume.js` read/reconstruct verbs recognise the store's presence as a re-enter-prep signal (a new `specReviewHold` evidence flag alongside FAFF-403's `awaitingReview`).
6. **prep** — a fourth `unavailable` arm in the spec-review consumer-fold: in-turn retry to the ceiling, then hold-or-escalate. New caller-facing return token `spec-review-held` (maps to ledger bucket `parked` + the annotation below — a hold, not a park). Plus the Scenario-B resume path that recognises the hold label + store and re-enters at the review gate, skipping spec re-production.
7. **Ledger annotation** — a top-level `spec_review_outage_pending` array (mirrors `review_outage_pending` exactly): held ids land in `outcomes` as `parked`, the annotation drives the distinct run-summary subsection, and it sits **outside** the `runcheck` completeness invariant (no ledger migration).
8. **`faff next`** — an arm: an issue carrying `faff-awaiting-spec-review` (and not `faff-parked`) returns `next: prep`, so beep-boop's prep-queue assembly re-admits it; prep's Scenario B then resumes at review.
9. **Surfacing** — `faff disposition` classifies a `faff-awaiting-spec-review` hold distinctly from a build-side `faff-awaiting-review` hold and from a park; beep-boop's run summary gains `## Awaiting spec-review (adversarial outage): N`; `/faff-wtf` gains an *Awaiting spec-review* line from a live label query; `/faff-tidy`'s stale-label auto-clear extends to `faff-awaiting-spec-review`.

## 4. HOW

### (a) The occupant: surface the outage (aggregation transport floor)

The occupant already assigns each lens an outcome of `refuted | clear | unavailable` with a kind (`config-fault` | `infra-configured`), and already computes whether the outaged set can swing the verdict. Change only the aggregate mapping:

```
current: any unavailable lens (config-fault OR swing-capable infra) → needs-human
new:
  config-fault unavailable lens                    → needs-human   (unchanged; a human config fix)
  infra-configured unavailable lens, swing-capable → unavailable   (NEW; a transient the orchestrator can hold)
  infra-configured unavailable lens, non-swing     → decided by the surviving lenses (unchanged)
```

The `unavailable` verdict carries the outaged lens(es) as its `objections` (each `{lens, severity}` — severity from the lens's gating class, or `major` as the founded default), so `computeSpecReviewVerdict`'s "non-approve carries objections" invariant holds and the missing lenses are named for the human if it ever escalates.

### (b) prep: the disposition arm (spec-review consumer-fold)

On a conformant (exit 0) verdict of `unavailable` from the pipe to `faff contract spec-review-verdict`:

```
PROCEDURE disposition_unavailable(issue, spec):
  1. IF NOT autonomous → surface the outage to the human (do not auto-hold); they choose retry / park.
  2. attempt := 0; limit_in_turn := faff config get prep.spec_review_outage_retry_limit   # default 2
  3. WHILE attempt < limit_in_turn:                                # entirely in-turn; the turn never ends here
       attempt += 1
       re-dispatch the spec_review occupant for the still-outaged lenses only
         (each attempt bounded by the existing adversarial deadline; no orchestrator wall-clock)
       IF verdict != unavailable → route it normally (approve/revise/reject-approach/needs-human) and RETURN
  4. # in-turn ceiling hit — the chain did not clear this turn
     holds := (.faff/resume/<issue>/spec-review-hold.json).outage_holds (absent → 0)
     IF holds + 1 >= faff config get prep.spec_review_outage_hold_limit:   # default 3
       → needs-human park: park protocol, cause "spec-review provider outage, N held drains exhausted",
         remove faff-awaiting-spec-review, rm -rf .faff/resume/<issue>. Return parked.
     ELSE hold:
       a. write .faff/resume/<issue>/spec-review-hold.json
          { outage_holds: holds+1, outaged_lenses: [...], pinned_reviewer?: ... }
       b. faff label add <issue> faff-awaiting-spec-review        # descriptor → single tracker write
       c. tracker comment: hold notice — "spec-review provider unavailable; spec attached and held;
          attempt <holds+1>/<N>; auto-resumes at review on the next drain"
       d. leave status Backlog (spec attached, not promoted, not parked)
       e. return spec-review-held (executor records bucket parked + spec_review_outage_pending annotation)
```

The **in-turn retry never ends the turn** — FAFF-854's `turncheck` refuses a non-terminal turn-end, and this loop is inside a single turn by construction. If the harness reaps the process mid-retry anyway, no hold is written and the item is simply un-progressed Backlog; FAFF-854's disposition backstop detects the abandoned run. The hold write in step 4 is the point past which recovery is a clean next-drain resume.

### (c) Re-queue and resume (next drain)

No queue-side recognition code beyond the `faff next` arm — a held issue is Backlog + attached spec + `faff-awaiting-spec-review` + **not** `faff-parked`, so `faff next` returns `prep` and beep-boop's prep-queue assembly re-admits it. Recovery lives in prep's Scenario B:

```
PROCEDURE resume_at_review(issue):                                # prep Scenario B, autonomous
  1. Spec discovery finds the attached spec (existing-spec path).
  2. Issue carries faff-awaiting-spec-review AND .faff/resume/<issue>/spec-review-hold.json exists:
       → SKIP spec re-production and the already-shipped/premise gate; carry outage_holds forward;
         re-enter the spec-review gate directly (re-run the occupant fresh).
  3. Terminal dispositions after a resumed review:
       approve / revise / reject-approach / needs-human → normal routing;
         remove faff-awaiting-spec-review; rm -rf .faff/resume/<issue>.
       unavailable again → disposition_unavailable(): the counter reads the carried file, so it
         increments across drains and escalates to needs-human at the hold limit.
```

**Anti-pattern:** coercing the outage to `approve` (the exact regression the exit-code discipline exists to prevent). **Anti-pattern:** dual-tagging `faff-parked` on a hold. **Anti-pattern:** a new `runcheck` `TERMINAL_STATES` entry or a bucket outside the `spec_review_outage_pending` annotation. **Anti-pattern:** re-producing the spec on resume — the spec is durable on the tracker; only the review is re-run.

## 5. Scenarios

```
Given an autonomous prep whose spec_review occupant returns unavailable (swing-capable, infra-configured)
  and outage_holds = 0
When the in-turn retry runs to the ceiling (2 attempts) and the chain has not cleared
Then no promotion happens, .faff/resume/<issue>/spec-review-hold.json holds outage_holds = 1 and the
     outaged lenses, the issue is Backlog + faff-awaiting-spec-review (not faff-parked), the ledger records
     parked + spec_review_outage_pending: [issue], a hold-notice comment is posted, and the drain continues
```

```
Given an in-turn retry where the 429 chain clears on attempt 2 and the occupant returns approve
When the retry loop reads the new verdict
Then the loop exits into normal routing — the spec promotes (composed with the confidence gate), no hold
     is written, no label applied, the turn never ended between attempts
```

```
Given a Backlog issue tagged faff-awaiting-spec-review with a valid hold store (outage_holds = 1)
When the next prep drain dispatches prep on it
Then prep finds the attached spec, skips re-production, re-runs the spec-review gate directly, and — on a
     clean approve — promotes and clears the hold (label removed, store deleted)
```

```
Given outage_holds = 2 carried into the current drain and prep.spec_review_outage_hold_limit = 3
When the review is unavailable again after the in-turn ceiling
Then prep parks needs-human: park protocol applied, faff-parked set, faff-awaiting-spec-review removed,
     resume store cleared, cause cites the exhausted held drains
```

```
Given an outage confined to a single non-swing minority lens
When aggregation runs
Then the aggregate verdict is decided by the surviving lenses (no unavailable, no hold) — AC "a non-swing
     outage does not produce a hold" holds
```

```
Given a config-fault unavailable lens (unsupported/misconfigured backend)
When aggregation runs
Then the aggregate is needs-human (a human config fix) — the retry/hold loop never fires on it
```

Assertions (non-functional): `unavailable` is never promotion-eligible on any path; every hold leaves a label + comment; `runcheck` passes on a ledger containing `spec_review_outage_pending`; the interactive path never auto-holds; `faff validate-adapters` + `node --test` green.

## 6. Design decision rationale

- **In-band verdict member vs out-of-band detection?** **Chosen:** in-band — add `unavailable` to `SPEC_REVIEW_VERDICTS`, symmetric with code-review's FAFF-405 `unavailable`. The occupant already computes a per-lens `unavailable`; surfacing it as a first-class aggregate verdict is the smallest, most detectable change and reuses the whole consumer-fold plumbing. Out-of-band exit-9 sniffing would duplicate the swing analysis the occupant already owns.
- **Where does the retry/hold loop live?** **Chosen:** in prep (the orchestrator), consuming the occupant's `unavailable` verdict — mirrors FAFF-403's graft-owns-the-disposition split. The occupant only surfaces the outage; prep owns the turn, the ceiling, and the tracker writes.
- **Two ceilings, why?** **Chosen:** an in-turn ceiling (`prep.spec_review_outage_retry_limit`, default 2) rides out a transient 429 within one turn; a cross-drain ceiling (`prep.spec_review_outage_hold_limit`, default 3) bounds how long a persistent outage may hold before a human is called. One knob cannot serve both — they bound different time-scales.
- **Knob namespace?** **Chosen:** `prep.*`, registered in `DEFAULTS` — prep owns the loop, exactly as `graft.*` owns FAFF-403's.
- **Distinct label + ledger array vs reusing the build-side ones?** **Chosen:** distinct `faff-awaiting-spec-review` + `spec_review_outage_pending`. A prep hold and a build hold are different re-entry points (prep queue vs build queue) and must stay separable in `faff disposition` / `/faff-wtf`; reusing `faff-awaiting-review` would route the held spec into the build queue.
- **Held status = Backlog, not Todo?** **Chosen:** Backlog. The spec is attached but **not** promoted (review has not passed), so Todo would be a false build-ready signal. The re-entry is driven by the label via the `faff next` arm, not by a status move — cleaner than the build-side's In Progress → Todo carve-out, which prep does not need.
- **Cross-run handoff?** **Chosen:** `.faff/resume/<ISSUE>/spec-review-hold.json`, mirroring FAFF-403's store (zero new read paths; composes with FAFF-909's window store in the same directory).

## 7. Open questions and assumptions

Open questions: none unresolved — the three ticket questions are settled above with the recommended defaults confirmed:

- **Chosen:** outage verdict member — in-band `unavailable` (symmetric with FAFF-405).
- **Chosen:** in-turn ceiling — `prep.spec_review_outage_retry_limit`, default 2, per-attempt bounded by the adversarial deadline, no orchestrator wall-clock.
- **Chosen:** control label — new `faff-awaiting-spec-review`, kept separable from `faff-awaiting-review`.

**Punt:** the exact co-tenancy of the outage-hold artifact with FAFF-909's convergence-window store (one merged JSON vs two sibling files in `.faff/resume/<ISSUE>/`) — settle when whichever of the two lands second is built; both designs compose and neither blocks this slice.

Assumptions:

- **Assumes:** FAFF-854's turn-survival guard (`turncheck` Stop hook + disposition backstop) is present — verified Done, merged PR #744. The in-turn retry depends on it to refuse a non-terminal turn-end.
- **Assumes:** the `spec_review` occupant (`faffter-dark-spec-review`) already emits per-lens `unavailable` outcomes with a `config-fault` / `infra-configured` kind and already computes swing-capability — verified in `faffter-dark-spec-review/SKILL.md` (the aggregation transport floor).
- **Assumes:** FAFF-405's `unavailable` review-verdict member exists as the naming + contract precedent — verified in `contract-defs.js` (`review-verdict` SIGNALS include `unavailable`).

## 8. DONE

### Contract + occupant
- [ ] `SPEC_REVIEW_VERDICTS` includes `unavailable`; `computeSpecReviewVerdict` accepts it, requires it to carry objections, never coerces toward `approve`; schema enum + `--describe` semantics + selftest cases updated.
- [ ] `faffter-dark-spec-review` aggregation surfaces `unavailable` for a swing-capable `infra-configured` outage, `needs-human` for a `config-fault` outage, and the surviving-lens verdict for a non-swing outage.

### Config + label
- [ ] `faff config get prep.spec_review_outage_retry_limit` prints `2` and `prep.spec_review_outage_hold_limit` prints `3` with no `.faffrc` entry (DEFAULTS-registered; `config defaults --selftest` updated).
- [ ] `faff labels` emits `faff-awaiting-spec-review` (machine-writable, no `tracker_owned`); `faff label add <i> faff-awaiting-spec-review` exits 0; gateway control-label prose updated.

### prep disposition (HOW b/c)
- [ ] autonomous + `unavailable` → in-turn retry to `prep.spec_review_outage_retry_limit`; a cleared chain routes the new verdict normally.
- [ ] in-turn ceiling hit + holds < limit → no promotion; `spec-review-hold.json` written with `outage_holds` incremented; `faff-awaiting-spec-review` applied; hold-notice comment posted; status stays Backlog; prep returns `spec-review-held`.
- [ ] in-turn ceiling hit + holds >= `prep.spec_review_outage_hold_limit` → needs-human park; label removed; store cleared.
- [ ] interactive `unavailable` surfaces to the human, never auto-holds.
- [ ] Scenario B: `faff-awaiting-spec-review` + hold store → skip re-production, re-run the review gate; counter carries across drains; a clean verdict clears the hold.

### Ledger + surfacing
- [ ] Both concurrency executors / the prep-queue reconcile map `spec-review-held` → bucket `parked` + append to `spec_review_outage_pending`; `runcheck` passes on a ledger containing it.
- [ ] `faff next` returns `prep` for a `faff-awaiting-spec-review` (non-parked) issue.
- [ ] `faff disposition` classifies the prep hold distinctly; beep-boop run summary renders `## Awaiting spec-review (adversarial outage)`; `/faff-wtf` surfaces it via a live label query; `/faff-tidy` auto-clears a stale hold label.
- [ ] `faff validate-adapters` + `node --test` green.

confidence: high
spec-review: approve
