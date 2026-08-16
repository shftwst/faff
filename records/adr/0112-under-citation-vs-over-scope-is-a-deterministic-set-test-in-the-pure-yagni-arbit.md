# ADR 0112 — Under-citation vs over-scope is a deterministic set-test in the pure YAGNI arbitration

- **Status:** Accepted
- **Provenance:** loop
- **Date:** 2026-08-16
- **Issue:** FAFF-815

## Context

The Phase-2 skeptic is an LLM. When it overturned a PRDR because "the DoD covers more goals
than it cites", the arbitration's unconditional overturn-reject fired and a correctly-scoped
MVP stayed `Proposed`. Two failures share the "covers more than cited" surface but demand
opposite verdicts: under-citation (`V ⊆ D ∧ C ⊊ V` — a citation bug, benign) must admit, and
over-scope (`V ⊄ D` — gold-plating) must reject. Resting that distinction on prompt wording
alone cannot guarantee the acceptance criteria hold when the skeptic mis-attributes.

## Decision

The distinction lives as a deterministic set-test in the pure arbitration
(`computePrdrYagniVerdict`), with the authoring/judging prose as prevention layered on top.
`over_scope ⟺ V ⊄ D` conservative-rejects deterministically — even when the skeptic survived —
and is recorded as an authoritative verdict boolean. `under_cited ⟺ V ⊆ D ∧ C ⊊ V` gates the
one newly-admitted case. The covered set V arrives via a new `--dod-covers` flag; absent it,
V = ∅, so `over_scope` and `under_cited` are both false and behaviour is byte-identical to
today (conservative reject on any overturn). The consumer validator trusts the recorded
`over_scope` (the verdict does not carry D) and re-derives only `under_cited` from the echoed
`cited_goals`/`dod_covers`.

## Consequences

The load-bearing guarantee is mechanical and unit-testable via a predicate-boundary matrix,
not prompt-dependent. Genuine over-scope is still rejected even if the skeptic is fooled.
Scope is judged against the declared goal set D, never the single citation. No new adversarial
judgement-seam is introduced — the set comparison makes one unnecessary. The schema
(`additionalProperties:false`) gains `cited_goals`, `dod_covers`, and `over_scope`.
