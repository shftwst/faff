Methodology: faffter-noon-methodology-thematic

## Roadmap: 2026-11-16

### TL;DR

One outcome is active: Reliable recovery, and its ledger → notifications → reporting chain joins up structurally. Token ledger has no commits in 16 days, so its started status may be stale or delivery may be stalled. Independence of its two tasks is unverified; verify it before an overnight parallel run.

### Outcome initiatives

Initiative: Reliable recovery
Status: Active
Success metric: Every accepted recovery request produces one durable token

### Workstreams

```text
Initiative: Reliable recovery

Now    Token ledger            [started]
       MAP-2  Deduplicate recovery requests
       MAP-1  Store recovery tokens
Next   Recovery notifications  [planned]
       MAP-3  Send recovery notifications
Later  Recovery reporting      [backlog]
       MAP-4  Report recovery delivery
```

No recent git activity was supplied. Token ledger has gone 16 days without commits despite being marked started. MAP-0, prepare the token schema, is Done and its former blocker of MAP-1 is satisfied; no recent merge date is supplied. Later is intentionally collapsed into one project until the ledger ships.

### Dependency chain

```text
Reliable recovery
Token ledger                 Recovery notifications      Recovery reporting
MAP-2 ──┐
        ├──► MAP-3 ─────────────────────────────────────► MAP-4
MAP-1 ──┘
```

Yes, the chain joins up. This is graph coherence, with delivery progress and parallel safety unresolved. The satisfied MAP-0 edge is excluded.

### Trigger gates

Gate: Token ledger → Recovery notifications
Who fires it: Reliable recovery, initiative-internal
Currently fireable: Yes, by tracker state
Notes: Both ledger issues are In Progress and notifications exists. Completion still gates notifications; the 16-day absence of commits warrants reviewing those statuses.
────────────────────────────────────────
Gate: Recovery notifications → Recovery reporting
Who fires it: Reliable recovery, initiative-internal
Currently fireable: Not yet
Notes: MAP-3 is Todo, waiting for both ledger issues; reporting exists.

### Critical path

- **Now:** MAP-2, then MAP-1, in the returned methodology order. Review Token ledger's stalled or stale state and verify task independence before parallel execution.
- **Next:** MAP-3 sends notifications after both ledger blockers finish.
- **Later:** MAP-4 reports delivery after MAP-3 finishes. Keep the collapsed Later project until the ledger ships, as intended.

### Risks the structure surfaces

- **Stalled or stale Now project:** Token ledger has no commits in 16 days, exceeding the 14-day threshold. Open its issues for human review to determine whether delivery stalled or the tracker status needs attention.
- **Unverified parallel work, methodology severity 1:** Token ledger has two unverified parallel tasks; a collision could repeat work. Verify independence before an overnight run through a `/faff-tidy` pass scoped to Token ledger.
- **Ledger → notifications:** MAP-2 and MAP-1 in Token ledger both block MAP-3 in Recovery notifications. Complete both before releasing the Now → Next transition.
- **Notifications → reporting:** MAP-3 in Recovery notifications blocks MAP-4 in Recovery reporting. Complete MAP-3 before starting reporting.

Cycle and ghost-project diagnostics returned no findings.

Picking up MAP-2, deduplicate recovery requests; a spec exists. Start building now via `/faff-graft MAP-2`? (y/n)

Run `/faff-tidy` scoped to Token ledger to verify independence before queuing overnight runs? (y/n)

Token ledger: stalled or stale? Open the project for review (open) / leave (skip)?

Want to shift to today's focus via `/faff-wtf`? (y/n)