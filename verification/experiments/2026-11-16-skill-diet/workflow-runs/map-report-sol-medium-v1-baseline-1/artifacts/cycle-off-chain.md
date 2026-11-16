Methodology: faffter-noon-methodology-thematic

## Roadmap: 2026-11-16

### TL;DR

One outcome is active: Reliable recovery. Its ledger → notifications → reporting chain joins up. The biggest defect is a separate dependency cycle between internal flag naming and fixture naming; it needs repair even though it does not touch this chain.

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

MAP-2 has a commit from yesterday on an active branch. MAP-0, prepare the token schema, merged two days ago and supports Token ledger. Its Done status satisfies its former blocker of MAP-1. Later is intentionally one collapsed project until the ledger ships.

### Dependency chain

```text
Reliable recovery
Token ledger                 Recovery notifications      Recovery reporting
MAP-2 ──┐
        ├──► MAP-3 ─────────────────────────────────────► MAP-4
MAP-1 ──┘
```

Yes, the chain joins up. The returned cycle is entirely off this chain; the satisfied MAP-0 edge is excluded.

### Trigger gates

Gate: Token ledger → Recovery notifications
Who fires it: Reliable recovery, initiative-internal
Currently fireable: Yes
Notes: Both ledger issues are In Progress and notifications exists. Notifications still wait for both to finish.
────────────────────────────────────────
Gate: Recovery notifications → Recovery reporting
Who fires it: Reliable recovery, initiative-internal
Currently fireable: Not yet
Notes: MAP-3 is Todo, waiting for the ledger; reporting exists.

### Critical path

- **Now:** Finish MAP-2, then MAP-1, preserving the methodology's order. Both ledger issues are In Progress and independence is verified.
- **Next:** MAP-3 sends notifications after both ledger issues finish.
- **Later:** MAP-4 reports delivery after MAP-3 finishes. Keep Later collapsed until the ledger ships, as intended.

### Risks the structure surfaces

- **Off-chain dependency cycle:** MAP-7 renames an internal flag; MAP-8 refreshes old fixture names. Both are Backlog and block each other: `[MAP-7 → MAP-8 → MAP-7]`. Review removing MAP-7's blocker on MAP-8 so the flag can be renamed before fixtures are refreshed; confirm that sequence before changing links. This defect does not change the recovery chain's join-up result.
- **Ledger → notifications:** MAP-2 and MAP-1 in Token ledger block MAP-3 in Recovery notifications. Complete both ledger issues before releasing the Now → Next transition.
- **Notifications → reporting:** MAP-3 in Recovery notifications blocks MAP-4 in Recovery reporting. Complete MAP-3 before starting reporting.

Ghost-project diagnostics and additional methodology horizon findings are empty. The cycle was detected this pass despite no tidy pass.

Want to shift to today's focus via `/faff-wtf`? (y/n)