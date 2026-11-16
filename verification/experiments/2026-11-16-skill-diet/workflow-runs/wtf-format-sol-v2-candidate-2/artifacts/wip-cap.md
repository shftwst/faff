Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1:** Finish checkout. Human work in progress.
- **WIP-2:** Finish the refund screen. Human work in progress.
- **WIP-3:** Build the audit export. Autonomous work in progress.

### Do this

1. **WIP-1:** Finish checkout. Required tax mapping has no ticket; that upstream gap needs attention.
2. **WIP-2:** Finish the refund screen. Complete this in-flight work.

### Methodology findings

Human WIP: 2/2; no room for new starts. WIP-3 does not count against the human cap.

- **WIP-1, upstream chain-gap:** Required tax mapping has no ticket.
- **WIP-5:** Set the refund currency. Repeated currency decision parks.

(more in `/faff-tidy`)

### Heads up

- **WIP-1, chain-gap (upstream):** Required tax mapping has no ticket.
- **WIP-5, repeat-park:** Repeated currency decision parks.

### Automation preview

#### Build queue

```text
fire-and-forget (independents)
  WIP-4  Add receipts
```

#### Needs your call before automation can pick up

(none)

#### Prep queue

(none)

### Structural diagnostics

- **WIP-1, chain-gap (upstream):** Required tax mapping has no ticket.
- **WIP-5, repeat-park:** Repeated currency decision parks.
- **WIP-6:** Link payment alerts. Ghost-project pointer: the old payment project is missing.

### Calibration signals

The currency decision pattern reached 4 events in the last 14 days. This signal is advisory. Consider:

- Reviewing whether the resolve-attempt rules should recognise the currency decision pattern.
- Refreshing affected specs via `/faff-prep --refresh` after resolving the currency decision.
- Leaving the rules and specs as they are.

Run a full groom via `/faff-tidy`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)