---
sidebar_position: 3
---

# Commissaire: the governance system

Commissaire governs the delivery loop. It records evidence, checks objective
rules, and controls whether work may move through a boundary. It does not write
the feature or turn an engineering judgement into a fact.

In the current `faff` distribution, Commissaire is a logical code region. It is
not yet a separate package, process, service, or security boundary.

## Who decides what

| Responsibility | Owner | Examples |
|---|---|---|
| Reasoning and execution | AI agents | planning, specification, implementation, review |
| Objective checks | Deterministic code and forge controls | schemas, budgets, liveness, allowed outcomes, required checks |
| Engineering judgement | AI reviewers and people | design quality, review findings, interpretive acceptance criteria |
| Authority | People | objectives, eligibility, credentials, risk acceptance, parked decisions |

A typical boundary works like this:

```text
agent or person makes a judgement
              |
              v
structured result is recorded
              |
              v
deterministic code checks its shape and allowed outcome
              |
              v
delivery proceeds, stops, or returns to a person
```

The checker can reject a malformed review verdict or prevent an unknown value
from becoming a pass. It cannot prove that the reviewer's assessment was good.

## What Commissaire checks

The current governance region contains reusable mechanics for:

- run events, heartbeats, and progress records;
- budgets, declared effects, and intervention signals;
- run completion, reconciliation, and audit;
- validation of structured contracts and their failure direction.

The delivery system supplies the software-specific policy. It decides what
makes a ticket eligible, which verdicts a build needs, how worktrees and test
environments are used, and what must be true before a change may merge.

This distinction is why `governance-check` and `merge-gate` still belong to the
delivery side today. They apply SuperDomestique's specific review, holdout, and
merge policy using evidence produced by the underlying governance mechanics.

## The code boundary

The source dependency rule is one-way:

```text
dispatch -> delivery policy -> governance mechanics -> shared infrastructure
```

`faff regions check` verifies that governance code does not import delivery
policy. CI runs that check. This makes future extraction possible, but does not
provide process isolation or an independent security boundary.

## The merge boundary

The strongest governance point is outside the agent's own process. A pull
request can carry run records, and `governance-check` can re-evaluate them in
CI. When that check is required by branch protection, a cooperating agent
cannot omit the check and still merge through the normal path.

The check validates the records it receives. It does not yet prove that every
record was authored honestly. The [evidence page](./evidence.md) and
[governance-check guide](/guide/governance-check) describe the current status
and the remaining external-verification work.

## Implementation references

- [`regions.js`](https://github.com/shftwst/faff/blob/main/plugin/skills/faff/bin/lib/regions.js)
  owns the current region map and dependency check.
- [`contract-engine.js`](https://github.com/shftwst/faff/blob/main/plugin/skills/faff/bin/lib/contract-engine.js)
  validates generic contract shapes and failure directions.
- [`contract-defs.js`](https://github.com/shftwst/faff/blob/main/plugin/skills/faff/bin/lib/contract-defs.js)
  defines delivery-specific verdicts.
- [ADR 0042](https://github.com/shftwst/faff/blob/main/docs/adr/0042-three-tier-region-model-shared-infra-governance-factory-with-a-one-way-direction.md)
  records the current architecture decision.
