Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1:** Finish checkout. Human work in progress.
- **WIP-2:** Finish the refund screen. Human work in progress.
- **WIP-3:** Build the audit export. Autonomous work in progress; excluded from the human WIP cap.

### Do this

Human WIP is at its cap of 2/2, with no remaining headroom. Finish in-flight work before starting anything new.

1. **WIP-1: Finish checkout.** Address the missing upstream tax-mapping ticket first.
2. **WIP-2: Finish the refund screen.** Continue the work already in progress.

### Methodology findings

Human WIP: 2/2; remaining headroom: 0.

- **Chain-gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Set refund currency has repeatedly parked on the currency decision.

(more in `/faff-tidy`)

### Heads up

- **Chain-gap (upstream), WIP-1:** Checkout requires tax mapping that no ticket tracks.
- **Repeat-park, WIP-5:** The refund currency decision keeps parking the work.

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
- **Ghost-project, WIP-6:** Link payment alerts points to the missing old payment project.

### Calibration signals

The currency decision produced 4 events in the last 14 days, meeting the advisory threshold. Possible actions:

- **Review the rule:** Assess whether resolve-attempt rules should recognise this pattern.
- **Refresh the specs:** Consider `/faff-prep --refresh` on affected issues after the currency decision is resolved.
- **Leave unchanged:** Ignore the signal for now.

Run a full groom via `/faff-tidy`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
