# ADR 0026 — Spec-review depth scales by level — L1–L3 single-pass vs L4 adversarial

- **Status:** Proposed
- **Date:** 2026-06-27
- **Issue:** FAFF-266

## Context

ADR-0025 stood up the `spec_review` slot and the fixed `spec-review-verdict` contract (the spine of FAFF-9), but deliberately left the *reviewer's behaviour* — how deep the review goes and when — to the occupant. FAFF-266 ships the first real occupant and so must settle that depth question, because the answer constrains every later spec-stage-review slice.

A single review shape does not fit every change. A four-lens **adversarial** review (independent per-lens reviewers each prompted to refute the spec) is the strongest catch, but it is overkill for a one-line change and unaffordable to run on every spec at scale. A single-pass checklist is cheap and proven but weaker. Without a fixed boundary between the two, each downstream slice (L4 refuters, change-surface lens selection) would re-decide depth ad hoc and drift, and the cheap path would risk acquiring adversarial cost by accretion.

faff already scales agency by the autonomy level (L1→L4) and by the `appetite` dial everywhere else; review depth is the same kind of knob and should reuse those dials rather than invent a new one.

## Decision

**Spec-review depth scales by level, mapping onto the one `spec-review-verdict` contract (ADR-0025):**

- **L1–L3** — a **single-pass four-lens checklist** (architectural / infosec / methodology / QA) emitting one founded verdict. This is what FAFF-266 ships (`faffter-noon-spec-review`).
- **L4** — **independent per-lens adversarial refuters**, each prompted to refute the spec from its angle, gated on majority/severity. This is a separate occupant in the same slot (content in FAFF-267); FAFF-266 leaves only the hook.
- Review **depth/cost scales with level + appetite + change-surface** — the same dials faff uses everywhere. Selective per-lens firing by change-surface is a later refinement (FAFF-268).

The cheap single-pass form and the costly adversarial form are both occupants of the same slot and both emit the same `spec-review-verdict` block; the level (plus appetite and change-surface) selects which occupant/depth runs, not a different contract.

## Consequences

- **Constrains every later spec-stage-review slice.** FAFF-267 (adversarial refuters) and FAFF-268 (lens selection) must honour this gradient and this contract boundary — they refine depth and lens-firing, never the verdict shape.
- **Keeps the cheap path cheap.** A small change does not silently acquire adversarial-review cost; refutation is reserved for the level where it pays.
- **The boundary is contract-stable.** Because both forms map onto the one verdict, the consumer (`faff-prep`) and build-admission are indifferent to which depth ran — they branch on the verdict, not the reviewer.
- **Level resolution must exist at review time.** The gradient assumes the running level (and appetite, change-surface) is resolvable when the reviewer is invoked; until selective firing lands (FAFF-268), L1–L3 always fires all four lenses in one pass.
