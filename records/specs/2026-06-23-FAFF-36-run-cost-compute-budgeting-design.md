# Run cost / compute budgeting — token + compute ceiling per unattended run

> Spec: faffter-dark-nlspec · 2026-06-23 · confidence: high · mode: interactive · Full spec on FAFF-36

> **Revised spec — supersedes the earlier `medium` comment on this issue.** The token-visibility open question (the reason for `medium`) is **resolved**: faff *can* read its own session token spend at runtime via the session transcript, keyed off `CLAUDE_CODE_SESSION_ID`. The token dimension is now hard-enforceable, not estimate-only. Confidence → `high`. Verification notes inline.

For the build agent and human reviewers. Defines how an unattended `/faff-beep-boop` run is given a **budget** it respects and a **defined behaviour at the ceiling**, generalising the two budget flags that already exist.

## 1. WHY — Problem and Principles

**The load-bearing model:** a budget is a set of **ceilings** on a run's spend across **dimensions** (wall-clock, build-attempts, tokens, cost), checked at the same between-units gate the existing flags use, producing one of three **at-ceiling outcomes** — `stop` / `narrow` / `escalate`. The contract is the *ceiling + outcome*; how spend is *accounted* is a swappable producer behind it.

**Problem.** A run can today be capped only on wall-clock (`--until`) and build-attempt count (`--max`); no token/cost ceiling, and the only at-ceiling behaviour is "stop dispatching." The lights-out runner (FAFF-225) and terminating-condition (FAFF-38) need a unified budget signal with richer behaviour.

**Design principles.**
- **Enforce what's observable; estimate only as fallback.** Token spend *is* observable at between-units boundaries via the session transcript (see HOW), so the token dimension is hard-enforced; an estimate is used **only** when the transcript is unavailable and is always labelled `(estimate)`.
- **Between-units, never mid-turn.** A turn's `usage` lands in the transcript only once it closes — so accounting is read at the existing between-units checkpoints. No mid-turn abort, by design; matches faff's gate timing.
- **Generalise, don't proliferate.** New dimensions join *one* budget contract, not bespoke flags.
- **Fixed contract, swappable accounting.** Ceiling + outcome is the fixed contract FAFF-38/FAFF-225 consume; accounting is an upgradable producer.

**Reference context.**

| System | Where | Relevance |
|---|---|---|
| beep-boop budget flags | `plugin/skills/faff-beep-boop/SKILL.md` ~36–72 | `--until`/`--max`: dimensions + between-units gate extended here |
| Stop conditions | same file ~496–510 | `budget-hit` stop reason gains dimensions |
| Run-ledger + owner stamp | same file ~220–269 | `owner.started_at` (FAFF-205) = run-start baseline anchor; gains a `budget` block |
| Session transcript | `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` | per-message `usage`; token-accounting source |
| `faff` CLI DEFAULTS | `plugin/skills/faff/bin/faff` | config keys + a `faff budget` subcommand |

**Scope.** A foundational stop-condition leaf in the lights-out v1 project; consumed by FAFF-38 and FAFF-225.

## 2. OUT OF SCOPE

- **Per-issue / single-build budget** — runaway single build = FAFF-49 Sentry. Extension: a `per_issue` dimension.
- **Real CI/compute metering** — CI spend needs provider introspection faff lacks in v1. Extension: a CI-introspection producer feeding `cost` with CI actuals (today `cost` = tokens × price).
- **Mid-turn cancellation** — preserves "in-flight units finish naturally." Extension: FAFF-49 kill-switch.

## 3. WHAT — Vocabulary, Types, Interfaces

| Term | Definition |
|---|---|
| Dimension | One axis of spend: `until`, `max_attempts`, `tokens`, `cost`. |
| Ceiling | A configured limit on a dimension. Any subset; unset = unbounded. |
| Token accounting | Sum of `usage` across the run's transcripts since run start (see HOW). |
| At-ceiling outcome | `stop` / `narrow` / `escalate`. |

```
RECORD BudgetEnvelope:                 # resolved once at run start
  ceilings: { until?: Time, max_attempts?: Int, tokens?: Int, cost?: Money }
  at_ceiling: stop | narrow | escalate              # default: stop

RECORD BudgetState:                    # recomputed at each between-units check, lives in the ledger
  spent: { elapsed, attempts, tokens, cost }
  tokens_source: transcript | estimate              # transcript = measured; estimate = fallback
  breached: Set<Dimension>
  outcome: stop | narrow | escalate | none
```

**Budget signal (consumed by FAFF-38/FAFF-225).** `faff budget check` — a pure CLI reading run-ledger + config + the run's transcripts, emitting `BudgetState` JSON. `breached ≠ ∅` is the terminating signal; `outcome` says what to do. No tracker call (matches `faff next`).

**Config (`.faffrc`, all optional; `concurrency_max` is the numeric precedent).**

