Methodology: faffter-noon-methodology-thematic

## Roadmap: 2026-11-16

### TL;DR

One outcome is active: Reliable recovery. A dependency cycle between the two Token ledger issues breaks the chain to notifications and reporting. Resolve one mutual blocker before treating the Now → Next gate as usable.

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

MAP-2 has a commit from yesterday on an active branch. MAP-0, prepare the token schema, merged two days ago and supports Token ledger. Its Done status satisfies its former blocker edge to MAP-1. The single Later project is intentional until the ledger ships.

### Dependency chain

```text
Reliable recovery
Token ledger: [MAP-1 → MAP-2 → MAP-1]
                    │ cycle prevents completion
                    ▼
Next: Recovery notifications (MAP-3)
                    │
                    ▼
Later: Recovery reporting (MAP-4)
```

No: a dependency cycle breaks the chain: MAP-1, MAP-2, MAP-1. Both ledger issues block MAP-3; MAP-3 blocks MAP-4. The satisfied MAP-0 edge is excluded.

### Trigger gates

Gate: Token ledger → Recovery notifications
Who fires it: Reliable recovery, initiative-internal
Currently fireable: Blocked by cycle
Notes: Both ledger issues are marked In Progress and notifications exists, but the mutual live blockers prevent completion. Status alone cannot establish a usable gate.
────────────────────────────────────────
Gate: Recovery notifications → Recovery reporting
Who fires it: Reliable recovery, initiative-internal
Currently fireable: Not yet
Notes: MAP-3 is Todo, waiting for both ledger issues. Reporting exists but remains downstream of the cycle.

### Critical path

- **Now:** Retain methodology order MAP-2, then MAP-1. Resolve their mutual blocker before either can complete the ledger path.
- **Next:** MAP-3 waits for both ledger issues to finish before notifications can proceed.
- **Later:** MAP-4 waits for MAP-3. Keep the intentional collapsed reporting project until the ledger ships.

### Risks the structure surfaces

- **Dependency cycle:** `[MAP-1 → MAP-2 → MAP-1]` is the returned diagnostic cycle and touches the rendered chain. Review and remove MAP-2's blocker on MAP-1 if deduplication can precede storage; otherwise re-sequence the work and remove the opposite blocker. Confirm the valid direction before changing tracker links.
- **Ledger → notifications:** MAP-2 and MAP-1 in Token ledger both block MAP-3 in Recovery notifications. Break the ledger cycle and complete both issues to release this gate.
- **Notifications → reporting:** MAP-3 in Recovery notifications blocks MAP-4 in Recovery reporting. Complete notifications before starting reporting.

Ghost-project diagnostics and additional methodology horizon findings are empty.

Plan the missing structure or dependency repair via `/faff-plot`? (y/n)

Want to shift to today's focus via `/faff-wtf`? (y/n)