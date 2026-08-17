# Spec: graft drives its PR to merged via a bounded landing loop (FAFF-841)

> Spec: faffter-dark-nlspec · 2026-08-17 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-841.

This is the build specification for FAFF-841. Its audience is the coding agent that will edit `plugin/skills/faff-graft/SKILL.md`, plus the human reviewers gating the change. It is buildable from this document plus the cited anchors alone.

FAFF-841 is one ticket in a split. It builds the mechanical landing loop: the observe-then-act wait that drives an open PR toward merged, the In Review transition, and the new resumable-landing handoff token. The autonomous land-time fixing (re-entering the implementor lane to resolve a conflict or a real CI regression, the fix-cycle counter, the recovery artifact) is FAFF-844, blocked by this ticket. The cross-firing resume of a handed-off PR is FAFF-842.

## 1. WHY — Problem and Principles

**The load-bearing model: graft owns a bounded observe-then-act landing loop, and calls the merge primitive only when the PR is already terminal-green.** `merge-gate.js` is a snapshot: it looks at the PR head once, and refuses if CI is still pending (`classifyHeadShaChecks` maps any non-`completed` check to `indeterminate`, and `decideFloor` turns `indeterminate` into a blocker). It has no wait, poll, or rebase logic, and it does not grow any. The waiting, the rebase-on-behind, and the flaky re-run live in graft, which observes the PR's state, acts to move it toward mergeable, and hands to `merge-gate --execute` only once the snapshot will pass.

**Problem statement.** Automated L3 beep-boop firings open a PR at graft Step 9b, but graft then leaves the PR for a human whenever the endgame is not instantly clean: CI still running at build-end reads as indeterminate and `merge-gate` refuses, on top of an uncapped `gh pr checks --watch` wait (`plugin/skills/faff-graft/SKILL.md` lines 530-544 and 576-582). This ticket makes graft drive its own PR to merged inside the firing, within a fixed time budget, and hand off cleanly with a resumable token when the budget runs out.

**Design principles.**

**graft owns the loop; the mechanical primitives stay mechanical.** `merge-gate.js` and the `faffter-noon-ship` producer are unchanged. graft calls `merge-gate --execute` (through the existing ship handoff) once, and only once the PR is terminal-green, mergeable, and review-passed. No wait logic is added inside either. If the loop lived in ship it would break ship's `judgement_seam: none` minimum-producer contract, which is a second reason it lives in graft.

**No new autonomous fixing in this ticket.** A conflict or a real CI regression is still observed, but graft routes it to the pr-open-for-human path it already has today, not to a new fix loop. The bounded autonomous fix cycles for those two states are FAFF-844.

