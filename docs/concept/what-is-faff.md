---
sidebar_position: 2
---

# What faff is

Under the hood, faff is a **harness**: a set of Claude Code skills wrapping
the delivery loop — issue → spec → build → review → ship — in fixed
contracts and gates. It won't make the model a better engineer. It makes it
**safe to stop watching**, one step at a time.

That's the whole pitch, and it's worth being precise about what it isn't: not
a shortcut, not a convenience layer, not a way to skip the parts of
engineering that matter. The levels below are trust earned per rung, not
convenience gained per rung — and the governance machinery that earns that
trust (the park protocol, the run-ledger, the review gates) is a product in
its own right, not an appendix bolted onto a build tool.

## The tracker as the control plane

The core idea underneath the whole harness is **the tracker as the control
plane**. Your issue tracker drives two halves of automation:

- **Deliver the *right* things** — tracker-driven methodology automation:
  value/risk sequencing, what to focus on next, grooming the backlog.
- **Deliver them *right*** — automated spec-driven development: issue → spec
  → build → review → ship, each stage behind a fixed contract.

In both, the tracker stays the human-legible record, control plane, and
observability surface. That's exactly what makes it safe to step back and
let the loop run — there's nowhere else the state secretly lives, and
nothing faff does is invisible from the board.

## Deterministic tools over prose

A tenet worth calling out on its own: mechanical and contractual work belongs
in testable, reproducible tools, and the model is reserved for discovery,
judgement, and insight — not for re-running a contract the same way every
time. If the same input should always give the same output, that's a tool's
job, not a prompt's. See [Governing principles](./governing-principles.md)
for the full set this comes from.
