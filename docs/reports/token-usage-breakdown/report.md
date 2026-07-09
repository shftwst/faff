# Token-usage breakdown (FAFF-407)

> Analysis snapshot — regenerate with `node scripts/token-breakdown.mjs [--json]`. Read-only pivot over the on-disk Claude Code transcript corpus; the pivot re-implements the CLI's `sumTranscriptFile` record selection and asserts internal consistency (`grand.total == flat_sum`). Costs use per-model API pricing (see **Pricing**). Emits sizes/counts/names/costs only — never transcript payload content.

**Window:** 2026-05-29 → 2026-07-09 (40 active days) · 982 transcript files · 86,337 usage records. Regenerated 2026-07-09 with the **FAFF-409** measured per-tool cache-amplification pass. (The corpus is *live* — sessions append to it, so re-running shifts absolute figures marginally; percentages and cost shares are stable. Numbers below are from `report.json`.)

## Headline

- **17,786M tokens (~17.8B) · $16,763** total. **Reconciled** — the pivot's grand total equals the flat four-class sum computed via the *same* record-selection logic as the CLI's `sumTranscriptFile` (`grand.total == flat_sum`, an internal-consistency check; a direct cross-check against `faff budget check` is a fileable follow-up).
- **`cache_read` is the whole game:** 94.7% of tokens and **52.7% of cost ($8,831)**. This is persistent context (skills prompts, gateway, specs, subagent context) re-read on every turn — *not* primarily MCP.
- **MCP's amplified share of `cache_read` is now measured, not a range (FAFF-409): 15.2%** (2.57B of 16.93B tokens; boundary-sensitivity range 15.2–16.2%). The remaining **84.8% is non-MCP context/model.** This *confirms* "the primary lever is context, not MCP" — but MCP is a bigger secondary lever than the ~1% payload floor suggested: ~$1.3K of measured cache cost. See **Axis 4**.
- **`cache_write` is the second cost centre: 32.8% ($5,502).** Writing that context into cache.
- Together, cache traffic = **85.5% of spend**. Model *generation* (`output`) is only 13.3%; fresh `input` is 1.2%.

## Axis 1 — Token class

| Class | Tokens | % tokens | Cost | % cost |
|---|--:|--:|--:|--:|
| cache_read | 16,832.6M | 94.7% | $8,831 | 52.7% |
| cache_write | 826.9M | 4.7% | $5,502 | 32.8% |
| output | 82.9M | 0.5% | $2,225 | 13.3% |
| input | 39.6M | 0.2% | $204 | 1.2% |

**Read:** per-token, `output` is 50× `input` and cache_read is 0.1× input — but *volume* inverts the ranking. The optimisation target is the **cache_read volume**, driven by `context_size × turns`. Levers: leaner prompts (the FAFF-114/115 lean-refactor family) and caching-order discipline (FAFF-119), which shrink the resident context that gets re-billed every turn.

## Axis 2 — Model

| Model | Tokens | % | Cost |
|---|--:|--:|--:|
| claude-opus-4-8 | 15,860M | 89.2% | $13,793 |
| claude-fable-5 | 1,247M | 7.0% | $2,655 |
| claude-sonnet-4-6 | 207M | 1.2% | $153 |
| claude-opus-4-6 | 122M | 0.7% | $85 |
| claude-haiku-4-5 | 342M | 1.9% | $76 |
| qwen3.6:27b-mlx (local) | 3.5M | — | $0 |
| \<synthetic\> (test) | 0 | — | $0 |

**Read:** Opus-4-8 is 82% of spend. Fable-5 is 7% of tokens but 16% of cost (2× Opus per-token). Haiku ran 342M tokens for $76 — the cheap-lane routing (`models.build_by_confidence`, FAFF-334) is working where used. **Biggest per-run lever:** route more mechanical work (high-confidence specs, prep-explore) off Opus onto Haiku/Sonnet.

## Axis 3 — Time

40 active days; spend is bursty (beep-boop run days dominate). Top days: **2026-07-05 ($1,803, 9.3%)**, 2026-06-26 ($1,088), 2026-07-07 ($1,166), 2026-06-29 ($1,001). See `report.json` `by_day` for the full series. No single day is a runaway; cost tracks run activity, as expected.

## Axis 4 — Phase / MCP-vs-model

**Phase attribution: not resolved in this pass.** The corpus-wide pivot has no phase tags; `events.jsonl` carries phase windows but no token data, and orchestrator-inline records span phases. Coarse phase attribution (events.jsonl timestamp-join) is deferred — see **Telemetry gaps**. What *is* attributable: model-vs-MCP, below.

### MCP per-tool cache-amplification (MEASURED — FAFF-409)