**The loop is bounded in wall-clock and in flaky re-runs.** The time budget stops a firing from blocking forever on slow CI or on a base branch that keeps moving. The flaky re-run budget stops a chronically-flaky check from being re-run every iteration until the clock runs out; once the budget is spent the check is persistent by fiat and goes to a human.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/SKILL.md` Step 10 (lines 468-544) and autonomous Flow step 6 (576-582) | Skill prose | The uncapped CI wait this loop replaces; the merge-confidence gate the loop feeds; the existing pr-open-for-human park routing and the re-run budget (one per head sha, two per issue-build) |
| `plugin/skills/faff-graft/SKILL.md` Step 9b (436-450) | Skill prose | The single PR-open point where the In Review transition is inserted |
| `plugin/skills/faff-graft/SKILL.md` Step 5 (250-259) | Skill prose | The In Progress claim the In Review write mirrors (live re-read, agent-mediated forward-rank write) |
| `plugin/skills/faff/SKILL.md` status monotonicity (628-636) | Skill prose | The forward-rank rule the In Review write obeys; `Backlog < Todo < In Progress < In Review < Done` |
| `plugin/skills/faff-graft/SKILL.md` "Classifying the CI result" (540-544) | Skill prose | The row-count-not-exit-code three-way CI evaluation `observe()` reuses |
| `plugin/skills/faff/bin/lib/ci-triage.js` and graft CI-red triage (499-501) | JavaScript / Skill prose | Observe-only triage the flaky-vs-regression classification and the CI_RED_PARK routing reuse; the `reruns_used` bookkeeping the caller increments; unchanged |
| `merge-gate.js` `classifyHeadShaChecks` / `decideFloor` | JavaScript | Snapshot primitive the loop calls only when terminal-green; unchanged |
| `plugin/skills/faffter-noon-ship/SKILL.md` | Skill prose | `judgement_seam: none` merge producer; unchanged |
| `disposition.js` `ATTENTION_OUTCOMES` | JavaScript | Consumer of the new token; changed by FAFF-842, not here |
| FAFF-844 (blocked by this ticket) | Ticket | Adds the autonomous fix cycles for CONFLICTING and CI_RED_REGRESSION, plus the landing-progress recovery artifact and the `faff landing-progress` CLI verb. FAFF-841 writes no recovery artifact |
| FAFF-819 / FAFF-820 / FAFF-842 (Phase 0 and resume) | Tickets | FAFF-844 introduces the landing-progress artifact the FAFF-819 bundle carries and FAFF-820 restores; FAFF-842 consumes the restored boundary to resume a stranded In Review PR. FAFF-841 only creates the In Review state and the landing-resumable handoff |

**Scope statement.** This sits at graft's post-build endgame (Steps 9b and 10, and the autonomous Flow step 6), between PR creation and the mechanical merge.

## 2. OUT OF SCOPE

- **Autonomous land-time fixing (FAFF-844).** Re-entering the implementor lane to resolve a conflict or a real CI regression, the fix-cycle counter, the 3-failed-cycle hard park, the `<run_dir>/<issue>/landing-progress.json` recovery artifact, and the `faff landing-progress` CLI verb are FAFF-844. In this ticket CONFLICTING and CI_RED_REGRESSION are observed and routed to the existing pr-open-for-human path. Extension point: the CONFLICTING and CI_RED_REGRESSION branches of the loop.
- **Cross-firing resume and admission (FAFF-842).** A later firing detecting a stranded In Review PR and resuming its landing is FAFF-842. This ticket writes the In Review state and returns the resumable token; it does not build the pickup mechanism. Extension point: `faff-beep-boop` build-queue admission and the resume-store fallback in graft Step 3.
- **The Phase 0 recovery bundle (FAFF-819 / FAFF-820).** FAFF-841 neither publishes nor restores the off-box bundle, and writes no recovery artifact of its own. Extension point: FAFF-844's per-issue landing-progress artifact, which FAFF-819 sweeps.
- **Disposition reclassification of the new token (FAFF-842).** Leaving the new token out of `ATTENTION_OUTCOMES` (line 35 of `disposition.js`), so it stops nagging a human, is FAFF-842. This ticket only introduces the token, returns it, and maps it through graft's own ledger-bucket mapping. Extension point: `disposition.js` `ATTENTION_OUTCOMES`.
- **`merge-gate.js` changes.** No wait, poll, or rebase is added to the primitive. Extension point: none needed; the loop feeds it.
- **`faffter-noon-ship` changes.** The merge producer stays `judgement_seam: none`, one delivery-outcome block, no loop. Extension point: none.
- **A configurable cap knob.** The time budget is a fixed constant in this ticket. A `.faffrc` knob is deferred. Extension point: `faff config` / `.faffrc.yaml` under a future `graft.landing.*` key.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Landing loop | graft's bounded observe-then-act loop that replaces the uncapped Step 10 CI wait and drives an open PR toward merged |
| Landing time budget | A fixed wall-clock deadline measured from loop entry; at the deadline graft stops and hands off with the resumable-landing token |
| Re-run budget | The within-firing flaky re-run allowance carried as ephemeral loop state: at most one clean re-run per head sha, at most two per issue-build |
| Resumable-landing outcome | The new caller-facing return token graft returns when it hands off a still-open, CI-pending PR at the time budget |
| Leave-for-human path | graft's existing pr-open-for-human park behaviour; the loop routes CONFLICTING, CI_RED_REGRESSION, CI_RED_PARK, a flaky check whose re-run budget is exhausted, and an update-branch failure to it, unchanged (defined in 4.2) |

**The new outcome token.**

**Chosen:** the caller-facing return token is `landing-resumable`. It is distinct from `pr-open-for-human`. It maps to the existing runcheck ledger bucket `pr-open` (the PR is genuinely open, opened at 9b), carrying a new ledger annotation `landing_resumable` in the ledger's annotation array, mirroring how `retry-later` maps to bucket `parked` plus the `review_outage_pending` annotation (lines 626, 638). The bucket stays a valid runcheck member, so no new bucket is introduced. graft emits the token, the bucket, and the annotation; FAFF-842 teaches `disposition.js` to read the annotation and reclassify the token as non-attention.

**Observed landing state.** The loop classifies each observation into one of these states. The CI classification reuses the existing three-way evaluation (`ci-green` / `ci-red` / `no-ci-coverage`, lines 540-544) and the existing `faff ci-triage` origin verdicts (lines 499-501); nothing new is added to `ci-triage.js`.

```
ENUM ObservedLandingState:
  CI_PENDING          # >=1 applicable check still pending/in_progress
  NO_CI_COVERAGE      # applicable-check set empty (existing Step 10 branch)
  CI_RED_PARK         # ci-triage: main-was-red / park-errored / park-needs-human
  CI_RED_FLAKY        # ci-red, ci-triage classifies the failure transient (flaky)
  CI_RED_REGRESSION   # ci-red, ci-triage classifies it persistent + code + mine
  CONFLICTING         # ci-green, mergeStateStatus DIRTY/CONFLICTING
  BEHIND              # ci-green, mergeStateStatus BEHIND (base moved)
  READY               # ci-green, mergeable, review pass
