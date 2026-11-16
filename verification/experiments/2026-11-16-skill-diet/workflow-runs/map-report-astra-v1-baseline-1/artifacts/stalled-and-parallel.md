Methodology: faffter-noon-methodology-thematic

## Roadmap: 2026-11-16

One outcome is in flight across one active initiative; no parked work is supplied. The dependency chain joins up, but Token ledger has had no commits for 16 days despite being marked started. Its two tasks also lack verified independence, so an overnight parallel run could repeat work.

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

No recent git activity is supplied; Token ledger has gone 16 days without commits. MAP-0, which prepared the token schema, is Done, and its satisfied edge to MAP-1 is excluded from the live chain.

### Dependency chain

```text
Reliable recovery
Token ledger (Now)
  MAP-2 ----+
           +--> MAP-3 (Next) --> MAP-4 (Later)
  MAP-1 ----+
```

Yes, the chain joins up. Graph connectivity does not establish delivery movement or safe parallel execution.

### Trigger gates

Gate: Token ledger → Recovery notifications
Who fires it: Initiative-internal
Currently fireable?: Yes, by recorded status
Notes: Both ledger issues are In Progress and the downstream project exists. The 16-day commit gap warrants review of whether those statuses still describe active work. Notifications await both completions.
────────────────────────────────────────
Gate: Recovery notifications → Recovery reporting
Who fires it: Initiative-internal
Currently fireable?: Not yet
Notes: MAP-3 is Todo; Recovery reporting exists but awaits notifications.

### Critical path

- **Now:** Finish Token ledger in methodology order: MAP-2, then MAP-1. Both are In Progress; do not infer independence from the absence of blocker links.
- **Next:** MAP-3 follows completion of both ledger issues.
- **Later:** MAP-4 follows MAP-3. Recovery reporting intentionally stays collapsed until the ledger ships.

### Risks the structure surfaces

- **Delivery risk, methodology severity 1:** Token ledger has two unverified parallel tasks; a collision could repeat work. Verify independence before an overnight run, using `/faff-tidy` scoped to Token ledger.
- **Stalled work or stale status:** Token ledger has no commits for 16 days, exceeding the 14-day check. Review MAP-2 and MAP-1 with the human to establish whether work is stalled or the project status is stale.
- **Ledger-to-notifications dependencies:** MAP-2 and MAP-1 in Token ledger each block MAP-3 in Recovery notifications under Reliable recovery. Confirm both completions at the handoff.
- **Notifications-to-reporting dependency:** MAP-3 in Recovery notifications blocks MAP-4 in Recovery reporting under Reliable recovery. Keep reporting behind notification completion.

The supplied diagnostics found no cycles or ghost-project pointers. The collapsed Later project is intentional.

MAP-2 is explicitly picked and has a spec. Start building now via `/faff-graft MAP-2`? (y/n)

Run `/faff-tidy` scoped to Token ledger to verify independence before queuing overnight runs? (y/n)

Stalled or stale? Open Token ledger for review (open) / leave (skip)?

Want to shift to today's focus via `/faff-wtf`? (y/n)