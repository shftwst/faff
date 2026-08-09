# What faff costs to run

Every figure on this page is measured, from an artifact in this repo, with a stated window. Where a claim can't be regenerated or pointed at, it's left out. See the method notes under each figure if you want to reproduce it yourself.

**The one caveat that applies to everything below: this is faff building faff.** Every number here comes from faff's own development — an unusually skill-heavy, tracker-chatty workload that runs Opus-class models by default and talks to Linear constantly. Your workload will differ, most likely in faff's favour: a smaller skill surface, fewer tracker round-trips, or a cheaper default model will all cost less per PR than what's measured here.

## Headline: $/PR

**$9 per shipped PR**, measured over 2026-07-13 → 2026-07-24 (11 days, 28 transcript files, 3,841 usage records): $1,099 total spend ÷ 122 PR-merge commits.

**Method** (reproducible): numerator is the grand-total USD from `node scripts/token-breakdown.mjs --json` for the stated window; denominator is a mechanical count of commits on `main` whose subject carries the squash-merge `(#N)` suffix in that same window — `git log --since=<window-start> --until=<window-end+1> --grep='(#' --oneline main | wc -l`. This repo squash-merges, so there are no merge commits to count via `--merges`; the `(#N)` suffix is the PR-identity signal instead.

**Why this number is much lower than the ~$48/PR figure that motivated this page:** the transcript corpus that `token-breakdown.mjs` reads from is a live, unpruned window — older sessions age out. The earlier committed measurement (`verification/reports/token-usage-breakdown/report.md`, FAFF-407/409) covers 2026-05-29 → 2026-07-09 and reports $16,763 across roughly 291–305 PR-merge commits in that window (≈$55–58/PR recomputed the same way). That's the more representative figure for "cost per PR over a normal multi-week span" — the 11-day window above is real but short, and short windows are noisier (a couple of light days pull the average down). Both are genuine measurements of the same repo; they aren't averaged here because they cover different spans, not because one is wrong.

## L3-night ranges

What a night of unattended (`/faff-beep-boop`) running has actually cost, both ends measured:

| | Cost | Source |
|---|--:|---|
| Heaviest measured run-days | $1,001 – $1,803 | `verification/reports/token-usage-breakdown/report.json` → `by_day`, window 2026-05-29→07-09 (top days: 2026-07-05 $1,803, 2026-07-07 $1,166, 2026-06-26 $1,088, 2026-06-29 $1,001) |
| A recent routed night | $57.94 | `.faff/runs/run-20260723-144253-beepboop-full/summary.md` — 79.3M tokens, 7 build attempts, 5 shipped, run cut short by a wall-clock ceiling rather than budget (2.6% of the token budget used) |

The gap between those two numbers is mostly **which model did the work**, not how much work got done — the heavy days predate model-routing being widely used; the recent night routed a chunk of it off Opus.

## Where the money goes

From the current snapshot (`node scripts/token-breakdown.mjs --json`, window 2026-07-13→2026-07-24, $1,099 total):

| Class | % of tokens | % of cost |
|---|--:|--:|
| cache_read | 95.0% | 52.9% |
| cache_write | 4.4% | 30.0% |
| output (generation) | 0.6% | 16.6% |
| input (fresh) | 0.1% | 0.4% |

Cache traffic (read + write) is **83% of spend** in this window — close to the 85.5% measured over the longer FAFF-407/409 window (`verification/reports/token-usage-breakdown/report.md`). Either way, the shape is the same: **the cost driver is resident context × how many turns re-read it, not what the model generates.** A long-running agent that keeps a large skill/spec/context prefix in cache and re-reads it every turn pays for that prefix hundreds of times over, not once.

## The two levers

The measurement ranks these two categories, in this order:

### Lever 1 — route work to cheaper models

Over the FAFF-407/409 window, `claude-opus-4-8` was **82% of spend**. Two instruments cut this without changing what gets built:

- **`models.build_by_confidence`** (FAFF-334) — routes high-confidence, mechanical builds to a cheaper model per-issue instead of defaulting every build to Opus. The cheap lane is measured working: the Haiku lane ran 342M tokens for **$76** in the same window.
- **A Sonnet 5 build lane** — Sonnet 5 is priced at an intro rate of **$2/$10** per million input/output tokens through 2026-08-31 (standard rate $3/$15 after), well under Opus's $5/$25. Available as a routing target; whether it's the default in your setup depends on your `.faffrc.yaml`.

### Lever 2 — shrink the resident context every turn re-reads

Since cache traffic is the largest cost centre, cutting the size of what's kept resident (or how often it's re-read) is the higher-leverage lever:

- **The gateway/skill-corpus diet** — trimming the skill prompts that make up the cached prefix every turn pays for again. (The claim that the skill corpus is "~40% of the average cached prefix" comes from outside this repo's measurements and isn't substantiated by a number in `report.json` — it's left off this page rather than published unverified. What is measured: `cache_read` is 52.7% of cost and 94.7% of tokens over the FAFF-407/409 window, so the prefix-size lever is real regardless of the exact skill-corpus fraction.)
- **MCP field-projection** — trimming what tracker (Linear) tool calls return, so a smaller result rides in cache on every subsequent turn. Measured: the top-5 Linear tools account for **$1,348** of measured cache cost over the FAFF-407/409 window (`verification/reports/token-usage-breakdown/report.md`, Axis 4) — about 98% of MCP's total measured cache impact.

## Subscription framing

Every dollar figure above is API metered pricing — the worst case. If you're running faff on a Claude subscription seat (Max) or a ChatGPT-class plan rather than metered API billing, a local L3 night is **window draw against your plan's usage allowance, not marginal dollars.** The token counts above still apply (that's what determines how much of your window you use); the dollar figures don't, directly.

## Pricing basis

Costs above are priced per-model × per-class against the rate table in `scripts/token-breakdown.mjs` (`PRICE_PER_MTOK`), which mirrors the pricing model in [ADR-0048](../../records/adr/0048-per-model-x-per-class-token-pricing-model.md). Sonnet 5 is priced at its **standard** $3/$15 rate in the script's table; the $2/$10 intro rate (through 2026-08-31) noted above is not yet reflected in that constant, so a Sonnet-5-heavy workload today costs somewhat less than the script's own output would suggest.

---

*Regenerate the underlying numbers any time with `node scripts/token-breakdown.mjs --json` (needs the local Claude Code transcript corpus). See [`verification/reports/token-usage-breakdown/`](token-usage-breakdown/) for the full per-tool, per-model breakdown this page draws its lever figures from, and [`verification/reports/token-usage-breakdown/snapshot-2026-07-24.json`](token-usage-breakdown/snapshot-2026-07-24.json) for the raw snapshot behind this page's headline $/PR and where-the-money-goes figures.*
