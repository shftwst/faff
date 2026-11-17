Methodology: faffter-noon-methodology-thematic

## Roadmap: 2026-11-16

One outcome is in flight across one active initiative; no parked work is supplied. The roadmap has a visible break at Next: the initiative description names Recovery notifications, but no project exists. Reporting depends on an unresolved issue reference at that missing stage.

### Outcome initiatives

Initiative: Reliable recovery
Status: Active
Success metric: Every accepted recovery request produces one durable token
Description: Next is Recovery notifications, to notify users after durable token creation.
────────────────────────────────────────
Structural gap: Recovery notifications
Status: No project exists
Consequence: The described Next stage has no project through which its gate can fire.

### Workstreams

```text
Initiative: Reliable recovery
Now    Token ledger             [started] MAP-2, MAP-1
Next   (no project planned)     structural gap
Later  Recovery reporting      [backlog] MAP-4
```

- **MAP-2:** Deduplicate recovery requests.
- **MAP-1:** Store recovery tokens.
- **MAP-4:** Report recovery delivery.
- **MAP-3:** Unresolved blocker reference on MAP-4; the supplied snapshot provides no issue title or record from which to derive a work description.

MAP-2 had a commit yesterday on its active branch. MAP-0, which prepared the token schema, merged two days ago and supports Token ledger. Its satisfied edge to MAP-1 is excluded from the live chain.

### Dependency chain

```text
Reliable recovery
Now: Token ledger (MAP-2, MAP-1)
          : intended transition in description
          X Next: Recovery notifications missing
          : no live project/issue record to connect
       MAP-3 unresolved --> MAP-4 (Later)
```

Yes, with 1 visible discontinuity: the intended Next stage has no project. The end-to-end execution path is incomplete; only MAP-3's unresolved blocker edge to MAP-4 is established downstream.

### Trigger gates

Gate: Token ledger → Recovery notifications
Who fires it: Initiative-internal
Currently fireable?: Blocked structurally
Notes: The description names Recovery notifications, no project exists. Both ledger issues are in flight, but the downstream container is missing.
────────────────────────────────────────
Gate: Recovery notifications → Recovery reporting
Who fires it: Initiative-internal
Currently fireable?: Blocked
Notes: Reporting exists, but MAP-4's blocker MAP-3 has no resolvable status in this snapshot. Treat the edge as live; its intended upstream project is missing.

### Critical path

- **Now:** Finish Token ledger in methodology order: MAP-2, then MAP-1. Both are In Progress and independence is verified.
- **Next:** No issues were returned in this horizon. Plan the missing Recovery notifications project and resolve MAP-3's reference before claiming a connected path.
- **Later:** MAP-4 remains blocked. Recovery reporting intentionally stays one collapsed project until the ledger ships.

### Risks the structure surfaces

- **Missing Next project:** The description names Recovery notifications, no project exists. The issue-side ghost pointer on MAP-4 identifies the same missing project, so this is one combined finding. Plan that project and reconcile MAP-4's blocker with a real upstream issue.

The supplied diagnostics found no cycles, and no horizon findings were returned. No cross-project edge can be assigned to the missing project's membership from this snapshot. The intentional single Later project is not a defect.

Plan the missing structure via `/faff-plot`? (y/n)

Want to shift to today's focus via `/faff-wtf`? (y/n)