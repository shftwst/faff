# FAFF-750 — Merge locus moves above the dispatch cut (dispatcher runs merge-gate; lane ends at PR-ready)

> Spec: faffter-dark-nlspec · 2026-08-09 · autonomous · confidence: high. Full spec on Linear FAFF-750.

This is the build spec for FAFF-750, slice 2 of 3 of the ADR-0077 write-authority relocation (FAFF-748 epic). Audience: the build agent that relocates the merge locus, and the human reviewers who gate an autonomous-merge-behaviour change. Slice 1 (FAFF-749, Done) already made the dispatched build lane *return* its AC/review evidence and made the dispatcher persist + digest-verify it; this slice moves the merge itself up to the dispatcher so that persisted copy becomes the merge's actual input.

## 1. WHY — Problem and Principles

**The load-bearing model.** ADR-0077 splits run-artifact writes into two authority classes across the orchestrator→lane *dispatch cut*: evidence the merge floor consumes must be written by the **trusted side** (the dispatcher), not the untrusted build lane. `faff merge-gate` fail-closes on a missing `ac-checklist.json` / `review-verdict.json`, so as long as the merge runs *inside* the lane it can only ever read the lane's own copy — the dispatcher-persisted copy slice 1 introduced lands only *after* the lane returns, too late to feed an in-lane merge. The fix is not to write the evidence earlier; it is to **move the merge later** — up to the dispatcher, which runs it after it has persisted the returned evidence.

**Problem statement.** Today the dispatched build lane runs the merge itself (graft Step 10: ship handoff → `merge-gate --execute` → `merge-record.json` → post-merge tail), reading its own in-lane evidence copies. That leaves slice 1's dispatcher-persisted copies as audit-only, and it lets an untrusted lane mutate shared `main`. This slice moves the merge locus above the dispatch cut so the dispatcher is the sole runner of the merge and the sole persister of the merge-consumed evidence.

**Design principles.**

