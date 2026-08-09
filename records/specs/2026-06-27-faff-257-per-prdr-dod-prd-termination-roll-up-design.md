# Spec — FAFF-257: Coverage gate + per-PRDR DoD → PRD-satisfied roll-up

> Spec: faffter-dark-nlspec · 2026-06-27 · interactive (chain walk, 3 design decisions resolved with the human) · confidence: high.

The **lower gate** FAFF-255 delegates to **plus** the **PRD-satisfied** roll-up. Full L4 "done" = *PRD satisfied (product) AND ledger clean (process)*; 257 owns the **product** half. It is also exactly where the leash meets the judge: the "is this DoD actually met?" verdict is delegated to the FAFF-34 evaluator.

## 1. WHY
The loop authors/supersedes PRDRs; two coverage guarantees must hold: **no silent abandonment** (every PRD goal stays covered by a live PRDR — the lower gate, checked at admission) and **no false done** (the PRD is "satisfied" only when every live PRDR's DoD is actually met). 257 owns both as two faces of one `goal↔PRDR↔DoD` relation.

**Principles:** two faces of one relation (coverage = static; completion = dynamic) · delegate *verification* to the judge (FAFF-34), 257 is the framework + conservative default · 257 owns **product-done** (`prd-satisfied`); FAFF-38 owns **run-done** (the composition).

## 2. OUT OF SCOPE
- 255's framework + authority + the upper gate (FAFF-256). 257 only fills `lower` + the roll-up.
- The **"DoD met against delivered work" evaluation** → **FAFF-34** (257 plugs its verdicts in; it never evaluates delivery itself).
- The **run-terminating predicate** → **FAFF-38** (257 produces one conjunct).
- The release-gate **Done** transition → **FAFF-259** (consumes `prd-satisfied` per-project).

## 3. WHAT — two outputs
```
PROCEDURE coverage(prd, live_prdrs):                    # 255's lower gate — pure
  uncovered := [g in prd.goals : no live_prdr cites g]
  RETURN { covered: uncovered==[], uncovered_goals: uncovered }

PROCEDURE prd_satisfied(prd, live_prdrs, dod_verdicts): # the roll-up; dod_verdicts from FAFF-34
  cov := coverage(prd, live_prdrs)
  IF NOT cov.covered:                 RETURN { satisfied:false, reason:"uncovered goals", cov }
  FOR each live_prdr:
    IF dod_verdicts[live_prdr] != "met":   # absent ⇒ unverified ⇒ conservative
       RETURN { satisfied:false, reason:"DoD unmet/unverified: "+live_prdr }
  RETURN { satisfied:true }
```
**`prd-satisfied ⟺ coverage (∀ goal ∃ live PRDR) ∧ completion (∀ live PRDR DoD met)`** — the no-gap predicate. Emits `faff-contract:prd-coverage` (the lower verdict, consumed by 255's `prdr admit --lower`) + a `prd-satisfied` predicate (consumed by FAFF-38 + FAFF-259).

**Chosen — scope:** both the coverage gate and the roll-up, as two faces of `goal↔PRDR↔DoD`. *(D1.)*
**Chosen — DoD-met:** delegated to the FAFF-34 evaluator (forward-interface); **conservative default — unverified ⇒ not satisfied** (never falsely done). 257 ships the framework now; FAFF-34 fills the verdicts later. *(D2.)*
**Chosen — coupling:** 257 produces `prd-satisfied`; FAFF-38 composes `run-done = prd-satisfied ∧ ledger-clean ∧ …`. *(D3.)*

## 4. HOW
- **Coverage (static, buildable now, pure):** map PRD goals ↔ live (non-superseded) PRDRs by the `prd_goal` citation. Uncovered = goals with no live PRDR. As 255's lower gate: at admission, a supersession that would drop a goal's *last* live PRDR → lower violation (no silent abandonment).
- **Roll-up (framework now, verdicts later):** the completion half reads per-PRDR DoD verdicts from **FAFF-34**. A DoD with no FAFF-34 verdict is **unverified ⇒ not satisfied** — so until the judge exists, `prd-satisfied` is conservatively false (the run *cannot* claim PRD-done without the judge — which is correct, and the whole point of the leash). When FAFF-34 lands, its verdicts flow in unchanged.
- **Coupling:** `prd-satisfied` is product-done. FAFF-38 composes it with ledger-clean (+ budget/inflection) into run-done; FAFF-259's release-gate Done consumes it per-project.

**Anti-patterns:** evaluating delivery-vs-DoD here (that's FAFF-34); claiming `prd-satisfied` with any unverified DoD (must be conservative); 257 owning run-termination (that's FAFF-38).

## 5. Scenarios
- every PRD goal has a live PRDR → coverage `covered`; 255 lower admits.
- a supersession drops the last live PRDR for a goal → coverage `uncovered` → 255 lower **violation** (no silent abandonment).
- coverage covered + every live PRDR has a FAFF-34 `met` verdict → `prd-satisfied: true`.
- a PRDR's DoD has no FAFF-34 verdict (evaluator absent/unbuilt) → `prd-satisfied: false` (conservative — unverified ≠ done).
- Assertion: `coverage` is pure (no network); `prd-satisfied` composes coverage + FAFF-34 verdicts; FAFF-38 consumes `prd-satisfied`, 257 owns no run-termination.

## 8. DONE
- [ ] coverage check (pure): PRD goals ↔ live PRDRs; emits 255's `lower: {covered, uncovered_goals}`; `faff contract prd-coverage` validator + `--selftest`.
- [ ] 255 lower-gate wiring: a supersession dropping a goal's last live PRDR → lower violation (no silent abandonment).
- [ ] `prd-satisfied` roll-up framework: `coverage ∧ (∀ live PRDR DoD-met)`; reads FAFF-34 verdicts; conservative default (unverified ⇒ not satisfied).
- [ ] `prd-satisfied` is a clean output consumed by FAFF-38 (run-termination) + FAFF-259 (release-gate Done); 257 owns no run-termination.
- [ ] additive/pure; a repo with no PRDRs is unchanged.

confidence: high

---
*Interactive chain-walk spec (3 design decisions resolved with the human, 2026-06-27). Verdict: **fire-and-forget**. Serialise behind FAFF-255 (`lower` interface). ADR-promotion intent: the product-done model (`prd-satisfied = coverage ∧ completion`, completion delegated to the FAFF-34 evaluator with an unverified⇒not-done conservative default) is architecturally significant — it's the leash↔judge boundary — materialise on build.*
