Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1:** Finish checkout; human work in progress.
- **WIP-2:** Finish the refund screen; human work in progress.
- **WIP-3:** Build the audit export; autonomous work in progress.

### Do this

1. **WIP-1:** Complete checkout; required tax mapping has no ticket and needs attention.
2. **WIP-2:** Complete the refund screen.

Human WIP is at the 2/2 cap, with no remaining headroom. Finish in-flight work before starting anything new. WIP-3 does not count against the human cap.

### Methodology findings

Human WIP: 2/2; remaining headroom: 0.

- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Setting the refund currency has repeatedly stopped at the currency decision.

(more in `/faff-tidy`)

### Heads up

- **Chain gap (upstream), WIP-1:** Required tax mapping remains untracked.
- **Repeat-park, WIP-5:** Repeated currency decision parks need attention.

### Automation preview

**Build queue**

```text
fire-and-forget (independents)       likely-fire (serialised)
  WIP-4  Add receipts                 (none)
```

Needs your call before automation can pick up: (none)

Prep queue: (none)

### Structural diagnostics

- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Repeated currency decision parks.
- **Ghost project, WIP-6:** Linking payment alerts points to the missing old payment project.

### Calibration signals

Advisory: 4 events involving the currency decision occurred in the last 14 days. Consider these possible actions:

- **Resolve rules:** Review whether the resolve-attempt rules should recognise the recurring currency decision.
- **Refresh specs:** Refresh affected specs via `/faff-prep --refresh` after the decision is settled.
- **Leave unchanged:** Ignore the signal and make no change.

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)

Run a full groom via `/faff-tidy`? (y/n)