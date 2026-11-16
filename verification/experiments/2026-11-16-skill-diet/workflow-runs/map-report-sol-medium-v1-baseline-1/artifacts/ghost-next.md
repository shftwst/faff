Methodology: faffter-noon-methodology-thematic

## Roadmap: 2026-11-16

### TL;DR

One outcome is active: Reliable recovery. Its description names Recovery notifications as Next, but no project exists, breaking the route from ledger work to delivery reporting. Plan that missing project and resolve reporting's missing blocker before treating the chain as connected.

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
Next   (no project planned)    structural gap
Later  Recovery reporting      [backlog]
       MAP-4  Report recovery delivery
```

MAP-2 has a commit from yesterday on an active branch. MAP-0, prepare the token schema, merged two days ago and supports Token ledger; its Done status satisfies its former blocker of MAP-1. Reporting intentionally stays collapsed into one Later project until the ledger ships.

### Dependency chain

```text
Reliable recovery
Now: Token ledger (MAP-2, MAP-1)
                 │ no live link to a Next project supplied
                 ▼
Next: [GAP: Recovery notifications has no project]
                 │ MAP-3 absent from snapshot
                 ▼
Later: Recovery reporting (MAP-4 waits for MAP-3)
```

No: Reliable recovery has no continuous path through its stated Next stage to delivery reporting. MAP-3 is an unresolved blocker reference, not a verified issue in this snapshot; its title and status are unavailable. Its edge remains live under the fail-safe rule. The satisfied MAP-0 edge is excluded.

### Trigger gates

Gate: Token ledger → Recovery notifications
Who fires it: Reliable recovery, initiative-internal
Currently fireable: Blocked structurally
Notes: Ledger issues are In Progress, but the named downstream project does not exist.
────────────────────────────────────────
Gate: Recovery notifications → Recovery reporting
Who fires it: Reliable recovery, initiative-internal
Currently fireable: Blocked structurally
Notes: Reporting exists, but its upstream notifications project is missing and MAP-3 cannot be resolved from the supplied snapshot.

### Critical path

- **Now:** Finish MAP-2, then MAP-1, preserving methodology order. Their independence is verified.
- **Next:** No ordered issues or project exist. Plan the described notifications stage and establish its real dependencies.
- **Later:** MAP-4 waits for unresolved MAP-3. Retain the intentional collapsed reporting project while repairing the missing Next structure.

### Risks the structure surfaces

- **Missing Next project:** The initiative description names Recovery notifications, no project exists. The issue-side ghost pointer on MAP-4 confirms the same gap, counted once. Plan the notifications project and reconcile MAP-4's blocker reference so reporting has a real upstream route.

Cycle diagnostics and additional methodology horizon findings are empty. The deliberate single-project Later horizon is not a defect.

Plan the missing structure via `/faff-plot`? (y/n)

Want to shift to today's focus via `/faff-wtf`? (y/n)