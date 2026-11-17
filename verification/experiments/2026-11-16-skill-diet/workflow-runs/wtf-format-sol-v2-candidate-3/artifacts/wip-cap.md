Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1:** Finish checkout; human work in progress.
- **WIP-2:** Finish the refund screen; human work in progress.
- **WIP-3:** Build the audit export; autonomous work in progress.

### Do this

1. **WIP-1:** Finish checkout. Address the missing ticket for required tax mapping.
2. **WIP-2:** Finish the refund screen.

### Methodology findings

Human WIP: 2/2, at cap; remaining headroom: 0. Focus on completion of in-flight work. WIP-3 is autonomous and does not count against the human cap.

- **Upstream chain gap, WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5: Set refund currency.** Repeated currency decision parks.

(more in `/faff-tidy`)

### Heads up

- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** The refund currency decision keeps causing parks.

### Automation preview

#### Build queue

```text
fire-and-forget (independents)        likely-fire (serialised)
  WIP-4  Add receipts                  (none)
```

Needs your call before automation can pick up: (none)

Prep queue: (none)

### Structural diagnostics

- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Repeated currency decision parks.
- **Ghost-project, WIP-6: Link payment alerts.** The old payment project is missing.

### Calibration signals

Currency decision: 4 events in 14 days. Advisory options: (a) review whether the resolve-attempt rules should cover this pattern, (b) refresh the affected specs via `/faff-prep --refresh` after the currency decision is settled, or (c) ignore the signal and make no change.

Run a full groom via `/faff-tidy`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)