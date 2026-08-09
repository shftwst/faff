# FAFF-527 — L4 run re-entry: resume a failed/aborted/escalated run where it left off

> Spec: faffter-dark-nlspec · 2026-07-17 · autonomous · confidence: medium. Full spec on Linear FAFF-527.

This spec defines the run-level re-entry contract for L4 lights-out runs — `faff lights-out --resume <run-id>` — and scopes a buildable v1 slice. It addresses FAFF-527 (spike → feature). Audience: the build agent implementing the CLI verbs and beep-boop prose changes, and human reviewers of the re-entry contract.

## 1. WHY — Problem and Principles

**The load-bearing model:** an L4 run's complete state already survives its process. The run-ledger (`run-ledger.json`), the append-only event log (`events.jsonl`), the per-issue artifacts (`build-progress.json`, `review-progress.json`, `merge-record.json`, the `.faff/resume/<ISSUE>/` store), and the forge (pushed branches, merged PRs) together form a durable, reconstructable record. Re-entry is therefore not a checkpoint/restore problem — it is a *reconstruction* problem: read the durable record, confront it with forge ground truth, and re-dispatch only what the record proves unfinished. Nothing new needs to be persisted mid-run for v1; what's missing is the verb that reads it all back under a fresh session.

**Problem:** today a fresh `faff lights-out` always mints a new run-id (`lights-out.js` ~line 804: `--id` only renames a fresh mint), so a run that dies mid-flight (process/container death), aborts (`owner.status: aborted-resumable` via Sentry), or exits for escalation (`budget-escalated` / `product-incomplete` / `sentry-abort`) can only be continued by hand. `faff disposition` classifies the wreckage but nothing acts on it. This change adds `--resume <run-id>`: reconstruct, verify, continue the same ledger — never re-shipping, never double-merging.

**Design principles:**

**Fail closed on every ambiguity.** Any divergence between what the ledger claims and what the forge shows refuses or parks — a resume must never guess. This extends the house rule (reconcile is fail-closed, preflight refusals mint nothing) to re-entry.

**Never undercount spend.** The budget governor's invariants (FAFF-229 attribution, FAFF-427 baseline windows) bind re-entry exactly as they bind a fresh mint. A resume whose prior-session spend cannot be established does not silently zero it.

**The ledger is continued, not copied.** Re-entry appends to the existing run-id's ledger and events — same `run_id`, same `events.jsonl` seq stream, same run-dir. A new run-id is the bug this ticket exists to fix.

**Losing or duplicating work must never be silent.** Where v1 rebuilds coarsely (the pre-push gap), the rebuild is announced in the resume banner and on the event stream.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Entry point.** One flag on the existing command — not a new subcommand:

```
faff lights-out --resume <run-id> [--check] [--json]
```

`--resume` is mutually exclusive with `--id` (exit 2 if both). `--check` performs the full resume preflight + reconstruction and prints the plan without touching the ledger (side-effect-free, mirroring the mint-path `--check`).

**Chosen:** `faff lights-out --resume <run-id>` (flag on `lights-out`, not a new subcommand).

**Re-enterable states.** Resume admits a run iff the ledger reads as one of:

```
ENUM ReEnterableState:
  aborted-resumable   # owner.status flipped by applySentryAbort (ledger.abort present or not)
  escalated           # escalate-class stop_reason: budget-escalated(*), product-incomplete,
                      #   non-convergence, sentry-abort (disposition.js ESCALATE_STOP set)
  dead-running        # owner.status still "running" BUT effective heartbeat stale

REFUSED (exit 2, ledger untouched):
  live-running        # owner.status "running" with fresh heartbeat — a second driver is a race
  done-clean          # terminal owner/stop_reason with all admitted outcomes terminal and clean
  unparseable         # missing/corrupt ledger — fail loud, never reconstruct from events alone
```

**Ledger additions** (all additive; absent fields on old ledgers tolerated read-side):

```
owner.epoch: Int                     # NEW; write-fence token — default 0 when absent
owner_history: List<OwnerBlock>      # NEW; prior epochs' final owner blocks, append-only
abort_history: List<AbortEntry>      # NEW; ledger.abort moves here on resume (abort cleared)
resume: List<ResumeEntry>            # NEW; one per re-entry, append-only

ResumeEntry:
  epoch, resumed_at, session_id, prior_state,
  plan_summary: { skipped_shipped, redispatched, rebuilt_coarse, parked_divergent }

Ledger.budget.sessions: List<SessionSpan>   # NEW; budget session-accumulation (shape (a))
SessionSpan:
  session_id, baseline_by_model_class, closed_delta_by_model_class|null,
  closed_at|null, close_source: "transcript"|"last-observation"|"degraded"|null
```

