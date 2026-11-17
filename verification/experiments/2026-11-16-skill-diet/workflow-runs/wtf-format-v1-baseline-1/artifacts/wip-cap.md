Methodology: faffter-dark-methodology-agile-delivery

## What's up - 2026-11-16

### In progress
- WIP-1  Finishes checkout (human)
- WIP-2  Finishes the refund screen (human)
- WIP-3  Builds the audit export (autonomous; does not count against your WIP cap)

### Do this
Human WIP is at cap: finish in-flight work only, no new starts.

1. WIP-1  Finish checkout. Its spec needs a tax mapping that no ticket tracks (see Heads up).
2. WIP-2  Finish the refund screen.

WIP-4 (adds receipts) is first in the methodology's order but is a new start, so it waits until you have headroom.

### Methodology findings

Human WIP at 2 (cap 2). At cap: recommending completion of in-flight work only, no new starts.

- **Chain gap (upstream):** WIP-1: the required tax mapping has no ticket.
- **Repeat-park:** WIP-5  Sets the refund currency: repeated parks on the currency decision.

(more in `/faff-tidy`)

### Heads up
- Repeat-park ⚠: WIP-5  Sets the refund currency: parks repeatedly on the same currency decision. Decide via `/faff-prep --refresh WIP-5`? (y/n)
- Chain gap ⚠ (upstream): WIP-1  Finishes checkout: the spec requires a tax mapping, but no ticket exists for that work. File a gap issue for it? (y/n)

### Automation preview: fire `/faff-beep-boop`?

**Build queue** (1 ready · 1 fire-and-forget · 0 likely-fire)

  fire-and-forget
    WIP-4  Add receipts

**Needs your call before automation can pick up:** (none)

**Prep queue:** (none)

### Structural diagnostics

- Chain gap (upstream): WIP-1: required tax mapping has no ticket.
- Repeat-park: WIP-5: repeated currency decision parks.
- Ghost project: WIP-6  Links payment alerts: its old payment project is missing.

### Calibration signals

Calibration signal: 4 events in the last 14 days share the root cause "currency decision". Consider: (a) extending the resolve-attempt rules to recognise this decision, (b) running `/faff-prep --refresh` on the affected issues so their specs record a settled currency choice, or (c) ignore, no change. Advisory only; nothing has been changed.

### Next steps
- Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
- Run a full groom via `/faff-tidy`? (y/n)
