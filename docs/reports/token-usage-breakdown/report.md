# Token-usage breakdown (FAFF-407)

> Analysis snapshot — regenerate with `node scripts/token-breakdown.mjs [--json]`. Read-only pivot over the on-disk Claude Code transcript corpus; reconciles to the flat `sumTranscriptFile` total the faff CLI already trusts. Costs use per-model API pricing (see **Pricing**). Emits sizes/counts/names/costs only — never transcript payload content.

**Window:** 2026-05-29 → 2026-07-09 (40 active days) · 981 transcript files · 86,065 usage records.

## Headline

- **17,786M tokens (~17.8B) · $16,763** total, reconciled (`grand.total == Σ sumTranscriptFile`).
- **`cache_read` is the whole game:** 94.7% of tokens and **52.7% of cost ($8,831)**. This is persistent context (skills prompts, gateway, specs, subagent context) re-read on every turn — *not* primarily MCP.
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

### MCP per-tool cost (surgical remediation target)

Census over the corpus. **`request`** = tool_use params sent; **`response`** = tool_result payload (chars/4, same proxy as FAFF-175); **`cache~`** = the response's persistence estimate (`response × 19.43` amplification factor — a LOWER-BOUND estimate, see gaps); **`cost~`** priced at the dominant model (opus-4-8). Ranked by total weight.

| Tool | Calls | request~ | cache~ (est) | response~ | cost~ (est) |
|---|--:|--:|--:|--:|--:|
| Linear.list_comments | 1,211 | 7,872 | 44.96M | 2.31M | $34.09 |
| Linear.get_issue | 1,836 | 14,527 | 40.87M | 2.10M | $31.02 |
| Linear.save_comment | 817 | **1.87M** | 37.84M | 1.95M | $38.01 |
| Linear.list_issues | 638 | 10,682 | 36.59M | 1.88M | $27.76 |
| Linear.save_issue | 1,463 | **251K** | 27.57M | 1.42M | $22.13 |
| Linear.list_projects | 66 | 687 | 7.26M | 374K | $5.50 |
| Linear.list_initiatives | 28 | 250 | 2.69M | 138K | $2.04 |
| _(15 more tools, each <$0.50)_ | | | | | |

**23 tools, 6,281 calls, census floor ≈ $162.**

**Read (the fix differs by column):**
- **Reads are fat-response** (`list_comments`, `get_issue`, `list_issues`): request ~10K, response ~2M. Fix = field projection / a terse CLI (FAFF-177).
- **Writes are fat-request** (`save_comment` 1.87M req, `save_issue` 251K req): the body being written *is* the cost. Fix = don't round-trip large bodies you already hold.
- **Top-3 surgical targets:** `save_comment` (fat-request), `list_comments` + `get_issue` (fat-response).

## Cross-reference vs FAFF-175 (the prior committed census)

`docs/reports/mcp-call-census/report.md` (window 2026-06-16→21, 7 days, chars/4 result-token proxy — the **same** proxy this pass uses):

- **Heavy-tool set matches exactly.** FAFF-175 top-4 (`get_issue`, `save_issue`, `list_comments`, `save_comment`) = this pass's top-5 (+`list_issues`). Two independent windows, same targets → high confidence.
- **Response-is-the-driver confirmed + refined.** FAFF-175: result payload 4.4× arg cost. This pass's request/response split shows *why*: reads are fat-response, `save_*` writes are fat-request (FAFF-175 recorded save_comment arg 555K / save_issue arg 123K — this pass's 1.87M / 251K request columns over 5.7× the window).
- **The "~39% of a week's tokens" claim is not substantiated by the committed artifact.** FAFF-175's report records *absolute* payload tokens (3.1M result tokens/week), never a 39%-of-total figure. This pass's *measured* MCP payload share is ~1% of total cost. The 39% is either from a much narrower interactive-only denominator, or counts cache-amplification the census can't measure. **MCP's true cost is a range: ~1% (measured floor) → unmeasured ceiling.** Closing that gap needs telemetry (below). The durable takeaway: **MCP is a secondary lever; the primary lever is cache_read volume.**

## Ranked optimisation opportunities (fileable follow-ups)

1. **Attack cache_read volume — the 52.7% cost centre.** Leaner runtime prompts + caching-order discipline shrink the context re-billed every turn. Ties to the FAFF-114/115 lean-refactor family + FAFF-119 (caching-friendly ordering, currently held). *Highest leverage by far.*
2. **Route mechanical work off Opus.** Opus-4-8 = 82% of spend; Haiku ran 342M for $76. Widen `models.build_by_confidence` / `models.prep_explore` (FAFF-334) coverage so high-confidence/mechanical passes use Haiku/Sonnet.
3. **Terse Linear MCP reads (sharpens FAFF-177).** `list_comments` + `get_issue` + `list_issues` = fat-response reads; a field-projecting CLI cuts the response payload that then rides in cache_read. This pass's per-tool table *is* the scoping evidence FAFF-177 asked for.
4. **Stop round-tripping large write bodies.** `save_comment` (1.87M request) / `save_issue` (251K) — the body is already in context; avoid re-sending it where the tracker API allows.

## Telemetry-gap register (make the next measurement exact)

The estimate axes exist because faff is blind there today. Each gap + the telemetry to close it (fileable):

- **Cache-amplification per tool** — currently `response × 19.43` (global factor). *Telemetry:* correlate `cache_read` deltas across the turns following each tool call, or emit a per-tool-call context-cost marker at dispatch. This is what turns MCP's "~1%→ceiling" range into a number.
- **MCP-vs-model split of cache_read** — the 94.7% cache_read is not decomposed into prompt-context vs MCP-injected content. *Telemetry:* wrap MCP dispatch to record the input/cache delta attributable to each tool_result. Would confirm/refute the "primary lever is context, not MCP" conclusion.
- **Phase attribution (prep/build/review/orchestrator)** — unresolved this pass. *Telemetry:* token-tag `events.jsonl` (`data.tokens` on prep/build/review/run events) so spend joins cleanly to phase. (Currently OUT OF SCOPE as instrumentation; this register promotes it to a recommendation.)
- **Missing `message.model`** — a small `unknown` bucket (local qwen / synthetic test records, correctly $0). Immaterial; noted for completeness.

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
