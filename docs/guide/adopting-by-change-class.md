# Adopting by change class

This page is for teams deciding which work agents may run with less supervision.
Complete [Your first runs](walkthroughs.md) before changing eligibility. Continue
with [Unattended runs at L3](unattended.md) when one narrow class is ready.

Choose an autonomy level for a kind of work, not for the whole team. A repository
can run documentation changes unattended while keeping authentication or schema
changes under direct supervision.

A change class is an informal group of changes with a similar risk profile:

| Lower risk | Higher risk |
|---|---|
| dependency updates | schema migrations |
| documentation | authentication and permissions |
| test backfill | public API changes |
| configuration covered by CI | changes that are difficult to reverse |

## Start with nothing eligible

The default `automation_default: opt-in` setting leaves unlabelled work alone.
A person makes a ticket eligible by adding `faff-automate`. The
`faff-automation-hold` label always excludes a ticket.

The system may recommend a change in eligibility, but it does not set these
tracker-owned labels itself. The decision to hand over work remains visible in
the tracker.

## Widen the scope gradually

1. Pick one narrow class with good tests and a cheap rollback.
2. Run a few tickets at L2 and inspect the specifications, changes, and reviews.
3. Mark that class eligible for L3 when the results justify unattended work.
4. Read the tracker and run records after each unattended batch.
5. Add another class only when its own risk and evidence support the change.

There is no need to move sensitive work. It can remain at L1 while proven work
runs at L3.

## Three controls

| Control | What it decides |
|---|---|
| Per-ticket eligibility | Whether the unattended pipeline may consider the ticket |
| Project appetite | How much work the pipeline may do before checking back |
| Routing verdict | Whether the ticket is clear and supported enough to admit |

Eligibility selects the work. Appetite limits its freedom. The routing verdict
parks work the system cannot confidently call.

Current crank-up sets group work by dependency chain, not by change class. A
person still applies eligibility to the individual tickets or proposed chain.

For the mechanics of an unattended run, see [Unattended runs](unattended.md).
For the available settings, see [Configuration](configuration.md).
