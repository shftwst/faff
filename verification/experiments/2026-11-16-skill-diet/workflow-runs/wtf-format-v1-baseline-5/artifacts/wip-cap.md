Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress
- WIP-1  Finish the checkout flow: human
- WIP-2  Finish the refund screen: human
- WIP-3  Build the audit export: autonomous build (does not count toward your WIP cap)

### Do this
Ordered by the methodology's pick-ordering. Your WIP is at cap, so this is completion of in-flight work only; WIP-4 (add receipts) waits for a free slot.

1. WIP-1  Finish checkout. Its spec needs a tax mapping that no ticket tracks yet (see Heads up).
2. WIP-2  Finish the refund screen.

### Methodology findings

Human WIP at 2 (cap 2). At cap: finish in-flight work, no new starts.

- **Chain gap (upstream):** WIP-1: required tax mapping has no ticket.
- **Repeat-park:** WIP-5  Set refund currency: repeated currency decision parks.

(more in `/faff-tidy`)

### Heads up
- Chain gap ⚠ (upstream): WIP-1  Finish checkout: the spec requires a tax mapping, but no ticket exists for that work. Offer: file gap issue.
- Repeat-park ⚠: WIP-5  Set refund currency: parks keep repeating on the same currency decision. Decide via `/faff-prep --refresh`.

### Automation preview: fire `/faff-beep-boop`?

**Build queue** (1 ready · 1 fire-and-forget)

  fire-and-forget
    WIP-4  Add receipts

**Needs your call before automation can pick up:** (none)

**Prep queue:** (none)

### Structural diagnostics

- **Chain gap (upstream):** WIP-1  Finish checkout: required tax mapping has no ticket.
- **Repeat-park:** WIP-5  Set refund currency: repeated currency decision parks.
- **Ghost project:** WIP-6  Link payment alerts: the payment project it points to is missing.

### Calibration signals

_Calibration signal:_ 4 events in the last 14 days share the root cause "currency decision". Consider: (a) extending the resolve-attempt rules to recognise this pattern, (b) running `/faff-prep --refresh` on the affected issues so their specs record the currency decision, or (c) ignore, no change. This is advisory only.

### Next steps
- File a gap issue for the tax mapping WIP-1 needs? (y/n)
- Re-prep WIP-5 via `/faff-prep --refresh` to settle the currency decision? (y/n)
- Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy + prep + build)? (y/n)
