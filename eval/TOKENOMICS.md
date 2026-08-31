# `eval/tokenomics.mjs` — runtime per-call context cost + a caching-strategy bench

A companion to `eval/size-census.mjs`. The size census measures the **static** size of the
`SKILL.md` files on disk. This measures what a real drive run actually **re-read from cache on
every API call**, and lets you score prompt/skill caching strategies against that real workload.

It exists because of a specific finding (jot P1, `evidence/`): the cost of an L4 drive run is
dominated by the **size of the cached context re-read per call** (~115-220k tokens), not by the
number of calls and not by cache churn. This tool corroborates that from source and turns the
lever into something you can measure a change against.

## Is the finding genuine? Yes — reproduced on the run itself, and on an independent run

The jot P1 measured a 2026-08-29 full-build L4 run (`run-20260829-100405-lights-out`). Pointed at
that run's transcripts (`evidence/cost-run-20260829-100405/`, drive + subagents, 843 API calls), the
tool reproduces the jot's headline almost exactly:

| Claim (jot P1) | This tool on the full cost-run | Verdict |
| --- | --- | --- |
| Book-sized context re-read per call | `cache_read` avg **183,960** (jot: 183,998), median 147,220, max **582,874** (jot: 582,874) | reproduced to ~0.02% |
| Caching healthy, not thrashing (~30:1) | read:write **36.6:1** | reproduced |
| Cost is context, not output/calls | context = **99.4%** of all token movement | reproduced |
| Per-call context is the lever | lean-gateway 66k→8.3k cuts the run **−18.9%** ($132.91→$107.80); lever ~$4.34 per 10k prefix tokens | reproduced |

