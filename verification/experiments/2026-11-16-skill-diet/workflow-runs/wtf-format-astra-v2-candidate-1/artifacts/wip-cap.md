Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1:** Finish checkout; human work in progress.
- **WIP-2:** Finish the refund screen; human work in progress.
- **WIP-3:** Build the audit export; autonomous work in progress.

### Do this

Human WIP is at its cap of 2; focus on finishing in-flight work.

1. **WIP-1: Finish checkout.** Address the missing ticket for required tax mapping before completing checkout.
2. **WIP-2: Finish the refund screen.** Complete the work already in progress.

### Methodology findings

Human WIP: 2/2; remaining headroom: 0. The autonomous audit export does not count against this cap.

- **Chain-gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Setting the refund currency has repeatedly parked on the currency decision.

(more in `/faff-tidy`)

### Heads up

- **Chain-gap (upstream), WIP-1:** Required tax mapping is untracked.
- **Repeat-park, WIP-5:** The refund currency decision keeps blocking progress.

### Automation preview

#### Build queue

```text
fire-and-forget (independents)       likely-fire (serialised)
  WIP-4  Add receipts                 (none)
```

Prep queue: (none)

### Structural diagnostics

- **Chain-gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Repeated currency decision parks.
- **Ghost-project, WIP-6:** Linking payment alerts points to the missing old payment project.

### Calibration signals

The currency decision produced 4 events in the last 14 days. This is advisory; possible actions are:

- **Review the pattern:** Check whether the resolve-attempt rules need a change.
- **Refresh affected specs:** Consider `/faff-prep --refresh` after resolving the currency decision.
- **Leave unchanged:** Keep the current rules and specs.

Run a full groom via `/faff-tidy`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