```

## 4. HOW — Behavior

### 4.1 In Review transition at Step 9b

**Summary:** when the PR opens, move the ticket forward to In Review, mirroring the Step 5 In Progress claim.

Insert immediately after PR creation at Step 9b (`plugin/skills/faff-graft/SKILL.md` line 445, after `gh pr create` succeeds, before "Proceed to Step 10"). In Review is a valid Faff-team workflow state of type `started`, ranked forward of In Progress (`Backlog < Todo < In Progress < In Review < Done`, `faff/SKILL.md` line 633). No writer moves to it today; this is the first.

```
PROCEDURE transition_to_in_review(issue):
  1. Re-read the issue's LIVE status in one fetch (per Re-ground before gate; mirrors Step 5).
  2. IF the configured tracker's workflow has no In Review-type state -> no-op, proceed.
     (Only Linear + git-only are covered today; git-only has no tracker at all.)
  3. IF live status is already In Review or Done -> no-op (forward-rank monotonicity; a peer advanced it).
  4. ELSE (live status is In Progress) -> agent-mediated tracker write (save_issue) moving status -> In Review.
  5. NEVER fail the build for a missing state or a failed status write; the loop proceeds regardless.
```

**Chosen:** the In Review write mirrors Step 5's mechanism exactly (live status re-read, agent-mediated forward-rank `save_issue`), and adds no new control label. Step 5 pairs its In Progress write with the `faff-claimed` breadcrumb; In Review needs no equivalent, so none is added. A tracker with no In Review-type state degrades to a no-op, never a build failure.

This write rides with Step 9b, so it runs wherever 9b runs, including in a dispatched build lane (the Step-9b work still runs under a dispatch cut, line 470). It obeys the status-monotonicity guard: forward-only, never reverting a further-along issue.

**Anti-pattern:** introducing a `faff status set` CLI. Why: status writes are agent-mediated throughout faff (Step 5, ship, tidy); there is no status-set verb and this ticket does not add one.

**Anti-pattern:** failing the build when the tracker lacks an In Review state. Why: In Review is a forward-progress nicety, not a merge precondition; a missing state must degrade to a no-op.

### 4.2 The bounded landing loop (replaces the Step 10 uncapped wait)

**Summary:** replace the uncapped `gh pr checks --watch` wait (autonomous Flow step 6, lines 576-582) with an observe-then-act loop that has a fixed wall-clock deadline and a flaky re-run budget, and calls the existing ship handoff to `merge-gate --execute` only when the PR is terminal-green and mergeable.

**Chosen:** the landing loop is the autonomous top-level graft path (the Step 10 merge locus, reached at Flow step 6). Interactive mode keeps Step 11's human-gated behaviour and the "How to actually wait for CI" explicit-handoff option unchanged; the human is present to watch. The In Review write at 9b, being shared, applies to both modes. Under a dispatch cut the loop runs wherever the merge locus runs (top-level graft or the concurrency dispatcher per obligation 7), never in a dispatched build lane.

**Chosen:** the fixed time budget is a whole-loop wall-clock deadline of 25 minutes, measured from loop entry, checked at the top of every iteration. It is within the operator-agreed 20 to 30 minute band. It bounds every observe-state, not only `CI_PENDING`: a base branch that keeps moving (repeated `BEHIND` rebases) and repeated flaky re-runs also count against it, so no state can spin without end.

**The oracle: `observe(pr)`.** The loop turns entirely on this classification, so it is fully specified. It reads the PR head check rows and the merge fields, then applies a fixed precedence (first match wins). The CI axis is resolved before the merge-state axis, because acting on a head whose CI is unsettled or red is premature.

```
FUNCTION observe(pr) -> ObservedLandingState:
  checks := `gh pr checks <pr> --json ...`   # branch on OBSERVED ROW COUNT, not exit code (lines 540-544)
  view   := `gh pr view <pr> --json mergeStateStatus,mergeable,reviewDecision`

  # --- CI axis first ---
  1. IF >=1 applicable check is pending/in_progress            -> CI_PENDING
  2. IF the applicable-check set is empty (zero rows)          -> NO_CI_COVERAGE
  3. IF >=1 applicable check is failing-terminal (ci-red):
       v := faff ci-triage --pr <pr> --issue <issue> --run-dir <run_dir>   # observe-only
       IF v in {main-was-red, park-errored, park-needs-human} -> CI_RED_PARK
       ELIF v is transient (flaky)                            -> CI_RED_FLAKY
       ELSE (persistent + code + mine)                        -> CI_RED_REGRESSION
  # --- merge-state axis, ci-green from here ---
  4. IF view.mergeStateStatus in {DIRTY, CONFLICTING}         -> CONFLICTING
  5. IF view.mergeStateStatus == BEHIND                       -> BEHIND
  6. IF view.mergeable AND review pass (reviewDecision APPROVED
       or the Step 9 pass already recorded)                   -> READY
  7. ELSE (mergeStateStatus UNKNOWN/BLOCKED, not yet settled) -> CI_PENDING   # re-poll
