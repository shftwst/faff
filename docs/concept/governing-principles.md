---
sidebar_position: 4
---

# Governing principles

Four tenets steer every design call in faff. Each is a tension — *X, not
Y* — and the named mechanism is where it already lives, not an aspiration.
When a spec or a build needs a tie-breaker, these are what it reaches for.

## Deterministic tools over prose

Mechanical and contractual work belongs in testable, reproducible tools; the
model is reserved for discovery, judgement, and insight — not for executing
a contract run-to-run. Rule of thumb: same input must always give the same
output, that's a tool's job; it needs taste or understanding, that's the
model's.

*Embodied by:* the `faff` CLI (`config`, `runcheck`, `validate-adapters`, and
the rest of the config-and-contract surface).

## Configurable, not opinionated

Every behaviour is a swappable slot over a fixed contract — faff ships
sensible defaults you can override, not opinions you must accept.

*Embodied by:* the slots/adaptor model, `.faffrc`, and the appetite dial.

## Adoptable, not all-encompassing

faff integrates rather than owns — it works with your tracker (any MCP),
your agents, and a git-only mode, and you adopt as much of the L1→L4 ladder
as you want.

*Embodied by:* the levels model, git-only mode, tracker autodetection, and
slot delegation to third-party skills.

## Understandable, not unapproachable

Output and behaviour are skimmable and low-cognitive-load, so the human can
always follow what faff did and why — and trust it.

*Embodied by:* the rendering/synthesis pass every human-facing output goes
through, and the human-readable run logs.
