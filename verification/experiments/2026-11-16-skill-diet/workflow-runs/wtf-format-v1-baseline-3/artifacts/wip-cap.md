Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress
- WIP-1  Finish the checkout flow (human).
- WIP-2  Finish the refund screen (human).
- WIP-3  Build the audit export (autonomous run; does not count against your WIP cap).

### Do this
Human WIP is at cap, so this lists in-flight work to finish, with no new starts. Ordered by the methodology's pick-ordering.

1. WIP-1  Finish the checkout flow. Its spec needs a tax mapping that no ticket tracks yet (see Heads up).
2. WIP-2  Finish the refund screen.

WIP-4 (add receipts) comes first in the methodology's order but is a new start, so it waits until a slot frees up.

### Methodology findings

Human WIP at 2 (cap 2). At cap: recommending completion of in-flight work only, no new starts. WIP-3 is an autonomous build and does not count.

- Chain gap (upstream): WIP-1: the required tax mapping has no ticket.
- Repeat-park: WIP-5  Set the refund currency: repeated parks on the currency decision.

(more in /faff-tidy)

### Heads up
- Chain gap ⚠ (upstream): WIP-1  Finish the checkout flow: the spec requires a tax mapping, but no ticket exists for that work. File gap issue? (y/n)
- Repeat-park ⚠: WIP-5  Set the refund currency: parked repeatedly on the same currency decision (decide via `/faff-prep --refresh WIP-5`).

### Automation preview: fire `/faff-beep-boop`?

**Build queue** (1 ready · 1 fire-and-forget · 0 likely-fire)

  fire-and-forget
    WIP-4  Add receipts

**Needs your call before automation can pick up:** (none)

**Prep queue:** (none)

### Structural diagnostics

- Chain gap (upstream): WIP-1  Finish the checkout flow: the required tax mapping has no ticket.
- Repeat-park: WIP-5  Set the refund currency: repeated currency-decision parks.
- Ghost project: WIP-6  Link payment alerts: points at an old payment project that is missing.

### Calibration signals

_Calibration signal:_ 4 events with the root cause "currency decision" in the last 14 days. Consider: (a) extending the resolve-attempt rules to recognise this decision, (b) running `/faff-prep --refresh` on the affected issues to record the chosen currency in their specs, or (c) ignore, no change. Advisory only; nothing has been changed.

### Next steps
- File a gap issue for the tax mapping WIP-1 needs? (y/n)
- Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy, prep and build)? (y/n)
- Run a full groom via `/faff-tidy` to see every methodology finding? (y/n)
