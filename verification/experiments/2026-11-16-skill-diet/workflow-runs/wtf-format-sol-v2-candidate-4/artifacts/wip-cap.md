Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1:** Finish checkout. Human work in progress.
- **WIP-2:** Finish the refund screen. Human work in progress.
- **WIP-3:** Build the audit export. Autonomous work in progress.

### Do this

1. **WIP-1:** Complete checkout; the required tax mapping has no ticket and needs attention.
2. **WIP-2:** Complete the refund screen.

### Methodology findings

Human WIP: 2/2; remaining headroom: 0. Focus on completing in-flight work. The autonomous WIP-3 build does not count against the human cap.

- **Upstream chain gap, WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Set the refund currency; the currency decision has caused repeated parks.

(more in `/faff-tidy`)

### Heads up

- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** The refund currency decision keeps parking the work.

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
- **Ghost-project, WIP-6:** Link payment alerts; the old payment project is missing.

### Calibration signals

The currency decision produced 4 events in the last 14 days. This signal is advisory. Possible next actions:

- Review whether resolve-attempt rules should recognise the currency decision pattern.
- Consider `/faff-prep --refresh` on affected issues after the currency decision is settled.
- Ignore the signal and make no change.

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)

Run a full groom via `/faff-tidy`? (y/n)