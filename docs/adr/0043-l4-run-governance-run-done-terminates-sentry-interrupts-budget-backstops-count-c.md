# ADR 0043 — L4 run governance: run-done terminates, Sentry interrupts, budget backstops, count-caps banned

- **Status:** Proposed
- **Date:** 2026-07-04
- **Issue:** FAFF-312

## Context

An unbounded L4 (lights-out) run has no operator watching it, so *something* has to decide when it stops. Three distinct questions hide behind "stop": is the work **done**, has the run gone **wrong**, and has it gone **rogue** on spend? Each wants a different governor, and faff already ships all three — run-done (doneness: both bottom-up tributaries dry ∧ PRD satisfied), Sentry (derailment: thrash, staleness, repeated-identical-failure), and budget (a spend/time envelope). The problem is what was *wired*: `faff lights-out` preflight accepted `max_attempts` alone as the mandatory "budget ceiling set" precondition, Sentry was a shipped, tested evaluator that no dispatch loop ever called, and run-done was consulted only under `--converge`.

A ticket count answers none of the three questions. Count is uncorrelated with project size or doneness — a small project sliced into micro-tasks yields more tickets than a large one in coarse epics — so a count is unplannable as a completion signal, and stalling a *healthy* run at attempt N defeats the entire point of L4. `max_attempts` is an L3 cost idiom ("do at most N tonight"), not an L4 completion mechanism. Yet the shipped defaults steered operators toward exactly that wrong governor while the right ones sat unwired. Both preconditions for a safe change already hold: the fail-closed floor (never launch a *truly* unbounded run) is non-negotiable, and every governor named here is a shipped CLI, so the fix is wiring and defaults, not new subsystems.

## Decision

**At L4, run-done terminates by doneness, Sentry interrupts on derailment, budget is a spend/time backstop, and count-caps are banned as the sole L4 governor.** The three-way division of labour is explicit: run-done ends a run because the work is *finished*, Sentry stops a run going *wrong* mid-flight, budget catches a run gone *rogue* on spend/time. `max_attempts` is demoted — legal as an extra backstop, never sufficient as the L4 ceiling.

Nine decisions settle the model (all closed in the FAFF-312 spec):

1. **Refuse, don't warn.** L4 lights-out preflight *refuses* to mint when no spend/time dimension is set — consistent with every other fail-closed preflight gate, not merely advisory against the operator error.
2. **Spend/time dimension defined.** `tokens` and `until` always qualify; `cost` only when `price_per_mtok > 0`, because an unpriced cost ceiling never breaches and a vacuous ceiling must not satisfy a fail-closed floor.
3. **`at_ceiling` default is level-scoped.** Mint `escalate` when config leaves it unset; honour an explicit value (including `stop`) verbatim — human-explicit config outranks the level default, mirroring the level-scoped-appetite precedent (ADR-0037).
4. **The L4 default lives at mint-time**, written into the run-ledger envelope — not the level-blind `DEFAULTS` registry (which would flip L3 too and churn `config defaults --selftest`). `faff budget check --run-dir` already prefers the ledger envelope, so the default binds for the whole run.
5. **The Sentry consult runs on every beep-boop run** at every dispatch boundary (shared telemetry, and the calibration feed for thresholds) — but **only lights-out-minted (L4) runs act** on the intervention; non-L4 runs log and surface the verdicts advisorily. Forking the *consult itself* on level would drift the shared loop prose; only the *handling* is mint-scoped. Evaluator-down handling is mint-scoped the same way — L4 fails closed, non-L4 is advisory.
6. **`pause` parks the implicated issue(s)** (thrash and repeated-failure are issue-scoped) via the shared park protocol and continues the rest of the queue.
7. **Every lights-out-minted run consults run-done at run-end** regardless of `--converge` — a terminator that only fires behind a flag is not a terminator. `--converge` remains only the within-run convergence loop; plain L3 termination is untouched.
8. **No budget-stop policy rung change** — under the L4 `escalate` default the `stop`→`run-complete` rung is unreachable, and when an operator explicitly sets `stop`, "budget-hit → run-complete" is exactly what they asked for.
9. **One ADR**, because the decision is one three-way division of labour; splitting fragments the rationale.

The un-subvertability of the interrupt rests on **consume, never re-derive**: the loop calls the shipped CLIs (`faff sentry check`, `faff run-done`, `faff budget check`) and reimplements no governor math in orchestrator prose. The interrupt is trustworthy precisely because it is evaluated by a CLI outside the supervised context. This composes ADR-0034's dispatch-boundary kill-switch (Sentry-1) and ADR-0036's lights-out runner; corrective authority (the `correct` rung, ADR-0039's GO-narrow) is treated as a known-shape future rung, not wired here.

## Consequences

- **`max_attempts` alone can no longer launch a lights-out run.** Operators who set only a count get a `budget-ceiling` refusal whose detail names the spend/time remedy. A `max_attempts` alongside a spend/time dimension proceeds unchanged, so the demotion costs existing correctly-configured runs nothing. The five `docs/external-verification/scaffold-p*.sh` configs all already set `budget.tokens`, so none break.
- **An L4 backstop breach now surfaces as a morning needs-human, not a silent stop.** The mint-time `escalate` default routes a breach through Sentry's `budget-breach` signal and run-done's fixed-floor `budget-escalated` rung → structured escalation. This is intended: a backstop binding on an L4 run *is* an anomaly worth surfacing. Operators who want L3's quiet stop set `at_ceiling: stop` explicitly.
- **L3 semantics are unchanged by construction.** Plain beep-boop keeps queue-emptiness termination, `--converge` opt-in, `at_ceiling` default `stop`, and `max_attempts` as a first-class cost idiom. The only L3-visible addition is the advisory Sentry consult's log/summary lines — which double as the calibration corpus that must exist before acting on interventions at L3 could ever be considered (a deliberate later step, out of scope here).
- **Sentry false-positives cost a paused night, not lost work** — aborts are `aborted-resumable` by design; the remedy for a disputed abort is threshold tuning (`sentry.*`), not a model change.
- **The dispatch-boundary consult adds a small per-boundary cost** (fs reads + one child `budget check`). Expected negligible; if run logs show boundary latency, the consult narrows to wave boundaries only at the same wiring point.
- **Future extension points are named, not built:** a spend-*rate* derailment trigger slots into `DERAILMENT_SIGNALS`; the `correct` intervention slots into the same mint-scoped dispatch branch this decision adds; promoting non-L4 Sentry acting is a config/branch change once calibration data exists. This slice ships stop-only.

*Self-review (against what shipped):* the Consequences track the delivered change — a preflight predicate swap, a mint-time envelope default, and two CLIs wired into the loop prose; no new subsystem. The "L3 unchanged" claim is the load-bearing one and is pinned by the spec's second assertion and the beep-boop test path; the "scaffolds unbroken" claim is verifiable against the five scaffold configs. Both are checkable, not aspirational.

confidence: high
