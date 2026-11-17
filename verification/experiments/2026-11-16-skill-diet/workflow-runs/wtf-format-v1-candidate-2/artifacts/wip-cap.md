Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1:** Finish the checkout flow. Human.
- **WIP-2:** Finish the refund screen. Human.
- **WIP-3:** Build the audit export. Autonomous; does not count against your WIP cap.

### Do this

Human WIP is at cap (2 of 2), so today is for finishing in-flight work only. No new starts; WIP-4 (add receipts) waits.

1. **WIP-1:** Finish the checkout flow. Its spec needs a tax mapping that no ticket tracks yet.
2. **WIP-2:** Finish the refund screen.

### Methodology findings

- **WIP:** 2 of 2 human, headroom 0. WIP-3 is autonomous and not counted.
- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Set the refund currency. Repeated currency decision parks.

(more in `/faff-tidy`)

### Heads up

- **Chain gap (upstream), WIP-1:** Checkout depends on a tax mapping that no ticket tracks.
- **Repeat-park, WIP-5:** Setting the refund currency keeps parking on the same currency decision.

### Automation preview

**Build queue**

```
fire-and-forget (independents)        likely-fire (serialised)
  WIP-4  Add receipts                   (none)
```

**Needs your call:** (none)

**Prep queue:** (none)

### Structural diagnostics

- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Repeated currency decision parks.
- **Ghost project, WIP-6:** Link payment alerts. Old payment project is missing.

### Calibration signals

_Calibration signal:_ 4 events with the root cause currency decision in the last 14 days. Consider: (a) extending the resolve-attempt rules to recognise this pattern, (b) running `/faff-prep --refresh` on the affected issues to record the currency decision in their specs, or (c) ignore, no change. Advisory only; nothing has been applied.

### Next steps

- Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy, prep and build)? (y/n)
- Run a full groom via `/faff-tidy`? (y/n)