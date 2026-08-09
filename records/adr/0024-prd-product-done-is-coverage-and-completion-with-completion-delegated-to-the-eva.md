# ADR 0024 — PRD product-done is coverage AND completion, with completion delegated to the evaluator under an unverified-not-done conservative default

- **Status:** Accepted
- **Date:** 2026-06-27
- **Issue:** FAFF-257
- **Initiative:** L4 — Lights-out AI factory

## Context

The L4 lights-out factory delegates *product ends* to the machine, but a run must never be able to declare itself product-done falsely. Full L4 "done" is two halves: **PRD satisfied** (the product is actually built) AND **ledger clean** (the process terminated coherently). This ADR fixes the *product* half — what it means for a container's PRD to be satisfied — and where the verdict comes from.

The PRDR layer lets the loop author and supersede project-scale product-requirement decision records within the human PRD box (ADR 0022 fixed the two-gate admission authority; the upper/YAGNI gate guards "is this PRDR warranted?"). The complementary question is the *lower* one: as PRDRs come and go, does the product still cover every goal the human set, and is every live commitment actually delivered? Two failure modes must be impossible:

- **Silent abandonment** — a supersession quietly drops the last live PRDR covering a PRD goal, so a goal the human set is no longer pursued by anyone.
- **False done** — the run claims the PRD is satisfied while a live PRDR's definition-of-done has not actually been met (or has never been checked).

The forces in tension:

- **Static coverage vs. dynamic completion.** "Every goal is covered by a live PRDR" is a pure structural check the loop can run now; "every live PRDR's DoD is actually met against delivered work" is an open-ended judgement that needs a real evaluator. Conflating them either blocks the buildable half on the unbuilt half, or lets a coverage-only check masquerade as done-ness.
- **Self-grading.** A loop that both delivers a PRDR and judges whether its DoD is met is marking its own homework — the "is this DoD actually met?" verdict cannot be the loop's alone. It belongs to a code-blind evaluator (the judge), which is a separate, as-yet-unbuilt capability.
- **The judge is not here yet.** The product-done framework is needed now (the PRDR layer is shipping), but the evaluator that grades DoDs is downstream. The framework must ship with a safe behaviour in the evaluator's absence, not wait for it.
- **Determinism over prose.** Product-done is a control-flow predicate the autonomous lane acts on with real authority (it gates run-termination and the release-gate Done transition); it must be a reproducible function, not run-to-run model judgement.

## Decision

**`prd-satisfied ⟺ coverage ∧ completion`** — the no-gap product-done predicate, computed by a pure verdict (`faff prdr coverage`), with the two faces of one `goal ↔ PRDR ↔ DoD` relation kept distinct:

- **Coverage (static, owned here).** Every PRD goal must stay covered by a live (non-superseded) PRDR. The verdict emits the lower-gate shape `{covered, uncovered_goals}` that the admission gate consumes (`prdr admit --lower`): a supersession whose *prospective* live set drops a goal's last PRDR yields `covered: false` and is refused — **no silent abandonment**. Coverage is a pure function of the PRD goals and the live-PRDR set; it makes no network or evaluator call.
- **Completion (dynamic, delegated to the judge).** Every live PRDR's DoD must actually be *met*. This verdict is **not** computed here — it is read from the code-blind evaluator's per-PRDR DoD verdicts. The coverage producer plugs those verdicts in; it never evaluates delivery itself.
- **The conservative default — unverified ⇏ done.** A live PRDR with no `met` verdict (the evaluator is unbuilt, unreachable, or simply has not graded it) counts as **unverified, therefore not met**. Consequently, until the evaluator exists, `prd-satisfied` is conservatively **false** for any container with live PRDRs. This is correct and by design: the run *cannot* claim product-done without the judge — that is the whole point of the leash. When the evaluator lands, its verdicts flow into the same input unchanged, with no change to the predicate.

`prd-satisfied` is the **product-done** signal only. Composing it with ledger-clean (and budget/inflection) into a full run-terminating condition is a separate concern (the run-done composition owns that); the per-project release-gate Done transition consumes `prd-satisfied` directly. This ADR draws the **leash ↔ judge boundary**: the leash (this framework) decides *what must be true* for product-done and refuses to abandon goals; the judge (the evaluator) decides *whether each DoD is actually met*. Neither grades the other's homework.

## Consequences

- The product-done verdict is born safe: a repo with no PRDRs is vacuously covered and satisfied (additive, no behaviour change); a repo with live PRDRs and no evaluator is conservatively *not* satisfied, so no autonomous run can self-certify product-done before the judge is built.
- The admission gate's lower input is now produced from real live-PRDR state rather than a hand-set flag, so the "no silent abandonment" guarantee is mechanical: dropping a goal's last cover is detected by recomputing coverage over the prospective live set and refused at admission.
- A hard interface line is fixed for the downstream evaluator work: it supplies per-PRDR DoD verdicts (`met` / not), and nothing more, into the completion half. Building it flips `prd-satisfied` from conservatively-false to genuinely-evaluated with no change to this predicate or its consumers.
- Downstream consumers (run-terminating-condition composition, per-project release-gate Done) get a single clean product-done predicate to read, decoupled from how completion is judged.
- Coverage and completion stay deliberately separable: the cheap structural check can gate admission continuously, while the expensive DoD judgement runs only where a satisfaction verdict is actually needed.
