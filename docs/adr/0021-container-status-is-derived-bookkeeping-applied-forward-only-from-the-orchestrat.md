# ADR 0021 — Container status is derived bookkeeping, applied forward-only from the Orchestrator lane via a pure predicate

- **Status:** Proposed
- **Date:** 2026-06-27
- **Issue:** FAFF-248

## Context

A container's tracker status (a project, or a parent issue with sub-issues) is never transitioned when its child issues are picked up or completed. faff writes child-issue status one level down — `/faff-graft` claims an issue `→ In Progress`, ships it `→ Done` — but no skill propagates that rollup up to the container, so the container field drifts and lies. `/faff-map` reads project status for its Now/Next/Later horizons, so the drift is load-bearing: a project sits in Backlog/Planned while its children are mid-flight, and the manual sweep to fix it never happens.

The reason it was never automated is a standing "don't change project status autonomously" stance. On inspection that stance conflates two things. The read-only posture genuinely belongs to `/faff-map` — *because map is a read-only lane that reports and never mutates* — and to *judgement* writes ("is this deliverable shippable?", "should this project be force-stalled?"). It was never meant to forbid a **mechanical, reversible rollup** of container status from child state. The real decision axes are (1) **where the change is initiated from** — map never, the `/faff-tidy` grooming lane yes (it owns state-coherence), a build only its own issue's claim/ship — and (2) **how safe and reversible the change is** — a transition derived from children, forward/monotonic, and undone in one tracker click is safe; a judgement call is not.

## Decision

Container status (project, and parent issue) is treated as **derived bookkeeping**: it mirrors the aggregate state of the container's child issues, computed by a **pure predicate** (`faff project-next`, parity with `faff next` — no tracker/network access; the agent maps live child statuses into `{total, active, done}` flags and the CLI returns the transition) and **applied only from the Orchestrator lane** (the `/faff-tidy` reconciliation sweep), never the Implementor lane (a build returns only a terminal token and has no tracker visibility).

The write is **forward-only and monotonic** under the same status-monotonicity guard that binds issue-claim: a container advances by rank (`planned < started < completed`) and is **never** moved backward — a quiet or cancelled child never un-starts a container. v1 ships three children-derived state-coherence transitions, all initiated from tidy: project → **In Progress** when a first child starts; parent issue → **In Progress** when any child is In Progress; project → **Done** when **all** children are Done **and the project carries no release-gate/DoD** (pure state-coherence — a not-Done project with every child Done is just stale). The `/faff-map` "don't change tracker status autonomously" disclaimer is **narrowed, not deleted**, to scope it to map's read-only role and to judgement writes, with the sanctioned mechanical rollup documented in its owning write lane, tidy.

## Consequences

- Establishes that container status is a computed mirror of a child-issue rollup, not a hand-maintained field — `/faff-map`'s horizons stop reading stale state without any manual sweep.
- The pure-predicate + orchestrator-lane-applicator split is the seam future slices extend without re-plumbing: **initiative-level** rollup (the same predicate over `containerParent` one level up), and the deferred **release-gate Done** (FAFF-259, blocked-by FAFF-245) — where a project *has* a DoD, that predicate owns `→ Done` and may hold a container open past children-done. This ADR deliberately scopes the autonomous Done write to the **no-DoD** state-coherence case only; the DoD-gated, deliverable-shippable *judgement* is out of bounds for a mechanical rollup.
- Constrains the autonomous-write posture: project/parent-issue status writes are admissible in autonomous (L3) mode **because** they are reversible bookkeeping reflecting work a human already authorised (by making a child eligible) — categorically unlike autonomous work-creation, which stays appetite-gated and provenance-bound. The forward-only guard is the floor that keeps this safe; a backward or judgement transition is never autonomous.
- Parent-issue → Done is intentionally **not** automated here: a parent issue often carries its own body of work beyond its children, so "all children Done" is not sufficient to call the parent done. Only the project-level no-DoD coherence ships.
