---
sidebar_position: 5
---

# Governing principles

Four rules guide SuperDomestique's design.

## Use tools for repeatable decisions

If the same input must produce the same answer, a deterministic tool should do
the work. Models are used where interpretation is required. The `faff` CLI
therefore owns schema checks, run state, budgets, and contract outcomes.

## Keep the contracts fixed and the workers replaceable

Slots choose which skill or service performs a task. Fixed contracts define the
result that the rest of the system may consume. Teams can replace a spec writer
or reviewer without teaching every later stage a new vocabulary.

## Adopt one workload at a time

Eligibility belongs to a ticket, not a whole team. A team can hand off routine
work and retain direct control of changes with wider consequences. Appetite and
routing rules limit how far eligible work may proceed.

## Make outcomes easy to inspect

The tracker records progress, parked questions, and delivery outcomes. Run
records retain the supporting evidence. Human-facing output should say what
happened, why it stopped, and what decision is needed next.
