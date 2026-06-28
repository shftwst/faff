# ADR 0029 — Machine DoD-verification for L4 is GO-narrow: trusted for born-verifiable (scenario/assertion) classes, human for prose

- **Status:** Accepted (spike outcome — measured; GO-narrow signed off by the human 2026-06-28)
- **Date:** 2026-06-28
- **Issue:** FAFF-263 (spike)

## Context

The entire L4 leash (PRD → PRDR → run-termination) is designed and largely built, and every piece bottoms out at one unbuilt, uncertain capability: a machine **evaluator** that answers *"is this Definition-of-Done met by the delivered work?"* (FAFF-34). FAFF-257's `prd-satisfied` roll-up returns `false` for any DoD without a FAFF-34 verdict; FAFF-38 (run-terminating) and FAFF-259 (release-gate Done) both consume it. So today the leash can never declare a PRD satisfied — by design — and building FAFF-34 on faith risks either a permanently-parking pipeline (too many false-fails) or, far worse, a pipeline that ships un-done work confidently (false-passes).

Whether the evaluator can be made *reliable enough to trust unattended* is a capability/uncertainty question, not an engineering one — you cannot drain your way to it. This spike answers it before FAFF-34 is built. The cardinal failure is **false-pass** (verdict `met` when it isn't): a false-fail merely parks for a human (the conservative `unverified ⇒ not-done` default catches it), but a false-pass is silent and ships un-done work.

### What was run

A **strawman** of FAFF-34 (FAFF-34 itself is unbuilt): a **code-blind judge** that, given a DoD criterion + the delivered work (a merged PR's diff as context, no other project knowledge), returns `met` / `unmet` / `needs-human`. Each judgement ran in a fresh isolated context (a faithful proxy for an independent evaluator invocation). The corpus is faff's own shipped tickets (spec-DoD criterion + merged PR), hand-ground-truthed and stratified by DoD class per FAFF-254's classifier (`scenario` / `assertion` / `prose`), and deliberately seeded with **negatives** — criteria paired with a wrong/sibling/adjacent PR, partial-clause misses, and within-PR fine distinctions — so false-pass is measurable.

### Measurements

**Breadth** (63 distinct (criterion, PR) pairs, 1 rep each):

| Stratum | n | Errors |
|---|---|---|
| True-met (shipped work vs own DoD + controls) | 25 | 0 false-fail |
| Negatives (wrong-feature, sibling-gate, partial-clause, within-PR, cross-feature) | 35 | **0 false-pass** |
| Prose (subjective criteria) | 3 | all 3 → `needs-human` (correct abstention) |

**Stability** (the 10 closest-call cases — incl. same-PR discrimination pairs — re-judged by **K=20** independent fresh-context judges = 200 judgements):

| | Result |
|---|---|
| Per-case stability | **10 / 10 at 1.0** — every case identical across all 20 reps; zero flips |
| Accuracy | 200 / 200 vs ground truth |
| False-pass (6 negatives × 20) | **0 / 120** |

**Combined: 155 negative-judgements, 0 false-pass → rule-of-three 95% upper bound ≈ 1.9%.** Stability 1.0 at K=20 on the cases most likely to flake.

The standout is discrimination quality: entries judging the **same PR** split correctly and *identically* across all 20 reps — e.g. "objection *severity* out-of-enum fail-louds" → `unmet` (it's an exit-1 violation) vs "*verdict* out-of-enum fail-louds" → `met` (exit-2); and "project→Done with a DoD" → `unmet` (deferred) vs "project→In Progress on first child" → `met`. The judge reads compute logic, not the PR label or surface plausibility.

## Decision

**GO-narrow on machine DoD-verification for L4.** A machine evaluator is **trusted to verify, unattended,** DoD criteria in the **born-verifiable classes — `scenario` and `assertion`** (FAFF-254 form): measured 0 false-pass (~1.9% upper bound) with perfect K=20 stability on the hardest cases. **`prose` criteria stay human-reviewed** — the evaluator must return `needs-human` for them, which it did unprompted in every prose case.

This is **GO-narrow**, not full GO (prose is not machine-verifiable) and not NO-GO (the born-verifiable classes are verifiable with no observed false-pass). The **reliability boundary** = {scenario, assertion} trusted · {prose} human — and that boundary *is* the definition of how wide narrow-class lights-out can be.

The conservative-default contract the leash already assumes — **`unverified ⇒ not-done`** — is **confirmed** as the right fail-safe: it composes exactly with this boundary, since the evaluator emits `needs-human` (≡ unverified ≡ not-done ≡ parks for a human) on everything outside the trusted classes.

## Consequences

- **FAFF-34 is buildable, scoped to the boundary.** Build the evaluator to emit `met`/`unmet` on `scenario`/`assertion` DoD and `needs-human` on `prose`. The risk it carries is no longer *capability* or *run-to-run stability* (both measured strong) — see the residual follow-ups.
- **Narrow-class lights-out is now operationally defined:** a run is trustworthy unattended for any work whose DoD is expressed born-verifiably; prose/"feels-done" DoD keeps a human at the done-gate. The wider the born-verifiable coverage of a PRD, the wider its lights-out envelope.
- **It composes with shipped machinery for free:** FAFF-254 already classifies each criterion into the three classes; the `unverified ⇒ not-done` default (FAFF-257/38/259) already routes prose/unverified to a human. GO-narrow needs no new routing — only FAFF-34 honouring the boundary.

### Caveats (what this spike did NOT establish)

- **Strawman ≠ FAFF-34.** The judge evaluated the **PR diff as text**, not a stood-up runtime. A GO here is a GO for *diff-level* verification; runtime-exercise fidelity (does the feature actually run against the spec) is FAFF-34's to validate separately.
- **Frontier-only.** All judgements used a frontier model; no local-model secondary, and cost/wall-clock was not characterised.
- **Builder-assigned ground truth.** The corpus labels (esp. the "met" positives) were assigned by the same author who built much of the work; an independent audit was not done.
- **Bound is ~1.9%, not <1%.** 0/155 is strong but a production-grade "<1% false-pass" needs a much larger negative set (~300+) — out of spike scope.

### Costed follow-ups

1. **Build FAFF-34** scoped to the born-verifiable boundary (emit `needs-human` on prose). The decisive de-risk is done.
2. **Runtime-exercise validation** — repeat the measurement where the evaluator exercises the delivered feature in a stood-up environment (ties FAFF-30/31), not PR-as-text.
3. **Independent ground-truth audit** — a second party labels a sample to remove builder bias.
4. **Production-scale negative set (~300+)** to push the false-pass upper bound below 1%, runnable on the existing `eval/` harness.
5. **Local-model secondary + cost characterisation** for the unattended cost envelope.

*Spike method + raw per-pass results live in this session's FAFF-263 logs under `.faff/`. Mirrors the ADR-0003/0004 spike shape: provisional GO with the decisive evidence measured, residual questions named as costed follow-ups.*
