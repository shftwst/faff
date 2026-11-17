Methodology: faffter-noon-methodology-thematic

## Roadmap: 2026-11-16

One outcome is in flight and one is planned across two initiatives; one issue is parked. The recovery-to-observability chain joins up, but delivery alerts have no route out of their park because Alert routing does not exist as a planned project. Planning that missing trigger is the clearest structural action.

### Outcome initiatives

Initiative: Reliable recovery
Status: Active
Success metric: Every accepted recovery request produces one durable token
────────────────────────────────────────
Initiative: Account observability
Status: Planned
Success metric: Operators see failed recovery delivery

### Workstreams

```text
Initiative: Reliable recovery
Now    Token ledger             [started] MAP-2, MAP-1
Next   Recovery notifications   [planned] MAP-3
Later  Recovery reporting      [backlog] MAP-4

Initiative: Account observability
Now    (no project planned)     structural gap
Next   Operations dashboard    [planned] MAP-9
Later  (no project planned)     structural gap
```

- **MAP-2:** Deduplicate recovery requests.
- **MAP-1:** Store recovery tokens.
- **MAP-3:** Send recovery notifications.
- **MAP-4:** Report recovery delivery.
- **MAP-9:** Display failed recovery delivery.
- **MAP-6:** Enable delivery alerts; parked until Alert routing ships. Its initiative and project membership are not supplied.

Reliable recovery: MAP-2 had a commit yesterday on its active branch. MAP-0, which prepared the token schema, merged two days ago and supports Token ledger; its satisfied edge to MAP-1 is excluded from the live graph.

Account observability: no recent git activity is supplied. Its missing Now does not sever the dashboard's incoming dependency from Reliable recovery; no Later work or rationale is supplied.

### Dependency chain

```text
Reliable recovery
Token ledger (Now)
  MAP-2 ----+
           +--> MAP-3 (Next) --> MAP-4 (Later)
  MAP-1 ----+                       |
                                    v
Account observability: Operations dashboard (Next)
                                  MAP-9

Separate parked branch, membership unspecified:
[Alert routing missing] --X--> MAP-6
```

Yes, with 1 visible discontinuity: the parked alert branch lacks its trigger project. The recovery-to-dashboard chain joins up; Account observability's absent horizon containers do not add a proven break to that chain.

### Trigger gates

Gate: Token ledger → Recovery notifications
Who fires it: Initiative-internal
Currently fireable?: Yes
Notes: Both upstream issues are in flight and notifications exists; MAP-3 still awaits both completions.
────────────────────────────────────────
Gate: Recovery notifications → Recovery reporting
Who fires it: Initiative-internal
Currently fireable?: Not yet
Notes: MAP-3 is Todo; the reporting project exists.
────────────────────────────────────────
Gate: Reliable recovery → Account observability
Who fires it: Cross-initiative dependency
Currently fireable?: Not yet
Notes: MAP-4 in Recovery reporting is Backlog and blocks MAP-9 in Operations dashboard. The downstream project exists.
────────────────────────────────────────
Gate: Alert routing ships → MAP-6 unparks
Who fires it: Resolve the missing trigger, then normal routing on a tidy pass
Currently fireable?: Blocked structurally
Notes: Alert routing is absent. The condition cannot be met as currently planned.

### Critical path

- **Now:** Finish Token ledger in supplied methodology order: MAP-2, then MAP-1. Both are In Progress and independence is verified.
- **Next:** MAP-3 follows both ledger completions. Operations dashboard remains in its assigned Next horizon, but MAP-9 waits for MAP-4 in Reliable recovery's Later horizon. No relative methodology ordering for MAP-9 was supplied.
- **Later:** MAP-4 follows MAP-3 and then releases MAP-9's blocker. Recovery reporting intentionally stays collapsed until the ledger ships.

### Risks the structure surfaces

- **Missing park trigger:** MAP-6 cannot satisfy its unpark condition because Alert routing is not planned. Plan the missing project or have the human revise the condition to a real upstream deliverable.
- **Horizon gaps:** Account observability has no Now or Later project. Confirm whether that scope is intentional before planning additional work; the existing incoming dependency supplies the dashboard's execution path.
- **Ledger-to-notifications dependencies:** MAP-2 and MAP-1 in Token ledger block MAP-3 in Recovery notifications within Reliable recovery. Verify both completions before the handoff.
- **Notifications-to-reporting dependency:** MAP-3 in Recovery notifications blocks MAP-4 in Recovery reporting within Reliable recovery. Verify notification completion before reporting starts.

The MAP-4-to-MAP-9 dependency is recorded once as a cross-initiative gate, not again as a same-initiative cross-project risk. No cycles, ghost-project pointers or methodology horizon findings were returned. Recovery reporting's single Later project is intentional.

MAP-1 is explicitly picked and has no spec. Prep now via `/faff-prep MAP-1`? (y/n)

Plan the missing Alert routing structure via `/faff-plot`? (y/n)

Want to shift to today's focus via `/faff-wtf`? (y/n)