Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1:** Finish checkout. Human work in progress.
- **WIP-2:** Finish the refund screen. Human work in progress.
- **WIP-3:** Build the audit export. Autonomous work in progress; excluded from the human WIP cap.

### Do this

1. **WIP-1:** Complete the in-flight checkout work. Required tax mapping has no ticket; that upstream gap needs attention.
2. **WIP-2:** Complete the in-flight refund screen.

### Methodology findings

Human WIP: 2/2; remaining headroom: 0. Focus on completing in-flight work.

- **Severity 1, chain-gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Severity 2, repeat-park, WIP-5:** Set the refund currency. Currency decisions have repeatedly parked the work.

(more in `/faff-tidy`)

### Heads up

- **Chain-gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Repeated currency decision parks need attention.

### Automation preview

#### Build queue

```
fire-and-forget (independents)       likely-fire (serialised)
  WIP-4  Add receipts                 (none)
```

#### Needs your call before automation can pick up

(none)

Prep queue: (none)

### Structural diagnostics

- **Chain-gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Repeated currency decision parks.
- **Ghost-project, WIP-6:** Link payment alerts. The old payment project is missing.

### Calibration signals

The currency decision root cause produced 4 events in the last 14 days. This is an advisory signal; possible next actions are:

- **Review the decision:** Clarify the currency choice with the human responsible.
- **Refresh affected specs:** Consider `/faff-prep --refresh` after the decision is settled.
- **Keep current rules:** Ignore the signal and make no change.

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)

Run a full groom via `/faff-tidy`? (y/n)