Migration rule: a ledger with no `budget.sessions` synthesizes span 0 read-side from the existing `tokens_at_start_by_model_class` + minting session. `tokens_at_start_by_model_class` retained untouched.

**Chosen:** budget session-accumulation shape (a). Spend = Σ closed deltas + current-span delta.

**Event additions.** One new event type `run-resume` registered in `DELIVERY_PROFILE.event_types` (governance-profile.js):

```
{ schema: 1, run_id, seq, ts, phase: "run", type: "run-resume",
  epoch, prior_state, skipped_shipped: [...], rebuilt_coarse: [...] }
```

**ResumePlan** (pure core output):

```
skip: List<IssueId>              # proven shipped — never touched again
continue_review: List<IssueId>   # at review boundary
continue_from_push: List<IssueId># build-complete-pushed — recreate worktree from branch
redispatch: List<IssueId>        # admitted, no checkpoint — coarse rebuild
park: List<{issue, divergence}>  # ledger-vs-forge divergence — needs-human
drain_remainder: Bool
```

## 4. HOW — Behavior

Six steps: (1) admit run as re-enterable, (2) re-fire full mint preflight, (3) close out prior budget session + re-baseline, (4) reconstruct per-issue positions + reconcile against forge, (5) write re-entry onto ledger + events, (6) hand off to beep-boop as mint does. Steps 1–4 side-effect-free; first write is step 5 (so `--check` = steps 1–4 + print).

1. ADMIT: resolve run_dir; missing/unparseable ledger → exit 2. Classify ReEnterableState: aborted-resumable (owner.status or ledger.abort), escalated (escalate-class stop_reason), dead-running (owner.status running + stale heartbeat via heartbeat.js overlay; fresh → REFUSE live, exit 2), else done-clean → REFUSE exit 2. Staleness threshold = resolved sentry heartbeat-staleness window (never a second liveness constant).
2. RE-FIRE mint preflight — all 8 guardrails + 3-key floor against CURRENT config/env. Any refusal → refused, ledger untouched. Envelope RE-RESOLVED from current config; run identity fields (run_id, level, prd_*, dial_profile) read from ledger. Escalated-budget gate: budget-escalated stop_reason → compute accumulated spend against re-resolved ceiling; still at/over → REFUSE naming config key. product-incomplete: PRD gate inside re-fired preflight re-reads fixed PRD.
3. BUDGET close-out + re-baseline (shape a): close prior span (measure transcript delta; unresolvable → last-observation → degraded, never zero), open new span baselined at resume instant. `budget check` sums Σ closed deltas + current-span delta. Runs without sessions array keep existing single-session math.
4. RECONSTRUCT per-issue → ResumePlan: shipped → reconcileShipped, null→skip, divergence→park; terminal non-shipped → keep; no terminal → resume store/awaiting-review→continue_review, build-complete+pushed-branch-verified→continue_from_push, recorded-but-missing branch→park, else→redispatch. drain_remainder=true.
5. WRITE (first side effect, atomicWriteLedger): push old owner→owner_history; new owner {status running, epoch prior+1, session_id, pid, started_at now, last_heartbeat now}; move ledger.abort→abort_history, delete it; clear stop_reason; append ResumeEntry + budget sessions mutation; append run-resume event (seq continues).
6. HAND OFF as mint: print banner + plan, emit `FAFF_APPETITE=full FAFF_RUN_DIR=<run_dir> /faff-beep-boop`.

**Resume granularity — boundary table:**

| Boundary | Durable evidence | Resume semantics (v1) |
|---|---|---|
| run-start | ledger only, `admitted: []` | Continue the drain from the queue |
| issue-admitted | ledger `admitted` entry, no checkpoint | **Coarse rebuild**: re-dispatch, fresh worktree |
| build-complete-pushed | `build-progress.json` + pushed branch | Recreate worktree from pushed branch (FAFF-402) |
| review | `.faff/resume/<issue>/` / awaiting-review | FAFF-403 hold-continuity path |
| merge | `merge-record.json` + forge merge | Proven shipped → skip; divergence → park needs-human |

**Chosen:** mid-implementation-pre-push gap ACCEPTED as coarse rebuild for v1 — documented (this table), announced (banner + `rebuilt_coarse` event), safe (fresh worktree cannot lose pushed work nor duplicate a merge). Sentry `wip_commit` surfaced in banner, never auto-applied.

