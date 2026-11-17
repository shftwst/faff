Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress
- WIP-1  Finishes the checkout flow: in progress (you)
- WIP-2  Finishes the refund screen: in progress (you)
- WIP-3  Builds the audit export: autonomous build in progress

### Do this
You are at your WIP cap, so finish what is in flight before starting anything new. Ordered by the methodology's pick-ordering.

1. WIP-1  Finish the checkout flow. Its spec needs a tax mapping that no ticket tracks yet (see Heads up).
2. WIP-2  Finish the refund screen.

### Methodology findings

Human WIP at 2 (cap 2). At cap: recommending completion of in-flight work only, no new starts. The autonomous build of WIP-3 does not count against your cap.

- **Chain gap (upstream)**: WIP-1  required tax mapping has no ticket.
- **Repeat-park**: WIP-5  Sets the currency used for refunds; the currency decision keeps parking it.

(more in /faff-tidy)

### Heads up
- Chain gap ⚠ (upstream): WIP-1  Finishes the checkout flow: the spec needs a tax mapping, but no ticket exists for that work.
- Repeat-park ⚠: WIP-5  Sets the currency used for refunds: parked repeatedly on the same currency decision. Decide via `/faff-prep --refresh`.

### Automation preview: fire `/faff-beep-boop`?

**Build queue** (1 ready · 1 fire-and-forget · 0 likely-fire)

  fire-and-forget
    WIP-4  Add receipts

**Needs your call before automation can pick up:** (none)

**Prep queue:** (none)

### Structural diagnostics

- **Chain gap (upstream)**: WIP-1  Finishes the checkout flow: required tax mapping has no ticket.
- **Repeat-park**: WIP-5  Sets the currency used for refunds: repeated currency decision parks.
- **Ghost project**: WIP-6  Link payment alerts: the old payment project it points to is missing.

### Calibration signals

The currency decision was the root cause of 4 events in the last 14 days. Advisory only; nothing has been changed. Possible actions: (a) extend the resolve-attempt rules to recognise this pattern, (b) settle the currency decision and re-run `/faff-prep --refresh` on the affected issues, or (c) ignore it and change nothing.

### Next steps
- File a gap issue for the tax mapping WIP-1 needs? (y/n)
- Re-prep WIP-5 via `/faff-prep --refresh` to settle the currency decision? (y/n)
- Run a full groom via `/faff-tidy` to see every structural finding? (y/n)
- Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
