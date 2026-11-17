Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1:** Finish checkout; human work.
- **WIP-2:** Finish the refund screen; human work.
- **WIP-3:** Build the audit export; autonomous work.

### Do this

1. **WIP-1:** Complete checkout, with attention to the missing tax-mapping ticket.
2. **WIP-2:** Complete the refund screen.

### Methodology findings

Human WIP: 2/2; remaining headroom: 0. Finish in-flight work before starting anything new. WIP-3 does not count against the human cap.

- **Upstream chain gap, WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Setting the refund currency has repeatedly parked on the currency decision.

(more in `/faff-tidy`)

### Heads up

- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket; the checkout work references untracked work.
- **Repeat-park, WIP-5:** The refund currency decision keeps stopping work.

### Automation preview

#### Build queue

```text
fire-and-forget (independents)        likely-fire (serialised)
  WIP-4  Add receipts                  (none)
```

#### Needs your call before automation can pick up

(none)

Prep queue: (none)

### Structural diagnostics

- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Repeated currency decision parks affect setting the refund currency.
- **Ghost-project, WIP-6:** Linking payment alerts points to the missing old payment project.

### Calibration signals

The currency decision produced 4 events in the last 14 days. This signal is advisory; no corrective action is recorded. Consider:

- **Review the resolve-attempt rules:** Check whether they can recognise this recurring decision.
- **Refresh affected specs:** Use `/faff-prep --refresh` after the currency decision is resolved.
- **Leave unchanged:** Ignore the signal for now.

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)

Run a full groom via `/faff-tidy`? (y/n)