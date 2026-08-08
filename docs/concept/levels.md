---
sidebar_position: 4
---

# Trust levels

A level describes the working agreement for one class of work. It is not a
permanent rank for a team. Routine documentation may run unattended while an
authentication change on the same board remains fully supervised.

| Level | Who runs the work? | When does a person step in? | Entry point |
|---|---|---|---|
| **L1** | The engineer | Throughout | `/faff-wtf`, `/faff-map`, `/faff-jot`, `/faff-plot`, `/faff-prep` |
| **L2** | The agent, one change at a time | At each major gate | `/faff-graft` |
| **L3** | The agent, across an eligible queue | When work is ambiguous, blocked, or ineligible | `/faff-beep-boop` |
| **L4** | The agent, without scheduled supervision | When a guardrail refuses the run or evidence requires judgement | `faff lights-out` |

## L1: you run the loop

You do the engineering. SuperDomestique helps understand the backlog, choose
work, and prepare a specification. No delivery authority has been handed to an
unattended process.

## L2: one supervised build

`/faff-graft` takes one specified issue through implementation and review. The
agent does the work, but the important transitions still wait for approval.
This is the normal place to learn how the system behaves on a repository.

## L3: an unattended queue

`/faff-beep-boop` drains work that a person has made eligible. The run parks
anything it cannot safely call, records why, and leaves the tracker as the
morning view. The run ledger refuses a clean finish while admitted work remains
unaccounted for.

L3 is the current unattended path. See [Unattended runs](/guide/unattended) for
eligibility, parking, and run records.

## L4: lights-out preview

`faff lights-out` adds a fail-closed preflight, budget and liveness controls,
adversarial review, a holdout verdict, and merge interlocks. The machinery
exists, but the complete L4 claim is not yet supported by external proof.

The distinction matters: invoking a guardrail can be mechanically enforced,
while the quality of a model's review remains a judgement. The
[evidence page](./evidence.md) links the current audit and open proof work.

## Choose a level by workload

Start with a narrow class of low-risk, well-tested work. Move it from L1 to L2,
then to L3 only after the results justify less scheduled attention. Other work
can stay at L1 indefinitely. The [adoption guide](/guide/adopting-by-change-class)
shows how eligibility and appetite support that approach.
