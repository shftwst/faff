# FAFF-312 — L4 governance: run-done terminates, Sentry interrupts, budget backstops (count-caps banned as L4 governors)

> Spec: faffter-dark-nlspec · 2026-07-03 · interactive · confidence: high.

This spec settles the governance model for unbounded L4 (lights-out) runs and specifies the wiring that enforces it. Audience: the build agent and human reviewers. Type: governance decision + wiring slice (the spike question in the ticket is answered here; the deliverable is the settled model, an ADR, and the concrete changes).

*Revised on 2026-07-03 — spec-review `revise` verdict (QA major: the L3-unchanged assertion was untestable as written; architectural minor: L3 action semantics unowned). Sentry actions are now explicitly mint-scoped: L4 acts, non-L4 is advisory.*

## 1. WHY — problem and principles

**The load-bearing model.** An unbounded L4 run needs three governors doing three different jobs: **run-done** decides the run is *finished* (doneness — both tributaries dry ∧ PRD satisfied), **Sentry** decides the run has gone *wrong* (derailment — thrash, staleness, repeated failure), and **budget** decides the run has gone *rogue* (runaway spend/time). A ticket-count cap does none of these jobs — count is uncorrelated with project size or doneness, and stalling a healthy run at attempt N defeats the point of L4 — so at L4 a count stops qualifying as a governor.

**Problem.** Today `faff lights-out` preflight accepts `max_attempts` alone as the mandatory "budget ceiling set" precondition; Sentry is a shipped, tested evaluator that no dispatch loop ever calls; and run-done is consulted only under `--converge`. The shipped defaults therefore steer an operator toward exactly the wrong governor (a count) while the right governors sit unwired.

**Design principles:**

- **Fail-closed floor stays.** Never launch a *truly* unbounded unattended run. What changes is what satisfies the floor: a spend/time ceiling, never a tally.
- **Consume, never re-derive.** The loop calls the shipped CLIs (`faff sentry check`, `faff run-done`, `faff budget check`); no governor logic is reimplemented in orchestrator prose. The un-subvertable-by-construction claim (Sentry evaluated outside the supervised context) rests on this.
- **Demote, don't remove.** `max_attempts` stays a legal envelope dimension — a first-class L3 cost idiom and a harmless extra backstop at L4. It just can't be the *sole* L4 ceiling.

**Reference context:**

| Surface | Location | Relevance |
|---|---|---|
| Lights-out preflight + mint | `plugin/skills/faff/bin/faff` (`lightsOutPreflight`, `cmdLightsOut`, ~L11515–11749) | The budget-ceiling precondition + minted ledger envelope this spec changes |
| Budget envelope | same file (`envelopeFrom` ~L2242, `envelopeFromLedger` ~L2492, `computeBudgetState` ~L2265) | `at_ceiling` default; ledger envelope is preferred for `--run-dir` checks (~L2450) |
| Sentry evaluator | same file (`cmdSentry`, `evaluateDerailment`, ~L8778–9130) | The already-shipped interrupt this spec wires into the loop |
| run-done predicate | same file (`computeRunDoneVerdict` ~L2672) | The already-shipped terminator; fixed floor already escalates on `at_ceiling: escalate` breach |
| Dispatch loop | `plugin/skills/faff-beep-boop/SKILL.md` (between-units checkpoints ~L58–88, wave steps 8.1/8.5 ~L172–183) | Where the sentry consult and the run-done consult land |
| ADRs 0034 / 0036 / 0037 | `docs/adr/` | Dispatch-boundary kill-switch intent; lights-out runner; level-scoped-appetite precedent for a level-scoped default |

**Scope:** the governance layer of the L4 runner and the beep-boop dispatch loop. No new subsystems — every mechanism named already ships; this slice changes one preflight predicate, one mint-time default, and wires two existing CLIs into the loop prose.

## 2. OUT OF SCOPE

