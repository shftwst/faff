Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress
- WIP-1  Finishes the checkout flow: in progress (human)
- WIP-2  Finishes the refund screen: in progress (human)
- WIP-3  Builds the audit export: in progress (autonomous run; does not count against your WIP cap)

### Do this
Your WIP is at cap, so this is completion of in-flight work only, no new starts. Ordered by the methodology's pick-ordering.

1. WIP-1  Finish the checkout flow. Note the upstream chain gap below: the tax mapping it needs has no ticket.
2. WIP-2  Finish the refund screen.

### Methodology findings

Human WIP at 2 (cap 2). At cap: recommending completion of in-flight work only, no new starts.

- Chain gap (upstream): WIP-1  The required tax mapping has no ticket.
- Repeat-park: WIP-5  Sets the refund currency; the currency decision keeps parking it.

(more in /faff-tidy)

### Heads up
- Chain gap ⚠ (upstream): WIP-1  Finishes the checkout flow: the required tax mapping has no ticket, so finishing WIP-1 leaves that prerequisite untracked.
- Repeat-park ⚠: WIP-5  Sets the refund currency: repeated parks on the currency decision. Decide via `/faff-prep --refresh`.

### Automation preview: fire `/faff-beep-boop`?

**Build queue** (1 ready · 1 fire-and-forget · 0 collision groups)

  fire-and-forget
    WIP-4  Add receipts

**Needs your call before automation can pick up:**
  (none)

Prep queue: (none)

### Structural diagnostics

- Chain gap (upstream): WIP-1  Finishes the checkout flow: required tax mapping has no ticket.
- Repeat-park: WIP-5  Sets the refund currency: repeated currency decision parks.
- Ghost project: WIP-6  Links payment alerts: the old payment project it points to is missing.

### Calibration signals

_Calibration signal:_ 4 events in the last 14 days share the root cause "currency decision". Consider: (a) extending the resolve-attempt rules to recognise this pattern, (b) running `/faff-prep --refresh` on the affected issues so their specs record the decision, or (c) ignore, no change. Advisory only; nothing has been applied.

Next steps:
- Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
- Run a full groom via `/faff-tidy`? (y/n)
