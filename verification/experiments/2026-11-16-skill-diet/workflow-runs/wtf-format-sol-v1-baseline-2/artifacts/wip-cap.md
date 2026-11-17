Methodology: faffter-dark-methodology-agile-delivery

## What's up - 2026-11-16

### In progress

- **WIP-1:** Finish checkout. Human work.
- **WIP-2:** Finish the refund screen. Human work.
- **WIP-3:** Build the audit export. Autonomous work.

### Do this

1. **WIP-1:** Finish checkout; required tax mapping has no ticket and needs attention before completion.
2. **WIP-2:** Finish the refund screen.

### Methodology findings

Human WIP: 2, cap: 2, remaining headroom: 0. Complete in-flight work only. WIP-3 is autonomous and does not count against the human cap.

- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket. Severity 1.
- **Repeat-park, WIP-5:** Set the refund currency; currency decisions repeatedly cause parks. Severity 2.

(more in `/faff-tidy`)

### Heads up

- **Chain gap (upstream), WIP-1:** Checkout requires tax mapping that no ticket tracks.
- **Repeat-park, WIP-5:** Refund currency decisions repeatedly cause parks.

### Automation preview - fire `/faff-beep-boop`?

**Build queue** (1 ready, 1 fire-and-forget, 0 collision groups)

```text
fire-and-forget (independents)       likely-fire (serialised)
  WIP-4  Add receipts                (none)
```

**Needs your call before automation can pick up:** (none)

Prep queue: (none)

### Structural diagnostics

- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Currency decisions repeatedly cause parks.
- **Ghost-project, WIP-6:** Link payment alerts; the old payment project is missing.

### Calibration signals

Currency decisions caused 4 events in the last 14 days. This is advisory. Consider the following actions:

- **Rules:** Review whether resolve-attempt rules should recognise recurring currency decisions.
- **Specs:** Refresh affected specs via `/faff-prep --refresh` after the currency decision is settled.
- **No change:** Ignore the signal for now.

Run a full groom via `/faff-tidy`? (y/n)

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)