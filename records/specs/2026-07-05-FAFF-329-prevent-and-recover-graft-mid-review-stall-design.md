# FAFF-329 — Prevent + cheaply recover the graft mid-review stall

> Spec: faffter-dark-nlspec · 2026-07-03 · interactive · confidence: medium · spec-review: approve.

> Revised 2026-07-03 (spec-review `revise`, architectural major → resolved): the resume path now carries a **diff-identity guard** — Phase-1 is skipped only when the current diff matches the diff the checkpointed verdict was computed against; otherwise Phase-1 re-runs. Resolves the "checkpoint treated as authoritative" tension. Re-review verdict: **approve**.

This spec addresses FAFF-329 for the build agent and human reviewers. It hardens the autonomous graft build loop against the known "slow review stalls the subagent" failure: a build subagent that ends its turn while the adversarial Phase-2 review is still running, returning no terminal token, so the orchestrator pays a full second dispatch to finish it.

## 1. WHY — Problem and Principles

**The load-bearing model.** A build runs as an *isolated subagent* whose turn must reach a terminal token `{issue, outcome, pr}` in one go; the slow part of that turn is the adversarial Phase-2 review, whose worst-case wall-clock (~6× a per-attempt timeout, multiplied per fallback backend — up to ~12 min/backend) can exceed the turn and end it mid-flight. This spec attacks that on two fronts that share one artifact: **bound** the Phase-2 wall-clock so it fits a turn, and **checkpoint** review progress to disk before the slow call so any recovery skips the work already done instead of repeating it.

**Problem statement.** Today a graft subagent that stalls mid-Phase-2 returns no terminal token, and the only recovery is a *fresh* re-dispatch that re-runs Phase-1 and re-runs Phase-2 from scratch (`faffter-noon-concurrency-sequential/SKILL.md:40`, `FAFF-201:131`) — a double-spend seen twice in one run (builds of FAFF-195/175). The stall is named verbatim in the FAFF-201 spec (`:138`, "Phase-1 done, Phase-2 not, no BUILD RESULT"); the FAFF-226 spike only got lucky on the happy path. This change bounds the Phase-2 call to a turn-fit budget and makes recovery cheap by resuming from an on-disk review-progress checkpoint.

**Design principles.**

