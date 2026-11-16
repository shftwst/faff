Methodology: faffter-noon-methodology-thematic

## Roadmap: 2026-11-16

One outcome is in flight across one active initiative; no parked work is supplied. A dependency cycle between storing tokens and deduplicating requests breaks the path to notifications and reporting. Resolve that cycle before treating the ledger handoff as executable.

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

- **MAP-2:** Deduplicate recovery requests; resolving its mutual blocker with MAP-1 lets the ledger work proceed towards notifications.
- **MAP-1:** Store recovery tokens; resolving its mutual blocker with MAP-2 lets the ledger work proceed towards notifications.
- **MAP-3:** Send recovery notifications.
- **MAP-4:** Report recovery delivery.

MAP-2 had a commit yesterday on its active branch. MAP-0, which prepared the token schema, merged two days ago and supports Token ledger. Its satisfied edge to MAP-1 is excluded from the live chain.

### Dependency chain

```text
Reliable recovery
Token ledger (Now)
 [MAP-1 → MAP-2 → MAP-1]
    MAP-2 ----+
             +--> MAP-3 (Next) --> MAP-4 (Later)
    MAP-1 ----+
```

No: a dependency cycle breaks the chain: MAP-1 → MAP-2 → MAP-1.

### Trigger gates

Gate: Token ledger → Recovery notifications
Who fires it: Initiative-internal
Currently fireable?: Blocked by cycle
Notes: Both ledger issues are marked In Progress and the downstream project exists, but each ledger issue waits on the other. Their status alone does not establish an executable handoff.
────────────────────────────────────────
Gate: Recovery notifications → Recovery reporting
Who fires it: Initiative-internal
Currently fireable?: Not yet
Notes: MAP-3 is Todo and waits behind the ledger cycle; Recovery reporting exists.

### Critical path

- **Now:** Preserve the methodology order, MAP-2 then MAP-1, while resolving their mutual blockers. Their In Progress statuses do not remove the cycle.
- **Next:** MAP-3 waits for both ledger issues to finish.
- **Later:** MAP-4 waits for MAP-3. Recovery reporting intentionally stays collapsed until the ledger ships.

### Risks the structure surfaces

- **Dependency cycle:** MAP-1 → MAP-2 → MAP-1 prevents Token ledger from completing its dependency sequence. Propose removing MAP-1's blocked-by-MAP-2 edge and delivering token storage first, after confirming that implementation direction is valid. This is a proposed graph repair, not a change to the returned methodology order.
- **Ledger-to-notifications dependencies:** MAP-2 and MAP-1 in Token ledger block MAP-3 in Recovery notifications under Reliable recovery. Recheck this handoff after repairing the cycle.
- **Notifications-to-reporting dependency:** MAP-3 in Recovery notifications blocks MAP-4 in Recovery reporting under Reliable recovery. Keep reporting behind notification completion.

No ghost-project pointers or horizon findings were returned. Independence was marked verified, but that does not override the explicit dependency cycle. The single Later project is intentional.

Plan the missing or broken structure via `/faff-plot`? (y/n)

Want to shift to today's focus via `/faff-wtf`? (y/n)