```yaml
budget:
  until:          # HH:MM wall-clock (existing --until, now config-settable)
  max_attempts:   # build-attempt count (existing --max)
  tokens:         # token ceiling (measured via transcript; estimate fallback)
  cost:           # cost ceiling = tokens × price constant
  at_ceiling: stop
  price_per_mtok: 0   # cost-dimension price input; 0 disables the cost dimension
```

CLI flags `--until`/`--max` remain and override config.

## 4. HOW — Behaviour

**Architecture.** At run start, resolve `BudgetEnvelope`, record it in the ledger `budget` block, and **baseline** tokens: record the current transcript-sum as `tokens_at_start` (so the budget counts *this run's* spend, not whole-session history). At each between-units checkpoint, call `faff budget check` → `breached` + `outcome`; the orchestrator acts.

**Token accounting (the resolved mechanism).**

```
PROCEDURE measure_tokens(run_start):
  1. sid = $CLAUDE_CODE_SESSION_ID                 # reliable key; NEVER the mtime-newest heuristic
  2. base = ~/.claude/projects/<encode(cwd)>/      # cwd '/'→'-'; honour $CLAUDE_CONFIG_DIR
  3. files = [ base/<sid>.jsonl ]                  # orchestrator transcript
            + base/agent-*.jsonl WHERE mtime >= run_start   # subagent (graft/explore) transcripts
  4. total = Σ over files, over assistant msgs: usage.{input_tokens+output_tokens+cache_creation_input_tokens+cache_read_input_tokens}
  5. RETURN total - tokens_at_start                # this-run delta
  FALLBACK: no transcript (CLAUDE_CODE_SKIP_PROMPT_HISTORY / missing) →
            estimate = attempts × est_tokens_per_attempt; tokens_source = estimate
```

**Verified mechanics (this session, 2026-06-23):** `CLAUDE_CODE_SESSION_ID` is exported and names the transcript; assistant messages carry `usage`; subagent turns are **not** sidechain entries — they live in separate `agent-*.jsonl` files, so step 3 must aggregate them or it undercounts (subagent grafts dominate run spend). Newest-by-mtime was a *different* session, so only the env var is reliable. All reads are post-turn.

```
PROCEDURE between_units_budget_check(ledger, config):
  1. state = faff budget check
  2. IF state.breached == ∅: continue dispatching
  3. ELSE branch on state.outcome:
     stop:     stop dispatching; in-flight finish; admitted-undispatched → "Unreached (budget hit)"; Stop reason = budget-hit(<dims>)
     narrow:   don't stop; ask methodology pick-ordering for the cheapest remaining admissible subset; dispatch only those; re-check; fall through to stop when nothing fits
     escalate: stop dispatching; emit a structured needs-human escalation (runner/Sentry/morning report); Stop reason = budget-escalated(<dims>)
```

**At-ceiling outcomes.** `stop` (default) = today's behaviour from any breached dimension; `narrow` = maximise value under residual budget via the methodology (orchestration holds no ordering opinion); `escalate` = stop + human-visible signal (the L4 path wants this, not a silent drain).

**Ledger augmentation.** Add `budget` block `{ envelope, state, tokens_at_start }`. Existing `unreached-budget` outcome reused; `discovered_scope` invariant unaffected.

**Failure modes.**
- **The failure:** child `agent-*.jsonl` aggregation misses files (late write / different config dir), undercounting. **How you'd know:** ledger run-total diverges sharply from the harness `/usage`. **What it means:** widen the window / honour `$CLAUDE_CONFIG_DIR`; keep an observable `until` ceiling as backstop.
- **The failure:** transcript disabled, silently falling to estimate while the user thinks it's metered. **How you'd know:** `tokens_source == estimate`. **What it means:** surface `tokens_source` in the run summary.

**Anti-pattern:** using the mtime-newest transcript as "the current session." Why: project dirs are shared across sessions; only `$CLAUDE_CODE_SESSION_ID` is reliable (verified).

## 5. SCENARIOS

```
Given a run with budget.max_attempts = 3 and at_ceiling = stop
When the 3rd build attempt has been launched and the next between-units check runs
Then no further units are dispatched, in-flight builds finish, undispatched admitted issues appear under "Unreached (budget hit)", and Stop reason = budget-hit(max_attempts)
```

```
Given a run with budget.tokens set, at_ceiling = escalate, and a readable transcript
When the run's measured transcript-sum delta crosses the token ceiling at a between-units check
Then dispatching stops, BudgetState.tokens_source = transcript, and a structured escalation signal is emitted (not a silent queue-drained exit)
```

```
Given a run with budget.tokens set but transcript reading disabled
When the budget check runs
Then tokens are estimated (attempts × est_tokens_per_attempt), tokens_source = estimate, and every surface labels the token figure (estimate)
```

- **Constraint:** estimate-derived token figures are labelled `(estimate)`; measured ones are not.
- **Constraint:** `faff budget check` makes no tracker call; reads usage only from local transcripts + the ledger.
- **Constraint:** the current session is identified by `$CLAUDE_CODE_SESSION_ID`, never transcript mtime.

## 6. DESIGN DECISION RATIONALE

**Per-run or per-issue?** **Chosen:** per-run for v1 (per-issue runaway = Sentry).

**At-ceiling outcome set?** **Chosen:** `stop | narrow | escalate` at the existing between-units gate.

**Default outcome?** **Chosen:** `stop` (backwards-compatible with `--until`/`--max`).

**Is token spend observable, and how?** Resolved this session. **Chosen:** measure by summing `usage` across the run's transcripts (orchestrator `$CLAUDE_CODE_SESSION_ID.jsonl` + child `agent-*.jsonl` in the run window), baselined at run start; hard-enforced at between-units boundaries.

**Aggregating subagent spend?** Subagent turns are separate `agent-*.jsonl` files (verified, not sidechain). **Chosen:** aggregate child agent files modified ≥ `owner.started_at`; a missed file undercounts but never overcounts (guard-rail semantics).

**Estimate's role?** **Chosen:** fallback only (transcript disabled/missing), always labelled, `tokens_source` recorded.

**Parallel flags or generalise?** **Chosen:** generalise `--until`/`--max` into one `BudgetEnvelope`.

**Where does accounting live?** **Chosen:** fixed budget+outcome contract, swappable accounting producer (matches the issue's slot framing).

**Harness `+Nk` budget directive?** **Assumes:** the harness/container's own budget is a separate outer concern faff does not read; faff's budget is independent. Validate no faff API reads it.

**Transcript availability?** **Assumes:** the session transcript is present/readable (default). Validate the file exists under the resolved config dir; else estimate fallback engages.

**Real CI/compute metering?** **Punt:** needs CI-provider introspection, out of v1; `cost` = tokens × price until then (ties FAFF-12/FAFF-30).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions (Punts).**
- **Real CI/compute metering** — deferred; `cost` = tokens × price for now. Revisit with a CI-introspection story (FAFF-12/FAFF-30).

**Assumptions.**
- **Harness `+Nk` budget is external** — validate no faff/CLI read path; if one exists, reconcile rather than double-count.
- **Transcript present & readable** — validate `<session-id>.jsonl` exists under the resolved (`$CLAUDE_CONFIG_DIR`-aware) dir; else estimate fallback with `tokens_source = estimate`.

## 8. DONE

### From WHY
- [ ] A run can be given a budget across ≥1 dimension and respects it at the between-units gate.
- [ ] Tokens measured from transcript when available; estimate fallback labelled and recorded via `tokens_source`.

### From WHAT
- [ ] `BudgetEnvelope` resolved from flags+config at run start; recorded in ledger `budget` block with `tokens_at_start`; unset = unbounded.
- [ ] `faff budget check` emits `BudgetState` JSON from ledger+config+transcripts, no tracker call.
- [ ] `.faffrc` `budget:` keys read only via `faff config get` (passes `validate-adapters`).
- [ ] `--until`/`--max` still work and override config.

### From HOW
- [ ] Token measurement keys off `$CLAUDE_CODE_SESSION_ID` (never mtime) and aggregates child `agent-*.jsonl` modified ≥ run start.
- [ ] Budget check runs at each existing between-units checkpoint.
- [ ] `stop` reproduces today's behaviour (in-flight finish, "Unreached (budget hit)", `Stop reason = budget-hit(<dims>)`).
- [ ] `narrow` dispatches only the methodology's cheapest remaining subset, falling through to `stop`.
- [ ] `escalate` stops and emits a structured escalation signal.
- [ ] Transcript-disabled path falls to estimate and sets `tokens_source = estimate`.

### From SCENARIOS
- [ ] All three scenarios pass as written.

**Integration smoke test.**
```
Given a beep-boop run with budget.max_attempts = 1
When one build attempt is launched and the next between-units check runs
Then faff budget check returns breached={max_attempts}, outcome=stop, the run ends with Stop reason=budget-hit(max_attempts), and the summary shows the budget as binding
```

## Methodology critique (agile-delivery)

- **Right-sized?** Borderline-large now that transcript token accounting is in scope (sum + child aggregation + baseline). Consider splitting: **(a)** budget contract + observable dims + `stop`; **(b)** transcript token accounting + `narrow`/`escalate`. Flagged, not forced.
- **Workstream fit?** Good — foundational stop-condition leaf; FAFF-38/FAFF-225 are the named consumers.
- **Deps surfaced?** `escalate` is only *useful* once FAFF-225/FAFF-49 consume it; `narrow` leans on methodology `pick-ordering`. No hard blocker — the contract can ship ahead of consumers.
- **Risk profile?** Headline unknown resolved (token observability verified). Residual = child-file aggregation completeness — guard-rail semantics (undercount-not-overcount) keep it low.

confidence: high