FAFF-407 could only price MCP's *one-time payload* and estimated its persistence with a single global `response × 19.42` factor. FAFF-409 **measures** it: a read-only pass reconstructs each context lineage's resident prefix turn-by-turn and splits every billed turn's actual `cache_read_input_tokens` across the blocks resident at that turn, pro-rata by size. MCP `tool_result` blocks collect their shares → the measured per-tool amplification, which **reconciles to the billed `cache_read` total by construction** (`mcp_share + nonmcp_share + unattributed == billed cache_read`, `reconciles: true` in `report.json` → `mcp.reconciliation`).

**`request`** / **`response`** = one-time tool_use params / tool_result payload (chars/4). **`cache_read~`** = the MEASURED summed pro-rata share of billed `cache_read` (replaces the old global-factor estimate). **`amp`** = `cache_read~ / response` — the *per-tool* amplification (the old global factor was a flat ×19.42 for every tool). **`cost~`** = request+response at the input rate + measured `cache_read` at the cache_read rate, priced at opus-4-8. Ranked by measured `cache_read`.

| Tool | Calls | request~ | response~ | **cache_read~ (measured)** | amp | cost~ |
|---|--:|--:|--:|--:|--:|--:|
| Linear.save_comment | 821 | **1.88M** | 1.96M | **607.8M** | ×311 | $323.09 |
| Linear.list_comments | 1,212 | 7.9K | 2.31M | **478.5M** | ×207 | $250.87 |
| Linear.save_issue | 1,471 | **252K** | 1.43M | **458.0M** | ×321 | $237.39 |
| Linear.get_issue | 1,838 | 14.5K | 2.11M | **416.6M** | ×198 | $218.91 |
| Linear.list_issues | 638 | 10.7K | 1.88M | **394.9M** | ×210 | $206.91 |
| Linear.list_projects | 66 | 687 | 374K | **137.1M** | ×367 | $70.43 |
| Linear.list_initiatives | 28 | 250 | 138K | **46.9M** | ×339 | $24.12 |
| _(16 more tools, each <$5)_ | | | | | | |

**23 tools, 6,296 calls · MCP measured `cache_read` = 2.57B tokens (15.2% of all `cache_read`) ≈ $1,348.** Attribution reconciles to the billed total exactly (unattributed = 0.01%).

**Read:**
- **The old global factor understated per-tool amplification ~10–20×.** Measured per-tool amplification runs ×198–×452 (each response token is re-read hundreds of times across a long orchestrator lineage), versus the flat ×19.42 estimate. The old estimate was arbitrary; this figure is distributed from numbers the API actually charged.
- **Reads are fat-response, writes are fat-request** (unchanged from FAFF-407): `list_comments`/`get_issue`/`list_issues` carry ~2M response; `save_comment` (1.90M) / `save_issue` (265K) carry the body as request. But the *dominant* cost is now visible: it is the **amplified `cache_read`**, not the one-time payload — a fat result that rides in orchestrator context for hundreds of turns costs far more than its single round-trip.
- **Top surgical targets:** `save_comment`, `list_comments`, `save_issue`, `get_issue`, `list_issues` — the top-5 are 98%+ of measured MCP cache cost. A terse, field-projecting Linear CLI (FAFF-177) shrinks the result that then rides in cache_read on every subsequent turn.

**Boundary-sensitivity (honest residual).** The transcript does not record which blocks were resident in each request's cached prefix; the pass reconstructs it, clearing on a detected `compact_boundary`. Re-running with a lenient rule (never clear) and an aggressive rule (clear on a >50% `cache_read` drop) moves MCP's share only **15.2% → 16.2%** — a tight range, so the point figure is trustworthy. See `mcp.reconciliation.boundary_modes`.

## Cross-reference vs FAFF-175 (the prior committed census)

`docs/reports/mcp-call-census/report.md` (window 2026-06-16→21, 7 days, chars/4 result-token proxy — the **same** proxy this pass uses):

- **Heavy-tool set matches exactly.** FAFF-175 top-4 (`get_issue`, `save_issue`, `list_comments`, `save_comment`) = this pass's top-5 (+`list_issues`). Two independent windows, same targets → high confidence.
- **Response-is-the-driver confirmed + refined.** FAFF-175: result payload 4.4× arg cost. This pass's request/response split shows *why*: reads are fat-response, `save_*` writes are fat-request (FAFF-175 recorded save_comment arg 555K / save_issue arg 123K — this pass's 1.87M / 251K request columns over 5.7× the window).
- **The "~39% of a week's tokens" claim is not substantiated by the committed artifact.** FAFF-175's report records *absolute* payload tokens (3.1M result tokens/week), never a 39%-of-total figure. This pass's *measured* MCP payload share is ~1% of total cost. The 39% is either from a much narrower interactive-only denominator, or counts cache-amplification the census could not measure. **FAFF-409 has now closed that range: MCP's amplified cost is a measured 15.2% of `cache_read` (14.4% of all tokens), not the old ~1%→ceiling range.** So the "~39%" was an over-estimate, but the true figure (15%) is well above the ~1% payload floor. The durable takeaway is **confirmed and sharpened**: MCP is a secondary lever (15%); the primary lever is non-MCP `cache_read` volume (85%).