**Chosen:** preflight re-fires in full on resume (environment at resume ≠ at mint). Mint itself not repeated.

**Chosen:** reconstruction source of truth = ledger + per-issue artifacts + forge ground truth, fail-closed divergence handling (divergence parks that issue, run continues for rest).

**Chosen:** never-double-merge by construction — only path skipping an issue is a reconcileShipped-proven merge; skipped issues excluded from dispatch; merge-gate.js sole merge path for everything else.

**Chosen:** escalated budget re-entry requires human to raise ceiling explicitly (edit budget.* in .faffrc); --resume re-resolves envelope, refuses while accumulated spend ≥ ceiling. Auto-inherit rejected.

**Chosen:** resume continues whole drain (drain_remainder: true).

**Chosen:** v1 sequential executor only; parallel concurrency slot → --resume refuses with clear message.

**Owner-epoch fence on ledger writes (takeover safety).** On resume-admission of a dead-running run, resume mints a new owner epoch (increment owner.epoch, default 0 when absent, stamp new session_id). EVERY ledger write path (atomicWriteLedger read-modify-write users: heartbeat, outcome writes, budget checkpoint, abort) re-reads owner.{epoch, session_id} immediately before writing and YIELDS — a no-op plus a loud log, never an error-crash — when its own epoch/session no longer matches. Mirrors status-monotonicity local-comparison; no CAS.

**Edge cases:** --resume + --id → exit 2. Corrupt ledger → exit 2 (never reconstruct from events). Two concurrent --resume: step-1 liveness + step-5 atomic write ordering; owner-epoch fence closes the live-but-quiet original driver case. continue_from_push branch deleted → park (divergence). Repeated death → repeated resume: epochs append; no hard cap v1. Retryable: preflight refusals + escalated-budget gate; terminal: unparseable-ledger + live-running; per-issue terminal-for-run: parked divergences.

**Anti-pattern:** reconstructing run state from events.jsonl when ledger unreadable (events are observability, not source of truth). **Anti-pattern:** teaching budget check to read old session transcript via --session-id (transcripts rotate → undercount).

## 8. DONE — Definition of Done

- `faff lights-out --resume <run-id>` exists; resumed run keeps original run_id, run-dir, ledger, events seq stream (no new mint).
- `--resume` + `--id` exit 2; `--resume --check` side-effect-free (ledger + events byte-identical) + prints ResumePlan.
- Re-enterable-state classification matches ENUM: aborted-resumable, escalate-class stop_reason, stale-heartbeat dead-running resume; live-running, done-clean, unparseable-ledger exit 2 without writes.
- Ledger additions (owner_history, abort_history, resume[], budget.sessions[]) additive + append-only; pre-527 ledger with none resumes correctly (span-0 synthesis).
- `run-resume` event type registered in DELIVERY_PROFILE.event_types, validates via eventViolations, carries epoch, prior_state, skipped_shipped, rebuilt_coarse.
- All 8 guardrails + 3-key floor re-fire on resume against current config; any refusal leaves ledger untouched.
- Budget close-out: prior span closed via transcript when resolvable, else last durable observation, else degraded — never zero; budget check on sessions-bearing ledger reports Σ closed deltas + current-span delta.
- Escalated budget re-entry refuses while accumulated spend ≥ re-resolved ceiling, naming config key; proceeds after human raises it.
- Reconstruction: shipped-with-proven-merge skipped + never dispatched; review-boundary + pushed-boundary continue via FAFF-403/402; checkpoint-less admitted re-dispatch from scratch.
- Ledger-vs-forge divergences (claimed-shipped-unmerged, phantom-merge, recorded-branch-missing) park that issue needs-human + exclude from dispatch while rest resumes.
- After admitted set settles, drain continues admitting from queue under same run-id + gates.
- Parallel concurrency slot → --resume refuses with sequential-only message.
- wip_commit (when present) printed in banner, never applied.
- Second --resume against freshly-resumed (live) run refuses on heartbeat check.
- Repeated resumes append epochs + budget spans; epoch count in banner.
- Resume of dead-running run increments owner.epoch (default 0 when absent) + stamps resuming session_id.
- Stale-epoch writer yields as no-op with loud log — never error-crash — covered by selftest row.
- Existing single-session behaviour byte-identical when owner.epoch absent.

confidence: high
spec-review: approve
