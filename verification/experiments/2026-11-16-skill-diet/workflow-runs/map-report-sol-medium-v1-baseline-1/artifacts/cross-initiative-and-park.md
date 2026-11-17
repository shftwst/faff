Methodology: faffter-noon-methodology-thematic

## Roadmap: 2026-11-16

### TL;DR

Two outcomes are in scope: Reliable recovery is Active and Account observability is Planned. The recovery chain joins up through reporting to the operations dashboard, with one separate discontinuity: a parked alert issue waits for a project that does not exist. That missing Alert routing trigger makes the park permanent until the structure is repaired.

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

Now    Token ledger            [started]
       MAP-2  Deduplicate recovery requests
       MAP-1  Store recovery tokens
Next   Recovery notifications  [planned]
       MAP-3  Send recovery notifications
Later  Recovery reporting      [backlog]
       MAP-4  Report recovery delivery

Initiative: Account observability

Now    (no project planned)    structural gap
Next   Operations dashboard    [planned]
       MAP-9  Display failed recovery delivery
Later  (no project planned)    structural gap
```

MAP-2 has a commit from yesterday on an active branch. MAP-0, prepare the token schema, merged two days ago and supports Token ledger; its Done status satisfies its former blocker of MAP-1. Recovery reporting intentionally stays collapsed until the ledger ships. No recent git activity is supplied for Account observability; its planned dashboard has a live upstream dependency from Reliable recovery. No evidence establishes its empty Now and Later horizons as delivery defects.

MAP-6 enables delivery alerts and is parked until Alert routing ships. No planned Alert routing project exists, and MAP-6's initiative membership is not supplied.

### Dependency chain

```text
Reliable recovery
Token ledger                 Recovery notifications      Recovery reporting
MAP-2 ──┐
        ├──► MAP-3 ─────────────────────────────────────► MAP-4
MAP-1 ──┘                                                  │
                                                           ▼
Account observability                           Operations dashboard (MAP-9)

[GAP: Alert routing project missing] ──► MAP-6 remains parked
```

Yes, with 1 visible discontinuity: the missing trigger for parked MAP-6. The main recovery-to-observability chain joins up; Account observability's empty horizons do not sever its supplied incoming path. The satisfied MAP-0 edge is excluded.

### Trigger gates

Gate: Token ledger → Recovery notifications
Who fires it: Reliable recovery, initiative-internal
Currently fireable: Yes
Notes: Both ledger issues are In Progress and notifications exists; both must finish before notifications proceeds.
────────────────────────────────────────
Gate: Recovery notifications → Recovery reporting
Who fires it: Reliable recovery, initiative-internal
Currently fireable: Not yet
Notes: MAP-3 is Todo and blocked by the ledger. Reporting exists.
────────────────────────────────────────
Gate: Reliable recovery → Account observability
Who fires it: Cross-initiative dependency, MAP-4 → MAP-9
Currently fireable: Not yet
Notes: Operations dashboard exists, but MAP-4 is Backlog and waits for notifications. Its completion releases MAP-9.
────────────────────────────────────────
Gate: Alert routing ships → MAP-6 can unpark
Who fires it: Human resolves the missing-trigger gap; normal routing then reconsiders the park
Currently fireable: Blocked structurally
Notes: Alert routing does not exist as a planned project. Resolve that gap and re-evaluate the park through the appropriate recovery flow.

### Critical path

- **Now:** Finish MAP-2, then MAP-1, preserving methodology order. Independence is verified. The explicit human pick is MAP-1; it does not rewrite that order.
- **Next:** MAP-3 waits for both ledger issues. Operations dashboard is also Next, but MAP-9 waits for Later reporting in Reliable recovery. No methodology rank between MAP-3 and MAP-9 was supplied.
- **Later:** MAP-4 waits for MAP-3 and then releases MAP-9. Keep the intentional collapsed reporting project until the ledger ships.

### Risks the structure surfaces

- **Missing parked-work trigger:** MAP-6 cannot meet its unpark condition because Alert routing is absent. Plan the missing upstream project or have the human revise the park condition if that work is no longer intended.
- **Ledger → notifications:** MAP-2 and MAP-1 in Token ledger block MAP-3 in Recovery notifications. Complete both to release this same-initiative gate.
- **Notifications → reporting:** MAP-3 in Recovery notifications blocks MAP-4 in Recovery reporting. Complete MAP-3 before reporting starts.

The MAP-4 → MAP-9 dependency is recorded once as a cross-initiative gate, rather than repeated as a same-value-stream cross-project risk. Cycle and ghost-project diagnostics returned no findings; the missing park trigger is a separate supplied finding.

Picking up MAP-1, store recovery tokens; no spec exists. Prep now via `/faff-prep MAP-1`? (y/n)

Plan the missing Alert routing structure via `/faff-plot`? (y/n)

Want to shift to today's focus via `/faff-wtf`? (y/n)