Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1:** Finish checkout. Human work in progress.
- **WIP-2:** Finish the refund screen. Human work in progress.
- **WIP-3:** Build the audit export. Autonomous work in progress.

### Do this

1. **WIP-1:** Complete checkout; the required tax mapping has no ticket and needs attention.
2. **WIP-2:** Complete the refund screen.

### Methodology findings

Human WIP is at cap: 2/2, with no remaining headroom. Focus on completion of in-flight work. WIP-3 does not count against the human cap.

- **Chain-gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Set the refund currency. Repeated currency decision parks.

(more in `/faff-tidy`)

### Heads up

- **Chain-gap (upstream), WIP-1:** Checkout requires tax mapping that has no ticket.
- **Repeat-park, WIP-5:** The refund currency decision keeps parking.

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
- **Ghost-project, WIP-6:** Link payment alerts. The old payment project is missing.

### Calibration signals

The currency decision pattern reached 4 events in the last 14 days. This signal is advisory. Possible next actions:

- Review whether the resolve-attempt rules should recognise this pattern.
- Resolve the currency decision and refresh affected specs through `/faff-prep --refresh`.
- Leave the rules and specs unchanged.

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
