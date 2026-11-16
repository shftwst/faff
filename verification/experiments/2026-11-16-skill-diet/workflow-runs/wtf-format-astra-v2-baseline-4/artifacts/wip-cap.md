Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1:** Finish checkout. Human work.
- **WIP-2:** Finish the refund screen. Human work.
- **WIP-3:** Build the audit export. Autonomous work.

### Do this

1. **WIP-1:** Complete checkout; the required tax mapping has no ticket and needs attention.
2. **WIP-2:** Complete the refund screen.

### Methodology findings

Human WIP is 2, at the cap of 2, with no remaining headroom. Focus on completing in-flight work. WIP-3's autonomous build does not count against the human cap.

- **Chain gap (upstream), severity 1:** WIP-1 requires tax mapping that has no ticket.
- **Repeat-park, severity 2:** WIP-5, set refund currency, repeatedly parks on the currency decision.

(more in `/faff-tidy`)

### Heads up

- **Chain gap (upstream):** WIP-1's required tax mapping has no ticket.
- **Repeat-park:** WIP-5 repeatedly parks on the currency decision.

### Automation preview: fire `/faff-beep-boop`?

**Build queue** (1 ready)

```text
fire-and-forget (independents)       likely-fire (serialised)
  WIP-4  Add receipts                 (none)
```

**Needs your call before automation can pick up:** (none)

Prep queue: (none)

### Structural diagnostics

- **Chain gap (upstream):** WIP-1 requires tax mapping that has no ticket.
- **Repeat-park:** WIP-5 repeatedly parks on the currency decision.
- **Ghost-project:** WIP-6, link payment alerts, points to an old payment project that is missing.

### Calibration signals

The currency decision accounts for 4 events in 14 days, meeting the advisory threshold. Possible next actions:

- Review whether the resolve-attempt rules should recognise this pattern.
- Resolve the currency decision, then refresh affected specs via `/faff-prep --refresh`.
- Leave the rules and specs unchanged.

Run a full groom via `/faff-tidy`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)