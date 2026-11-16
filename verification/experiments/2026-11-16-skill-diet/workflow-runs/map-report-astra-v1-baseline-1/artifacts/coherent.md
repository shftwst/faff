Methodology: faffter-noon-methodology-thematic

## Roadmap: 2026-11-16

One outcome is in flight across one active initiative; no parked work is supplied. The chain joins up end-to-end. Its main risk is that recovery notifications require both Token ledger issues to finish.

### Outcome initiatives

Initiative: Reliable recovery
Status: Active
Success metric: Every accepted recovery request produces one durable token

### Workstreams

```text
Initiative: Reliable recovery
Now    Token ledger             [started] MAP-2, MAP-1
Next   Recovery notifications   [planned] MAP-3
Later  Recovery reporting      [backlog] MAP-4
```

- **MAP-2:** Deduplicate recovery requests.
- **MAP-1:** Store recovery tokens.
- **MAP-3:** Send recovery notifications.
- **MAP-4:** Report recovery delivery.

MAP-2 had a commit yesterday on its active branch. MAP-0, which prepared the token schema, merged two days ago and supports Token ledger. Its satisfied blocker edge to MAP-1 is excluded from the live chain.

### Dependency chain

```text
Reliable recovery
Token ledger (Now)
  MAP-2 ----+
           +--> MAP-3 (Next) --> MAP-4 (Later)
  MAP-1 ----+
```

Yes, the chain joins up.

### Trigger gates

Gate: Token ledger → Recovery notifications
Who fires it: Initiative-internal
Currently fireable?: Yes
Notes: Both upstream issues are in flight and the downstream project exists. Notifications still await completion of both issues.
────────────────────────────────────────
Gate: Recovery notifications → Recovery reporting
Who fires it: Initiative-internal
Currently fireable?: Not yet
Notes: MAP-3 is Todo; Recovery reporting exists but waits for notifications.

### Critical path

- **Now:** Finish Token ledger in the supplied methodology order: MAP-2, then MAP-1. Both are In Progress; independence is verified.
- **Next:** MAP-3 starts after MAP-1 and MAP-2 finish.
- **Later:** MAP-4 follows MAP-3. Recovery reporting intentionally stays one collapsed project until the ledger ships.

### Risks the structure surfaces

- **Ledger-to-notifications dependencies:** MAP-2 and MAP-1 in Token ledger each block MAP-3 in Recovery notifications, within Reliable recovery. Keep both completions in the notification handoff check.
- **Notifications-to-reporting dependency:** MAP-3 in Recovery notifications blocks MAP-4 in Recovery reporting, within Reliable recovery. Check MAP-3 completion before starting reporting.

The supplied diagnostics found no dependency cycles or ghost-project pointers. No horizon findings were returned. The single Later project has an explicit rationale and is not a defect.

Want to shift to today's focus via `/faff-wtf`? (y/n)