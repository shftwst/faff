# ADR 0045 — Producer dispatch vs chaining handoff — the slot-invocation transport rule

- **Status:** Accepted
- **Date:** 2026-07-05
- **Issue:** FAFF-372

## Context

faff orchestrators (`/faff-prep`, `/faff-jot`, `/faff-graft`) invoke sibling skills for two structurally different purposes, and the original slot model conflated them under one transport — the **Skill tool**. The Skill tool injects the invoked skill's `SKILL.md` as a **user-role message**, so when the sub-skill produces its output the caller's turn reads as *answering a fresh user request* and **ends** — the orchestrator never resumes. That is correct for a control transfer but fatal for a subroutine: a producer (spec / methodology / spec_review / intake) whose output the orchestrator must consume and then *resume after* (attach → validate → gate → promote) leaves the orchestrator stalled mid-flow. The regression was observed ~5× across different sessions and different models — structural, not a reasoning lapse. The build lane already avoids it: the `concurrency` slot dispatches `/faff-graft` as an **Agent-tool subagent** whose output returns as a **tool result**, so control comes back (ADR reference: the FAFF-201/226 build-subagent isolation).

## Decision

A faff orchestrator distinguishes two kinds of sibling invocation and uses a different transport for each:

- **Producer dispatch** — a slot whose output the orchestrator **consumes and then resumes after** (spec, methodology, spec_review, intake). Dispatched as an **Agent-tool subagent**: the producer runs in an isolated throwaway context and returns its full output (including its `faff-contract:*` block) as a **tool result**, so the orchestrator keeps control across the boundary. A producer subagent also accepts a `model` parameter, so it can consume a per-producer `models:` lane.
- **Chaining handoff** — control **transfers** to a sibling that takes over the conversation (prep→graft, jot→prep/plot, graft→prep/wtf). Stays on the **Skill tool**: transferring control is exactly what is wanted; a subagent would run the sibling in a throwaway context and discard the new driver.

**Single-level nesting is the boundary.** A producer subagent is dispatched **only from a top-level, non-subagent orchestrator** (interactive prep/jot). Dispatching one from a context that is itself a subagent (graft's review under the autonomous build subagent; autonomous prep under a beep-boop subagent) would double-nest, which the FAFF-201/226 build isolation forbids. The one producer that internally dispatches its own verify subagent (the `spec` producer's clean-context self-review) runs that verify **in-context** when the producer is itself a subagent, preserving single level.

## Consequences

- The interactive prep/jot producer dispatches (spec, methodology, spec_review, intake) migrate to Agent-tool subagents; the mid-turn stall is closed and each gains a `models:` lane (`models.spec` / `models.spec_review` / `models.methodology` / `models.intake`).
- Chaining handoffs are explicitly kept on the Skill tool — this ADR is the reference that a future change must not "migrate" them.
- **Deferred, and gated on this boundary:** graft's `review`/`ship` producer dispatches and autonomous (beep-boop) producer dispatch both run under an existing subagent, so their migration needs a mode-aware design (Agent when top-level, in-context under an existing build subagent). This ADR is the decision they extend.
- The contract layer is unaffected: producers still emit `faff-contract:*` blocks and the consumer-folds parse the returned text identically whether it arrived via Skill or Agent.
