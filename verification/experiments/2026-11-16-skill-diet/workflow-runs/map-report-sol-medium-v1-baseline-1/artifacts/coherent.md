Methodology: faffter-noon-methodology-thematic

## Roadmap: 2026-11-16

### TL;DR

One outcome is active: Reliable recovery. The chain joins up from Token ledger through Recovery notifications to Recovery reporting. Cross-project dependencies are the concrete risk: notifications wait for both ledger issues, and reporting waits for notifications.

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

MAP-2 has a commit from yesterday on an active branch. MAP-0, prepare the token schema, merged two days ago and supports Token ledger; its Done status satisfies the former blocker of MAP-1. Later intentionally stays collapsed into one project until the ledger ships.

### Dependency chain

```text
Reliable recovery
Token ledger                 Recovery notifications      Recovery reporting
MAP-2 ──┐
        ├──► MAP-3 ─────────────────────────────────────► MAP-4
MAP-1 ──┘
```

Yes, the chain joins up. The live graph excludes the satisfied MAP-0 blocker edge.

### Trigger gates

Gate: Token ledger → Recovery notifications
Who fires it: Reliable recovery, initiative-internal
Currently fireable: Yes
Notes: Both upstream issues are In Progress and the downstream project exists. Notifications still wait for both issues to finish; fireable does not mean already fired.
────────────────────────────────────────
Gate: Recovery notifications → Recovery reporting
Who fires it: Reliable recovery, initiative-internal
Currently fireable: Not yet
Notes: MAP-3 is Todo and blocked by the ledger issues. Recovery reporting exists.

### Critical path

- **Now:** Finish Token ledger in the returned methodology order: MAP-2, then MAP-1. Both are In Progress; their independence is verified.
- **Next:** MAP-3 is Todo. Send notifications after both ledger blockers finish.
- **Later:** MAP-4 is Backlog and waits for MAP-3. Retain the intentional collapsed reporting project until the ledger ships.

### Risks the structure surfaces

- **Ledger → notifications:** MAP-2 and MAP-1 in Token ledger each block MAP-3 in Recovery notifications. The Now → Next transition depends on both; complete both upstream issues before treating notifications as unblocked.
- **Notifications → reporting:** MAP-3 in Recovery notifications blocks MAP-4 in Recovery reporting. Complete MAP-3 before starting delivery reporting.

Cycle and ghost-project diagnostics returned no findings. No additional methodology horizon findings were supplied.

Want to shift to today's focus via `/faff-wtf`? (y/n)