- **Corrective intervention (`correct`)** — the redirect channel is the FAFF-278 (Sentry-2) spike. Extension point: the `SIGNAL_TRIP_INTERVENTION` map plus the dispatch-boundary branch this spec adds (a fourth intervention would slot into the same branch).
- **A spend-rate derailment trigger** (tokens/hour, distinct from absolute breach) — Sentry signal-set evolution. Extension point: a new member of `DERAILMENT_SIGNALS` + `SENTRY_THRESHOLD_DEFAULTS`.
- **Acting on sentry interventions in non-L4 runs** — this slice logs and surfaces sentry verdicts advisorily outside L4; promoting them to acting interrupts at L3 is a deliberate later step once thresholds have calibration data. Extension point: the mint-scoped branch in the dispatch-boundary procedure (section 4C).
- **run-done rung reweighting** — the policy ladder is already methodology-owned (`run-termination-policy` named output); no rung changes here (see decision rationale).
- **L3 semantics** — plain beep-boop keeps queue-emptiness termination, `--converge` opt-in, `at_ceiling` default `stop`, and `max_attempts` as a first-class cost idiom.
- **Reverting the repo's temporary Fable-week `.faffrc.yaml` budget values** — operator config, not code. (That edit is evidence the target model is already wanted; this spec makes it the documented posture rather than a hand-edit.)

## 3. WHAT — vocabulary and shapes

**Vocabulary:**

| Term | Definition |
|---|---|
| Terminator | The governor that ends a run because the work is *done* (`faff run-done`) |
| Interrupt | The governor that stops a run going *wrong* mid-flight (`faff sentry`) |
| Backstop | A generous spend/time ceiling that should rarely bind (`faff budget`) |
| Count-cap | A tally ceiling (`max_attempts`) — legal as a backstop, banned as the sole L4 governor |
| Spend/time dimension | `tokens`, `until`, or `cost` *when priced* (`price_per_mtok > 0`) |
| L4 run | A run whose ledger was minted by `faff lights-out` |

**The preflight predicate** (replaces the current any-dimension `.some(v != null)`):

```
FUNCTION spendTimeCeilingSet(envelope):
  RETURN envelope.ceilings.tokens != null
      OR envelope.ceilings.until  != null
      OR (envelope.ceilings.cost != null AND envelope.price_per_mtok > 0)
  # cost with price_per_mtok == 0 is inert (never breaches) — a vacuous
  # ceiling must not satisfy a fail-closed precondition
```

**The minted envelope:** when `budget.at_ceiling` is unset in config, `faff lights-out` mints the run-ledger envelope with `at_ceiling: "escalate"`. An explicitly configured value is written verbatim.

**The dispatch-boundary consult:** prose wiring in the beep-boop loop (section 4C) — `faff sentry check` output `{ verdicts, intervention ∈ continue|pause|abort, tripped }`. The consult runs on every beep-boop run; **acting on the intervention is mint-scoped** — an L4 run acts, a non-L4 run logs and surfaces advisorily.

## 4. HOW — behaviour

### A. Preflight: ban count-cap-only ceilings at L4

In `cmdLightsOut`, compute `spendTimeCeilingSet` (above) instead of the any-dimension check. On refusal the detail names the remedy:

```
gate: "budget-ceiling"
detail: "count-cap only (or no ceiling) — a count is not an L4 governor; set a
spend/time ceiling: budget.tokens, budget.until / --until, or budget.cost with
price_per_mtok > 0. max_attempts may stay as an extra backstop."
```

A `max_attempts`-only envelope refuses. A `tokens`-only envelope proceeds. `max_attempts` alongside a spend/time dimension proceeds unchanged.

### B. Mint-time `at_ceiling` default

At mint, if `budget.at_ceiling` resolves unset → write `escalate` into the minted ledger envelope; explicit config wins verbatim. Because `faff budget check --run-dir` prefers the ledger envelope (`envelopeFromLedger`), the default binds for the whole run with no change to the L3 `DEFAULTS` registry (and therefore no `config defaults --selftest` churn).

**Behaviour at the ceiling under the L4 default:** a breach produces `outcome: "escalate"`, which (i) trips Sentry's `budget-breach` signal and (ii) hits run-done's *fixed floor* rung 1 (`budget-escalated`) → structured needs-human, never a silent stop mid-project.

