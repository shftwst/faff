# ADR 0130 — Gate activation keys on run facts, not the L-level label

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-09-22
- **Issue:** FAFF-1072

## Context

Two unattended-safety mechanisms fired only at L4: the pre-build admissibility gate (`faff admissible --lights-out`, is the spec's Definition of Done machine-checkable) and the interactive custody stamp (a self-consistency integrity digest threaded to the merge floor). Both keyed their activation on `level === "L4"`. But an ordinary autonomous L3 run merges to `main` with no human confirm, so the risk each mechanism guards against is present at L3 too, and neither fired there.

FAFF-1040 named the lesson: safety machinery should key on the fact that makes it necessary, not on the level label that usually implies that fact. ADR-0103 (FAFF-717) had already applied this to Sentry's abort, re-keying it off the L4-mint proxy onto declared attendedness. The admissibility gate and the custody stamp had not received the same treatment. The L-level is a shorthand for a combination of underlying facts (attended vs unattended, autonomous vs interactive, dispatched vs not-dispatched); gating on the label is gating on the proxy.

## Decision

Both mechanisms key on the underlying run facts, not the level label.

- The **admissibility gate** fires on the `autonomous` fact (every automated run, whether attended or unattended at L3, and L4), inert for an interactive single-issue graft. It is a two-layer screen: the beep-boop primary filter is unconditional in the automated-runner context, and the graft pre-worktree backstop reads graft's own `autonomous` boolean as defence-in-depth.
- The **custody stamp** and its **merge-floor consumer** fire on `unattended ∧ not-dispatched` — the in-session merge of an unattended run with no dispatch cut above it to provide detective custody. This generalises the stamp's former L4-top-level-only gate onto the fact, covering the previously-uncovered autonomous-but-top-level L3 cell (the `l4.md` obligation-7 carve-out proves this cell exists: such a graft merges in-session with no `lane-boundary.json`, so `evaluateCustody` never fires).
- The `unattended` fact reuses the ADR-0103 resolver (`(level === "L4") || declaredUnattendedFromConfig(cfg)`); the merge floor computes it inline from the tamper-resistant committed anchor level plus config, never from the mutable run-ledger.
- Dispatched-lane detective custody (`evaluateCustody`) is unchanged — it already keyed on `lane-boundary.json` presence, not level, and already covered every dispatched run at any level.
- L4's specialness (a PRD-driven, heightened-autonomy run) still governs the holdout guarantee and topology authority; those keep their `level === "L4"` tests. This decision generalises only these two gates' activation axis.

This generalises ADR-0118's `custody-trusted` grant, which was built for an L4-specific purpose, onto the fact it actually protects.

## Consequences

- An unresolvable fact fails closed for the custody floor (require the guard), matching the existing FAFF-690 posture; the admissibility pre-build gate inherits graft's existing `autonomous` fail-safe (unresolvable → inert), backstopped by the always-on beep-boop primary filter.
- The merge-floor consumer is not a one-line change: `resolveIntegrity` gains a `cfg` parameter, and the `faff contract integrity-floor` extraction gains `unattended` / `dispatch_state` fields. The custody-stamp firing and the merge-floor requirement are coupled and must ship together, or an unattended non-dispatched merge either refuses with no stamp produced or produces a verdict nothing consumes.
- Future overnight-safety mechanisms should follow this precedent — key on the fact, resolve it through the shared helper — rather than re-introducing a `level === "L4"` activation test. Recording which decisions were human-ratified vs agent-chosen is a separate follow-up (FAFF-1079).
