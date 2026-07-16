# Spec — FAFF-496: When does a run plan? (run-start trigger semantics)

> Spec: faffter-dark-nlspec · 2026-07-16 · autonomous · confidence: high. Full spec on Linear FAFF-496.

A **spike** spec for FAFF-496, the de-risk lead of "Self-starting plans." A spike's DONE is *the decision recorded + the contract shape specified + fixtures the consumers (FAFF-497/498) build to*. Blocker FAFF-494 shipped (PR #401), so 496 is fully unblocked.

## 1. WHY

**Run-start is the mirror of `run-done`.** faff ships a *terminating* predicate — `faff run-done` (composes `queue_empty`/`ledger_clean`/`budget`/`prd_satisfied` → `run-complete | continue | escalate` over a fixed floor). This spike defines the *starting* predicate — `faff run-start` — composing **target resolution + ADR-0069 outward-only + `prd-readiness` + coverage** → `plan | drain | refuse` over a **fixed refusal-biased floor**. Same producer/consumer/validator idiom, opposite end: `run-done` fails toward `escalate`; `run-start` fails toward `refuse`.

**Problem.** faff can *execute* a backlog (drain) and, since FAFF-494, *decompose* an admissible PRD (`/faff-plot --autonomous`) — but nothing decides *which a run should do at its start*. That's the last human act at the top of the loop.

**Principles** (rejection-worthy if violated):
- **Refusal-biased floor.** `plan` is the most privileged output; under *any* uncertainty (unresolved target, ambiguous PRD, non-conformant admissibility, unmeasurable coverage) → `refuse` (the same fail-safe direction `prd-readiness` and `faff contain` already take).
- **Decompose-only.** `plan` authorises decomposing *the resolved admissible PRD* only; no admissible PRD ⇒ the predicate structurally cannot emit `plan`.
- **Outward-only (ADR-0069).** A target resolving to faff's own container (no PRD by construction) is `refuse / self-directed`, never a "fix the missing PRD" finding.
- **Compose, re-implement nothing.** Each input has one shipped producer (`faff contain`, the `prd` slot → `faff contract prd-readiness`, `faff prdr coverage`); the predicate reads their verdicts.

## 2. OUT OF SCOPE
- **Outward-only *mechanism*** → FAFF-521 (the `faff contain`-based inward detection); this spike owns the `self-directed` *row + ordering*, 521 supplies the check. Extension point: `signals.outward`.
- **Per-level plot gate answers** → shipped in FAFF-494. Invoked *after* a `plan` verdict.
- **Run-end / convergence read** → `faff run-done`'s `prd_satisfied` floor (unchanged). This reads the *decomposition* face at run-start.
- **Numeric coverage %/ratio** → the substrate emits boolean `covered` + uncovered-goal set, not a fraction; ratio is a future refinement (Open Questions).

## 3. WHAT — Contract shapes

### 3a. Coverage signal (FAFF-497 produces; FAFF-498 + `run-done` consume)
FAFF-497 is pure composition — **reuse the `prd-coverage` verdict verbatim** as the signal + one **additive, non-gating** `measure` block:
```
RECORD CoverageSignal:                # = prd-coverage verdict + additive measure
  covered: Boolean                    # every PRD goal has ≥1 live PRDR — the run-START read
  uncovered_goals: List<String>
  satisfied: Boolean                  # covered AND every live PRDR DoD met — the run-END read (FAFF-38 floor)
  completion: { all_met, unmet_or_unverified }
  measure: { total_goals: Int, covered_goals: Int }    # ADDITIVE, non-gating in v1 (observability + future ratio)
  CONSTRAINT covered == (uncovered_goals is empty)      # DoD-derived threshold
  CONSTRAINT satisfied ==> covered
```
Run-start reads `.covered`; run-end keeps reading `.satisfied` (unchanged wiring).

### 3b. Run-trigger verdict (FAFF-498 produces + consumes)
New contract schema **`run-trigger`** (not `run-start` — that already names an events.jsonl `type`), produced by a new pure CLI `faff run-start`, validated by `faff contract run-trigger` (Pattern-B, re-derives from signals, fail-safe → `refuse`), mirroring `run-termination` field-for-field. Closed `verdict × reason`:

| verdict | reason | Fires when |
|---|---|---|
| `plan` | `coverage-thin` | outward + admissible PRD + coverage measurable + `covered==false` |
| `drain` | `prd-covered` | outward + admissible PRD + coverage measurable + `covered==true` |
| `drain` | `no-prd-nothing-to-plan` | outward target, no PRD present |
| `refuse` | `no-target` | no target resolvable |
| `refuse` | `self-directed` | inward / faff's own container (ADR-0069; mechanism = FAFF-521) |
| `refuse` | `prd-ambiguous` | multiple Active/Frozen PRDs, not disambiguable |
| `refuse` | `prd-inadmissible` | `prd-readiness` not-ready, or its contract exits 1/2 |
| `refuse` | `coverage-unmeasurable` | PRD admissible but coverage fails to compute / malformed |