### C. Sentry at the dispatch boundary

At every existing between-units checkpoint (after every prep return, after every build return / before every launch, at every wave boundary — the same sites the budget check already runs), the orchestrator additionally runs `faff sentry check --json --run-dir <run-dir>` and handles the result **by mint**:

```
PROCEDURE dispatch_boundary_sentry(run_dir):
  1. result = faff sentry check --json --run-dir run_dir
  2. IF the command itself fails (non-zero exit, unparseable output):
     a. L4 run (lights-out-minted ledger): stop dispatching, surface
        needs-human — "kill-switch evaluator down" (fail closed: an L4 run
        whose interrupt is dead must not keep launching)
     b. non-L4 run: log the failure, continue (advisory)
  3. Non-L4 run: log the verdicts, surface any trip in the run summary,
     take NO dispatch action — L3 dispatch behaviour is unchanged; the
     consult is shared telemetry only
  4. L4 run, intervention == "continue" → proceed
  5. L4 run, intervention == "pause"    → park the implicated issue(s) — the
     verdict evidence names them (thrash and repeated-failure are
     issue-scoped) — via the shared park protocol; continue the rest of
     the queue
  6. L4 run, intervention == "abort"    → run `faff sentry abort --run-dir …`
     (marks the ledger aborted-resumable), launch nothing further, surface
     the verdicts in the run summary
```

**Anti-pattern:** forking the *consult itself* on "is this an L4 run". Why: the checkpoints are shared prose; a consult fork drifts. The consult always runs — only the *handling* (steps 2–6) is mint-scoped.
**Anti-pattern:** re-implementing any trigger math (attempt counting, heartbeat staleness) in loop prose. Why: the interrupt is trustworthy precisely because it is evaluated by a CLI outside the supervised context.

### D. run-done as the L4 terminator