- **Review compute never leaves the subagent.** Prevention and recovery must keep Phase-1 and Phase-2 *inside* the isolated build subagent (the same one, or a re-dispatched one). The orchestrator must not run the review itself — that is "the very thing isolation exists to prevent" (`FAFF-201 §1:13-15`, gateway `faff/SKILL.md:239`). This rejects any design that hoists Phase-2 into the orchestrator.
- **The hard gate is fixed; only the advisory second opinion is bounded.** The merge gate is AC-verified + CI-green + Phase-1 review `pass` (graft `Step 10`, concurrency slot obligation 4 at gateway `:990`). Phase-2 is already *soft* — findings only, no verdict (`faffter-dark-adversarial-review/SKILL.md:47`) — and already skips on an unreachable backend (`exit 5` → pass+skip). Bounding Phase-2 by a deadline reuses that existing pass+skip semantics; it never weakens the gate.
- **Loud, never silent.** A bounded/skipped Phase-2 is a real reduction in second-opinion coverage. Every deadline-skip is logged and surfaced (not swallowed), so a mis-tuned budget can't quietly no-op the adversarial pass.
- **Recovery must not depend on an unverified harness capability.** The primary cheap-recovery path works today (on-disk checkpoint + graft's existing idempotent re-attach). Any live subagent-resume primitive is treated as an unproven optimisation, spiked separately, never load-bearing.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/SKILL.md` (Step 9, ~296-336) | skill prose | The review→PR sequence; the stall site + slot invocation to change |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | skill prose | Phase-1/Phase-2 structure; where the checkpoint + deadline are described |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node (deps-free) | The Phase-2 HTTP helper; where the total-wall-clock deadline is enforced |
| `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md:40` | skill prose | Resume-from-ledger re-dispatch that consumes the checkpoint |
| `plugin/skills/faff/bin/faff` (CLI) | Node (deps-free) | Home for a deterministic checkpoint read/write subcommand |

**Scope statement.** This sits in the autonomous L3/L4 build loop — inside graft's review step and the concurrency executor's re-dispatch path — not in interactive graft (where a human absorbs a stall).

## 2. OUT OF SCOPE

- **Promoting a Phase-2 `critical` finding to merge-gating.** — Why excluded: that is FAFF-297's job (advisory→gating on the L4 path); this ticket keeps Phase-2 advisory. Extension point: the disposition step in `faffter-dark-adversarial-review/SKILL.md` (lines ~60-68).
- **A live-supervisor kill on a derailing review.** — Why excluded: Sentry (FAFF-49) owns TaskStop-based hard-kill; this ticket recovers a *benign* stall, it does not police a *malicious* one. Extension point: the orchestrator dispatch boundary (`FAFF-49 spec:67,86`).
- **Changing the 900s runcheck staleness window or the heartbeat cadence.** — Why excluded: FAFF-234/FAFF-205 own detection; this ticket changes prevention + recovery, not detection thresholds. Extension point: `STALE_SECS` in the runcheck liveness path.
- **A live subagent-context resume (SendMessage).** — Why excluded: unverified harness capability; carried here as a punt + follow-up spike, not built. Extension point: the concurrency executor's re-dispatch step (§4, Recovery).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Phase-1 | The inline structural review (`faffter-noon-review` 5-pass); owns the hard `pass`/`fail`/`needs-human` verdict. |
| Phase-2 | The adversarial second-opinion call to a structurally different external LLM via `review-call.mjs`; soft findings only, no verdict. |
| Turn-fit budget | A total wall-clock ceiling for the Phase-2 call (across all retries + fallback backends) chosen so the call completes within one subagent turn. |
| Review-progress checkpoint | An on-disk record of how far review got (Phase-1 verdict + diff hash; Phase-2 status + findings ref), written before the slow call so recovery resumes rather than repeats. |
| Deadline-skip | Phase-2 stopping because it hit the turn-fit budget; treated as pass+skip (like an unreachable backend) but logged loudly. |
| Diff-identity guard | On resume, Phase-1 is skipped only if the current diff hash matches the one the checkpointed verdict was computed against; otherwise Phase-1 re-runs. |

**Type definitions.**

```
RECORD ReviewProgress:                # the checkpoint; lives per-issue in the run dir
  issue: string                       # e.g. "FAFF-329"
  phase1: { status: "done",           # only written once Phase-1 reached a terminal verdict
            verdict: "pass",           # checkpoint is written ONLY on verdict == pass
                                       #   (fail / needs-human are already terminal — graft returns immediately, no Phase-2)
            diff_hash: string }        # hash of `git diff main...HEAD` at the moment Phase-1 passed;
                                       #   the resume guard: skip Phase-1 only if the CURRENT diff hash still matches this
  phase2: { status: Phase2Status,
            attempts: int,             # backends/attempts consumed so far (for the deadline accounting)
            findings_ref: Path? }      # path to the Phase-2 findings artifact when status == complete
  updated_at: Timestamp

ENUM Phase2Status:
  pending          # Phase-1 pass recorded, Phase-2 not yet started
  in_flight        # Phase-2 call issued, not yet returned (the stall window)
  complete         # Phase-2 returned findings (findings_ref set)
  skipped_deadline # Phase-2 hit the turn-fit budget → pass+skip (loud)
  skipped_unreachable  # existing exit-5 pass+skip, recorded for symmetry
```

**CLI surface (deterministic — `faff` CLI).**

```
faff review-progress read  <run-dir> <issue>            # -> ReviewProgress JSON on stdout, exit 0; exit 3 if none
faff review-progress write <run-dir> <issue> --phase1-pass --diff-hash <h>
faff review-progress write <run-dir> <issue> --phase2 <status> [--findings <path>] [--attempts <n>]
```

- Pure function over the on-disk file `.faff/runs/<run-id>/<issue>/review-progress.json` — no tracker, no network (the CLI-determinism invariant). `read` on a missing file exits 3 (not an error — "no checkpoint yet").

**`review-call.mjs` deadline surface.**

```
review-call.mjs … --deadline <seconds>     # NEW: total wall-clock ceiling across ALL attempts + fallback backends
                                           #   distinct from --timeout (which bounds ONE stream attempt)
```

**Design decision — one ticket or split prevent/recover?** Prevent (bound the call) and recover (checkpoint + re-attach) share the checkpoint artifact, both live in graft Step 9 / `review-call.mjs`, and neither is useful alone: a bound without cheap recovery still double-spends on the residual stall; cheap recovery without a bound leaves turns long enough to keep stalling. Agile "always-ships-together sibling → merge" applies. **Chosen:** one ticket. The unproven live-resume optimisation is the only separable piece and is punted to a follow-up.

## 4. HOW — Behavior

### Prevention — bound the Phase-2 wall-clock

Phase-2's blowup is structural: `--timeout` bounds one stream attempt, but retry (3×) × truncation-retry (2×) × fallback backends compose into ~6×timeout×backends (`review-call.mjs:193-198`). Prevention adds a **total wall-clock deadline** that caps the whole composition.

```
PROCEDURE run_phase2(diff, deadline_seconds):
  1. Record start = now.  Write checkpoint phase2.status = in_flight.
  2. FOR each backend in the fallback chain:
     a. IF now - start >= deadline_seconds: STOP → return DEADLINE_EXCEEDED.
     b. Run the backend with per-attempt --timeout, but clamp each attempt so it
        cannot run past (start + deadline_seconds).
     c. On success → return findings.  On transient fault → next backend (existing behaviour).
  3. Chain exhausted with no findings → existing unreachable semantics (exit 5).
```

- **DEADLINE_EXCEEDED maps to a new `review-call.mjs` exit code `8`**, distinct from the unreachable `exit 5` so the outcome is observable, but routed identically by the caller: **pass + skip the second opinion, logged loudly** as `phase2: skipped-deadline`. **Chosen:** deadline-exceeded reuses pass+skip semantics (never blocks the gate) but gets its own exit code + loud log line, so a mis-tuned budget is visible in the run log and to `/faff-wtf`, not silent.
- **Anti-pattern:** shrinking `--timeout` instead of adding a total deadline. Why: a small per-attempt timeout makes *individual* attempts fail and cascade into *more* fallback attempts (and more frequent exit-5 skips) — it makes the blowup worse and skips the second opinion more often, silently. The deadline caps the composed total without starving a single honest attempt.

### Recovery — resume from the checkpoint (primary), live-resume (punted)

The checkpoint is written at defined points inside the subagent so that a re-dispatch reads it and skips completed work.

```
PROCEDURE review_step (inside the build subagent, graft Step 9):
  1. On entry, read the checkpoint (faff review-progress read) AND compute cur_hash = hash(git diff main...HEAD).
     - none                                             → run Phase-1 fresh.
     - phase1.verdict=pass AND phase1.diff_hash == cur_hash:      # the diff-identity guard
         - phase2.status ∈ {pending,in_flight}          → SKIP Phase-1, resume at Phase-2.
         - phase2.status=complete                       → SKIP both; go to finding-disposition + gate.
     - phase1.verdict=pass AND phase1.diff_hash != cur_hash:      # diff moved since the checkpoint → STALE
         → discard the checkpoint's verdict and run Phase-1 fresh (Phase-2 status is void — a new diff
           needs a fresh review); the checkpoint is a hint, never authoritative.
  2. Run Phase-1 (if not skipped).  If verdict != pass → return terminal (no Phase-2, no checkpoint).
  3. Write checkpoint: phase1-pass --diff-hash cur_hash  (status pending).   [heartbeat tick — existing, line 302]
  4. Run bounded Phase-2 (above).  Write checkpoint: phase2 complete|skipped-deadline|skipped-unreachable.
  5. Dispose findings, apply the gate, proceed to PR/merge as today.
```

- **Chosen (recovery):** an on-disk review-progress checkpoint consumed by graft's **existing** idempotent re-attach. The concurrency executor's current recovery ("re-dispatched as a fresh build subagent; graft re-attaches idempotently" — `faffter-noon-concurrency-sequential/SKILL.md:40`) is unchanged in *shape*; it becomes *cheap* because the re-attached graft reads the checkpoint and resumes at the right point instead of repeating Phase-1 and a completed Phase-2. This works in the autonomous path today with no unverified harness feature, and keeps all review compute inside the (re-dispatched) subagent.
- **Punt: a live SendMessage-resume of the stalled subagent — needs human + spike.** Continuing the *live* subagent's context (avoiding even the re-dispatch cold-start) depends on a harness primitive that appears nowhere in faff today (`SendMessage` is an unused deferred tool; only `TaskStop`/kill is modelled, `FAFF-49:67,86`) and is unverified in the autonomous beep-boop dispatch path (where the orchestrator blocks awaiting the token). The checkpoint already makes re-dispatch cheap, so live-resume is a marginal optimisation, not required. Route: a follow-up **spike** verifies whether a dispatched build subagent can be resumed live and retains its worktree; only then is it worth wiring. Recorded as an Open Question.

### Failure modes

- **The failure:** the turn-fit budget is set too tight, so Phase-2 deadline-skips on most builds — the adversarial second opinion silently stops contributing. **How you'd know:** the `phase2: skipped-deadline` rate in the run logs climbs (add it to the run summary); a spot-check shows real backends were healthy but timed out. **What it means:** raise the budget (it is configurable) — the default must be validated against real backend latencies before trusting it, hence the budget default is punted to a human call.
- **The failure:** a re-dispatched subagent re-attaches to a worktree whose checkpoint disagrees with git/PR truth (e.g. a partial commit, or the diff moved since Phase-1 passed). **How you'd know:** the diff-identity guard (§4 recovery) finds `phase1.diff_hash != cur_hash`, or graft's existing PR/CI/worktree reconciliation (`FAFF-201:131`) contradicts the checkpoint. **What it means:** the checkpoint is discarded and Phase-1 re-runs on the current diff — a checkpoint never skips the hard review for a diff it wasn't computed against. The existing rule holds — "disk + git are truth on any disagreement" (`faffter-noon-concurrency-sequential/SKILL.md:31`). **Anti-pattern:** skipping Phase-1 on `verdict=pass` alone, without the diff-hash match. Why: that would trust a disk record as authoritative over the hard review input; the guard keeps the checkpoint a hint.
- **The failure:** the deadline clamp interacts badly with the fallback chain (a backend that would have succeeded at attempt 2 is cut off). **How you'd know:** deadline-skips correlate with chains that have healthy later backends. **What it means:** acceptable — a bounded turn beats an unbounded stall; the skip is loud and the budget is tunable.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a build subagent whose Phase-2 backend would run past the turn-fit budget
When the graft review step runs Phase-2 with --deadline set to that budget
Then Phase-2 stops at the deadline, returns exit 8, review resolves to pass+skip,
     and the run log records phase2: skipped-deadline (loudly, not silent)
```

```
Given a build subagent that ended its turn with the checkpoint at phase1.verdict=pass, phase2.status=in_flight
When the concurrency executor re-dispatches the issue and graft re-attaches to the worktree (diff unchanged)
Then graft reads the checkpoint, skips Phase-1 entirely, and resumes at Phase-2
     (Phase-1 is not re-run)
```

```
Given a checkpoint at phase2.status=complete with findings_ref set
When graft re-attaches after a stall that occurred after Phase-2 finished
Then graft skips both phases and proceeds straight to finding-disposition + the merge gate
```

```
Given a checkpoint at phase1.verdict=pass whose diff_hash differs from the current diff
When graft re-attaches (the diff moved since Phase-1 passed)
Then the checkpoint is discarded and Phase-1 re-runs fresh on the current diff
     (a stale verdict never skips the hard review)
```

```
Given any Phase-2 outcome (complete, skipped-deadline, or skipped-unreachable)
When the merge-confidence gate at Step 10 evaluates
Then the gate still requires AC-verified + CI-green + Phase-1 review pass, unchanged
     (Phase-2 never becomes a gate condition here)
```

Assertion: the orchestrator never invokes `review-call.mjs` nor runs Phase-1/Phase-2 itself — all review compute is issued from inside the build subagent (grep the concurrency + beep-boop skills for a review invocation → none).

## 6. DESIGN DECISION RATIONALE

**How to prevent the mid-Phase-2 turn-end?**
- *Total wall-clock deadline on the Phase-2 call* — bounds the real root cause (the 6×timeout×backends blowup) without starving a single attempt. Keeps Phase-2 inside the subagent.
- *Shrink `--timeout`* — rejected: worsens cascade + increases silent skips (anti-pattern above).
- *Run Phase-2 as a backgrounded Bash process that re-wakes the subagent on completion* — rejected for v1: depends on subagent background-exec + re-wake semantics that are as unverified as live-resume; the deadline+checkpoint approach works today. Revisit if the spike validates harness re-wake.
- **Chosen:** total wall-clock deadline (`--deadline`) on `review-call.mjs`, deadline-exceeded → exit 8 → pass+skip (loud).

**How to recover cheaply after a stall?**
- *On-disk review-progress checkpoint + graft idempotent re-attach* — works in the autonomous path today, no harness dependency, review stays in the subagent.
- *Live SendMessage-resume of the stalled subagent* — unverified harness capability; deferred to a spike.
- **Chosen:** checkpoint + re-attach as the primary path; live-resume punted.

**How is the resumed Phase-1-skip kept safe?**
- *Skip Phase-1 on `verdict=pass` alone* — rejected: trusts a disk record as authoritative over the hard review input, and could skip review for a diff that has since moved.
- *Skip Phase-1 only when `phase1.diff_hash` matches the current diff, else re-run* — the diff-identity guard; keeps the checkpoint a hint, never authoritative.
- **Chosen:** diff-identity guard on the resume path.

**Where does the checkpoint live?**
- *In the worktree* — rejected: a re-dispatch may re-attach or re-create the worktree; the artifact must survive.
- *Per-issue run dir* (`.faff/runs/<run-id>/<issue>/`, beside `graft.md`) — survives re-dispatch, already the per-issue artifact home (`FAFF-201:112`).
- **Chosen:** `.faff/runs/<run-id>/<issue>/review-progress.json`, read/written via a deterministic `faff review-progress` subcommand.

**What is the default turn-fit budget?**
- **Punt:** the exact default `--deadline` seconds needs a human's cost/coverage call, validated against real backend latencies (a too-tight default silently skips Phase-2; a too-loose one doesn't prevent the stall). At the time of writing, the composed worst case is ~6×`timeout` per backend with `timeout` defaulting to 120s. A conservative starting point to validate is ~480s (8 min), below the 900s staleness window with margin — but this is the value to confirm, not commit.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.**

- **Live subagent-resume (SendMessage).** Can a dispatched build subagent be resumed live (retaining its worktree/context) in the autonomous beep-boop path, where the orchestrator blocks awaiting the terminal token? `SendMessage` is an unused harness deferred tool; no faff skill models it. Resolve via a follow-up spike; until then the checkpoint + re-dispatch path is the committed recovery. This is non-blocking — the primary path stands without it.
- **Turn-fit budget default.** What `--deadline` value balances stall-prevention against second-opinion coverage? Needs validation against real backend latencies (see Rationale). Non-blocking — the mechanism ships with a validated-conservative default and a config knob.

**Assumptions.**

- **Assumes:** the run-dir per-issue artifact directory (`.faff/runs/<run-id>/<issue>/`) exists and is writable inside the build subagent. Validate: confirm `graft.md` is already written there per issue (`FAFF-201:112`) before relying on it for the checkpoint.
- **Assumes:** `review-call.mjs`'s fallback-chain loop is the single place total wall-clock accrues (no other unbounded wait outside it). Validate: read `runReviewChain` (`review-call.mjs:428-467`) and confirm the deadline check wraps every backend attempt + inter-retry sleep.

## 8. DONE — Definition of Done

### From WHY
- [ ] A build whose Phase-2 would exceed the turn-fit budget no longer ends its turn mid-Phase-2 with no terminal token (bounded call returns within budget).
- [ ] A stall that still occurs is recovered without re-running already-completed review work.

### From WHAT (types + interfaces)
- [ ] `faff review-progress read <run-dir> <issue>` prints the `ReviewProgress` JSON (exit 0) or exit 3 when absent; `write` persists `--phase1-pass --diff-hash <h>` and `--phase2 <status> [--findings] [--attempts]`.
- [ ] The checkpoint file is `.faff/runs/<run-id>/<issue>/review-progress.json` and matches the `ReviewProgress` schema.
- [ ] `review-call.mjs` accepts `--deadline <seconds>` as a total wall-clock ceiling distinct from `--timeout`.

### From HOW (prevention)
- [ ] Phase-2 stops when the deadline is reached and returns exit code `8` (DEADLINE_EXCEEDED), distinct from exit 5.
- [ ] Exit 8 is routed as pass + skip-second-opinion, and emits a loud `phase2: skipped-deadline` log line (not silent).
- [ ] The deadline clamps every backend attempt + inter-retry sleep so the composed total cannot exceed it.

### From HOW (recovery)
- [ ] graft Step 9 reads the checkpoint on entry and skips Phase-1 only when `phase1.verdict=pass` **and** `phase1.diff_hash` matches the current `git diff main...HEAD` hash.
- [ ] A checkpoint whose `diff_hash` differs from the current diff is discarded and Phase-1 re-runs fresh (stale verdict never skips the hard review).
- [ ] With `phase2.status=complete` (and diff-hash match), graft skips both phases and proceeds to finding-disposition + gate.
- [ ] The checkpoint is written before Phase-2 starts (`in_flight`) and updated on Phase-2 resolution.
- [ ] Re-dispatch recovery keeps all review compute inside the subagent; no orchestrator/concurrency/beep-boop skill invokes `review-call.mjs` or runs a review phase.

### From HOW (gate integrity + edge cases)
- [ ] The Step 10 merge gate still requires AC-verified + CI-green + Phase-1 `pass`; Phase-2 is not a gate condition.
- [ ] On checkpoint-vs-git disagreement, git/PR/worktree reconciliation wins (checkpoint is a hint, never authoritative).

### Eval coverage
- [ ] No new LLM-judgement seam is introduced (the changes — wall-clock deadline, on-disk checkpoint, diff-identity guard, re-attach routing, exit-code mapping — are deterministic); covered by unit + integration tests, not a grader KIND. (Recorded here so the absence is a decision, not an omission.)

### Integration smoke test
```
PROCEDURE smoke:
  1. Seed a checkpoint: faff review-progress write <run-dir> FAFF-TEST --phase1-pass --diff-hash abc123
  2. faff review-progress write <run-dir> FAFF-TEST --phase2 in_flight
  3. Re-read: faff review-progress read <run-dir> FAFF-TEST
  4. ASSERT phase1.verdict == "pass" AND phase1.diff_hash == "abc123" AND phase2.status == "in_flight"
  5. Run review-call.mjs against a deliberately-slow stub backend with --deadline 2
  6. ASSERT exit code == 8 within ~2s (deadline enforced, not 6×timeout)
```

confidence: medium
spec-review: approve