```

```
PROCEDURE landing_loop(issue, pr, run_dir):
  loop_started_at := now()
  reruns_by_sha   := {}     # ephemeral loop state; the caller-side ci-triage reruns_used budget.
  reruns_total    := 0      # NOT the persisted landing-progress artifact (that is FAFF-844).

  LOOP:
    faff heartbeat "<run_dir>" --unit <issue>          # keep the existing heartbeat tick

    IF now() - loop_started_at >= LANDING_CI_CAP (25 min):
       RETURN landing-resumable                        # PR open; FAFF-842 resumes it on a later firing

    state := observe(pr)
    head  := current PR head sha

    SWITCH state:
      CI_PENDING:
        block on `gh pr checks <pr> --watch --interval 15` in a chunk with a timeout
          below the 900s staleness window (existing chunking), then CONTINUE the loop
      NO_CI_COVERAGE:
        take the EXISTING Step 10 no-ci-coverage branch (lines 502-505, 582), unchanged;
          RETURN pr-open-for-human
      CI_RED_PARK:
        take the EXISTING ci-triage park branch (main-was-red / park-errored /
          park-needs-human, lines 500-501), unchanged; RETURN pr-open-for-human
      CI_RED_FLAKY:
        IF reruns_by_sha[head] < 1 AND reruns_total < 2:        # budget remains
           `gh run rerun <run-id> --failed`
           reruns_by_sha[head] += 1; reruns_total += 1          # caller increments ci-triage's reruns_used
           re-observe; CONTINUE
        ELSE:                                                   # budget exhausted -> persistent by fiat
           leave_for_human(issue, pr, reason="flaky-exhausted -> persistent");
           RETURN pr-open-for-human
      CI_RED_REGRESSION:
        leave_for_human(issue, pr, reason="ci-regression"); RETURN pr-open-for-human
          # FAFF-844 replaces this with a bounded fix cycle
      CONFLICTING:
        leave_for_human(issue, pr, reason="conflict"); RETURN pr-open-for-human
          # FAFF-844 replaces this with a bounded fix cycle
      BEHIND:
        run `gh pr update-branch <pr>` (or rebase main onto the branch), then re-push
        IF the update-branch / rebase / push FAILS (a conflict surfaced by the rebase,
           or a push rejection):
           leave_for_human(issue, pr, reason="rebase-conflict"); RETURN pr-open-for-human
             # a rebase that surfaces a conflict IS the CONFLICTING case 841 leaves for a human
        # a SUCCESSFUL rebase mints a NEW head sha: observe() returns CI_PENDING on the new head,
        # and the new sha gets its own fresh per-sha re-run allowance (reruns_total still caps at 2).
        # The 25-minute whole-loop deadline (from loop entry) still bounds the total.
        CONTINUE
      READY:
        hand off to the ship producer, which invokes `merge-gate --execute` (Step 10
          "all conditions hold" path, line 481); route on delivery-outcome as today;
          RETURN shipped
