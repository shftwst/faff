Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1:** Finish checkout. Human work in progress.
- **WIP-2:** Finish the refund screen. Human work in progress.
- **WIP-3:** Build the audit export. Autonomous work in progress.

### Do this

1. **WIP-1:** Complete checkout; required tax mapping has no ticket and needs attention first.
2. **WIP-2:** Complete the refund screen.

### Methodology findings

Human WIP: 2, cap: 2, remaining headroom: 0. Focus on completing in-flight work. WIP-3 is autonomous and does not count against the human cap.

- **Chain gap (upstream): WIP-1:** Checkout requires tax mapping that no ticket tracks.
- **Repeat-park: WIP-5:** Set the refund currency; the currency decision repeatedly causes parks.

(more in `/faff-tidy`)

### Heads up

- **Chain gap (upstream): WIP-1:** Required tax mapping has no ticket; the prerequisite needs attention before checkout can be completed.
- **Repeat-park: WIP-5:** The refund currency decision keeps causing parks.

### Automation preview: fire `/faff-beep-boop`?

**Build queue** (1 ready, 1 independent, 0 collision groups)

```text
fire-and-forget (independents)       likely-fire (serialised)
  WIP-4  Add receipts                 (none)
```

**Needs your call before automation can pick up:** (none)

Prep queue: (none)

### Structural diagnostics

- **Chain gap (upstream): WIP-1:** Required tax mapping has no ticket.
- **Repeat-park: WIP-5:** The refund currency decision repeatedly causes parks.
- **Ghost-project: WIP-6:** Link payment alerts; the old payment project is missing.

### Calibration signals

Four events with the root cause currency decision occurred in the last 14 days. This is advisory. Possible next actions:

- Review the resolve-attempt rules for the recurring currency decision.
- Review the affected specs and consider refreshing them via `/faff-prep --refresh` once the decision is settled.
- Leave the rules and specs unchanged.

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
