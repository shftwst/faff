Methodology: faffter-dark-methodology-agile-delivery

## What's up - 2026-11-16

### In progress

- **WIP-1:** Finish checkout. Human work.
- **WIP-2:** Finish the refund screen. Human work.
- **WIP-3:** Build the audit export. Autonomous work.

### Do this

1. **WIP-1:** Complete the in-flight checkout work; the required tax mapping has no ticket and needs attention.
2. **WIP-2:** Complete the in-flight refund screen.

### Methodology findings

Human WIP: 2, cap: 2. Remaining headroom: 0. Focus on completing in-flight work. WIP-3's autonomous build does not count against the human cap. WIP-4, adding receipts, leads the supplied pick-ordering but cannot be recommended as a new human start at cap.

- **Chain gap (upstream), severity 1:** WIP-1 requires tax mapping that has no ticket.
- **Repeat-park, severity 2:** WIP-5, setting the refund currency, repeatedly parks on the currency decision.

(more in `/faff-tidy`)

### Heads up

- **Chain gap (upstream):** WIP-1 requires tax mapping that has no ticket.
- **Repeat-park:** WIP-5 repeatedly parks on the currency decision.

### Automation preview - fire `/faff-beep-boop`?

**Build queue** (1 ready; 1 independent; 0 collision groups)

```
fire-and-forget (independents)     likely-fire (serialised)
  WIP-4  Add receipts               (none)
```

**Needs your call before automation can pick up:** (none)

**Prep queue:** (none)

### Structural diagnostics

- **Chain gap (upstream):** WIP-1 requires tax mapping that has no ticket.
- **Repeat-park:** WIP-5 repeatedly parks on the currency decision.
- **Ghost-project:** WIP-6, linking payment alerts, points to an old payment project that is missing.

### Calibration signals

The currency-decision root cause recorded 4 events in the last 14 days, meeting the advisory threshold. Possible next actions:

- **Review the decision:** Clarify the refund currency choice.
- **Refresh the spec:** Consider `/faff-prep --refresh WIP-5` to incorporate a resolved decision.
- **Leave unchanged:** Keep the current rules and specs.

These are suggestions; none has been applied.

Run a full groom via `/faff-tidy`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)