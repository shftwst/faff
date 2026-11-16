Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1:** Finish checkout. Human work.
- **WIP-2:** Finish the refund screen. Human work.
- **WIP-3:** Build the audit export. Autonomous work.

### Do this

1. Complete WIP-1, the checkout work; the missing ticket for required tax mapping needs attention.
2. Complete WIP-2, the refund screen.

### Methodology findings

Human WIP is 2 (cap 2), with no room for new starts. Autonomous WIP-3 does not count against that cap.

- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Setting the refund currency keeps parking on a currency decision.

(more in `/faff-tidy`)

### Heads up

- **Chain gap (upstream), WIP-1:** Checkout requires tax mapping that has no ticket.
- **Repeat-park, WIP-5:** The refund-currency decision has repeatedly parked.

### Automation preview: fire `/faff-beep-boop`?

**Build queue** (1 ready)

```text
fire-and-forget (independents)       likely-fire (serialised)
  WIP-4 Add receipts                  (none)
```

Prep queue: (none)

### Structural diagnostics

- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Repeated currency-decision parks affect the refund-currency work.
- **Ghost-project, WIP-6:** Linking payment alerts points to the missing old payment project.

### Calibration signals

The currency-decision root cause recorded 4 events in the last 14 days, meeting the advisory threshold. Possible next actions:

- Review whether the resolve-attempt rules should recognise this recurring decision.
- Refresh affected specs via `/faff-prep --refresh` after resolving the currency decision.
- Leave the rules and specs unchanged.

These are suggestions; none has been applied.

Run a full groom via `/faff-tidy`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
