Methodology: faffter-dark-methodology-agile-delivery

## What's up - 2026-11-16

### In progress

- **WIP-1:** Finish checkout; human work in progress.
- **WIP-2:** Finish the refund screen; human work in progress.
- **WIP-3:** Build the audit export; autonomous work in progress.

### Do this

1. **WIP-1:** Complete checkout; required tax mapping has no ticket and needs attention.
2. **WIP-2:** Complete the refund screen.

### Methodology findings

Human WIP: 2, cap: 2. No headroom for new starts; focus on completing in-flight work. The autonomous audit export does not count against the human cap.

- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Set the refund currency; repeatedly parked on the currency decision.

(more in `/faff-tidy`)

### Heads up

- **Chain gap (upstream), WIP-1:** Checkout requires tax mapping that no ticket tracks.
- **Repeat-park, WIP-5:** The refund currency decision keeps causing parks and needs resolution.

### Automation preview - fire `/faff-beep-boop`?

**Build queue** (1 ready; 1 independent; 0 collision groups)

```text
fire-and-forget (independents)       likely-fire (serialised)
  WIP-4  Add receipts                 (none)
```

**Needs your call before automation can pick up:** (none)

Prep queue: (none)

### Structural diagnostics

- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** The refund currency decision has caused repeated parks.
- **Ghost-project, WIP-6:** Link payment alerts; the old payment project is missing.

### Calibration signals

Currency decisions caused 4 events in the last 14 days, meeting the advisory threshold. Consider extending the resolve-attempt rules for this pattern, refreshing the affected specs via `/faff-prep --refresh` after the decision is settled, or leaving the rules unchanged. These are possible actions; none has been applied.

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)