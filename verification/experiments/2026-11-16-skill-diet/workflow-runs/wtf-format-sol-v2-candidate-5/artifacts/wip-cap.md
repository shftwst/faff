Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1:** Finish checkout. In progress with a human.
- **WIP-2:** Finish the refund screen. In progress with a human.
- **WIP-3:** Build the audit export. In progress autonomously; excluded from human WIP.

### Do this

1. **WIP-1:** Complete checkout, with attention to the required tax mapping that has no ticket.
2. **WIP-2:** Complete the refund screen.

### Methodology findings

Human WIP: 2/2; remaining headroom: 0. Focus on completing in-flight work.

- **Upstream chain-gap, WIP-1:** Required tax mapping has no ticket. Severity 1.
- **Repeat-park, WIP-5:** Set the refund currency. Repeated currency decision parks. Severity 2.

(more in `/faff-tidy`)

### Heads up

- **Chain-gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Refund currency decisions keep parking.

### Automation preview

**Build queue**

```text
fire-and-forget (independents)       likely-fire (serialised)
  WIP-4  Add receipts                 (none)
```

Needs your call before automation can pick up: (none)

Prep queue: (none)

### Structural diagnostics

- **Chain-gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Currency decisions repeatedly park.
- **Ghost-project, WIP-6:** Link payment alerts. The old payment project is missing.

### Calibration signals

Advisory: 4 events involving the currency decision occurred in the last 14 days. Consider these actions:

- **Resolve-attempt rules:** Review whether they could recognise this recurring decision pattern.
- **Specs:** Refresh affected specs via `/faff-prep --refresh` once the currency decision is settled.
- **No change:** Leave the current rules and specs as they are.

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)

Run a full groom via `/faff-tidy`? (y/n)