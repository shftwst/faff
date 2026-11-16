Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1:** Finishes the checkout flow. Actor: human.
- **WIP-2:** Finishes the refund screen. Actor: human.
- **WIP-3:** Builds the audit export. Actor: autonomous (does not count against your WIP cap).

### Do this

Human WIP is at cap, so finish in-flight work only; no new starts.

1. **WIP-1:** Finish checkout.
2. **WIP-2:** Finish the refund screen.

### Methodology findings

- **WIP:** human WIP 2 of 2, at cap; 0 new starts.
- **Chain gap (upstream), WIP-1:** the tax mapping checkout needs has no ticket.
- **Repeat-park, WIP-5:** setting the refund currency keeps parking on the same currency decision.

(more in `/faff-tidy`)

### Heads up

- **[upstream chain gap] WIP-1:** the required tax mapping has no ticket, so finishing checkout leaves that work untracked.
- **[repeat-park] WIP-5:** repeated parks on the currency decision.

### Automation preview

Build queue:

```
fire-and-forget (independents)        likely-fire (serialised)
  WIP-4  Add receipts                   (none)
```

Needs your call: (none)
Prep queue: (none)

### Structural diagnostics

- **Chain gap (upstream), WIP-1:** required tax mapping has no ticket.
- **Repeat-park, WIP-5:** repeated currency decision parks.
- **Ghost project, WIP-6:** linking payment alerts points at an old payment project that is missing.

### Calibration signals

The currency decision was the root cause of 4 events in the last 14 days. Consider: (a) extending the resolve-attempt rules to recognise this currency decision, (b) running `/faff-prep --refresh` on the affected issues so their specs record the chosen currency, or (c) ignore: no change. This signal is advisory; nothing has been changed.

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)

Run a full groom via `/faff-tidy`? (y/n)
