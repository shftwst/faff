# ADR 0113 — Phase-2 YAGNI challenge carries a closed-vocab ground gating the under-citation admit

- **Status:** Accepted
- **Provenance:** loop
- **Date:** 2026-08-16
- **Issue:** FAFF-815

## Context

Admitting on `under_cited` alone would let an under-cited PRDR through whenever the skeptic
overturned — even when the skeptic's real objection was that a goal is unserved, redundant, or
off-mission, not a scope claim at all. That silently weakens skeptic authority beyond the
target case (a mis-attributed over-scope overturn). The challenge already carries a free-text
`reason`, but parsing LLM prose is a fragile, model-dependent gate.

## Decision

The Phase-2 challenge classifies its overturn with a closed-vocabulary `ground`:
`over-scope` | `unserved` | `other`, defaulting to `other` when absent or unknown (fail-safe).
The under-citation admit fires only on `under_cited ∧ ground == "over-scope"` — the skeptic
claimed over-scope and the deterministic `V ⊆ D` set-test proves that claim was actually
under-citation. Any overturn on `unserved`/`other` grounds, or an absent/unknown ground, is
respected as a conservative reject. `ground` is a shape addition to the arbitration input and
verdict, distinct from FAFF-816's transport of the challenge.

## Consequences

The cure is scoped to exactly the mis-attributed-over-scope case; full skeptic authority is
preserved everywhere else. The `prdr-yagni` schema gains `challenge.ground` as an enum, and
future adversarial-review occupants that overturn a PRDR must emit it. The fail-safe default
means a challenge that omits the ground can never widen what admits.
