Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1:** Finish checkout. Human.
- **WIP-2:** Finish the refund screen. Human.
- **WIP-3:** Build the audit export. Autonomous run; does not count against your WIP cap.

### Do this

Your WIP is at cap, so finish in-flight work only. No new starts.

1. **WIP-1:** Finish checkout.
2. **WIP-2:** Finish the refund screen.

### Methodology findings

- **WIP:** human WIP 2 of 2, at cap; no headroom for new starts.
- **Chain gap (upstream), WIP-1:** the required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Set the refund currency. It keeps parking on the same currency decision.

(more in `/faff-tidy`)

### Heads up

- **Chain gap (upstream), WIP-1:** checkout depends on a tax mapping that no ticket tracks.
- **Repeat-park, WIP-5:** parks repeatedly on the currency decision.

### Automation preview

**Build queue**

```
fire-and-forget (independents)
  WIP-4  Add receipts
```

- **Needs your call:** (none)
- **Prep queue:** (none)

### Structural diagnostics

- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Repeated currency decision parks.
- **Ghost project, WIP-6:** Link payment alerts. The old payment project it points to is missing.

### Calibration signals

_Calibration signal:_ 4 events with the root cause "currency decision" in the last 14 days. Consider: (a) extending the resolve-attempt rules to recognise this decision pattern, (b) running `/faff-prep --refresh` on the affected issues, such as WIP-5, to record the currency decision in their specs, or (c) ignoring it, with no change. This is advisory; nothing has been changed.

### Next steps

- Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy, prep and build)? (y/n)
- Run a full groom via `/faff-tidy`? (y/n)