```

**The leave-for-human path.** `leave_for_human` is graft's existing pr-open-for-human park behaviour, not a new mechanism. For a CI-red regression (or a flaky check whose re-run budget is spent, now persistent by fiat) it is the existing CI-red triage `fix-attempt` / park routing (lines 500-501, 580-581); for a conflict or an update-branch failure it is the existing `failed:<reason>` handling (line 484): autonomous does one opportunistic fix attempt if the fix is obvious from the error, else flips the PR to draft and parks per the shared protocol. Both terminate at the `pr-open-for-human` return (bucket `pr-open`). FAFF-841 neither extends nor removes this behaviour; the bounded multi-cycle autonomous fix loop is FAFF-844.

**Which states continue the loop.** `CI_PENDING` (poll), `CI_RED_FLAKY` while its re-run budget remains (one re-run, then continue), and a successful `BEHIND` rebase continue. `CONFLICTING`, `CI_RED_REGRESSION`, `CI_RED_PARK`, `NO_CI_COVERAGE`, a `CI_RED_FLAKY` whose budget is exhausted, and a failed `BEHIND` rebase leave the loop for a human. `READY` merges. The whole-loop 25-minute deadline bounds every continuing state, and the re-run budget separately bounds flaky re-runs so a chronically-flaky check escalates to a human rather than looping to the clock.

**Anti-pattern:** counting a `BEHIND` rebase or a within-budget flaky re-run as a reason to park. Why: those are mechanical, recoverable states; parking on them would strand a healthy PR.

**Anti-pattern:** re-running a flaky check every iteration with no budget. Why: a chronically-flaky check would then only ever be bounded by the 25-minute clock and never reach a human; the re-run budget is what makes it persistent by fiat once spent.

**Anti-pattern:** adding wait or rebase logic to `merge-gate.js`. Why: it is the terminal-green snapshot primitive; graft calls it only when `READY`.

### 4.3 Wiring the new token through graft's ledger-bucket mapping

Add `landing-resumable` to graft's Return values enumeration (near lines 620-628) and to the ledger-bucket mapping (line 638): `landing-resumable -> pr-open` (bucket) plus the `landing_resumable` annotation, following the `retry-later -> parked + review_outage_pending` precedent already on that line.

The bucket and annotation are written by the same locus that writes every other ledger bucket: top-level autonomous graft records its own ledger in-session, and under a dispatch cut the concurrency dispatcher (which runs the merge locus per obligation 7) records the bucket for the dispatched build. Whoever runs the merge locus writes the annotation; a dispatched build lane, which stops at `pr-ready` and never runs the loop, never writes it. The slot writes the bucket, not the raw token, so runcheck stays valid.

### 4.4 Failure modes

- **The cap is shorter than typical CI.** If CI routinely takes longer than 25 minutes, most PRs hand off as `landing-resumable` every firing and rarely land in-firing. How you would know: the ledger shows `landing_resumable` annotations dominating and few in-firing merges. What it means: revisit the cap; the knob is deferred, so this is a follow-up, not a silent failure.
- **A base branch that moves faster than a rebase completes.** Without the whole-loop deadline, repeated `BEHIND` rebases would never terminate. How you would know: many rebase re-pushes, no merge, CI green throughout. What it means: the 25-minute whole-loop deadline (not just the CI-pending sub-state) is what bounds it; if `BEHIND` churn still dominates a firing, the branch is too hot to land unattended and the `landing-resumable` handoff is correct.
- **A chronically-flaky check.** Without the re-run budget, a check that flakes on every run would be re-run each iteration until the clock, never reaching a human. How you would know: the same check re-runs repeatedly and the PR hands off as `landing-resumable` at the cap. What it means: the re-run budget (one per head sha, two per issue-build) escalates it to the pr-open-for-human path once spent, which is the intended outcome.
- **`observe()` misreads a settling merge state.** A PR mid-update can report `mergeStateStatus: UNKNOWN`, which precedence rule 7 treats as CI_PENDING and re-polls. How you would know: a READY PR sits looping without merging. What it means: the re-poll is intended; the whole-loop cap still bounds it, so a genuinely stuck UNKNOWN hands off as `landing-resumable` rather than spinning.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a review-passed PR is opened at Step 9b and the tracker workflow has an In Review state
When graft runs the In Review transition
Then the ticket moves In Progress -> In Review via a forward-rank agent-mediated write, and the loop proceeds
```

