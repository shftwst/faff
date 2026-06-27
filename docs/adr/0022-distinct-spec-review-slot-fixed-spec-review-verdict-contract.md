# ADR 0022 — Distinct spec_review slot + fixed spec-review-verdict contract

- **Status:** Proposed
- **Date:** 2026-06-27
- **Issue:** FAFF-265

## Context

FAFF-9 adds a reviewer of the *spec itself* — adversarial at L4 — across four lenses (architectural, infosec, methodology, QA). It decomposes into a contract+slot spine (FAFF-265, this slice), an L1–L3 single-pass reviewer (FAFF-266), L4 per-lens refuters (FAFF-267), and change-surface lens selection (FAFF-268). Every downstream slice needs one shared, machine-checkable verdict to map onto, or each would invent its own shape and drift.

Two seating options existed for that verdict: reuse the existing `review` slot (code review) parameterised by stage, or stand up a distinct `spec_review` slot. They differ in input (a spec vs a code diff), in verdict vocabulary (`approve/revise/reject-approach/needs-human` with lensed objections vs `pass/fail/needs-human`), and in control flow (spec review has a backward-routing `reject-approach` edge that re-plans before code exists — code review has no such edge). faff already proves the contract-as-code pattern (ADR-0001): a producer emits a `faff-contract:<name>` block, a deterministic `faff contract <name>` script validates its *shape*.

## Decision

Stand up a **distinct `spec_review` slot** with its **own fixed `spec-review-verdict` contract** (`approve` / `revise` / `reject-approach` / `needs-human`, plus `objections: [{lens, severity}]`), rather than overloading the `review` slot.

- The contract validates **shape, not judgement** (enum membership + founded-verdict invariants: `approve` ⇒ no objections; any other verdict ⇒ ≥1 objection). It performs no spec reasoning.
- It follows the **contract-as-code** foundation (ADR-0001): producer-emits the `faff-contract:spec-review-verdict` block, the consumer pipes it to `faff contract spec-review-verdict`; the script's exit code (0/1/2) is the sole source of contract data.
- Bad-verdict handling is **fail-loud** (the `prd-readiness` precedent, ADR-adjacent FAFF-253), since faff's own producer emits the block; soft objection fields enforce their enum via violations (the `prd-readiness.reason` precedent).
- The default occupant is a **passthrough** `faffter-noon-spec-review` emitting `approve`/`[]`, upgraded in place by FAFF-266.

## Consequences

- **FAFF-266, FAFF-267, and FAFF-268 all conform to this slot + contract** — the choice constrains every downstream slice of FAFF-9. The L4 refuters (FAFF-267) map their per-lens refutations onto this same verdict; lens selection (FAFF-268) gates which lenses populate `objections`.
- The `review` slot stays single-purpose (code review), avoiding two-contracts-one-slot conflation.
- A new slot adds registration surface (`DEFAULTS`, the `config defaults` expected list, `config resolved` SLOTS, `SLOT_TYPES`, a `validate-adapters` conformance profile) — the standard cost every slot pays, accepted for the clean separation.
- The thin `{lens, severity}` objection shape is deliberately minimal; if FAFF-266 needs richer per-objection detail (e.g. a rationale field) it is an additive schema change, not a redesign.
- Severity→verdict *mapping* is intentionally **out of this contract** — it is reviewer judgement (FAFF-266/267), keeping the contract a pure shape gate.
