Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1:** Finish checkout. Human work in progress.
- **WIP-2:** Finish the refund screen. Human work in progress.
- **WIP-3:** Build the audit export. Autonomous work in progress.

### Do this

1. **WIP-1:** Finish checkout. Address the missing upstream tax-mapping ticket before completion.
2. **WIP-2:** Finish the refund screen. Complete the work already in flight.

### Methodology findings

Human WIP: 2/2, with no headroom for new starts. WIP-3 is autonomous and does not count against the human cap.

- **Upstream chain-gap, severity 1:** WIP-1 requires tax mapping that has no ticket.
- **Repeat-park, severity 2:** WIP-5, setting the refund currency, has repeatedly parked over the currency decision.

(more in `/faff-tidy`)

### Heads up

- **Chain-gap (upstream):** WIP-1 needs tax mapping, but no ticket tracks that required work.
- **Repeat-park:** WIP-5 keeps stopping on the currency decision.

### Automation preview

#### Build queue

```text
fire-and-forget (independents)        likely-fire (serialised)
  WIP-4  Add receipts                  (none)
```

#### Needs your call before automation can pick up

(none)

Prep queue: (none)

### Structural diagnostics

- **Chain-gap (upstream):** WIP-1 requires tax mapping that has no ticket.
- **Repeat-park:** WIP-5 has repeatedly parked over the currency decision.
- **Ghost-project:** WIP-6, linking payment alerts, points to the missing Old payment project.

### Calibration signals

Currency decision: 4 events in the last 14 days meet the advisory threshold. Possible actions, none applied:

- **Review the rule:** Consider whether resolve-attempt rules should recognise the repeated currency-decision pattern.
- **Refresh affected specs:** After settling the currency decision, consider `/faff-prep --refresh` on the affected issues.
- **Leave unchanged:** Ignore the signal and retain the current rules and specs.

Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)

Run a full groom via `/faff-tidy`? (y/n)