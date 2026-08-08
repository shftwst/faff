---
sidebar_position: 2
---

# What SuperDomestique is

SuperDomestique, currently shipped as `faff`, is an engineering system for
progressively autonomous software delivery. The current implementation combines
agent skills, a dependency-free CLI, tracker and git workflows, and fixed
contracts and gates around the delivery loop from issue to shipment.

It does not make a model a better engineer, remove subjective judgement, or
promise defect-free output. It reduces scheduled human attention only where
the named controls and evidence support that workload. The levels are trust
earned per rung, and the Commissaire governance responsibility is part of the
product rather than an appendix to a build tool.

Commands and every other current technical identifier remain `faff`. See
[positioning and language](./positioning-and-language.md) for the staged naming
decision and evidence-bounded writing rules, and [execution and governance](./execution-and-governance.md)
for the current responsibility boundary.

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
nothing the current `faff` implementation does is invisible from the board.

## Deterministic tools over prose

A tenet worth calling out on its own: mechanical and contractual work belongs
in testable, reproducible tools, and the model is reserved for discovery,
judgement, and insight — not for re-running a contract the same way every
time. If the same input should always give the same output, that's a tool's
job, not a prompt's. See [Governing principles](./governing-principles.md)
for the full set this comes from.
