# Spec — FAFF-38: DONE / terminating-condition — what concretely ends an unattended run (refreshed → high)

> Spec: faffter-dark-nlspec · refreshed 2026-06-27 · interactive · confidence: high.

This is the buildable spec for `faff run-done` — the pure predicate that composes faff's already-shipped run signals into the one decision that ends a `/faff-beep-boop` run: `run-complete | continue | escalate`. The **enum + CLI mechanics + safety-floor conjuncts** are the fixed contract; the **weighting/composition policy** is the methodology slot's, with the structural default supplying the v1 ladder.

## 1. WHY

A lights-out factory needs a stop condition or "build it by morning" never terminates. faff already produces every terminating *signal* as a pure CLI — queue state, ledger completeness (`faff runcheck`), budget (`faff budget check`), product-done (`faff prdr coverage` → `prd-satisfied`). What's missing is the **composer**: one pure predicate that folds those signals into a terminal verdict, so the run-end decision is a deterministic, testable function instead of the prose scattered across faff-beep-boop's stopping-condition steps.

**Design principles.**
- **Compose, never reimplement.** `run-done` reads the *outputs* of `faff runcheck` / `budget check` / `prdr coverage`; each signal CLI stays the sole producer of its signal.
- **Pure** — parity with `faff next` / `budget check` / `prdr coverage`: no tracker, no network, no disk beyond the args. **`run-done` never calls the methodology** — the orchestrator resolves the policy and hands it in.
- **Two layers, one fixed / one swappable.** The *mechanical conjuncts* (ledger-clean, budget breach/outcome, queue state, `prd_satisfied`) are facts with a fixed safety floor; the *weighting/precedence* of how they compose is a methodology opinion.
- **Conservative-default forward interface to the judge.** The product conjunct reaches the per-DoD verdicts *transitively* via `prd-satisfied` (conservative `unverified ⇒ not-satisfied`).

## 2. OUT OF SCOPE
- **Producing any underlying signal** — each has a shipped producer; `run-done` only composes their outputs.
- **Evaluating delivery-vs-DoD** — the holdout/evaluator harness; read transitively via `prd-satisfied`.
- **The release-gate `Done` transition** — per-project, consumes `prd-satisfied`; `run-done` is per-*run*.
- **The narrow-subset selection** — the methodology's `pick-ordering`; `run-done` only emits the `continue/budget-narrow` verdict.
- **Authoring the MVP-vs-finished target** — `run-done` consumes it via the `inflection` hook.
- **Mid-issue cancellation** — in-flight units finish naturally; `run-done` decides only whether to *start* more work.

## 3. WHAT — types & interface

**Input — the deterministic signal bundle plus an optional composition policy:**
```
RECORD RunSignals:                       # the FACTS (mechanical; safety floor)
  queue_empty: Bool
  all_parked: Bool
  ledger_clean: Bool           # `faff runcheck --json` → .clean  (admitted − outcomes == ∅)
  budget: BudgetState          # `faff budget check --json` → { breached:[dim…], outcome }
  prd_satisfied: Bool | null   # `faff prdr coverage` → .satisfied; null ⇒ no PRD in scope
  inflection: "reached"|"none" # value/MVP-inflection signal; default "none"
  non_convergence: Bool        # orchestrator: N consecutive no-progress waves; default false
  CONSTRAINT budget.outcome ∈ { stop, narrow, escalate, none }

RECORD TerminationPolicy:                # the WEIGHTING (methodology-owned; optional)
  ladder: [Rung]               # ordered precedence rungs; absent ⇒ built-in structural default
  # a Rung names a conjunct test + (optionally) the verdict it yields when it fires
```

**Output — the fixed terminating-condition contract:**
```
RECORD RunDoneVerdict:
  verdict: "run-complete" | "continue" | "escalate"   # fixed three-valued contract
  reason: String                                       # a stop-reason token (!= "")
  signals: { …the conjuncts that decided it… }         # provenance for the morning brief
  policy_source: "structural-default" | "methodology"  # which weighting decided it
  conformant: Bool ; violations: [String]
  CONSTRAINT verdict ∈ enum AND reason != ""
```
`reason` reuses the existing stop-reason vocabulary: `budget-escalated(<dims>)` · `non-convergence` · `budget-narrow(<dims>)` · `budget-hit(<dims>)` · `value-inflection` · `work-remaining` · `undispatched-ledger` · `product-incomplete` · `drained` · `all-parked`.

**CLI surface.** `faff run-done --queue-empty --all-parked --ledger-clean --budget JSON [--prd-coverage JSON | --no-prd] [--inflection reached|none] [--non-convergence] [--policy JSON] [--json] [--selftest]`. Pure; JSON out; inline in `plugin/skills/faff/bin/faff`; a `run-termination` entry in `CONTRACTS` + `run-termination.schema.json`, `schemaCheck`ed belt-and-braces. `--policy` absent ⇒ the built-in structural-default ladder.

## 4. HOW — the composition ladder

```
PROCEDURE evaluate(signals, policy = structural_default_ladder):
  # --- SAFETY FLOOR (fixed in the CLI; NO policy may weaken these) ---
  breached := signals.budget.breached != [] ; dims := signals.budget.breached.join(",")
  IF breached AND signals.budget.outcome == "escalate":  RETURN escalate,     "budget-escalated("+dims+")"
  IF NOT signals.ledger_clean AND (signals.queue_empty OR signals.all_parked):
                                                          RETURN continue,     "undispatched-ledger"
  IF signals.prd_satisfied == false:                      RETURN escalate,     "product-incomplete"
  # --- POLICY-WEIGHTED rungs (structural default shown; a methodology may reorder/soften these) ---
  1. IF signals.non_convergence:                          RETURN escalate,     "non-convergence"
  2. IF breached AND signals.budget.outcome == "narrow":  RETURN continue,     "budget-narrow("+dims+")"
  3. IF breached AND signals.budget.outcome == "stop":    RETURN run-complete, "budget-hit("+dims+")"
  4. IF signals.inflection == "reached":                  RETURN run-complete, "value-inflection"
  5. IF NOT (signals.queue_empty OR signals.all_parked):  RETURN continue,     "work-remaining"
  6. RETURN run-complete, (signals.queue_empty ? "drained" : "all-parked")
```

