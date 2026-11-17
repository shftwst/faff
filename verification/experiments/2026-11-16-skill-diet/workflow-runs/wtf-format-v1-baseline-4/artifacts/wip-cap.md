Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress
- WIP-1  Finish the checkout flow; human work in flight
- WIP-2  Finish the refund screen; human work in flight
- WIP-3  Build the audit export; autonomous build (does not count against your WIP cap)

### Do this
Ordered by the configured methodology's `pick-ordering`. Your WIP is at cap, so this is completion of in-flight work only; no new starts. WIP-4 (add receipts) is held back for now and sits in the automation build queue below.

1. WIP-1  Finish the checkout flow. Note the chain gap below: its spec needs a tax mapping that no ticket covers.
2. WIP-2  Finish the refund screen.

### Methodology findings

Human WIP at 2 (cap 2). At cap: recommending completion of in-flight work only, no new starts.

- Chain gap (upstream): WIP-1  the required tax mapping has no ticket.
- Repeat-park: WIP-5  Set the refund currency; currency decision parks keep repeating.

(more in `/faff-tidy`)

### Heads up
- Chain gap ⚠ (upstream): WIP-1  Finish the checkout flow; the spec requires a tax mapping, but no ticket exists for that work.
- Repeat-park ⚠: WIP-5  Set the refund currency; parked repeatedly on the currency decision.

### Automation preview: fire `/faff-beep-boop`?

**Build queue** (1 ready · 1 fire-and-forget)

  fire-and-forget
    WIP-4  Add receipts

**Needs your call before automation can pick up:**
  (none)

Prep queue: (none)

### Structural diagnostics

- Chain gap (upstream): WIP-1  required tax mapping has no ticket.
- Repeat-park: WIP-5  repeated currency decision parks.
- Ghost project: WIP-6  Link payment alerts; the old payment project it points to is missing.

### Calibration signals

_Calibration signal:_ 4 events with the root cause "currency decision" in the last 14 days. Consider: (a) extending the resolve-attempt rules to recognise this pattern, (b) running `/faff-prep --refresh` on the affected issues to record the currency choice in their specs, or (c) ignore, no change. Advisory only; nothing has been changed.

Next steps:
- Run a full groom via `/faff-tidy` to see every structural finding? (y/n)
- Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