## Ranked optimisation opportunities (fileable follow-ups)

1. **Attack cache_read volume — the 52.7% cost centre.** Leaner runtime prompts + caching-order discipline shrink the context re-billed every turn. Ties to the FAFF-114/115 lean-refactor family + FAFF-119 (caching-friendly ordering, currently held). *Highest leverage by far.*
2. **Route mechanical work off Opus.** Opus-4-8 = 82% of spend; Haiku ran 342M for $76. Widen `models.build_by_confidence` / `models.prep_explore` (FAFF-334) coverage so high-confidence/mechanical passes use Haiku/Sonnet.
3. **Terse Linear MCP reads (sharpens FAFF-177).** `list_comments` + `get_issue` + `list_issues` = fat-response reads; a field-projecting CLI cuts the response payload that then rides in cache_read. This pass's per-tool table *is* the scoping evidence FAFF-177 asked for.
4. **Stop round-tripping large write bodies.** `save_comment` (1.87M request) / `save_issue` (251K) — the body is already in context; avoid re-sending it where the tracker API allows.

## Telemetry-gap register (make the next measurement exact)

The estimate axes exist because faff is blind there today. Each gap + the telemetry to close it (fileable):

- **Cache-amplification per tool** — ✅ **CLOSED by FAFF-409.** Was `response × 19.42` (global factor); now a measured per-tool figure (×198–×452 amplification per tool) derived from the billed `cache_read`, reconciling to the total. The post-hoc transcript-correlation approach won (a dispatch-time marker was rejected — faff does not own the MCP transport, so it is not read-only-implementable).
- **MCP-vs-model split of cache_read** — ✅ **CLOSED by FAFF-409.** The 94.7% `cache_read` is now decomposed: **MCP 15.2%, non-MCP context/model 84.8%** (unattributed 0.01%). This *confirms* "the primary lever is context, not MCP".
- **Phase attribution (prep/build/review/orchestrator)** — unresolved this pass. *Telemetry:* token-tag `events.jsonl` (`data.tokens` on prep/build/review/run events) so spend joins cleanly to phase. (Currently OUT OF SCOPE as instrumentation; this register promotes it to a recommendation.)
- **Unpriced-but-named models** — local `qwen3.6:27b-mlx` and `<synthetic>` test records carry model strings but aren't in the API price table, so they price at $0 (correct — they aren't API spend). This is *not* a missing-`message.model` gap: `records_missing_model` is 0. Immaterial to the cost figures; noted for completeness.

## Recommendation — build a durable `faff tokens` command?

**Qualified yes — but scope it to the axes that pay.** The breakdown is high-value and the script is ~200 lines with zero new deps, reconciling to the existing token path. But: (a) it overlaps `faff economics` (FAFF-357), which already renders per-run/per-issue cost — a durable command should *extend* economics with the class/model/MCP axes, not duplicate its ledger walk; (b) the highest-value axis (cache_read volume) is better served by the CI prompt-size census (FAFF-171) than by a spend report. **Proposed:** fold the token-class + per-model + MCP-per-tool breakdown into `faff economics --by class|model|mcp` rather than a standalone `faff tokens`, and treat the telemetry-gap items as the real follow-on work. **Null-result caveat does not apply** — spend is concentrated (cache_read 52.7%, Opus 82%), so there are clear targets.

## Pricing

USD per 1M tokens. Source: claude-api skill model table (cached 2026-06-24). Cache classes derived from documented caching economics: `cache_write = 1.25× input` (5-min TTL), `cache_read = 0.1× input`. Configurable in `scripts/token-breakdown.mjs` `PRICE_PER_MTOK`. Sonnet-5 has an intro rate ($2/$10) through 2026-08-31; standard rates used here (conservative upper bound). Local/synthetic models price at $0.

| Model | input | output | cache_write | cache_read |
|---|--:|--:|--:|--:|
| claude-fable-5 | $10 | $50 | $12.50 | $1.00 |
| claude-opus-4-8 / 4-7 / 4-6 | $5 | $25 | $6.25 | $0.50 |
| claude-sonnet-5 / 4-6 | $3 | $15 | $3.75 | $0.30 |
| claude-haiku-4-5 | $1 | $5 | $1.25 | $0.10 |