```
Given a PR opened on a tracker whose workflow has no In Review-type state
When graft runs the In Review transition
Then the move is a no-op, the build is NOT failed, and the loop proceeds
```

```
Given an automated L3 firing whose PR has CI still running at build-end
When the landing loop observes CI_PENDING and CI finishes green within 25 minutes
Then graft rebases if BEHIND, calls merge-gate --execute via the ship handoff, and returns shipped in the same firing
```

```
Given a PR that is green but BEHIND its base
When the landing loop observes BEHIND and the update-branch/rebase succeeds
Then graft re-pushes, observe() returns CI_PENDING on the new head sha, and the PR merges once green with no human involvement
```

```
Given a PR that is BEHIND but whose rebase surfaces a merge conflict
When the update-branch/rebase fails
Then graft does NOT loop; it routes to the existing pr-open-for-human path and returns pr-open-for-human
```

```
Given a PR that is CONFLICTING (or has a real CI regression)
When the landing loop observes CONFLICTING (or CI_RED_REGRESSION)
Then graft routes to the existing pr-open-for-human path and returns pr-open-for-human, opening no fix cycle (that is FAFF-844)
```

```
Given a PR with a chronically-flaky check that keeps failing after its re-run budget (one per head sha, two per issue-build) is exhausted
When the landing loop observes CI_RED_FLAKY with no budget remaining
Then the check is treated as persistent by fiat, graft routes to the existing pr-open-for-human path and returns pr-open-for-human rather than re-running to the 25-minute cap
```

```
Given a PR still CI-pending at the 25-minute budget
When the loop reaches the deadline
Then graft returns landing-resumable (ledger bucket pr-open plus the landing_resumable annotation), distinct from pr-open-for-human, leaving the PR open for a later firing to land
```

- `merge-gate.js` and `faffter-noon-ship` are byte-for-byte unchanged.

## 6. Design decision rationale

**Where does the wait/rebase loop live?**
- Options: inside `merge-gate.js`; inside the ship producer; in graft.
- `merge-gate.js` is a deterministic snapshot primitive with no network wait, and adding a poll would break that. The ship producer is `judgement_seam: none` ("merges, nothing more"); a loop would break its minimum-producer contract. graft already owns the endgame (Steps 9b to 12).
- **Chosen:** graft owns the loop. It calls `merge-gate --execute` (through the existing ship handoff) once, only when terminal-green.

**How are CONFLICTING and CI_RED_REGRESSION handled in this ticket?**
- Options: build the bounded fix loop here; observe them and route to the existing park path.
- The operator split the autonomous fixing into FAFF-844. Building it here would re-merge the split.
- **Chosen:** observe both states and route them to graft's existing pr-open-for-human park path, unchanged. FAFF-844 replaces those two branches with a bounded fix cycle.

**Where does the flaky re-run budget live?**
- Options: drop it (bound only by the 25-minute clock); carry the existing Step 10 budget as loop state; persist it in a recovery artifact.
- Dropping it lets a chronically-flaky check re-run every iteration to the cap, never escalating. Persisting it is the FAFF-844 artifact, out of scope here.
- **Chosen:** carry the same budget graft's Step 10 tracks caller-side (one clean re-run per head sha, two per issue-build, via ci-triage's `reruns_used` bookkeeping) as ephemeral within-firing loop state; on exhaustion the check is persistent by fiat and routes to the pr-open-for-human path.

**What is the new token's name and ledger bucket?**
- The token must be distinct from `pr-open-for-human` so FAFF-842 can reclassify it, and must map to a bucket runcheck already accepts.
- **Chosen:** token `landing-resumable`, mapped to bucket `pr-open` plus a new `landing_resumable` annotation, following the `retry-later` + `review_outage_pending` precedent. No new bucket. `disposition.js` consuming the annotation is FAFF-842.

**Does the cap bound only CI-pending, or the whole loop?**
- Options: cap the `CI_PENDING` poll only (the literal ticket wording); cap the whole loop.
- A CI-pending-only cap leaves `BEHIND` rebase churn unbounded.
- **Chosen:** a 25-minute whole-loop wall-clock deadline from loop entry, checked every iteration. Still "return `landing-resumable` at the cap," just applied to every state.

