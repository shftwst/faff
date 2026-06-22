# ADR 0009 — Eligibility-label provenance by write-abstention

- **Status:** Proposed
- **Date:** 2026-06-22
- **Issue:** FAFF-218

## Context

faff's automation-eligibility throttle (FAFF-19) treats the backlog as a *human* control surface: `faff-automate` cranks an issue up into the autonomous lane, `faff-automation-hold` pins it out. The whole guarantee rests on one fact — **a human, not an agent, set the label.** That fact was guarded only by gateway prose ("no autonomous path ever adds `faff-automate` or removes `faff-automation-hold`"). Both are ordinary tracker labels the faff CLI (`labelOp`/`cmdLabel`) would write for any caller, so an agent could crank *itself* up and walk into its own autonomous lane.

FAFF-125 shipped the *read* gate — a runtime `faff eligible` present/absent check — but a read gate cannot see *who* set the label; it trusts whatever is there. FAFF-218's original framing, "read-side actor attribution," tried to close that by reading the tracker activity log for a human actor. That is infeasible here: there is no faff bot identity to attribute writes against, and the Linear MCP exposes no per-label-change actor. A filesystem self-marker ("faff wrote this") was also rejected — the legitimate chat crank flows run *agent-side with human confirmation*, so a marker cannot distinguish agent-on-human-confirm from agent-on-its-own.

## Decision

The label-mutation CLI **refuses to write the eligibility-throttle labels in any direction.** `labelOp`/`cmdLabel` in `plugin/skills/faff/bin/faff` will not add *or* remove `faff-automate` or `faff-automation-hold` for any crank flow (crank-up / crank-down / hold / unhold) — it exits deterministically non-zero (code 3) with a message pointing the human at the tracker UI toggle.

- The two labels are flagged `tracker_owned: true` in the `CONTROL_LABELS` manifest; the refusal predicate **reads the flag, not hardcoded names**, so the policy is data-driven and extensible.
- The four chat crank flows — jot's existing-ticket interactor, tidy §4a single + batch, prep's Step-3 gate — become **advisory**: they *name* the label to toggle and tell the human where to flip it, but never execute the write.
- This is the write-abstention counterpart to FAFF-125's read gate (which it makes trustworthy) and shares the guardrail-not-cryptographic-control stance of FAFF-212's intake provenance: refuse the easy machine path, accept the loud-and-rare bypass.

Rejected: read-side actor attribution (no bot identity, no per-label actor in the MCP) and a filesystem self-marker (cannot separate agent-on-confirm from agent-on-its-own).

## Consequences

- **`faff-automate` present ⟹ a human set it directly in the tracker — true by construction.** FAFF-125's read gate is now trustworthy with no actor read, no bot identity, and no new tracker IO. The pure no-tracker-IO CLI invariant is preserved; the policy stays tracker-portable and git-only-safe.
- The gateway's existing prose guard is **upgraded to CLI enforcement** — the rule is now mechanical, not honour-system.
- **FAFF-218 drops its dependency on the actor-attribution primitive.** Siblings FAFF-216/217 still retain that primitive for their own surfaces; this decision narrows it out of the eligibility path only.
- **Residual boundary (accepted):** a raw tracker-MCP call that bypasses the faff CLI can still write the label. Per the FAFF-212 stance this is a guardrail, not cryptographic control — loud-not-impossible, and explicitly out of scope.
- The **human gesture is unchanged**: one-click tracker toggle, zero new ceremony, no human-facing CLI.
- **Future autonomous safety-holds must be designed deliberately.** Any later carve-out (e.g. faff auto-adding `faff-automation-hold` as an emergency brake) reintroduces a machine-write path and must opt out of `tracker_owned` consciously. The machine-breadcrumb labels (`faff-parked`, `faff-jot-intake`, `faff-chain-gap-fill`) stay `tracker_owned: false` and CLI-writable — unaffected.
