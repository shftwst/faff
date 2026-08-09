# ADR 0048 — Per-model x per-class token pricing model

- **Status:** Proposed
- **Date:** 2026-07-09
- **Issue:** FAFF-410

## Context

faff attributes a USD cost to token spend in more than one place. The run-level
`economics` command has, until now, priced a single scalar token total at one flat
`budget.price_per_mtok` rate — a rate that cannot express the real economics of the
Claude API, where the four token classes (`input`, `output`, `cache_creation`,
`cache_read`) are billed at very different per-million rates, and each model has its
own rate card. The FAFF-407 spike proved that a class-aware, model-aware breakdown
is where the optimisation signal lives (cache_read dominates spend; a cheaper model
on the high-volume lane is the lever). Landing that breakdown durably in `economics`
forces the question: where does the per-model × per-class price table live, and how
does a user tune it — code constant, config, or both? A flat scalar is not an
option for a per-class breakdown, and future cost surfaces (budget ceilings, an
evaluate-cost helper) will want the same pricing source rather than re-deriving one.

## Decision

Token cost, wherever faff prices per-class per-model spend, resolves against a
**built-in `PRICE_PER_MTOK` map** (a code constant: model-id → `{input, output,
cache_write, cache_read}` USD-per-1M-tokens, seeded from the API rate card),
**optionally overridden per-model by a `budget.price_per_mtok_by_model` config
map**. The precedence is fixed: `config[model][class]` → built-in
`PRICE_PER_MTOK[model][class]` (with a dated model-id suffix `-YYYYMMDD` stripped
before lookup) → for a model present in neither map, the row's cost is `null`
(distinct from `$0`, so an unpriced/local model is visible rather than silently
counted free). This is deliberately **additive** to the legacy flat
`budget.price_per_mtok`, which continues to drive the existing top-line
`computeUnitEconomics` cost unchanged; reconciling the two pricing models is a
separate, later decision.

## Consequences

- **Works with zero config, tunable when needed** — the built-in map prices the
  shipped models out of the box; a user extends or corrects rates via
  `budget.price_per_mtok_by_model` without editing code, honouring the
  configurable-not-opinionated tenet.
- **One pricing source for future cost surfaces** — budget cost ceilings and a
  future evaluate-cost helper inherit this map + precedence rather than each
  minting its own rate table, so a rate change lands in one place.
- **Two cost figures coexist for now** — the flat-scalar top-line cost and the
  per-model × per-class breakdown cost can disagree; that divergence is named
  out-of-scope and left for a follow-up to reconcile (migrate the top-line onto
  this map, or emit a reconciliation delta).
- **An unpriced model never crashes and never reads as free** — it surfaces as
  `cost: null` with the model-id visible, prompting a human to extend the map.
- **The rate card ages** — the built-in constant is a point-in-time snapshot; the
  config override is the escape hatch when the shipped defaults drift from billing.

**Reconciliation note (ADR-0059, FAFF-427 / FAFF-446):** the "two cost figures
coexist" item above is superseded — ADR-0059 wired this map into `budget.cost`
+ `economics`'s top-line as the default pricing source, and FAFF-446 has since
removed the legacy flat `budget.price_per_mtok` scalar entirely (it can no
longer be freshly configured; see ADR-0059's amendment). This map + the
`budget.price_per_mtok_by_model` override, unchanged, remain the one pricing
source.