A lights-out-minted run **always** consults `faff run-done` (live signals + the methodology's `run-termination-policy` ladder, exactly as the existing `--converge` step does) before declaring itself complete — with or without `--converge`. Verdict `run-complete` → end normally; `continue` → keep draining (or enter the convergence pass when enabled); `escalate` → needs-human in the run summary. Plain (non-lights-out) beep-boop termination is unchanged.

### E. Prose demotion

The beep-boop budget section reframes `max_attempts`: a launch-counted **backstop**, never a terminator for an L4 run; example envelopes show `tokens`/`until` as the primary ceiling. (Per the prose rules, the SKILL.md edits state the model forward — no ticket refs.)

### F. Docs in the same PR

- `.faffrc.example.yaml` gains `budget:` and `sentry:` blocks (all keys, defaults, and the L3-vs-L4 `at_ceiling` guidance) — today neither is documented there at all.
- `docs/cli.md`: `lights-out` entry documents the spend/time precondition; `budget`/`sentry`/`run-done` entries updated where behaviour changed.
- `docs/architecture/l3-l4-architecture.svg`: the L4 governance badge already states this model — verify it matches the shipped behaviour; the L3 badge (`at_ceiling: stop`) stays.

### G. ADR

Record one ADR at graft time (via `faff adr new`; renumber to `faff adr next-number` at branch time): *at L4, run-done terminates by doneness, Sentry interrupts on derailment, budget is a spend/time backstop, and count-caps are banned as governors.*

### Failure modes

- **Sentry false-positives abort healthy runs.** Observable: `aborted-resumable` ledgers whose verdicts a human disputes next morning. Meaning: tune `sentry.*` thresholds, not the model — aborts are resumable by design, so the cost is a paused night, not lost work. The advisory non-L4 consult doubles as the calibration feed for those thresholds.
- **Escalate-by-default turns overnight breaches into morning needs-human** instead of a quiet stop. Intended: a backstop binding on an L4 run *is* an anomaly worth a structured escalation. Operators who want L3's quiet stop set `at_ceiling: stop` explicitly.
- **Per-boundary sentry cost is non-zero** (fs reads + one child `budget check`). Expected negligible; if run logs show boundary latency, narrow the consult to wave boundaries only — the wiring point is the same.

## 5. SCENARIOS

```
Given .faffrc sets only budget.max_attempts
When  faff lights-out preflight runs
Then  it refuses with gate "budget-ceiling" and the detail names the spend/time remedies

Given budget.tokens is set and at_ceiling is unset
When  faff lights-out mints the run
Then  preflight proceeds and the minted envelope carries at_ceiling: "escalate",
      and faff budget check --run-dir reports outcome "escalate" on breach

Given budget.at_ceiling: stop is explicitly configured
When  faff lights-out mints the run
Then  the minted envelope keeps "stop"

Given a lights-out-minted run mid-drain where faff sentry check returns
      intervention "abort"
When  the orchestrator reaches the next dispatch boundary
Then  no further build launches, faff sentry abort marks the ledger
      aborted-resumable, and the run summary surfaces the verdicts

Given a lights-out-minted run where sentry returns "pause" on
      fix-review-thrash scoped to one issue
When  the orchestrator reaches the next dispatch boundary
Then  that issue parks via the park protocol and the rest of the queue continues

Given a plain (non-lights-out) beep-boop run where sentry returns a trip
When  the orchestrator reaches the next dispatch boundary
Then  the verdicts are logged and surfaced in the run summary and no dispatch
      action is taken (advisory)

Given a lights-out run without --converge whose queue has drained
When  the run would end
Then  faff run-done is consulted and its verdict — not bare queue-emptiness —
      decides run-complete vs escalate
```

Assertions (non-functional):
- All five `docs/external-verification/scaffold-p*.sh` configs pass the new preflight unmodified (each already sets `budget.tokens`).
- Plain L3 beep-boop **dispatch and termination semantics are unchanged**: no new refusals, `at_ceiling` default `stop`, queue-emptiness termination, and sentry verdicts are logged + surfaced only (never acted on) outside L4. The only L3-visible addition is the advisory consult's log/summary lines.

## 6. DESIGN DECISION RATIONALE

**Ban or warn when the only ceiling is a count-cap?** Warn keeps flexibility but is advisory against the precise operator error the ticket names; refuse is consistent with every other preflight gate (fail-closed, mint nothing). **Chosen:** refuse at L4 when no spend/time dimension is set.

**What counts as a spend/time dimension?** `tokens` and `until` always; `cost` only when `price_per_mtok > 0`, because unpriced cost never breaches (the existing envelope selftest pins that) and a vacuous ceiling must not satisfy a fail-closed floor. **Chosen:** the `spendTimeCeilingSet` predicate in section 3.

**Force or default `at_ceiling: escalate` at L4?** Appetite is *forced* `full` at L4 (level-scoped), but `at_ceiling` carries real operator semantics — an explicit `stop` is a legitimate "quietly end the night at the ceiling" choice, and human-explicit config outranks the dial. **Chosen:** level-scoped *default* — mint `escalate` when unset, honour an explicit value verbatim.

**Where does the L4 default live — `DEFAULTS` registry or mint time?** The registry is level-blind (it would flip L3 too, and churn `config defaults --selftest`); the minted ledger envelope is already the authoritative envelope for `--run-dir` checks. **Chosen:** mint-time, written into the run-ledger envelope.

**Consult Sentry on all runs or L4 only? And who acts?** The checkpoints are shared loop prose, so forking the consult drifts — but *acting* on interventions at L3 would change L3 dispatch semantics inside an L4-scoped ticket, on thresholds with no calibration data yet. **Chosen:** the consult runs at every between-units checkpoint on every beep-boop run (shared telemetry, and the calibration feed for thresholds); **only lights-out-minted runs act** on the intervention — non-L4 runs log + surface the verdicts advisorily. Evaluator-failure handling is mint-scoped the same way (L4 fail-closed, non-L4 advisory).

**What does `pause` mean operationally (at L4)?** The pause-mapped triggers (thrash, repeated-identical-failure warn tier) are issue-scoped, and the park protocol is the existing issue-scoped stop. **Chosen:** park the implicated issue(s), continue the queue.

**run-done for all L4 runs or keep it `--converge`-gated?** A terminator that only fires when a flag is passed is not a terminator; the model makes doneness the primary governor. **Chosen:** every lights-out-minted run consults run-done at run-end; `--converge` remains only the within-run convergence loop, and plain L3 termination is untouched.

**Change the `budget-stop` policy rung (currently → `run-complete`)?** Under the L4 default the rung is unreachable (breaches arrive as `escalate` → fixed floor); when an operator *explicitly* sets `stop`, "budget-hit → run-complete" is exactly what they asked for. **Chosen:** no rung change.

**One ADR or several?** The decision is one three-way division of labour; splitting it fragments the rationale. **Chosen:** a single ADR recorded at graft time.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none — every decision above is closed.

**Assumptions:**

- **Assumes:** `envelopeFromLedger` gives the minted ledger envelope precedence over freshly-resolved config for `--run-dir` budget checks. Validate before build: read `envelopeFromLedger` (~`bin/faff:2492–2510`); if fresh config wins any field, apply the mint-time default inside that merge as well.
- **Assumes:** `faff sentry check --json --run-dir` is report-only (exit 0) with `intervention` in the payload — verified at write time (~L9105).
- **Assumes:** every external-verification scaffold sets `budget.tokens` — verified at write time (p1–p5 all do), so the tightened precondition breaks none of them.

## 8. DONE

### From WHY
- [ ] A `max_attempts`-only envelope cannot launch a lights-out run; a `tokens`/`until` (or priced-`cost`) envelope can.

### From HOW A–B (CLI)
- [ ] `lightsOutPreflight` uses the spend/time predicate; the refusal detail names the remedies; `test/lights-out.test.mjs` + `lightsOutSelftest` cover the count-cap-only refusal, the tokens-only proceed, and the unpriced-cost refusal.
- [ ] The minted envelope carries `at_ceiling: escalate` when config leaves it unset and the explicit value otherwise; a test asserts `faff budget check --run-dir` reflects the minted value.

### From HOW C (loop wiring)
- [ ] The beep-boop between-units checkpoint runs `faff sentry check` alongside the budget check, with the mint-scoped handling: L4 acts (pause → issue park; abort → `faff sentry abort` + no further launches; evaluator down → fail closed), non-L4 logs + surfaces advisorily and takes no dispatch action.
- [ ] No trigger math is re-implemented in loop prose (review check).

### From HOW D
- [ ] A lights-out-minted run consults `faff run-done` at run-end regardless of `--converge`; the plain-L3 default path is unchanged.

### From HOW E–G (prose, docs, ADR)
- [ ] beep-boop budget prose reframes `max_attempts` as a backstop, never an L4 terminator.
- [ ] `.faffrc.example.yaml` gains `budget:` + `sentry:` blocks; `docs/cli.md` updated in the same PR.
- [ ] The architecture SVG's governance badges match shipped behaviour.
- [ ] The ADR is recorded at graft (`faff adr new`, renumbered at branch time) capturing terminator / interrupt / backstop + the count-cap ban.

### Eval seam
- [ ] Seam disposition declared: the new wiring branches deterministically on CLI verdicts — `judgement_seam: none` for this slice, no new grader KIND.

### Scenarios
- [ ] All section-5 scenarios pass; both assertions hold (scaffolds unmodified; L3 dispatch/termination semantics unchanged, advisory-only sentry outside L4).

### Integration smoke test

```
1. .faffrc budget: { max_attempts: 40 }         → faff lights-out  → refused, gate "budget-ceiling"
2. add budget.tokens                            → faff lights-out  → proceeds; ledger envelope.at_ceiling == "escalate"
3. force a breach fixture                       → faff budget check --run-dir → outcome "escalate"
4. faff run-done --queue-empty --ledger-clean --budget '<that JSON>' → verdict "escalate", reason "budget-escalated(…)"
5. faff sentry check --run-dir                  → budget-breach verdict, intervention reflects the trip
```

confidence: high
spec-review: approve
