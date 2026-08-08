---
sidebar_position: 2
---

# The delivery system

SuperDomestique turns tracker work into reviewed software changes. The current
distribution is the `faff` plugin and CLI.

The delivery path is:

```text
intent -> tracker work -> specification -> build -> review -> delivery
```

Agents handle the work inside that path. Fixed contracts define the records
each stage must produce and the outcomes the next stage may accept. A person
sets the objective, decides which work is eligible for automation, and resolves
questions the available evidence cannot settle.

## The tracker is the control plane

The tracker carries the plan and the current state. SuperDomestique uses it to:

- capture ideas and break them into buildable work;
- order work by outcomes and dependencies;
- attach specifications and product decisions;
- record progress, parked questions, and delivery outcomes.

Run records provide more detailed evidence, but people should not need to read
raw logs to find out what happened. The tracker remains the normal place to
inspect or redirect the work.

## Judgement stays judgement

Models are used for discovery, planning, implementation, review, and other work
that needs interpretation. Deterministic tools handle repeatable checks such as
schema validation, budgets, run state, and allowed contract outcomes.

This division does not make model decisions objectively correct. It makes the
decision, its evidence, and its failure path visible to the next gate. See
[Commissaire](./execution-and-governance.md) for the full responsibility
boundary.

## Start supervised

The first useful path is interactive:

1. `/faff-jot` captures work.
2. `/faff-prep ISSUE-XX` prepares a specification.
3. `/faff-graft ISSUE-XX` builds one issue and pauses at its approval gates.

Once a team trusts that path for a narrow class of work, `/faff-beep-boop` can
process eligible tickets unattended. The [levels](./levels.md) and
[adoption guide](/guide/adopting-by-change-class) explain how to widen that
scope without changing the posture of the whole team.
