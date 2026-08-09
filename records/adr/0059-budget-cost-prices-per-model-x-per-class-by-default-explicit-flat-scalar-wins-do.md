# ADR 0059 — budget.cost prices per-model x per-class by default; explicit flat scalar wins; dollar ceiling is the recommended L4 governor

- **Status:** Proposed
- **Date:** 2026-07-12
- **Issue:** FAFF-427

## Context

ADR-0048 gave faff an accurate per-model × per-class price map (`PRICE_PER_MTOK`,
model-id → `{input, output, cache_write, cache_read}` USD/MTok, plus a
`budget.price_per_mtok_by_model` config override) for the `economics --by`
breakdowns, but deliberately left the map **unwired** from the two places that
actually govern spend: the `budget.cost` ceiling dimension in `faff budget
check`, and the `economics` top-line `cost_total`/`cost_per_*` figures. Both
still price against the flat scalar `budget.price_per_mtok` (default `"0"` =
disabled), which charges every token class — including cache_read, ~85.5% of
measured traffic — at one undifferentiated rate. ADR-0048 named this explicitly
as "two cost figures coexist for now" and deferred the reconciliation.

The practical cost of leaving it unwired: the only default-armed L4 spend
governor a user can arm today is either a fiction (`budget.cost` priced flat,
usually left at 0/disabled) or a semantically weak proxy (`budget.tokens`,
dominated by cache_read so a meaningful ceiling needs tens of millions of raw
tokens). A dollar ceiling that doesn't measure dollars cannot be the governor
an unattended L4 run relies on to stop spending.

`bin/lib/budget.js` is the governance region and `bin/lib/economics.js` is the
factory region (FAFF-359 region direction: governance must never reference
factory). The price map — needed by both the governing `budget.cost` dimension
and the reporting `economics` command — can only live in one place without
inverting that direction: it moves to governance, and the factory-region
reporting command imports it from there.

## Decision

`budget.cost` and the `economics` top-line resolve against the **same pricing
rule**, replacing ADR-0048's "two cost figures coexist" interim state:

- **Map is the default pricing source.** Absent an explicit `budget.price_per_mtok
  > 0`, both `budget.cost` and `economics`' top-line price the run's per-model ×
  per-class token walk against the resolved price map (built-in `PRICE_PER_MTOK`,
  overridden per-model by `budget.price_per_mtok_by_model` — ADR-0048's
  precedence, unchanged).
- **Explicit flat scalar wins.** A human who has set `budget.price_per_mtok > 0`
  keeps today's flat-scalar behaviour byte-for-byte, with a deprecation warning
  pointing at the map. Human-explicit config always outranks the default; the
  map is additive-by-default, not a silent override of a deliberate setting.
- **The price map itself moves to `budget.js` (governance).** `PRICE_PER_MTOK`,
  `economicsPriceForModel`, and `resolveEconomicsPriceMap` relocate from
  `economics.js` into `budget.js`; `economics.js` imports and re-exports them
  (the legal factory→governance edge). `budget.js` never requires
  `./economics` — the FAFF-359 direction invariant holds by construction, and
  `faff regions check` is the mechanical proof.
- **Unpriced models overcount, never undercount.** A model absent from the
  resolved map is priced at the costliest per-class rate present in the map,
  with a warning naming the model-id, so a pricing gap can only make a governor
  breach *early* — never silently pass through unmetered.
- **A dollar ceiling (`budget.cost`) becomes the recommended default L4 spend
  governor.** It is accepted as a sufficient spend/time ceiling on its own
  (lights-out's `spendTimeCeilingSet` / `budget-ceiling` gate), and the gate's
  refusal message leads with it ahead of `budget.tokens` / `budget.until`.

This amends ADR-0048's Consequences section — specifically the "two cost
figures coexist for now" item, which is superseded by the single-rule
reconciliation above. ADR-0048's core Decision (the map + config-override
precedence) is unchanged and remains authoritative; only the deferred
reconciliation is resolved here.

## Consequences

- **One honest default spend governor.** `budget.cost` alone (no
  `price_per_mtok` required) is now a legitimate, recommended L4 ceiling —
  closing the gap where the only armed governor was a fiction or a
  cache-read-skewed token proxy.
- **Zero-config dollars.** `economics` shows real per-model × per-class priced
  dollars by default instead of `cost_*: null`; the top-line and the `--by
  class`/`--by model` breakdowns now agree on one pricing source, closing
  ADR-0048's deferred reconciliation.
- **Back-compatible for explicit configs.** Any repo that already set
  `budget.price_per_mtok > 0` sees byte-identical figures, plus a deprecation
  warning — no silent behaviour change for deliberate configuration.
- **Fail-safe direction on pricing gaps.** An unknown model can only inflate a
  measured cost (via the costliest-rate fallback), never deflate it — a
  pricing gap surfaces as an early breach + warning, never a silently
  unbreachable ceiling.
- **Governance/factory boundary reinforced, not just documented.** Moving the
  map into `budget.js` means `faff regions check` mechanically enforces that
  `budget.js` never imports `economics.js` — the direction invariant this ADR
  depends on is provable, not just asserted in prose.
- **The rate card still ages** (unchanged from ADR-0048) — the built-in map is
  a point-in-time snapshot; `budget.price_per_mtok_by_model` remains the
  escape hatch when rates drift from real billing.
- **`budget.price_per_mtok` is not removed** — it stays accepted, deprecated,
  and explicit-wins, so no in-flight config breaks. Removing it is tracked
  separately (FAFF-446).

## Amendment (FAFF-446, 2026-07-14)

FAFF-446 has now removed `budget.price_per_mtok` — the map is the sole pricing
source for any FRESH config resolve; the scalar can no longer be *set* to
activate flat pricing. A `.faffrc.yaml` that still sets it is ignored (never
applied) and named on the resolved envelope's `price_per_mtok_removed` field:
`faff budget check`/`economics` degrade this to a `warnings` entry (a hard
exit there would fail-open the whole budget signal, masking a real breach —
the FAFF-364 `until_invalid` precedent this ADR's own governance region
already established), while `faff lights-out`'s mint-time preflight refuses
outright (no fail-open risk at that call site). The one thing this amendment
deliberately does **not** touch: a ledger already minted under `pricing:"flat"`
by a pre-FAFF-446 binary keeps its recorded price verbatim via
`envelopeFromLedger` — an in-flight run's dollar ceiling never silently
changes mid-run just because the config schema changed underneath it.
