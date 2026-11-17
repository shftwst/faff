Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- WIP-1: Finish checkout. Human work.
- WIP-2: Finish the refund screen. Human work.
- WIP-3: Build the audit export. Autonomous work.

### Do this

1. Complete WIP-1, checkout. Required tax mapping has no ticket and needs attention.
2. Complete WIP-2, the refund screen.

### Methodology findings

Human WIP is 2 against a cap of 2, with no remaining headroom. Focus on completion; no new human starts. WIP-3's autonomous build does not count against the human cap.

- **Chain gap (upstream):** WIP-1 requires tax mapping that has no ticket.
- **Repeat-park:** WIP-5: Set the refund currency. Repeated currency decision parks.

(more in `/faff-tidy`)

### Heads up

- **Chain gap (upstream):** WIP-1, checkout, requires tax mapping that has no ticket.
- **Repeat-park:** WIP-5, refund currency, has repeated currency decision parks.

### Automation preview: fire `/faff-beep-boop`?

**Build queue** (1 ready)

```text
fire-and-forget (independents)       likely-fire (serialised)
  WIP-4  Add receipts                 (none)
```

**Needs your call before automation can pick up**

(none)

Prep queue: (none)

### Structural diagnostics

- **Chain gap (upstream):** WIP-1 requires tax mapping that has no ticket.
- **Repeat-park:** WIP-5 has repeated currency decision parks.
- **Ghost-project:** WIP-6: Link payment alerts. The old payment project is missing.

### Calibration signals

Currency decision: 4 events in the last 14 days. This signal is advisory. Possible next actions:

- Review whether the resolve-attempt rules need to cover this pattern.
- Resolve the currency decision, then refresh affected specs via `/faff-prep --refresh`.
- Leave the rules and specs unchanged.

Run a full groom via `/faff-tidy`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
