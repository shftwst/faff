Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1: Finish checkout.** Human work in progress.
- **WIP-2: Finish the refund screen.** Human work in progress.
- **WIP-3: Build the audit export.** Autonomous work in progress.

### Do this

1. **WIP-1: Finish checkout.** Required tax mapping has no ticket; the upstream gap needs attention.
2. **WIP-2: Finish the refund screen.** Complete the work already in flight.

### Methodology findings

Human WIP: 2/2; no remaining headroom for new starts. WIP-3 is autonomous and does not count against the human cap.

- **Upstream chain gap, WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5: Set the refund currency.** Currency decisions repeatedly cause parks.

(more in `/faff-tidy`)

### Heads up

- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Repeated currency decision parks need attention.

### Automation preview

**Build queue**

```
fire-and-forget (independents)     likely-fire (serialised)
  WIP-4  Add receipts               (none)
```

Needs your call before automation can pick up: (none)

Prep queue: (none)

### Structural diagnostics

- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Repeated currency decision parks.
- **Ghost-project, WIP-6: Link payment alerts.** The old payment project is missing.

### Calibration signals

There were 4 currency-decision events in the last 14 days. Possible actions, for human review:

- **Review the rule:** Consider extending resolve-attempt rules to recognise the currency-decision pattern.
- **Refresh affected specs:** Consider `/faff-prep --refresh` to incorporate a settled currency decision.
- **Leave unchanged:** Ignore the advisory signal.

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)

Run a full groom via `/faff-tidy`? (y/n)