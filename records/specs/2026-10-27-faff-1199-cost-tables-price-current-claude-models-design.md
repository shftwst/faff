# FAFF-1199 — Price the current Claude models (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-fable-5-1`) in the built-in cost tables

> Spec: faffter-dark-nlspec · 2026-10-27 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1199.

This spec is for the build agent implementing FAFF-1199 and for the human reviewer gating it. It describes adding three current Claude models to the three hand-maintained per-million-token (per-MTok) cost tables faff ships, and resolves the two open questions the ticket raised (the exact rates, and how an unlisted model is priced).

## 1. WHY — Problem and Principles

**The load-bearing idea.** faff prices token spend from three independent, hand-maintained rate tables — one per consumer — and a model that is absent from a table is not priced correctly by that consumer. The current production models (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-fable-5-1`) are absent, so spend on them is mispriced or unpriced. The fix is to add one row per model to each table, with rates taken verbatim from Anthropic's published pricing.

**Problem statement.** The cost tables stop at the previous generation (`claude-opus-4-8`, `claude-sonnet-5`, `claude-fable-5`), and `eval/tokenomics.mjs` carries no Claude Fable row at all. Spend on the models now actually in use — the planned eval model `claude-opus-5-5` and the 5.5 / fable-5.1 session models — therefore falls through each table's unlisted-model path (a null, a conservative over-estimate, a silent zero, or an opus-tier default depending on the consumer) instead of being priced at its real rate. This change adds the three models to every table so `faff economics`, the budget governor, and the two offline analysis scripts price them correctly.

**Design principles.**

- **Confirmed rates only — never estimate.** Every number committed must come from Anthropic's published pricing table, not from a multiplier guess. This matters because the historical "cache read = 0.1× input" rule no longer holds for these models (see the WHAT section), so a plausible-looking derived number is wrong.
- **The governor must never price lower than reality.** The budget governor's job is to stop runaway spend. Its existing fail-safe (price an unknown model at the costliest known row) must be preserved; adding rows must not weaken it.
- **Additive, not structural.** This is a data change plus one small, localised fidelity fix. It must not restructure the pricing code, unify the three tables, or change how any consumer is wired.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/budget.js` | JavaScript (committed, no `.ts` sibling) | `PRICE_PER_MTOK` (5-class rows) feeds `faff economics` and the budget governor |
| `eval/tokenomics.mjs` | JavaScript (ESM) | `RATES` (2-class) + a flat `CACHE_MULT` drive the cache-economics bench |
| `scripts/token-breakdown.mjs` | JavaScript (ESM) | `PRICE_PER_MTOK` (4-class) drives the offline per-day/per-model spend report |
| `https://platform.claude.com/docs/en/about-claude/pricing` | — | The authoritative source for every rate below |

**Scope statement.** These are the three cost tables faff maintains by hand; this change keeps them current with the models faff actually runs on.

## 2. OUT OF SCOPE

- **Unifying the three price tables into one shared module.** Why excluded: a real refactor with its own risk; the ticket is a data refresh. Extension point: a future issue could have all three import a single `PRICE_PER_MTOK` from `budget.js`.
- **Adding every other current model (e.g. `claude-fable-5`, `claude-haiku-5-5`, `claude-opus-5`, `claude-sonnet-5` where a given table lacks them).** Why excluded: the ticket names three models in production use; widening to the whole catalogue is separate grooming. Extension point: the same row-addition pattern in each table. Note in particular that `eval/tokenomics.mjs` and `scripts/token-breakdown.mjs` lack a `claude-fable-5` row too — a reasonable adjacent add, but not this ticket.
- **Changing the unlisted-model fallback *mechanism* in any consumer.** Why excluded: the ticket asks whether unlisted pricing *should warn*, answered in the HOW section as "no new warning"; redesigning the fallbacks is a separate concern. Extension point: `priceModelClassSums` / `priceFor` / `rateFor`.
- **Auto-refreshing rates from the live pricing page.** Why excluded: these are deliberately committed, reviewable constants with a staleness nudge. Extension point: `priceFreshnessNudge` in `budget.js`.

## 3. WHAT — Confirmed rates and table shapes

**Vocabulary.**

| Term | Definition |
|---|---|
| per-MTok rate | Dollars per one million tokens for a given token class |
| token class | One of: base input, output, 5-minute cache write, 1-hour cache write, cache read (a.k.a. cache hit/refresh) |
| cache-read multiplier | The ratio of a model's cache-read rate to its base input rate |

**Confirmed rates (from Anthropic's published pricing page, reconfirmed 2026-10-27).** These are authoritative, not estimated:

| Model | input | output | 5m cache write | 1h cache write | cache read |
|---|---|---|---|---|---|
| `claude-opus-5-5` | $4 | $20 | $5 | $8 | $0.20 |
| `claude-sonnet-5-5` | $2 | $10 | $2.50 | $4 | $0.10 |
| `claude-fable-5-1` | $10 | $50 | $12.50 | $20 | $0.25 |

**The cache-read rule changed for these models — this is the one non-obvious fact in the data.** Historically faff's tables assumed cache read = 0.1× base input. The published page's footnotes state that cache reads are now priced at **0.05× base input for `claude-opus-5-5` and `claude-sonnet-5-5`** and **0.025× base input for `claude-fable-5-1`** (all other models keep 0.1×). Cache *writes* are unchanged: 5-minute = 1.25× input and 1-hour = 2× input hold uniformly across every model, including these three. So the committed cache-read figures above ($0.20, $0.10, $0.25) are deliberately *lower* than a naive 0.1× would give ($0.40, $0.20, $1.00); do not "correct" them.

**Decision — are the rates confirmed, or must they be punted?** The ticket mandated published rates and flagged that getting them wrong is worse than punting. All five classes for all three models were confirmed against the live published pricing table and its multiplier footnotes. The cached `claude-api` skill reference was imprecise on one value (it loosely stated Sonnet 5.5 cache read as $0.20; the authoritative page and its 0.05× footnote give $0.10) — the live page value is used. **Chosen:** commit the rates in the confirmed-rates table above verbatim; nothing is punted. *(decides: product)* — reviewer should spot-check the three rows against `platform.claude.com/.../pricing` at merge time.

**Table shapes the build agent must match (do not change the shapes).**

```
budget.js  PRICE_PER_MTOK[model]  = { input, output, cache_write_5m, cache_write_1h, cache_read }   # dollars/MTok
tokenomics RATES[model]           = { in, out }                                                      # cache handled via CACHE_MULT
token-breakdown PRICE_PER_MTOK[m] = { input, output, cache_write, cache_read }                       # single cache_write == 5m (1.25x)
```

## 4. HOW — Behaviour

**Overview.** Add one row per model to each of the three tables, using the confirmed rates mapped onto that table's shape. Make one small fidelity fix in `tokenomics.mjs` so its flat cache-read multiplier does not over-price the new models. Bump each table's provenance/as-of marker. No wiring, no consumer logic, changes beyond the one `tokenomics` read-multiplier hook.

**`budget.js` is edited directly as JavaScript.** It has no `.ts` sibling (confirmed: only `budget.js` exists under `bin/lib/`), so the AGENTS.md "edit the `.ts`, rebuild the `.js`" rule does not apply here and no build step is required for this file. The three rows carry all five classes exactly as in the confirmed-rates table (e.g. `"claude-opus-5-5": { input: 4, output: 20, cache_write_5m: 5, cache_write_1h: 8, cache_read: 0.2 }`). Also bump `PRICE_TABLE_AS_OF` from `"2026-07-23"` to the reconfirmation date `"2026-10-27"`, since the table was just reconfirmed against published pricing (its own comment instructs this on reconfirmation).

**`tokenomics.mjs` needs a per-model cache-read multiplier, because its cache-read leg is derived, not stored.** `RATES` holds only `{ in, out }`; `billCalls` computes the cache-read leg as `c.cr * CACHE_MULT.read * pin` with a single flat `CACHE_MULT.read = 0.1`. For the new models the real multiplier is 0.05 (opus-5-5, sonnet-5-5) or 0.025 (fable-5-1), so a flat 0.1× over-prices their cache reads by 2×–4× — and this is the one bench whose entire purpose is cache economics, so that distortion is a real defect, not cosmetic.

```
PROCEDURE price_cache_read_leg(call, rate_row):
  1. read_mult = rate_row.read_mult IF present ELSE CACHE_MULT.read   # default 0.1x preserved for every existing model
  2. return call.cr * read_mult * (rate_row.in / 1e6)
```

Give the three new `RATES` rows an optional `read_mult` field (`0.05` for opus-5-5 and sonnet-5-5, `0.025` for fable-5-1) and change the single cache-read line in `billCalls` to read `read_mult` from the row, defaulting to `CACHE_MULT.read`. Leave the write legs (`CACHE_MULT.write_5m` / `write_1h`) untouched — the 1.25×/2× write multipliers are correct for these models. **Anti-pattern:** replacing the flat `CACHE_MULT.read` with a hard-coded 0.05 globally. Why: that silently mis-prices every pre-existing 0.1× model.

**`token-breakdown.mjs` stores cache read as an absolute rate, so it needs no multiplier logic — just the correct numbers.** Its rows are `{ input, output, cache_write, cache_read }` where `cache_write` is the 5-minute (1.25×) rate. Add `"claude-opus-5-5": { input: 4, output: 20, cache_write: 5, cache_read: 0.2 }`, `"claude-sonnet-5-5": { input: 2, output: 10, cache_write: 2.5, cache_read: 0.1 }`, `"claude-fable-5-1": { input: 10, output: 50, cache_write: 12.5, cache_read: 0.25 }`. Update the module's provenance comment (currently "cache_read = 0.1x input") and the `pricing.source` string (currently "cached 2026-06-24; … cache_read=0.1x input") so they no longer assert the 0.1× rule as universal — note that current models read at 0.05×/0.025× and the stored `cache_read` values already encode the correct rate.

**Unlisted-model pricing today, and whether to warn (the ticket's second open question).** The three consumers already handle an unlisted model differently, by design:

| Consumer | Unlisted-model behaviour today | Surfaced? |
|---|---|---|
| `faff economics` (via `economicsPriceForModel`) | returns `null` → cost rendered as `null` | yes, as an explicit null |
| budget governor (via `priceModelClassSums`) | priced at the costliest known row (`conservativePriceRow`), never $0 | yes, model named in `unpriced_models` |
| `scripts/token-breakdown.mjs` (via `priceFor`) | `ZERO_PRICE` → $0 | no, silent |
| `eval/tokenomics.mjs` (via `rateFor`) | `DEFAULT_RATE` = opus-tier `{5, 25}` | no |

**Decision — add a new warning for unlisted models?** The governor already fails safe and names unpriced models; `economics` already shows null; the two scripts are interactive offline tools whose operator sees the output. Adding the three models removes them from the unlisted path entirely, which is the actual fix the ticket needs. **Chosen:** keep each consumer's existing unlisted-model policy unchanged; add no new warning in this ticket. The one latent sharp edge — `token-breakdown.mjs` silently pricing a genuinely unknown model at $0 — is noted under OUT OF SCOPE as a possible follow-up, not changed here. *(decides: architecture)*

**Adding these rows does not weaken the governor's fail-safe.** `conservativePriceRow` takes the per-class maximum across all rows. The new rows (max input $10, output $50, 1h-write $20 — all from `claude-fable-5-1`, which equals the existing `claude-fable-5` maxima) do not raise or lower any column maximum, so the conservative fallback row is unchanged and the existing governor self-test expectations still hold.

**Failure modes.**

- **The failure:** a rate is transcribed wrong (e.g. the naive 0.1× cache-read value committed instead of the footnote value). **How you'd know:** a cost report for a known workload comes back ~2×–4× high on the cache-read leg for the affected model; a spot-check against the published page disagrees. **What it means:** correct the number before merge — this is the exact risk the "confirmed rates only" principle guards.
- **The failure:** the `tokenomics` `read_mult` hook is applied to the write legs too, or the default is dropped. **How you'd know:** existing-model (`claude-opus-4-8`, `claude-sonnet-5`) bench outputs change when they should be byte-identical. **What it means:** the fidelity fix over-reached; narrow it to the cache-read leg only.

## 5. Scenarios — main objectives, born verifiable

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a token workload recorded against claude-opus-5-5
When faff economics prices it
Then the model is priced at $4/$20/$5/$8/$0.20 per MTok (input/output/5m-write/1h-write/read)
  and no longer appears as unpriced (cost is a number, not null)
```

```
Given the tokenomics bench prices a workload whose calls are mostly cache reads on claude-sonnet-5-5
When billCalls computes the cache-read leg
Then it uses the 0.05x read multiplier (read rate $0.10/MTok), not the flat 0.1x ($0.20/MTok)
  and the same run on claude-opus-4-8 is byte-identical to before this change
```

- The budget governor's `conservativePriceRow` (costliest-known-row fallback) returns the same per-class maxima after the three rows are added as before.

## 6. Design Decision Rationale

**Where do the rates come from, and is any rate unconfirmed?** Options: (a) take all five classes per model from Anthropic's published pricing page; (b) commit input/output from the page and derive cache classes from historical multipliers; (c) punt rates that aren't line-itemed. Option (b) is unsafe because the cache-read multiplier changed for exactly these models. Option (c) is unnecessary because the page line-items every class. **Chosen:** option (a) — every class confirmed against the published page and its multiplier footnotes; the cached `claude-api` reference's looser Sonnet-5.5 cache-read figure was overridden by the authoritative page.

**How does `tokenomics.mjs` represent the new, lower cache-read multiplier?** Options: (a) optional per-row `read_mult`, defaulting to the existing flat `CACHE_MULT.read`; (b) a second per-model multiplier map; (c) do nothing and accept 2×–4× cache-read over-pricing. Option (c) defeats a cache-economics bench; (b) duplicates the rate home. **Chosen:** option (a) — smallest change, preserves every existing model's behaviour by default, keeps the rate next to the model it belongs to.

**Should unlisted-model pricing start warning?** Options: (a) keep each consumer's current policy; (b) add a uniform warn across all three tables. **Chosen:** option (a) — the governor already fails safe and names unpriced models, and this ticket's real job is to make the three models *listed*; a cross-consumer warning policy is separate work.

**Bump the provenance dates?** **Chosen:** yes — bump `PRICE_TABLE_AS_OF` to `2026-10-27` and refresh the `token-breakdown.mjs` provenance comment/`pricing.source` string, because the tables were just reconfirmed and the old "0.1× cache read" provenance note is now misleading.

## 7. Open Questions and Assumptions

**Open Questions:** none. Both questions the ticket raised are resolved above (rates confirmed; unlisted policy kept, no new warning).

**Assumptions:** none load-bearing. (The rates are confirmed data, not assumptions; the reviewer spot-check noted in the WHAT decision is a verification step, not an unresolved dependency.)

## 8. DONE — Definition of Done

### From WHAT (confirmed rates)
- [ ] `budget.js` `PRICE_PER_MTOK` has rows for `claude-opus-5-5` (4/20/5/8/0.2), `claude-sonnet-5-5` (2/10/2.5/4/0.1), `claude-fable-5-1` (10/50/12.5/20/0.25), each with all five classes `{input, output, cache_write_5m, cache_write_1h, cache_read}`.
- [ ] `eval/tokenomics.mjs` `RATES` has rows `claude-opus-5-5` `{in:4,out:20}`, `claude-sonnet-5-5` `{in:2,out:10}`, `claude-fable-5-1` `{in:10,out:50}`.
- [ ] `scripts/token-breakdown.mjs` `PRICE_PER_MTOK` has rows `claude-opus-5-5` `{input:4,output:20,cache_write:5,cache_read:0.2}`, `claude-sonnet-5-5` `{input:2,output:10,cache_write:2.5,cache_read:0.1}`, `claude-fable-5-1` `{input:10,output:50,cache_write:12.5,cache_read:0.25}`.

### From HOW (behaviour)
- [ ] `faff economics` prices a `claude-opus-5-5` workload at the committed rates and no longer reports it unpriced/null.
- [ ] `tokenomics.mjs` `billCalls` applies a per-row `read_mult` for the cache-read leg (0.05 for opus-5-5 / sonnet-5-5, 0.025 for fable-5-1), defaulting to `CACHE_MULT.read` (0.1) when a row omits it; write legs unchanged.
- [ ] A `tokenomics` bench run on a pre-existing model (`claude-opus-4-8`) is unchanged by this edit.
- [ ] `budget.js` was edited directly (no `.ts` sibling; no build step), `PRICE_TABLE_AS_OF` bumped to `2026-10-27`.
- [ ] `token-breakdown.mjs` provenance comment and `pricing.source` string no longer assert a universal 0.1× cache-read rule.

### From HOW (unlisted-model policy)
- [ ] No new unlisted-model warning was added; each consumer's existing fallback is unchanged.
- [ ] `budget.js` `conservativePriceRow` per-class maxima are unchanged after the additions (governor fail-safe preserved).

### Repository checks (not holdout-judgeable)
- [ ] `budget.js` selftest passes, including (added) assertions that `economicsPriceForModel` returns the committed rows for the three new model IDs.
- [ ] `faff regions check` / the repo's standard lint pass stays green.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. price a one-call workload of 1,000,000 cache-read tokens on claude-fable-5-1 through tokenomics billCalls
  2. ASSERT the cache-read leg == $0.25  (0.025x * $10), not $1.00
  3. price the same model through budget.js economicsPriceForModel
  4. ASSERT the returned row == { input:10, output:50, cache_write_5m:12.5, cache_write_1h:20, cache_read:0.25 }
```

confidence: high
spec-review: approve
build-tier: complex

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

Lens appetite `high`; `issue-critique` is advisory — findings only, no tracker writes.

### Right-sized? (Principle 4) — No issues

FAFF-1199 is a single coherent sub-day-to-one-day unit: three rows added to each of three hand-maintained tables, plus one localised `read_mult` hook in `tokenomics.mjs`. The fidelity fix is not an independent second concern that would justify a split — it exists *only* because the three new models carry a changed cache-read multiplier (0.05x / 0.025x vs the legacy flat 0.1x), so it is load-bearing on exactly the rows being added and correctly ships with them (the principle's "merge items that always ship together"). The spec also draws a clean right-sized boundary: unifying the three tables and adding the rest of the model catalogue are explicitly pushed OUT OF SCOPE, keeping this a data refresh rather than a creeping refactor. Nothing to split, nothing to merge.

### Workstream fit? (Principles 1 + 5) — No issues

The issue sits project-less in Backlog, which is the lens's correct default landing for a standalone maintenance refresh that does not name one coherent, currently-sequencable outcome to home into. There is no activity-named or mixed-outcome workstream to critique here because there is no workstream — and manufacturing one ("Pricing", "Tech debt") would itself be a thematic/activity bucket the lens forbids. Leaving it loose is right. One forward note for a later `backlog-diagnostics` pass, not this issue: if sibling "keep-X-current" refresh tickets accumulate (e.g. the OUT-OF-SCOPE `claude-fable-5` / `claude-haiku-5-5` catalogue additions the spec flags), a rehoming pass could cluster them under a single outcome — but a lone refresh ticket is below that bar and belongs loose.

### Deps surfaced? (Principle 6) — One finding

**What's there.** All tracker relations are empty (no blocks, blockedBy, relatedTo), yet the issue's own "Why now" paraphrases planned work: "`claude-opus-5-5` is the planned eval model, and sessions already run on the 5.5 and fable-5.1 models." That is a clear reference to an eval-model-adoption change elsewhere, named as the reason this ticket exists, with no link encoding the relationship.

**Why it matters.** The direction of the dependency runs *toward* this ticket: an "adopt `claude-opus-5-5` as the eval model" change wants this pricing landed first, or spend on the new eval model is mispriced/unpriced the moment it switches on (precisely the gap the spec describes). Left implicit, a build pass could pull the eval-model switch "ready" while pricing is still absent — the silent-regression failure mode principle 6 guards against. The ticket itself takes no code dependency on other tickets (its data source is Anthropic's published pricing page, an external reference verified at spec time, not a tracker prerequisite), so FAFF-1199 is genuinely unblocked — the missing edge is the *downstream* one.

**What to do.** Check whether the eval-model adoption is a tracked ticket; if it is, link FAFF-1199 as blocking it (or at minimum relatedTo) so sequencing is honest and pricing lands first. If no such ticket exists, the "planned eval model" phrasing is just context and needs no link — but confirm that, don't leave it ambiguous.

### Risk profile? (Principle 7) — No issues

The real risk on a rates-refresh is data-correctness, not integration or novel approach, and the spec has already de-risked it inline rather than piling it at the end: a "confirmed rates only — never estimate" principle, an explicit callout that the cache-read multiplier changed for exactly these three models (so the naive 0.1x derivation is now wrong), a named failure mode for a transcribed rate, a reviewer spot-check against the live pricing page mandated at merge, and a smoke test asserting the fable-5.1 cache-read leg is $0.25 not $1.00. That is the right shape — the unknown (are the numbers right?) is surfaced and verified up front, not deferred. A de-risking spike would add nothing here; the verification *is* the de-risking. The only residual exposure is ordinary staleness of an external rate table, and provenance was reconfirmed 2026-10-27 (today), so it is fresh at authoring. No change recommended.
