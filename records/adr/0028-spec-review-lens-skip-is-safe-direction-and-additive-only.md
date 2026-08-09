# ADR 0028 — Spec-review lens-skip is safe-direction and additive-only

- **Status:** Accepted
- **Date:** 2026-06-27
- **Issue:** FAFF-268

## Context

ADR 0025 stood up the `spec_review` slot and the fixed `spec-review-verdict` contract; ADR 0026 fixed depth-by-level (L1–L3 single-pass, L4 adversarial); ADR 0027 made the L4 form independent per-lens refuters. None of them decided *which* lenses fire — a four-lens review on every spec over-spends on a one-line config tweak, so a change-surface cost-gate selects the lens-set ahead of the reviewer.

A cost-gate that *removes* review is a safety-bearing decision, not a local optimisation. The failure the gate exists to prevent is under-review: a mis-derived "config-only" classification that drops the infosec or architectural lens silently ships an unreviewed risk. Deriving a change-surface from a *spec* (before code exists) is heuristic and unproven, so the gate must be structurally unable to under-review even when its classification is wrong. This invariant must hold for this slice, the deferred symmetric-skip follow-up, and any future evolution of the cost dial — otherwise each slice re-decides skip-safety ad hoc and the gate's trustworthiness erodes by accretion.

## Decision

**Spec-review lens-skip is safe-direction and additive-only.** The cost-gate may only ever *remove* a lens, and only in the safe direction:

- **Fail-safe on doubt.** An unclassified, mixed, or unrecognised change-surface fires **all four** lenses. Saving a lens is only ever an optimisation on a *confidently* classified surface.
- **Never skip toward higher risk.** A lens is dropped only when classification confidently shows the surface does not need it; the gate never *infers* a lens away in the risky direction.
- **`infosec` + `QA` are sticky.** At L1–L3 they always fire — `infosec` whenever the spec touches auth / secrets / external input / data handling **or** when the surface is uncertain, and `QA` as the always-fire verifiability baseline. Neither is ever inferred away.
- **v1 ships additive-only.** The only lens dropped on a confidently-trivial surface is the low-risk `architectural` lens (and `methodology` where no surface tag adds it). The aggressive / symmetric variant — bidirectional inference that would drop a sticky lens on a proven-clean surface — is deferred to a follow-up slice, gated on measured spec-derived-classification reliability.
- **Selection is advisory input, never a contract change.** The gate chooses the producer's inputs (lens-set + depth); the `spec-review-verdict` contract, its four lens names, and its three severities are untouched (ADR 0025).

Derivation is from the spec's **declared** surface (its WHAT, named files/modules/subsystems, `Assumes:`), recall-biased, reusing the existing surface-area extraction — never a predicted build diff (pre-code diff inference is unreliable and circular).

## Consequences

- **Under-review is structurally hard.** Because the only moves are fail-safe-all-four and a single low-risk drop, a wrong classification over-fires (wastes a lens-pass) rather than under-fires (skips a needed review).
- **Constrains the deferred follow-up.** The symmetric/aggressive skip slice may widen *which* lenses are skippable, but only behind this same safe-direction invariant and only once derivation reliability is measured. It may never drop a sticky lens by inference toward higher risk.
- **The cheap path stays cheap.** A trivial spec skips the architectural (and where unselected, methodology) lens at L1–L3; L4 stays pinned to the full adversarial set, so high-stakes runs never lose rigour to cost-gating.
- **Contract-stable.** Consumers (`faff-prep`, build-admission) branch on the verdict, indifferent to which lenses ran — the selection changes inputs, never the verdict shape.
