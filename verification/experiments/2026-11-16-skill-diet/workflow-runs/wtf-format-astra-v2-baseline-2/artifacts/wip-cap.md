Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1:** Finish checkout. Human work.
- **WIP-2:** Finish the refund screen. Human work.
- **WIP-3:** Build the audit export. Autonomous work.

### Do this

Human WIP is at cap. Complete in-flight work before starting anything new.

1. **WIP-1:** Finish checkout; first address the required tax mapping that has no ticket.
2. **WIP-2:** Finish the refund screen.

### Methodology findings

Human WIP is 2, cap 2, with no remaining headroom. WIP-3's autonomous build does not count against the human cap.

- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Set the refund currency. Currency decisions have repeatedly left this work parked.

(more in `/faff-tidy`)

### Heads up

- **Chain gap (upstream), WIP-1:** Checkout needs tax mapping, but no ticket tracks it.
- **Repeat-park, WIP-5:** Refund currency decisions keep leaving this work parked.

### Automation preview: fire `/faff-beep-boop`?

**Build queue** (1 ready, fire-and-forget)

```text
fire-and-forget (independents)       likely-fire (serialised)
  WIP-4 Add receipts                  (none)
```

Prep queue: (none)

### Structural diagnostics

- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Refund currency decisions have repeatedly left this work parked.
- **Ghost-project, WIP-6:** Link payment alerts. The old payment project referenced by this work is missing.

### Calibration signals

The currency-decision pattern reached 4 events in 14 days. This is advisory. Possible actions:

- Review whether the resolve-attempt rules should recognise the currency-decision pattern.
- Refresh affected specs via `/faff-prep --refresh` after the currency decision is settled.
- Leave the rules and specs unchanged.

Run a full groom via `/faff-tidy`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
