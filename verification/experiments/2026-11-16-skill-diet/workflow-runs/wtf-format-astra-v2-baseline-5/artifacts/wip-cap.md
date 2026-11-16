Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1:** Finish checkout. Human work.
- **WIP-2:** Finish the refund screen. Human work.
- **WIP-3:** Build the audit export. Autonomous work.

### Do this

1. WIP-1: Finish checkout; the required tax mapping has no ticket and needs attention.
2. WIP-2: Finish the refund screen.

### Methodology findings

Human WIP is 2, at the cap of 2; remaining headroom is 0. Focus on completion of in-flight work. WIP-3 does not count against the human cap.

- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Set refund currency; repeated currency decision parks.

(more in `/faff-tidy`)

### Heads up

- **Chain gap (upstream), WIP-1:** Checkout requires tax mapping that no ticket tracks.
- **Repeat-park, WIP-5:** The refund currency decision keeps parking the work.

### Automation preview: fire `/faff-beep-boop`?

**Build queue** (1 ready)

```text
fire-and-forget (independents)       likely-fire (serialised)
  WIP-4  Add receipts                  (none)
```

Prep queue: (none)

### Structural diagnostics

- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Repeated currency decision parks.
- **Ghost-project, WIP-6:** Link payment alerts; the old payment project is missing.

### Calibration signals

The currency decision root cause produced 4 events in 14 days. This signal is advisory. Possible actions:

- Review whether the resolve-attempt rules need to cover the currency decision pattern.
- Refresh the affected specs via `/faff-prep --refresh` after settling the decision.
- Leave the rules and specs unchanged.

Run a full groom via `/faff-tidy`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)