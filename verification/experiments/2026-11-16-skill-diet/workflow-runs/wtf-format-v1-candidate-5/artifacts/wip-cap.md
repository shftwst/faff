Methodology: faffter-dark-methodology-agile-delivery

## What's up: 2026-11-16

### In progress

- **WIP-1:** Finish checkout. Human.
- **WIP-2:** Finish the refund screen. Human.
- **WIP-3:** Build the audit export. Autonomous build; it does not count against your WIP cap.

### Do this

Human WIP is at cap (2 of 2), so finish in-flight work before starting anything new.

1. **WIP-1:** Finish checkout. See the upstream chain gap below.
2. **WIP-2:** Finish the refund screen.

### Methodology findings

- **WIP:** human WIP 2 of 2, at cap; no headroom for new starts.
- **Upstream chain gap, WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5 (set the refund currency):** Repeated currency decision parks.

(more in `/faff-tidy`)

### Heads up

- **[chain gap: upstream] WIP-1:** Required tax mapping has no ticket.
- **[repeat-park] WIP-5:** Repeated currency decision parks.

### Automation preview

**Build queue**

```
fire-and-forget (independents)          likely-fire (serialised)
  WIP-4  Add receipts                     (none)
```

**Needs your call:** (none)

**Prep queue:** (none)

### Structural diagnostics

- **Chain gap (upstream), WIP-1:** Required tax mapping has no ticket.
- **Repeat-park, WIP-5:** Repeated currency decision parks.
- **Ghost project, WIP-6 (link payment alerts):** Old payment project is missing.

### Calibration signals

4 events with the root cause "currency decision" in the last 14 days. Consider: (a) extending the resolve-attempt rules to recognise this pattern, (b) running `/faff-prep --refresh` on the affected issues so their specs record the currency decision, or (c) ignoring it, with no change. These are suggestions; nothing has been applied.

---

- Build queue has 1 issue (1 independent, 0 collision groups), plus 0 prep candidates. Run `/faff-beep-boop` (full pipeline: tidy, prep and build)? (y/n)
- Run a full groom via `/faff-tidy`? (y/n)