## 4. HOW — the ladder (refusal-bias order, first-failing-check-wins)
```
1. target empty                          → refuse / no-target
2. contain check inward (FAFF-521)       → refuse / self-directed        # ADR-0069, BEFORE PRD checks
3a. multiple Active/Frozen PRDs          → refuse / prd-ambiguous
3b. no PRD present                       → drain  / no-prd-nothing-to-plan
4. prd-readiness != admissible or exit1/2→ refuse / prd-inadmissible     (fail-safe)
5a. coverage unmeasurable/malformed      → refuse / coverage-unmeasurable (fail-safe)
5b. coverage.covered == false            → plan   / coverage-thin
5c. coverage.covered == true             → drain  / prd-covered
```
**Ordering is load-bearing:** the outward floor (2) precedes PRD checks so inward+no-PRD is `self-directed` (faff's own container) while outward+no-PRD is a benign `drain` — running admissibility first would misclassify faff's empty-PRD container as a drain, the exact silent self-direction ADR-0069 forbids.

**Call-site:** extends beep-boop §0a's binary PROCEED/REFUSE into three-way PLAN/drain/refuse (outward floor prepended, coverage split appended). FAFF-498 wires it; the L4 lights-out path consumes it (ordinary L3 unchanged).

**Anti-patterns:** coercing unmeasurable coverage to `drain` (→ must `refuse`); re-checking outward-ness instead of consuming FAFF-521's `signals.outward`; treating `plan`-then-mid-recursion-refuse as two policies (the plot HALT handles branch-not-derivable within the mandate).

## 5. Scenarios (born-verifiable)

> 3 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

- outward + admissible PRD + a goal with no live PRDR → `plan / coverage-thin`, `coverage.covered==false`.
- outward + admissible PRD + every goal has a live PRDR → `drain / prd-covered`.
- target = faff's own container → `refuse / self-directed` *before* any PRD/admissibility check.
- `faff contract run-trigger` re-derives `verdict`+`reason` from `signals`, rejecting a hand-altered verdict (Pattern-B).

## 6. Decision rationale
- **Threshold = DoD-derived** (not absolute/ratio): `faff prdr coverage` emits boolean `covered = (no uncovered goals)` + `uncovered_goals[]`, no numeric measure — an absolute floor is ungrounded, a ratio has no fraction to threshold. **Chosen:** denominator = the PRD's declared goals; threshold = `covered==true`; "below threshold" = ≥1 undecomposed goal.
- **Trigger reads `.covered`, not `.satisfied`:** `run-done` consumes `.satisfied` at run-end; reading it at run-start would refuse to plan a fully-undecomposed PRD. The two predicates read complementary faces of one signal.
- **Closed refusal taxonomy** bound 1:1 to `plan|drain|refuse`, fail-safe → `refuse`, mirroring run-done's canonical reasons.
- **`run-trigger` mirrors `run-termination`** field-for-field (least new surface); schema name distinct from the `run-start` event type.
- **Coverage signal reuses `prd-coverage`** + additive `measure` (no new spine — FAFF-497's own framing).
- **FAFF-521 boundary:** 496 owns taxonomy + `self-directed` row + ordering; 521 owns the outward *mechanism*; consumed once as `signals.outward` (no double-gating) — exactly 521's own framing.

## 7. Open Questions & Assumptions
- **Punt: numeric ratio-tolerance knob (drain when ≥X% covered even if not all)? (decides: product)** — DoD-derived all-or-nothing is the grounded v1; a ratio is a product call about how eagerly the loop plans vs builds, unsettleable from the codebase (no fraction in the substrate, no eagerness signal). **Non-blocking:** the additive `measure` block reserves its home, and the thrash it guards is already caught by `run-done`'s non-convergence backstop. FAFF-497 owns *where the threshold parameter lives* if taken.
- **Assumes:** `/faff-plot --autonomous` (FAFF-494) is the `plan` executor, self-minting its L4 ledger (verified shipped, PR #401).
- **Assumes:** target resolved `explicit > inherited > methodology-default` (FAFF-521's; this spike only needs `signals.target_resolved`).
- **Assumes:** `faff prdr coverage` can extract declared goals (admissible PRDs have born-verifiable stop-conditions; `coverage-unmeasurable` is the fail-safe otherwise).

## 8. DONE
- [ ] Decision recorded as a decision table: every §3b row has a fixed `verdict`+`reason`; refusal-biased ordering documented.
- [ ] Coverage signal = reused `prd-coverage` + additive `measure`, `covered==(uncovered empty)`, `satisfied⇒covered`; exposes `.covered` (start) + `.satisfied` (end, unchanged).
- [ ] `run-trigger` verdict shape specified (schema name distinct from the event type), mirroring `run-termination`, closed `verdict×reason` enum; validator Pattern-B, fail-safe → refuse.
- [ ] Predicate ordering specified (target → outward floor → PRD presence/ambiguity → admissibility → coverage); inward+no-PRD ⇒ `self-directed`, outward+no-PRD ⇒ `no-prd-nothing-to-plan`.
- [ ] Every refusal path enumerated; FAFF-521 boundary recorded (taxonomy here, mechanism there, consumed once).
- [ ] Threshold decided (DoD-derived) with grounded rationale; the one product Punt recorded `(decides: product)`, non-blocking.
- [ ] Decision-table fixture set (one input row per §3b row → expected `{verdict,reason}`) so FAFF-498's `faff run-start --selftest` + FAFF-497's roll-up build against it.
- [ ] Integration smoke: outward + 2-goal admissible PRD + goal-2 uncovered → `plan/coverage-thin`; flip target inward → `refuse/self-directed` without reaching PRD checks; `faff contract run-trigger` rejects a hand-altered `drain` on plan-shaped signals.

confidence: high
