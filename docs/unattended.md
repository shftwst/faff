# Unattended runs (L3)

`/faff-beep-boop` runs the whole pipeline without a human in the loop — the *on the loop* level. Good for overnight, meetings, or anything you want off your plate. This page is the deep-dive on how it stays safe to walk away from.

## How the loop works

```
new idea / project → tickets → "what should I work on?" → prep it → build it
                                       ↑                                |
                                       └────────── reprep ←─────────────┘
```

`/faff-jot` is the front door — everything else acts on tickets that already exist, and jot (or `/faff-plot`, for a whole application) is how they come to exist. From there each step chains to the next behind a yes/no gate: say yes, keep moving; say no, stop. No ceremonies, no standups with 12 people — just you and your code.

## Fire and forget

`/faff-beep-boop` drives that loop end to end with no human gates:

- Default: the whole shebang — tidy, then prep every backlog issue, then build whatever's ready
- `ISSUE-12 ISSUE-15`: just those
- Cap the run with `--until 06:00` (stop at a wall-clock time) or `--max 5` (stop after N builds) — the queue drains in priority order and whatever's unreached is left for the next run

Auto-merges when every acceptance criterion is verified, CI is green, and review passed. Otherwise the PR is left open with a clear reason.

## What keeps it honest

The safety net isn't you staying awake — it's mechanical and always on:

- **Park protocol.** Anything the run can't confidently call is *parked*, never quietly binned. Parked work surfaces in `/faff-wtf` the next morning.
- **Run-ledger.** Every run writes a full audit trail under `.faff/runs/`. The ledger refuses to call a run "done" if it left admitted work dangling (`faff runcheck` audits this).

## The tracker is the control plane

In an unattended run the tracker is the human-legible record, control plane, and observability surface that makes it safe to step back. Every issue's status, spec, park reason, and delivery outcome is reflected back into the tracker — so when you wake up, the morning view is the tracker plus the run-ledger, not a wall of logs. That's what makes L3 a place you can actually leave the building from.
