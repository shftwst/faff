Methodology: faffter-noon-methodology-thematic

## Roadmap: 2026-11-16

One outcome is in flight across one active initiative; no parked work is supplied. The recovery chain joins up end-to-end. A separate cycle between internal flag renaming and fixture renaming remains a backlog defect, though it does not block this chain.

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

MAP-2 had a commit yesterday on its active branch. MAP-0, which prepared the token schema, merged two days ago and supports Token ledger. Its satisfied edge to MAP-1 is excluded from the live chain.

### Dependency chain

```text
Reliable recovery
Token ledger (Now)
  MAP-2 ----+
           +--> MAP-3 (Next) --> MAP-4 (Later)
  MAP-1 ----+
```

Yes, the chain joins up. The supplied cycle has no member on this chain.

### Trigger gates

Gate: Token ledger → Recovery notifications
Who fires it: Initiative-internal
Currently fireable?: Yes
Notes: Both upstream issues are in flight and the downstream project exists. Notifications await both completions.
────────────────────────────────────────
Gate: Recovery notifications → Recovery reporting
Who fires it: Initiative-internal
Currently fireable?: Not yet
Notes: MAP-3 is Todo; Recovery reporting exists but waits for notifications.

### Critical path

- **Now:** Finish Token ledger in methodology order: MAP-2, then MAP-1. Both are In Progress and independence is verified.
- **Next:** MAP-3 follows completion of both ledger issues.
- **Later:** MAP-4 follows MAP-3. Recovery reporting intentionally remains one collapsed project until the ledger ships.

### Risks the structure surfaces

- **Off-chain dependency cycle:** MAP-7 renames an internal flag; MAP-8 refreshes old fixture names. Both are Backlog and each blocks the other. Propose removing MAP-7's blocked-by-MAP-8 edge so the flag can be renamed before fixtures, subject to confirming that sequence is valid.

```text
[MAP-7 → MAP-8 → MAP-7]
```

- **Ledger-to-notifications dependencies:** MAP-2 and MAP-1 in Token ledger each block MAP-3 in Recovery notifications under Reliable recovery. Check both completions before the notification handoff.
- **Notifications-to-reporting dependency:** MAP-3 in Recovery notifications blocks MAP-4 in Recovery reporting under Reliable recovery. Check notification completion before starting reporting.

No ghost-project pointers or horizon findings were returned. The single Later project is intentional.

Review the off-chain cycle and proposed edge repair via `/faff-tidy`? (y/n)

Want to shift to today's focus via `/faff-wtf`? (y/n)