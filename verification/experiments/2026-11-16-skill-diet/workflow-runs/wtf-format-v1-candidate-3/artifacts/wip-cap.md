Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1** Finish checkout: complete the checkout flow. Actor: human.
- **WIP-2** Finish refund screen: complete the screen for issuing refunds. Actor: human.
- **WIP-3** Build audit export: export audit records. Actor: autonomous (does not count against your WIP cap).

### Do this

Human WIP is at cap, so finish in-flight work before starting anything new.

1. **WIP-1** Finish checkout. Note the upstream chain gap below: the tax mapping it needs has no ticket.
2. **WIP-2** Finish refund screen.

### Methodology findings

- **WIP:** 2 of 2 human items, headroom 0. No new starts until one finishes.
- **Chain gap (upstream), WIP-1:** required tax mapping has no ticket.
- **Repeat-park, WIP-5** Set refund currency (choose the currency refunds are paid in): repeated currency decision parks.

(more in `/faff-tidy`)

### Heads up

- **[upstream chain gap] WIP-1** Finish checkout: required tax mapping has no ticket.
- **[repeat-park] WIP-5** Set refund currency: repeated currency decision parks.

### Automation preview

**Build queue**

```
fire-and-forget (independents)        likely-fire (serialised)
  WIP-4  Add receipts                   (none)
```

WIP-4: Add receipts, giving customers a record of their purchase.

**Needs your call:** (none)

**Prep queue:** (none)

### Structural diagnostics

- **Chain gap (upstream), WIP-1** Finish checkout: required tax mapping has no ticket.
- **Repeat-park, WIP-5** Set refund currency: repeated currency decision parks.
- **Ghost project, WIP-6** Link payment alerts (connect alerts to payments): old payment project is missing.

### Calibration signals

4 events with the root cause "currency decision" in the last 14 days. This is advisory; nothing has been changed. Suggested actions: (a) extend the resolve-attempt rules to recognise the currency decision, (b) run `/faff-prep --refresh` on the affected issues so their specs record the decision, or (c) ignore, no change.

---

- Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
- Run a full groom via `/faff-tidy`? (y/n)
