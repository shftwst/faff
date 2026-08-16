# ADR 0110 — L4 decomposition is emergent on the wave loop; ticket size is never a park reason

- **Status:** Accepted
- **Provenance:** loop
- **Date:** 2026-08-16
- **Issue:** FAFF-809

## Context

L4 runs a project to completion without a human, within the PRD's boundaries. The only legitimate reasons to involve a human are a genuine risk or a call the agents genuinely can't make. Ticket size ("too big to build as one unit") is decidable by the agents, so it isn't one of those reasons — yet today it effectively parks on size: the up-front planner plans then stops (a second run is needed to build, FAFF-809), and a mid-run too-big slice parks for a human (FAFF-810). Planning the whole project up front is also unwanted (waterfall); structure should emerge within the PRD's bounds as too-big is discovered and broken down, and that breakdown must never block buildable work. A continuous per-item scheduler was weighed against the existing wave loop — continuous is faster but is a genuine mechanics change with a weaker checkpoint/resume story, whereas the wave loop already gives convergence, checkpoints, and run-done termination.

## Decision

1. **Size is never an L4 park reason.** A too-big slice is re-sliced by the agents and building continues. L4 parking is reserved for genuine risk or a genuinely-undecidable call — including the earned case where decomposition provably fails to reduce (churn), treated as can't-decide, not size.
2. **Decomposition is emergent and lazy within the PRD's outer bounds.** The planner decomposes only enough to yield the next buildable slice, not a full up-front tree; further structure emerges as too-big is discovered at prep and re-sliced. Buildable work is never blocked by decomposition of a too-big sibling (real dependencies aside).
3. **It runs on the existing wave loop, not a new scheduler.** Changes are at the edges: too-big re-slices-and-requeues instead of parking; the planner is lazy; the run doesn't stop after planning — it converges until the PRD is fulfilled, bounded by run-done / budget / convergence backstops (FAFF-809). Build scheduling stays wave-based. The continuous per-item model is a noted future optimisation, deferred.
4. **Discovered scope is recorded and jotted.** The implementor keeps recording to the run-dir file (durable at discovery — audit, ground-truth-reconcile, resume). At L4 the orchestrator additionally jots eagerly on each build's return, gated by containment: `contained` + `concrete` auto-creates immediately; `outward-new-root` / `vague` is surface-only (FAFF-814). The PRD boundary is the scope authority at L4, not a human, and the agent must not invent scope beyond it. Dedup is via search-before-create, safe against the parallel-build race since filing is serial; a stable structural key is later hardening.
5. **L1–L3 are unchanged.** A too-big slice parks for a human at attended levels; discovered scope follows the existing human-confirmed / file-and-defer path.

Implemented by: FAFF-809 (up-front — don't stop after planning), FAFF-810 (reactive — re-slice not park at L4, park at L1–L3), FAFF-814 (eager containment-gated discovered-scope jotting), FAFF-499 (whole-loop convergence umbrella).

## Consequences

- **Positive.** L4 delivers plan-then-build with no second arm cycle and no human size-decision; the plan emerges agilely within the PRD; discovered scope is durable immediately, closing the abandoned-run stranding window, and feeds the loop sooner; the change stays small and on the resumable wave loop.
- **Accepted costs.** Emergence trades up-front certainty for occasional rework (the agile bet). Eager per-item jotting leans on fuzzy title dedup, so same-scope-different-words can create a near-duplicate — self-healed by tidy, hardened later by a stable key. Wave batching keeps intra-wave blindness and boundary latency, with the continuous model as the escape hatch.
- **Deferred, not blocking.** A plan-side adversarial/confidence gate (the build-side spec-review analogue, for "is this the right decomposition") stays a noted future improvement, not a blocker on this decision.

**Self-review (producer, post-implementation).** FAFF-809's shipped change — re-reading coverage after `/faff-plot --autonomous` returns and falling through to step 1 → prep → build on `.covered`, with the build pass minting its own `faff lights-out` ledger rather than reusing plot's — matches Decision items 1 and 3 exactly: no second arm cycle, wave-loop convergence unchanged, decompose-pass/build-pass ledger separation preserved. Items 2, 4, and 5 are implemented by the sibling tickets named above, not this one; this ADR records the umbrella decision they all implement.

confidence: high