This is a **full end-to-end build** (a real feature shipped through the pipeline), so its call mix is
representative of production usage — the right run to optimize from. The committed baseline is
`eval/baselines/tokenomics-cost-run-20260829.json` (the raw transcripts live under the gitignored
`evidence/`, so the derived baseline is what's version-controlled). Output is real on this run
(avg ~1,181 tok/call), so the bill's output leg is measured, not a floor.

### Also reproduced on an independent run

A second, unrelated run (`transcript-run-20260812-153033-fly-l3.jsonl`, an L3 fly build, 281 calls,
committed as `eval/baselines/tokenomics-fly-l3.json`) shows the same profile — reproducing the
finding on a run the jot never touched:

| Claim (jot P1) | This tool on the L3 evidence run | Verdict |
| --- | --- | --- |
| Book-sized context re-read per call | `cache_read` avg **211,706**, median **222,879**, max 386,463 tok/call | corroborated (same regime as the jot's 184k avg / 115k median) |
| Caching healthy, not thrashing (~30:1 read:write) | read:write ratio **21.6:1** | corroborated |
| Cost is context size, not output | context = **99.997%** of all token movement | corroborated, decisively |
| Per-call context is the lever | shrinking the injected gateway prefix 66k→8.3k cuts this run **~22%** ($35.67→$27.87) | corroborated |

One caveat specific to this L3 fly transcript: it records `output_tokens` only on the message-start
line (avg < 6/call), so the output side could not be checked from it — the tool flags this
(`output_suspect`) and treats the output leg as a floor. The full cost-run above does not have this
limitation (its output is real), so nothing rests on it; output is a rounding error against a
200k-token cached context either way.

### Precedent in faff source

- `eval/size-census.mjs` + `eval/baselines/prompt-size.json` (FAFF-170/171) already treat prompt
  size as a first-class, gated metric — but only the **static** file size, not runtime cache cost.
- The gateway `plugin/skills/faff/SKILL.md` is **~66k est tokens** today (267k chars), up from
  ~42.5k at the 2026-06-29 baseline. If that is injected into the drive and each subagent's context
  on every call, the ~200k/call `cache_read` this tool measures is exactly what you'd expect.

The gap the tool fills: faff has a static prompt-size gate, but nothing that measures the
**runtime** per-call cache cost from a real transcript, and nothing to evaluate caching strategies.

## Usage

```
node eval/tokenomics.mjs --transcript <file|dir> [--fixed N] [--lean N] [--json] [--save out.json]
```

- `--transcript` — a Claude Code transcript `.jsonl`, or a directory of them (drive + subagents).
- `--fixed N` — the size in tokens of the fixed injected prefix you're testing (the
  gateway/skill content present in every call). Defaults to the static gateway `SKILL.md` size.
- `--lean N` — the target size after leaning it. Defaults to 8300 (the P0 "inject only the slice
  each call needs" target).
- `--save` writes the full report JSON; `--json` prints it to stdout.

Committed baselines: `eval/baselines/tokenomics-cost-run-20260829.json` (the full-build L4 run — the
representative reference to optimize from) and `eval/baselines/tokenomics-fly-l3.json` (the
independent L3 run). Both are the tool's output; the raw transcripts stay under the gitignored
`evidence/`.

## What it computes

**Measurement (free, deterministic, no model call).** Parses `usage` fields, deduping the several
streamed assistant lines per API call by `request_id` (taking the max of each field, since only the
final line carries the real `output_tokens`). Produces a census: `cache_read` / `cache_write` /
`input` / `output` distributions, the read:write ratio, and the context-vs-output share.

**Bench.** Holds the real per-call workload fixed and re-prices it under each strategy. A strategy
is a pure transform of the workload, so its dollar delta vs baseline is a grounded counterfactual —
"what this exact run would have cost if the fixed prefix were N tokens instead of what it was".

Pricing uses list rates (Opus 4.8 $5/$25, Sonnet 5 $3/$15 per MTok) and the cache multipliers from
the prompt-caching reference (read 0.1×, 5m write 1.25×, 1h write 2× base input). Cache-write TTL is
read from the transcript's own `cache_creation` buckets, not assumed.

### Strategies shipped

| Strategy | Models |
| --- | --- |
| `baseline` | the run as measured |
| `lean-gateway (F->lean)` | shrink the injected prefix from F to the lean target on every call that carries it |
| `drop-injection` | remove the fixed prefix from cached context entirely (upper bound on the lever) |
| `writes-5m-ttl` | 1h cache writes repriced as 5m — write-cost only, hit rate held fixed (upper bound; a real TTL cut can lower the hit rate, which usage can't show) |

The `saving_per_10k_prefix_tokens` figure is the actionable lever: dollars saved per 10k tokens
shaved off the fixed injected prefix on a run of this length.

## The strategy model, and its one assumption

Each call either **reads** the cached fixed prefix (`cache_read >= F`, a warm call) or **wrote** it
cold this turn (`cache_write >= F`). Shrinking the prefix by `F - F'` reduces whichever leg carries
it, per call, across the run — so both the one-time write and the many reads are captured, and never
double-counted (a cold write has `cache_read ≈ 0`, a warm read has small `cache_write`). The
assumption is that a single, contiguous fixed prefix of size `F` is present in cached form on every
call; that is the mechanism the jot identifies (gateway/skill injection). It does not model
second-order effects a real change would have — a smaller prefix could shift the cacheable minimum,
or a TTL change could alter the hit rate — so treat the deltas as first-order estimates, which is
what a strategy-comparison bench is for.

## Adding a strategy

Add an entry to `strategies()` in `eval/tokenomics.mjs`: `{ name, note, apply(calls) }`, where
`apply` returns a new workload array. Anything expressible as a per-call transform of
`{cr, cw, cw1h, cw5m, in, out, model}` can be benched — e.g. a per-subagent prefix (filter on
`c.subagent`), a model swap (rewrite `c.model`), or a history-compaction model (cap `c.cr`).
Tests live in `test/eval-tokenomics.test.mjs` (deterministic, no process spawn).

## Latency lens (`--latency`) — time, not just cost

`--latency` adds a time model on top of the same workload, driven by two throughput profiles.

```
node eval/tokenomics.mjs --transcript <run> --latency \
  [--prefill-tps 1000] [--decode-tps 35] \
  [--frontier-prefill-tps N] [--frontier-decode-tps N]
```

A call's time is prefill (sets TTFT) plus decode. The tokens prefilled per call depend on whether
the cached prefix is actually reused:

- **cached** = only the uncached tail (`cache_write + input`) is processed; the cached prefix is
  skipped. This is the hosted regime the transcript was captured under (21:1 reuse).
- **uncached** = the whole context (`cache_read + cache_write + input`) is re-prefilled every call.
  The local worst case, where prompt caching does not persist or is not shared across subagent
  processes.

Real hardware sits between the two, set by the local cache hit rate; the pair are the bounds. The
lens reports each profile under both regimes, the per-strategy wall-clock, and the local:frontier
ratio (the viability figure). It also prints **observed frontier anchors** straight from the run's
`result` events (TTFT, realized output tps, API wall) so you can replace the placeholder
`--frontier-*` figures with what your run actually recorded. A clean frontier *kernel* tps cannot be
solved from a hosted transcript (cache_read time confounds it), so those anchors are the calibration.

Key readings on the L3 evidence run at placeholder 1000/35 tps local:

- cached median TTFT ~1.4s vs uncached ~3.8m. On local, whether the cache reuses is the difference
  between a 47-minute run and a 17-hour run. Cache reuse dominates every other lever.
- Shrinking the prefix helps the uncached (local) regime far more than the cached one, because warm
  calls skip the prefix anyway. Granularity is a latency lever mainly when caching is weak.

## Cache-survival / TTL lens

The `--latency` panel also reports cache survival: inter-call wall-clock gaps grouped by session,
counted against a 5m and a 1h TTL. Each gap that exceeds the TTL is a cache expiry that forces a cold
re-prefill on the next call. `ttlRisk(calls, ttlSeconds)` is the pure function. On the L3 run: 4 of
280 gaps (1.4%) exceed 5m, 0 exceed 1h, so the run's 1h TTL never times out and the `writes-5m-ttl`
cost strategy would be a false economy here (it would trigger those 4 cold re-prefills). Faster calls
shorten the gaps, so speeding calls up reduces expiries, a feedback loop that compounds on local
where a cold re-prefill is itself slow.

## `eval/prefix-planner.mjs` — which content belongs in the cached prefix

The bench prices a *given* per-call prefix size. The planner decides *which gateway content* should
be in that prefix, by measuring how widely each block is actually shared. It answers the
gateway-leanness question: keep shared content in the gateway, pull it into read-on-demand files, or
duplicate it into the skills that use it.

**The physics that orders the options.** Caching bills a cached prefix at 0.1x per token on *every*
call that carries it. Sharing a prefix across skills changes how many times you *write* it, not how
many times you *read* it, and reads are ~96% of the bill. So the lever is granularity (make each
call carry only the blocks it needs), not cache-entry sharing. "Multiple smaller skill-dependent
prefixes" helps mainly by carrying less, and its residual cache-sharing benefit lands on the small
write leg.

**Pipeline.** Segment the gateway into blocks (61 today, ~66k tok) → reference-scan every other
`SKILL.md` for citations of gateway block titles (faff's refer-back rule makes this a real signal) →
classify each block as `universal` (titled-shared or cited by most), a specific consumer `set`, or
`unknown` (no citation). Unknowns default **conservative** = carried by every skill, so the seed
never proposes dropping something a skill quietly relies on. Then it weighs the approaches by the
average per-call prefix each yields, and proposes the optimal prefix blocking (cluster blocks by
usage signature, order most-shared-first, layer the breakpoints).

```
node eval/prefix-planner.mjs [--optimistic] [--emit-manifest out.json] [--json]
```

`--emit-manifest` writes the seed `eval/baselines/gateway-usage.json` (block → consumers), which is
human-correctable: narrowing an `unknown` block to a real consumer list converts conservative
headroom into confirmed saving. `--optimistic` treats unknowns as splittable (the ceiling).

**Composing the two tools.** Each approach the planner reports is an average per-call prefix `F'`.
Feed it to the bench for dollars: `node eval/tokenomics.mjs --transcript <run> --fixed 66165 --lean <F'>`.

**The optimisation.** `ideal_floor` is what each skill would carry if it could carry exactly its
needed blocks (independent per-skill assembly, approaches 1 and 2). `layered_prefixes` is the best a
single shared block ordering can do (approach 3), which is `>= ideal_floor` because prefix caching
cannot skip: a block sitting before a needed block is carried whether needed or not. The
`contiguity_tax` is that gap. A large tax means the content does not cluster into clean nested
prefixes, so independent assembly (1/2) beats a shared cache topology (3) on reads — which is the
honest test of whether approach 3 is worth it.

## Not part of CI by default

Like the rest of `eval/`, this is excluded from the `node --test` globs that run real work;
`test/eval-tokenomics.test.mjs` is deterministic and safe to keep in the CI set.
