Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1:** Finish checkout; human work.
- **WIP-2:** Finish the refund screen; human work.
- **WIP-3:** Build the audit export; autonomous work.

### Do this

1. **WIP-1: Finish checkout.** Address the missing ticket for required tax mapping before completing checkout.
2. **WIP-2: Finish the refund screen.** Complete the in-flight work.

### Methodology findings

Human WIP is at cap: 2/2, with 0 remaining headroom. Focus on completion; autonomous WIP-3 does not count against the human cap.

- **Chain-gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Set refund currency; repeated currency decision parks.

(more in `/faff-tidy`)

### Heads up

- **Chain-gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** The refund currency decision has repeatedly parked the work.

### Automation preview

#### Build queue

```text
fire-and-forget (independents)       likely-fire (serialised)
  WIP-4 Add receipts                 (none)
```

Prep queue: (none)

### Structural diagnostics

- **Chain-gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Repeated currency decision parks.
- **Ghost-project, WIP-6:** Link payment alerts; the old payment project is missing.

### Calibration signals

Currency decision: 4 events in the last 14 days. This signal is advisory. Possible next actions:

- Review whether the resolve-attempt rules should cover this currency decision pattern.
- Refresh affected specs via `/faff-prep --refresh` once the currency decision is settled.
- Ignore the signal and make no change.

Run a full groom via `/faff-tidy`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