- **Key on the dispatch cut, never the autonomous flag.** The behaviour split is "is there a trusted dispatcher above me?", not "am I running unattended?". An autonomous-but-top-level graft (no concurrency executor above it) still merges in-session; interactive top-level graft is unchanged. This is the ADR-0077 carve-out, applied by construction, and it is the FAFF-698 ruling (interactive graft accepted hand-authored merge-floor evidence — key trusted-side behaviour on the cut's presence).
- **Reuse slice 1's cut signal — do not invent a second one.** Slice 1 already gates `EvidenceReturn` on dispatch-cut presence (graft returns it only when dispatched by a concurrency executor; interactive top-level returns none). The merge-locus split keys on the *same* signal, yielding one coherent invariant: **a lane returns EvidenceReturn ⟺ there is a dispatch cut ⟺ that lane does not merge; the dispatcher merges.** A lane that returns evidence must never also merge, and vice-versa.
- **Relocate the caller, never touch the interlock.** `faff merge-gate` / `decideFloor` / the merge-fence stay byte-identical (ADR-0043's single mechanical interlock). This slice changes *who invokes* merge-gate and *from where*, not *what* it decides.
- **The merge floor never weakens.** AC-verified + CI-green + review-pass (+ L4 holdout) is fixed. Moving the invocation must not drop, reorder, or soften any floor condition (concurrency obligation 4).

## 2. OUT OF SCOPE

- **Slice 1's return plumbing (`EvidenceReturn`, dispatcher persist + digest-verify)** — already shipped (FAFF-749, Done). This slice consumes it; obligation 6 already exists.
- **Slice 3 — extending the integrity-digest bracket to the per-issue evidence + merge-tail members** — ADR-0077 Decision 7 defers adding `merge-record.json` / `post-merge-verification.json` to `correctiveIntegrityDirs()` until the merge locus has moved (FAFF-751).
- **Trusted-side re-derivation of review/AC content** — content-independence stays the code-blind holdout's job (obligation 4); this slice moves the *writer of record* and *runner of the merge*, never claims the lane's authored content is independent.
- **Interactive top-level graft (L2) and autonomous-but-top-level graft** — no dispatch cut above them; they remain the trusted side and merge in-session exactly as today.
- **Any change to `merge-gate` / `decideFloor` / `merge-fence` decision logic** — ADR-0043's interlock is untouched; only its caller relocates.
- **Moving branch-authoring lane steps** — the Step-4b ADR materialisation and the Step-9b immutable per-PR anchor commit stay in-lane (they write the feature branch, which is the lane's own artifact). Only merge *preconditions and execution* move.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Dispatch cut | The orchestrator→lane boundary a `concurrency` executor creates when it dispatches `/faff-graft` as a build subagent. "Trusted side" = above the cut (the dispatcher); "untrusted lane" = below it. |
| Dispatched lane | A graft invocation running under a dispatch cut (invoked by a `concurrency` executor). The only lane this slice changes. |
| PR-ready | The new terminal state of a dispatched lane: gates green, PR opened, evidence returned — **not merged**. |
| Merge locus | The cluster that executes and records the merge: the ship handoff (`merge-gate --execute` via `slots.ship`) + `merge-record.json` + the post-merge verification tail + the merge-time ADR-collision guard. |

**The dispatched-lane terminal token gains a state.** graft's caller-facing return vocabulary adds `pr-ready`:

```
ENUM GraftTerminalOutcome:            # the `outcome` field of TerminalToken{issue, outcome, pr}
  shipped                             # merged in-session — ONLY on a non-dispatched (top-level) lane now
  pr-ready                            # NEW: dispatched lane finished at PR-ready; dispatcher must run the merge
  pr-open-for-human                   # review returned human-judgement — parked, PR open, do NOT auto-merge
  retry-later                         # review-chain outage hold (unchanged)
  superseded-done                     # build-time premise-superseded close (unchanged)
  parked | errored                    # unchanged
```

`pr-ready` is distinct from `pr-open-for-human`: the former is "ready for the dispatcher to merge on green", the latter is "held for a human, never auto-merge". The token stays `{issue, outcome, pr}` — no new field; `EvidenceReturn` still rides alongside per obligation 6.

**Merge-completion outcome (dispatcher-side).** After the dispatcher runs the merge for a `pr-ready` return, it maps the delivery-outcome to a fixed ledger bucket — no new bucket:

```
merge-ok            → ledger bucket `shipped`
not-ready:precond   → ledger bucket `pr-open`  (deferral; PR left open, unmerged)
failed:<reason>     → ledger bucket `parked`   (+ standard park comment)
```

`pr-ready` itself is never a *ledger* bucket — it is the lane's hand-off token; the dispatcher always completes it to one of the fixed buckets in obligation 3.

**Gateway contract change — new `concurrency` obligation 7** (the canonical, gateway-owned home; both executors refer back, never restate — ADR-0077 Decision 8 landing-surface rule):

```
Obligation 7 — Run the merge above the cut (ADR-0077 relocation slice 2; dispatched lane only).
  For each member that returns outcome == `pr-ready`, AFTER obligation 5 (run-grain verify)
  AND obligation 6 (evidence persist + digest-verify) have passed for that member:
    the dispatcher — not the lane — runs the merge locus against the dispatcher-persisted
    ac-checklist.json / review-verdict.json:
      1. Assert the non-delegable integrity floor (AC-verified + CI-green + review-pass [+ L4 holdout]).
      2. Run the merge-time ADR-collision guard.
      3. Invoke `slots.ship` (the ship handoff) and consume its faff-contract:delivery-outcome
         (JSON.parse → `faff contract delivery-outcome`), routing shipped / not-ready / failed.
      4. On `shipped` (autonomous): run the post-merge verification tail (`faff post-merge-check`).
    Record the resulting ledger bucket per obligation 3. Parallel executor: this runs inside the
    existing rebase-before-merge serialisation, one member at a time (obligation 4 note).
  Interactive / autonomous-but-top-level graft has no dispatch cut and is out of scope: it merges
  in-session exactly as today. This obligation binds ONLY a dispatched lane, and NEVER weakens
  obligation 4's merge floor — it relocates the invocation, not the decision.
```

## 4. HOW — Behavior

**Architecture and approach.** The merge locus moves from graft's Step 10 up into each `concurrency` executor's per-member return-handling, immediately after slice 1's persist+verify. graft's Step 10 becomes conditional on dispatch-cut presence.

**graft's split (keyed on the dispatch cut = the same signal that gates EvidenceReturn):**

```
PROCEDURE graft_terminal(build_result):
  1. Steps 7.5–9b run unchanged (gates, AC verify, review, open PR, anchor).
  2. IF running under a dispatch cut (I return EvidenceReturn):
       a. Do NOT run the merge locus (no ship handoff, no merge-gate, no merge-record,
          no post-merge tail).
       b. Return TerminalToken{issue, outcome: `pr-ready`, pr} + EvidenceReturn (obligation 6).
  3. ELSE (top-level: interactive OR autonomous-but-top-level):
       a. Run the merge locus in-session exactly as today (Step 10 autonomous / Step 11 interactive):
          ship handoff → merge-gate --execute → merge-record.json → post-merge tail (autonomous).
       b. Return TerminalToken with outcome `shipped` (or the interactive equivalent).
```

**Dispatcher's added step (both executors, per obligation 7):**

```
PROCEDURE dispatcher_on_return(member, token, evidence):
  1. Obligation 5 run-grain verify → park on tamper.                      # existing
  2. Obligation 6 persist + digest-verify member's returned evidence → park on mismatch.  # existing (slice 1)
  3. IF token.outcome == `pr-ready`:                                      # NEW (this slice)
       a. Assert integrity floor (AC/CI/review [+holdout]); a floor miss → do NOT merge,
          record per delivery-outcome deferral/park path (never a silent skip).
       b. ADR-collision merge guard.
       c. Invoke slots.ship (--pr/--issue/--run-dir/--level); parse faff-contract:delivery-outcome
          via `faff contract delivery-outcome`.
       d. Route: shipped → (autonomous) run `faff post-merge-check`; record bucket `shipped`.
                 not-ready:precondition → bucket `pr-open` (PR left open).
                 failed:<reason> → bucket `parked` + park comment.
     ELSE: record the token's bucket as today (pr-open-for-human, parked, errored, …).
```

**Authoritative evidence — the sole-writer resolution (item 3).** merge-gate reads `<run-dir>/<issue>/ac-checklist.json` / `review-verdict.json`. Because the merge now runs on the dispatcher *after* obligation 6 has (re)written those paths from the returned bytes (post digest-verify), the copy the merge consumes is the **dispatcher-persisted** copy — resolving slice 1's transitional in-lane-merge coupling. The lane still writes its in-lane copies at Steps 8/9 (the Step-9b anchor, still in-lane, reads them pre-return), but those are no longer the merge's input. "Sole writer of the merge-consumed state" is therefore true by ordering: the dispatcher writes it last, immediately before consuming it, on the trusted side.

**Anti-pattern:** keying the split on graft's `autonomous` flag. Why: an autonomous-but-top-level graft has no dispatcher above it — keying on `autonomous` would strand its merge with nobody to run it. Key on the dispatch cut (EvidenceReturn presence).

**Anti-pattern:** moving the Step-9b anchor or Step-4b ADR materialisation up with the merge. Why: they author the feature branch (the lane's own artifact), not shared `main`; moving them over-scopes the slice and the ADR mandate names only the merge locus.

**Edge cases and error handling.**

- **Floor miss on the dispatcher (AC not verified / CI not green / review not pass).** merge-gate fail-closes as today; the dispatcher records the delivery-outcome deferral (`pr-open`) — never merges, never silently drops the unit.
- **`slots.ship` returns `not-ready:precondition` (e.g. CI still running).** Deferral: leave the PR open, bucket `pr-open`; the next drain re-picks it. Same semantics graft had, now on the dispatcher.
- **Parallel executor, rebase-before-merge conflict.** Already the executor's job (obligation 4); the moved merge runs inside that existing serialisation — one member merges at a time, re-validated after rebase. Moving the merge here makes shared-`main` serialisation *more* coherent, not less.
- **Post-merge `verified-fail`.** Unchanged behaviour, now run by the dispatcher: post a tracker comment + `discovered-scope.json` entry; status stays `Done`; never revert.
- **Git-only mode.** The ship handoff's `--local` branch (`cmdMergeGateLocal`) moves with the rest; the dispatcher runs it. No new logic.

## 5. Scenarios

```
Given a dispatched build lane (invoked by a concurrency executor) with gates green and a PR open
When the lane reaches its terminal step
Then it returns TerminalToken{outcome: `pr-ready`} + EvidenceReturn and performs no merge
 And no merge-record.json is written by the lane
```

```
Given a member returned `pr-ready` and its evidence has passed obligations 5 and 6 on the dispatcher
When the dispatcher runs obligation 7 against the dispatcher-persisted evidence
Then it asserts the floor, invokes slots.ship, and merge-gate consumes the dispatcher-persisted
     ac-checklist.json / review-verdict.json (not a lane-written copy)
 And on merge-ok the ledger bucket is `shipped` and the post-merge tail runs
```

```
Given an interactive (or autonomous-but-top-level) graft with no dispatch cut above it
When it reaches its terminal step
Then it merges in-session exactly as today and returns `shipped` (no EvidenceReturn, no dispatcher merge)
```

## 6. Design Decision Rationale

**How does graft know whether to merge?** Options: (a) key on graft's `autonomous` flag; (b) key on dispatch-cut presence via a new signal; (c) reuse slice 1's EvidenceReturn cut-signal. (a) strands autonomous-but-top-level merges; (b) duplicates an existing signal and risks the two drifting. **Chosen:** (c) reuse slice 1's dispatch-cut signal — a lane merges iff it returns no EvidenceReturn. Rationale: one signal, one invariant (EvidenceReturn ⟺ cut ⟺ dispatcher-merges), zero drift, and it is exactly the ADR-0077 / FAFF-698 carve-out ("presence of a dispatch cut, not the autonomous flag").

**Dispatcher invokes `slots.ship`, or calls `merge-gate --execute` directly?** **Chosen:** the dispatcher invokes `slots.ship` and becomes the `faff-contract:delivery-outcome` consumer for dispatched lanes. Rationale: the whole merge handoff moves up as a unit; a deploy-capable `ship` producer must keep working under autonomous merge; contract churn is minimised (the consumer relocates, the contract is unchanged).

**New terminal state, or reuse `pr-open-for-human`?** **Chosen:** add `pr-ready`. Rationale: `pr-open-for-human` means "held, never auto-merge"; the dispatched lane's new state means "ready for the dispatcher to merge on green" — conflating them would either auto-merge human-held PRs or strand ready ones.

**Does the Step-9b anchor / Step-4b ADR materialisation move too?** **Chosen:** no — they stay in-lane. Rationale: they author the feature branch (the lane's own artifact, pre-return), not shared `main`; the ADR mandate names only the merge locus; moving them over-scopes the slice.

**Landing surface for the new prose.** **Chosen:** one new gateway obligation 7 in the `concurrency` contract; both executors + graft refer back, never restate (ADR-0077 Decision 8 / FAFF-115 shared-prose hub). Rationale: matches how slice 1's obligations 5/6 landed; passes `validate-adapters` duplicated-block lint.

## 7. Open Questions and Assumptions

**Open Questions.** None that block the build — every design decision above is closed by ADR-0077's mandate and slice 1's shipped seam.

**Assumptions.**

- **Assumes:** slice 1's dispatch-cut signal (the condition under which graft returns `EvidenceReturn`) exists and is reusable as the merge-locus key. Validate: `plugin/skills/faff-graft/SKILL.md` EvidenceReturn section + gateway obligation 6 — confirmed present (FAFF-749 Done).
- **Assumes:** an eval sweep harness exists to gate this PR's merge (the ticket mandates eval-sweep-before-merge because it changes autonomous merge behaviour). Validate: run the autonomous-merge cases before merging FAFF-750's own PR.
- **Assumes:** `faff merge-gate` / `post-merge-check` accept being invoked from the orchestrator's Bash context (they take `--pr/--issue/--run-dir/--level` and are process-location-agnostic).

## 8. DONE — Definition of Done

### From WHY
- [ ] A dispatched build lane performs no merge; the dispatcher is the sole runner of the merge and sole persister of the merge-consumed evidence.
- [ ] Shared-`main` mutation for dispatched builds happens only on the trusted side (the dispatcher).

### From WHAT (types and interfaces)
- [ ] graft's terminal vocabulary includes `pr-ready`, distinct from `pr-open-for-human`; `TerminalToken` stays `{issue, outcome, pr}` with `EvidenceReturn` alongside.
- [ ] A new gateway `concurrency` obligation 7 defines the dispatcher-side merge; both executors + graft refer back to it (no duplicated block; `validate-adapters` green).
- [ ] `pr-ready` is completed by the dispatcher to a fixed ledger bucket (`shipped` / `pr-open` / `parked`) — never recorded as a raw bucket; `runcheck` accepts the run.

### From HOW (behaviour)
- [ ] graft merges in-session iff it is NOT under a dispatch cut (interactive or autonomous-but-top-level); it stops at `pr-ready` iff it returns `EvidenceReturn`.
- [ ] The dispatcher runs the merge locus (floor assertion → ADR-collision guard → `slots.ship` handoff → delivery-outcome routing → post-merge tail) for each `pr-ready` member, strictly after obligations 5 and 6.
- [ ] The merge consumes the dispatcher-persisted `ac-checklist.json` / `review-verdict.json`, not a lane-written copy.
- [ ] `merge-record.json` and `post-merge-verification.json` are produced by the dispatcher-run merge/tail for dispatched builds.
- [ ] The delivery-outcome consumer for dispatched lanes is the concurrency executor; graft Step 10's autonomous merge prose is removed for the dispatched path (line-cap fixture updated).

### From HOW (edge cases)
- [ ] Floor miss / `not-ready:precondition` on the dispatcher → PR left open (`pr-open`), never merged, never silently dropped.
- [ ] Parallel executor runs the moved merge inside its existing rebase-before-merge serialisation, one member at a time.
- [ ] Post-merge `verified-fail` behaviour (comment + discovered-scope, status stays Done) is preserved on the dispatcher.
- [ ] The merge floor (obligation 4) is unchanged — no condition dropped, reordered, or softened.

### Eval coverage
- [ ] The eval sweep includes at least one dispatched-lane autonomous-merge case; the sweep is run and green before this PR merges (eval-sweep-gated per the ticket).

confidence: high
spec-review: approve