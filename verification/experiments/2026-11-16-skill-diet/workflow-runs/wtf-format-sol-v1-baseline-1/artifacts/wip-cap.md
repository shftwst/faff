Methodology: faffter-dark-methodology-agile-delivery

## What's up - 2026-11-16

### In progress

- WIP-1: Finish checkout. Human work in progress.
- WIP-2: Finish the refund screen. Human work in progress.
- WIP-3: Build the audit export. Autonomous work in progress.

### Do this

1. WIP-1: Complete checkout; the required tax mapping has no ticket and needs attention before completion.
2. WIP-2: Complete the refund screen.

### Methodology findings

Human WIP: 2, cap: 2, remaining headroom: 0. Focus on completing in-flight work. WIP-3 is autonomous and does not count against the human cap.

- **Chain gap (upstream), severity 1:** WIP-1 requires tax mapping that has no ticket.
- **Repeat-park, severity 2:** WIP-5: Set the refund currency. Currency decisions have repeatedly parked.

(more in `/faff-tidy`)

### Heads up

- **Chain gap (upstream):** WIP-1 cannot fulfil its required tax mapping without tracked work for that prerequisite.
- **Repeat-park:** WIP-5 has repeatedly parked on the currency decision.

### Automation preview - fire `/faff-beep-boop`?

**Build queue** (1 ready)

```text
fire-and-forget (independents)       likely-fire (serialised)
  WIP-4 Add receipts                 (none)
```

Prep queue: (none)

### Structural diagnostics

- **Chain gap (upstream):** WIP-1 requires tax mapping that has no ticket.
- **Repeat-park:** WIP-5 has repeated currency decision parks.
- **Ghost-project:** WIP-6: Link payment alerts. The old payment project is missing.

### Calibration signals

There were 4 currency decision events in the last 14 days. Advisory options are to review the resolve-attempt rules for this pattern, refresh the affected specs via `/faff-prep --refresh` after resolving the currency decision, or leave the rules unchanged. No change has been applied.

Run a full groom via `/faff-tidy`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)