# ADR 0068 — DoD release gate only tightens a container's Done

- **Status:** Proposed
- **Date:** 2026-07-14
- **Issue:** FAFF-259

## Context

FAFF-248 gave `faff project-next` a pure, children-derived Done transition: a project with no DoD advances to Done the moment all its children are done. FAFF-245/257/277 then gave a subset of projects a machine-readable Definition of Done — a per-container release gate that can be evaluated `met` or `unmet/unverified`. FAFF-259 wires that gate into the same predicate as a second, DoD-gated Done transition.

The two transitions could combine two ways. **Disjunctive**: gate-met alone is sufficient for Done, regardless of open children. **Conjunctive**: gate-met only ever adds a further requirement on top of all-children-done. The ticket's own framing settled the direction before this ADR — the DoD "may hold the project open *past* all-children-done", judging criteria "*beyond* child completion" — language of a gate that raises the bar, never one that lowers it. A disjunctive reading would let a project with open children flip to Done the instant its release gate passes, silently orphaning those children inside a container the tracker now calls finished. Deciding what happens to them — re-home to another container, cancel as no-longer-needed, or leave open under a Done parent — is a scope judgement, not something the state-coherence sweep can discharge as bookkeeping. It would also collide with FAFF-248's own started-signal coherence, which already treats open children as the signal that a container is still `started`.

This is architecturally significant beyond this one predicate: it fixes a floor every future container-lifecycle transition inherits — a DoD/release-gate signal is hold-open authority, never fast-forward authority. Corrective or backward transitions, and whatever FAFF-248/259 gain next, all sit on top of this floor.

## Decision

**The DoD release gate only ever tightens a container's Done — it never loosens it.** Concretely, in `projectNext`:

- All-children-done remains a *necessary* condition for a project's Done in every case, DoD or not.
- A DoD project's Done additionally requires the release gate to be satisfied (`--dod-met`): `allDone ∧ hasDod ∧ dodMet` → advance to `completed`.
- Gate-met with open children — `hasDod ∧ dodMet ∧ ¬allDone` — is never inspected as a Done condition at all; the predicate's `allDone` guard runs first, so this combination cannot auto-complete a container no matter what the gate says.
- All-children-done with an unmet or unverified gate holds the project open (`noop`, reason "all-children-done: release gate not passed — held open (DoD authoritative)") rather than falling back to the no-DoD rule.

No input combination the predicate accepts can produce a `completed` container with `done < total`.

## Consequences

- Every future container-lifecycle transition (further FAFF-248 coherence work, later corrective/backward transitions, any additional gate this predicate grows) inherits the same floor: a release-gate/DoD signal may only add a further bar to clear, never substitute for children being done. A change that wants gate-met alone to complete a container with open children needs to explicitly revisit and supersede this ADR, not quietly special-case around `projectNext`.
- The predicate stays a single conjunction to reason about — `allDone AND (¬hasDod OR dodMet)` — with no disjunctive escape hatch, keeping the monotonicity/forward-only selftest grid exhaustive by construction (`dodMet ∈ {false, true}` composed with the existing `hasDod` axis).
- What happens to a project's children when its release gate is satisfied but work is still open remains explicitly out of scope for this mechanism — that judgement is deferred to a human or a future methodology-level flow, not resolved as a side effect of gate evaluation.
- A caller cannot pass `--dod-met` for a gate-less project to route around the guard; the predicate treats `dodMet ∧ ¬hasDod` as a malformed rollup (exit 2) rather than silently ignoring it.