**The two layers, explicit:**
- **Safety floor (fixed, never methodology-overridable):** a `budget-escalate`, an unclean ledger at drain (`undispatched-ledger`), and `prd_satisfied == false` (`product-incomplete`). No policy may declare a run complete through these.
- **Policy-weighted rungs (the methodology's `run-termination-policy`):** the precedence of non-convergence / budget-narrow / budget-stop / value-inflection / work-remaining / clean-complete. The structural default is the ladder above; an opinionated lens supplies its own ordering via the named output.

**Why the floor is fixed.** `undispatched-ledger` and `product-incomplete` are the two anti-patterns the whole leash exists to prevent. Repos with **no PRD** (`prd_satisfied == null`) skip the product floor entirely.

## 5. Scenarios
```
Given queue has admissible work, budget unbreached → continue / "work-remaining"
Given queue drained, runcheck clean, budget unbreached, no PRD → run-complete / "drained"
Given budget.breached==["tokens"], outcome=="escalate" → escalate / "budget-escalated(tokens)"  (floor; beats any policy)
Given queue drained, runcheck clean, prd_satisfied==false (PRD in scope) → escalate / "product-incomplete"  (floor)
Given queue drained but runcheck clean==false → continue / "undispatched-ledger"  (floor; never silently complete)
Given an opinionated methodology supplies a run-termination-policy reordering the policy rungs → that ordering decides the non-floor verdict; policy_source=="methodology"
Given no --policy → the built-in structural-default ladder applies; policy_source=="structural-default"
```
- **Assertion:** `evaluate` is pure (no tracker/network/disk beyond args); `run-done` never calls the methodology.
- **Assertion:** no `TerminationPolicy` can alter a safety-floor outcome — selftests pin each floor rung against an adversarial policy that tries to override it.

## 6. Design decision rationale
- **D1 — Decouple from the evaluator. Chosen:** ship now; the product conjunct consumes `prd-satisfied`, conservative-false until the judge lands.
- **D2 — Chosen:** pure composer of `runcheck`/`budget check`/`prdr coverage` outputs; new conjuncts arrive as new input args.
- **D3 — Chosen:** fixed three-valued enum; `reason` carries the existing stop-reason tokens.
- **D4 — Composition home. Chosen:** the precedence ladder is the **structural methodology's `run-termination-policy` named output** (a new Optional output; unanswered ⇒ the CLI's built-in structural-default ladder).
- **D5 — Fixed vs swappable boundary. Chosen:** the **fixed contract** = the verdict enum + the pure CLI mechanics + the **safety-floor conjuncts**. The **swappable** = the policy-weighted rung ordering via the methodology named output.
- **D6 — Product-incomplete: escalate (floor), not complete-and-report. Chosen.**
- **D7 — Target authoring. Chosen:** `run-done` **consumes** the target via the `inflection` hook with a degradable `inflection=none` default.

## 7. Open Questions & Assumptions
- **Open Questions: none.**
- **Assumes (A1):** the per-PRDR DoD verdicts reach `run-done` **transitively** via `faff prdr coverage`'s `prd-satisfied` (conservative `unverified ⇒ not-satisfied`); `run-done` never reads the evaluator directly.
- **Assumes (A2):** a "done target" exists eventually; until then the degradable default is per-run drain semantics. With no target and no PRD, `run-done` reproduces today's queue/budget/ledger behaviour.

## 8. DONE
- [ ] `faff run-done` exists inline in `plugin/skills/faff/bin/faff`, pure, with `--selftest` and `--json`.
- [ ] Inputs: the closed-vocabulary `RunSignals` bundle + optional `--policy JSON`; malformed JSON → exit 2; `--policy` absent ⇒ built-in structural-default ladder.
- [ ] Output `RunDoneVerdict {verdict, reason, signals, policy_source, conformant, violations}`; `verdict ∈ {run-complete, continue, escalate}`; `reason != ""`.
- [ ] A `run-termination` entry in `CONTRACTS` + `run-termination.schema.json`; verdict `schemaCheck`ed before print.
- [ ] **Safety floor is fixed:** budget-escalate, undispatched-ledger, product-incomplete hold regardless of `--policy`; an adversarial-policy `--selftest` per floor rung is pinned to fail to override.
- [ ] **Policy-weighted rungs:** non-convergence / budget-narrow→continue / budget-stop→complete / value-inflection→complete / work-remaining→continue / drained|all-parked→complete each covered by a `--selftest` fixture under the structural-default ladder.
- [ ] **`run-termination-policy` named output:** `faffter-noon-methodology-structural` answers it with the v1 ladder; it is an **Optional** methodology output (unanswered ⇒ CLI structural default). Gateway methodology named-output set gains `run-termination-policy` (Optional).
- [ ] `run-done` reads `prd-satisfied` only; never reads the evaluator directly (A1).
- [ ] With no PRD, no inflection, and no `--policy`, `run-done` reproduces today's queue/budget/ledger behaviour (A2).
- [ ] **Integration smoke:** run `faff budget check`/`faff runcheck`/`faff prdr coverage`, feed their JSON to `faff run-done`; assert drained→`run-complete/drained`, `--no-ledger-clean`→`continue/undispatched-ledger`.

confidence: high