**What is the exact cap value?**
- The operator locked the 20 to 30 minute band and deferred a knob.
- **Chosen:** 25 minutes, a fixed constant. The `.faffrc` knob is deferred (see Open Questions).

## 7. Open questions and assumptions

**Open Questions.**

**Punt:** the fixed 25-minute budget is not configurable in this ticket; a `.faffrc` knob under a future `graft.landing.*` key is explicitly deferred. (decides: product)

**Assumptions.** None. This ticket writes no recovery artifact and depends on no cross-firing persistence; within-firing correctness needs only the live PR observation, the ephemeral re-run budget, and the existing graft paths.

## 8. DONE — Definition of Done

### From WHY
- [ ] An L3 firing whose PR has CI running at build-end merges the PR in the same firing when CI finishes green inside 25 minutes, instead of leaving it open.
- [ ] CONFLICTING and CI_RED_REGRESSION are observed but routed to the existing pr-open-for-human path; no new autonomous fixing, counter, or recovery artifact is added.

### From WHAT (types and interfaces)
- [ ] `observe(pr)` classifies into the eight `ObservedLandingState` values by the specified fields and precedence, branching on check row count rather than exit code.
- [ ] graft returns the token `landing-resumable`, distinct from `pr-open-for-human`, mapped to ledger bucket `pr-open` plus a `landing_resumable` annotation in graft's ledger-bucket mapping.
- [ ] The annotation is written by the party running the merge locus (top-level graft in-session, or the concurrency dispatcher under a dispatch cut), never by a dispatched build lane.

### From HOW (In Review transition)
- [ ] On PR open at Step 9b, graft re-reads live status and moves the ticket In Progress to In Review via an agent-mediated forward-rank `save_issue`; it is a no-op if the live status is already In Review or Done, and a no-op in git-only mode.
- [ ] If the configured tracker workflow has no In Review-type state, the move is a no-op and the loop proceeds; the build is never failed for a missing state or a failed status write.
- [ ] No `faff status set` CLI is introduced and no new control label is added for the In Review write.

### From HOW (the landing loop)
- [ ] The uncapped Step 10 / Flow-step-6 CI wait is replaced by the bounded loop for autonomous top-level graft; interactive Step 11 behaviour is unchanged.
- [ ] The loop acts per state: CI_PENDING polls; CI_RED_FLAKY with budget re-runs once and continues; a successful BEHIND rebase re-pushes and continues (observe() returns CI_PENDING on the new head sha); READY hands off to `merge-gate --execute` and returns shipped.
- [ ] The flaky re-run budget is carried as ephemeral loop state (one clean re-run per head sha, two per issue-build); once exhausted the flaky check is treated as persistent by fiat and routes to the pr-open-for-human path.
- [ ] CONFLICTING, CI_RED_REGRESSION, CI_RED_PARK, NO_CI_COVERAGE, a budget-exhausted CI_RED_FLAKY, and a failed BEHIND rebase route to the existing pr-open-for-human path and return pr-open-for-human.
- [ ] The loop has a 25-minute whole-loop wall-clock deadline from entry, checked each iteration; at the deadline graft returns `landing-resumable` with the PR open.

### From non-goals
- [ ] FAFF-841 adds no fix cycle, fix-cycle counter, recovery artifact, or `faff landing-progress` CLI verb (all FAFF-844).
- [ ] `merge-gate.js` is unchanged (no wait/poll/rebase added).
- [ ] `faffter-noon-ship` is unchanged (`judgement_seam: none`, one delivery-outcome, no loop).
- [ ] `disposition.js` (`ATTENTION_OUTCOMES`) and `faff-beep-boop` are untouched.

**Integration smoke test.**

```
PROCEDURE smoke_landing_happy_path:
  1. Open a PR at Step 9b on a branch whose CI will pass; confirm the ticket moves to In Review
     (or is a no-op on a tracker without the state).
  2. Enter the landing loop; observe() returns CI_PENDING, then READY within the budget.
  3. Confirm graft hands off to the ship producer, merge-gate --execute merges, graft returns shipped.
  4. Confirm merge-gate.js / faffter-noon-ship are unmodified and no landing-progress artifact was written.
```

confidence: high
build-tier: complex
spec-review: approve
