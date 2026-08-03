# ADR 0094 — lens_bounds oracle shape for judgement-eval closed-set kinds

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-08-03
- **Issue:** FAFF-615

## Context

The `refutation-spec` eval kind (FAFF-283) scores the L4 adversarial spec reviewer — the independent per-lens refuters ADR-0027 settled. Each enabled lens (architectural / infosec / methodology / QA) runs as its own refuter, and the eval measures *which* lenses objected above minor severity, scored against a hand-authored oracle by strict set-equality (`setEqual` in `eval/grader.mjs`). A case's oracle populated exactly one of `closed_set` / `ordering` / `gloss_rubric`; refutation-spec rode `closed_set`, so the predicted objecting-lens set had to match the oracle's expected set exactly — no more, no fewer.

That exactness is right when a case has a single correct answer. It is wrong here more often than it looks. A re-baseline sweep turned up six refutation-spec cases scoring FAIL for the wrong reason: the model had not missed the threat at all — the spec under review was genuinely defective on more than one axis. A correct multi-lens refuter named the primary lens the oracle expected *and* raised further objections that were themselves well-grounded, and set-equality rejects the superset. So the eval was marking a reviewer down for being thorough — the exact behaviour L4 exists to reward — and worse, doing it silently enough that the FAIL read as a real miss until someone read the transcripts.

The tempting fix is to loosen set-equality across the board to "the expected lens is present, ignore any extras". That swaps one bug for a nastier one, which the Decision below turns on.

## Decision

Add a new oracle shape, **`lens_bounds { must_object, may_object }`**, scored as a two-sided containment:

```
must_object ⊆ predicted ⊆ (must_object ∪ may_object)
```

A refutation-spec case populates **exactly one** of `closed_set` or `lens_bounds` — the existing populate-exactly-one exclusivity check in `validateCase` extends to cover the new field, so a case can't carry both or neither. `must_object` is the mandatory set: miss any lens in it and the case FAILs, because that lens is the real threat the reviewer had to catch. `may_object` names the lenses whose objection is defensible on *this particular* spec but not required of a correct reviewer; an extra objection passes only if its lens is named there. A lens outside both sets is still a FAIL.

The predicted-set extraction is untouched — the deduped set of lenses whose objection cleared minor severity, exactly as today. Only the comparison changes, and only when the oracle carries `lens_bounds`: the grade branches on which oracle field is present, not on the kind, so `closed_set` cases keep grading by `setEqual` byte-for-byte.

The rejected alternative — globally relaxing to "primary lens present, ignore the rest" — is recorded here because it looks correct and isn't. These cases are the one place the suite catches a reviewer that *over-fires*: objects on a clean angle where nothing is wrong. "Ignore the rest" would stop catching that entirely — a refuter that objected on all four lenses regardless of the spec would then pass every case, and the near-miss clean fixtures that exist precisely to punish crying wolf would go green. The bounded per-case tolerance is what keeps the over-firing guard alive while still accepting grounded multi-lens objections: `may_object` says "these extra objections are fair game on this spec", and the closed upper bound says "anything beyond them is still over-firing". Preserving that guard is the whole reason the shape is bounded rather than open.

## Consequences

- **The six mis-scored cases now grade on merit.** A reviewer that catches the mandatory threat and adds grounded objections named in `may_object` passes; one that objects on a lens in neither set still FAILs. The over-firing near-miss fixtures are unaffected — their oracles carry an empty `may_object`, so any extra objection breaks the upper bound exactly as strict equality did.
- **This sets the durable convention** for how any refutation-spec-style case expresses "this lens must object, these others may". Later adversarial-lens cases express permitted-but-not-required objections through `lens_bounds` rather than inventing a per-case escape hatch, and the choice of `must_object` vs `may_object` per lens becomes a normal part of authoring an adversarial fixture.
- **Because the grade branches on the oracle field, not the kind,** a future closed-set-of-lenses surface can opt into bounded tolerance by populating `lens_bounds` — no new kind and no new grade math beyond the containment check. `closed_set` remains the right shape wherever a case genuinely has one exact answer (a single verdict, a marker map); `lens_bounds` is for the set-valued case where thoroughness is legitimate.
- **Flakiness measurement is unchanged.** The signature stays the sorted predicted set, so cross-rep stability still counts a reviewer that objects on different lenses across reps as unstable, independent of whether any single rep passed its bounds.
- **The tolerance is only as tight as the author makes it.** A `may_object` that lazily lists every lens would neuter the over-firing guard for that case — the bound would admit anything. That is author discipline caught in fixture review, not something the grader can enforce; the shape gives a place to be precise, it doesn't compel precision.
