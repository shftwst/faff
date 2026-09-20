# Prime-then-fan-out spec-review dispatch, made configurable, with a per-lens wall-clock ceiling

> Spec: faffter-dark-nlspec · 2026-09-20 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1054.

> Revised 2026-09-19 (spec-review round 1, in-place): folded in the design-lens objections from the concluded spec-review (reject-approach, architectural/infosec/QA). Changes: pinned the deadline default to 900 s with rationale; added the required `EXIT.DEADLINE(8) → unavailable/infra-configured` per-lens row (never config-fault, never pass+skip); added the `-gt 0` numeric guard on deadline resolution; stated the connection-independent-cache assumption; corrected the critical-path cost to the honest `prime + max(rest)` (up to ~2x on no-cache/overlapping backends, no-worse-than-today satisfied *by config*); and named the cache-hit verification probe plus the priming-failure and config-resolution tests so the headline DONE item and the edge cases are decidable.

> Revised 2026-09-20 (spec-review round 2, in-place): folded in the second concluded spec-review's design-lens objections (reject-approach, architectural/infosec/QA — converging, 8→6, no critical). Changes: (1) added an always-on **in-band strategy self-check** so the no-cache regression is observable on *any* backend, not only when a caching backend is configured — the occupant compares post-prime lens wall-clock against the prime's and emits an operator advisory when no cache benefit is seen (arch-major); (2) pinned the priming lens to the first **reachable** request and stated that a fast-preflight-failing prime costs ≈0 while a slow-streaming prime is bounded by the deadline (arch-minor); (3) added a deadline **lower-floor** guard (`deadline ≥ inactivity timeout`, else reset to 900) so a positive-but-tiny deadline can no longer silently advance the chain to a weaker fallback (infosec-minor); (4) pinned the headline cache-hit probe to a concrete ratio (**lens-2/3 TTFT ≤ 1/5 of lens-1**, wall-clock as the proxy the fan-out already measures) and named its measurement source, so the headline DONE item is decidable (QA-major); (5) added a scenario + test that assert the occupant maps `EXIT.DEADLINE(8)` → `unavailable`/`infra-configured` and never `config-fault`/`pass+skip` (QA-major); (6) added a test feeding an unrecognised `--strategy`/config value and asserting the non-zero fail-loud exit (QA-minor).

> Revised 2026-09-20 (spec-review round 3, in-place): first round served by the authoritative **primary** `spark-qwen-3-8` (rounds 1–2 were the degraded OpenRouter fallback while the primary was down); folded in its design-lens objections (reject-approach, architectural/infosec/QA — no critical). The round-2 fixes were internally inconsistent; this round reconciles them. Changes: (1) **the cache observable is now prefill (TTFT), not total wall-clock** — the cache saves prefill only, so the round-2 wall-clock ratio conflated a slow *decode* with a cache miss and would false-fire the advisory on any slow-decode backend; the in-band self-check and the headline probe now use the **same** TTFT observable, and the self-check reports "not-computed" (never a false advisory) when the transport does not expose TTFT (arch-major + QA-minor); (2) **dropped the "first reachable" priming rule** — `fan-out.mjs` cannot evaluate reachability before dispatch, and it contradicted the `await runOne(requests[0])` procedure; the prime is simply `requests[0]`, and the cost model now states the honest not-served-prime cost (one bounded preflight/chain hop, not "≈0") (arch-major + QA-major); (3) **the deadline lower-floor now WARNS, never silently resets**, and is keyed to an absolute sanity floor, not the inactivity `timeout` — an operator's legitimately-small deadline on a fast backend is honoured (Configurable-not-asserted), and a below-floor value is surfaced loud, not neutered (arch-minor + infosec-minor); (4) **the inactivity `timeout` resolution now carries its own `-gt 0` numeric guard**, so a non-numeric `timeout` can no longer make any comparison a silent fail-open (infosec-minor); (5) **the byte-identity DONE item now names a concrete test** — a pure assertion that the assembled shared/prefix block is byte-identical across the N `LensRequest`s (QA-minor); (6) the headline "1 prefill not N" AC is stated as decidable **only** on a prefix-caching backend (the gated probe), with the in-band TTFT self-check as the any-backend observable — the honest scope, not a claim the no-cache case can decide (QA-major).

This spec addresses FAFF-1054. It is written for the build agent implementing the fix and for human reviewers. It changes how the adversarial spec-review lenses are dispatched so the shared-prefix cache the wire shape was built for (FAFF-903) is actually populated before the bulk of the lenses run, makes the dispatch strategy a per-deployment config knob, and bounds a slow lens by total wall-clock so one hung lens can no longer stall the pass unboundedly.

## 1. WHY — Problem and Principles

**The load-bearing model.** A radix prefix cache only populates when a request *completes* prefill. FAFF-903 deliberately puts a byte-identical shared context+diff block in the cacheable prefix slot (`review-call.mjs:2148`) so that "lens 1 populates the cache, lenses 2 to N hit it". But `fan-out.mjs` (FAFF-706) spawns all N lens children simultaneously and awaits them together (`requests.map(runOne)` then one `Promise.allSettled`), so all N miss the cache — none has finished populating the prefix when the others begin. The intended cache win never happens under concurrent dispatch, and on a prefill-dominated backend the concurrent path pays ~N full prefills where serial pays one.

**Problem statement:** Today concurrent fan-out defeats the FAFF-903 shared-prefix cache, paying full prefill per lens (operator-measured ~19x on later lenses on a prefix-caching local backend) and, separately, a single slowly-streaming lens holds the whole pass because `--timeout` is an inactivity window, not a total ceiling. This change primes the cache with one lens, then fans out the rest so they hit the cache; it makes the strategy configurable per deployment; and it bounds each lens by total wall-clock.

**Design principles:**

- **Configurable, not asserted.** The prefill-cache win is deployment-dependent — a backend with no prefix cache gets nothing from priming. The strategy must be selectable per deployment with a documented default, never hardcoded as universally correct (operator, 2026-09-19).
- **Reuse, never fork the transport.** `fan-out.mjs` and `review-call.mjs` are reused-never-forked (`faffter-dark-spec-review/SKILL.md:216`). The dispatch strategy is added *inside* `fan-out.mjs` (it already owns dispatch), extending it, not forking it or hand-rolling a per-lens bash loop.
- **Prefix bytes stay byte-identical.** The cache win rests on the shared block being byte-identical across lenses (FAFF-903 / FAFF-915 trim purity). Nothing in this change may perturb the shared prefix bytes; only dispatch *order* varies.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/fan-out.mjs` | Node (mjs) | The concurrent dispatcher (FAFF-706); where the strategy is added. Awaits all children via `Promise.allSettled`; no timeout/strategy notion today. |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node (mjs) | The per-lens transport. `:2148` FAFF-903 role swap (shared block → prefix slot). `--timeout` = per-attempt inactivity (`realStream` idle timer); `--deadline` = total wall-clock across attempts/fallbacks; `EXIT.DEADLINE=8`. |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | Skill prose | The occupant. `:55`/`:217` mandate "CONCURRENTLY … never a per-lens loop"; `:126` states the (currently-false-under-fan-out) "lens 1 populates the cache, lenses 2 to 4 hit it". Builds `LensRequest[]` and makes one `fan-out.mjs` call (`:111`). |
| `adversarial.spec_review.*` config | `.faffrc` | Existing per-consumer keys (`timeout`, `max_tokens`) resolved with a `spec_review.* → adversarial.* → default` three-tier fallback; the new strategy + deadline keys follow the same shape. |

**Scope statement:** This is a dispatch-ordering + configurability + timeout-bounding change to the spec-review lens fan-out; it does not change the lenses, the aggregation, the contract, or the shared-prefix wire shape.

## 2. OUT OF SCOPE

- **Streaming / incremental partial-result return from `fan-out.mjs`.** — Returning finished lenses' results before a slow lens completes. Why excluded: `fan-out.mjs`'s await-all design is deliberate; AC "a single slow lens no longer withholds results" is met here by bounding the slow lens with a total wall-clock deadline (so the pass returns in bounded time), not by re-architecting to streaming partial return. Extension point: `fanOut()` in `fan-out.mjs`.
- **Auto-detecting whether a backend caches (Direction 2).** Why excluded: faff has no backend prefix-cache capability signal today. Extension point: the strategy resolver — an `auto` value could consult such a signal when one exists.
- **Wiring the code-review (adversarial-review) altitude to the strategy key.** Why excluded: FAFF-1054 is scoped to spec-review; the `--strategy` flag is transport-general on `fan-out.mjs`, but v1 reads config only at the spec-review occupant. Extension point: the code-review occupant that also calls `fan-out.mjs`.
- **FAFF-855's per-backend concurrency cap / backoff for 429s.** Why excluded: 855 (Backlog) shares the fan-out surface and its `serial` need is served by this ticket's `serial` strategy value, but its 429-backoff specifics are its own ticket. Extension point: same `--strategy` seam + `review-call.mjs` retry policy.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| dispatch strategy | How the N lens `review-call.mjs` children are sequenced: all-at-once, one-at-a-time, or prime-one-then-rest. |
| prime | Dispatch one lens alone and await its completion so it populates the shared-prefix cache before the rest fan out. |
| priming lens | The single lens dispatched first under `prime-then-parallel` (the first entry of the request array). |

**Config keys (resolved CLI-only, `spec_review.* → adversarial.* → default` three-tier, mirroring the existing `timeout`/`max_tokens`):**

```
adversarial.spec_review.dispatch_strategy : "parallel" | "serial" | "prime-then-parallel"   # default "prime-then-parallel"
adversarial.spec_review.deadline          : integer seconds (total wall-clock per lens)      # default 900 (see below)
```

**Deadline default — a named, generous value, not a sweep constant.** The terminal fallback default is **900 s (15 min) per lens**. Rationale: it must sit *above* any legitimate slow-but-healthy lens (round 1's healthy lenses returned in under a minute serially; the shared `adversarial.spec_review.timeout` inactivity window is already 900 s) and *below* the pathological stall it exists to bound (the round-1 architectural lens ran ~28 min wall / 8 s CPU). 900 s catches that 28-min stall while never truncating a genuinely-working lens. It is a bound, not a tuned performance constant — an operator on a slower backend raises it via `adversarial.spec_review.deadline`. The build agent implements this literal default (`-d 900`), so the DONE item is checkable against a named value.

**`fan-out.mjs` CLI surface (additive):**

```
--strategy parallel | serial | prime-then-parallel      # default parallel (byte-identical to today when omitted)
```

- `parallel` — today's behaviour exactly: spawn all requests, `Promise.allSettled`.
- `serial` — dispatch requests one at a time, each awaited before the next.
- `prime-then-parallel` — await `requests[0]` alone, then dispatch `requests[1..N-1]` in parallel and await them together.
- Output shape unchanged: a `LensResult[]` in input-request order in every strategy.

**Design decisions** (see §6 for full rationale):

- **Chosen:** `prime-then-parallel` is the default strategy — one full prefill primes the cache, the rest hit it and overlap their (near-free) prefill + decode. Pays serial's prefill cost with parallel's wall-clock on the only part that still costs.
- **Chosen:** the strategy is configurable via `adversarial.spec_review.dispatch_strategy` (fallback `adversarial.dispatch_strategy`), values `parallel|serial|prime-then-parallel`, default `prime-then-parallel`.
- **Chosen:** the strategy is implemented *inside* `fan-out.mjs` behind a `--strategy` flag; the spec-review occupant resolves config and passes it. `fan-out.mjs`'s default when the flag is omitted stays `parallel` (byte-identical to today).
- **Chosen:** each lens child is bound by a total wall-clock deadline via `review-call.mjs --deadline`, resolved from `adversarial.spec_review.deadline`, so a slowly-streaming/hung lens is classified `EXIT.DEADLINE(8)` instead of stalling the pass past the inactivity window.
- **Chosen:** correct the occupant prose in `faffter-dark-spec-review/SKILL.md` (`:55`, `:126`, `:217`) so it describes the shipped prime-then-parallel dispatch, resolving the standing contradiction between the FAFF-903 note and the "always concurrent" rule.
- **Chosen (in-band strategy self-check — always on under `prime-then-parallel`, keyed to PREFILL/TTFT, not wall-clock):** the prefix cache saves **prefill only** — every lens, prime and post-prime alike, still pays its full *decode* — so the correct observable is each lens's **prefill time, proxied by time-to-first-byte (TTFT)**, never total wall-clock. (A wall-clock ratio conflates a slow decode with a cache miss: on a slow-decode backend it climbs toward any fixed threshold *with the cache working*, false-firing the advisory — the round-2 defect this replaces.) `fan-out.mjs` records each child's TTFT (the timestamp of the first streamed byte, which `review-call.mjs` already observes via its `realStream` first-byte timer); the observable is `max(TTFT of lenses 2..N) / TTFT(prime)`. When that ratio does **not** fall below **1/5** (the pinned cache-hit threshold — the same observable and threshold the headline probe uses, §8), no prefill cache benefit was realised, and the occupant emits **one** operator advisory line — `prime-then-parallel showed no prefill-cache benefit on this backend (post-prime/prime TTFT ratio ≥ 1/5); consider adversarial.spec_review.dispatch_strategy: parallel`. **When TTFT is not exposed** for a lens (e.g. a non-streaming backend), the self-check records `not-computed` and emits **no** advisory — it never falls back to wall-clock and never manufactures a false positive. It is advisory only: it never gates, downgrades a verdict, or changes dispatch this run.
- **Chosen (the priming lens is `requests[0]`, matching the procedure — no pre-dispatch reachability rule):** the prime is deterministically `requests[0]`, exactly as §4's `primed = await runOne(requests[0])` implements. `fan-out.mjs` **cannot** evaluate reachability before dispatch (reachability is decided inside `review-call.mjs`'s preflight *during* the child's run, observable only via the child's exit code *after* it returns), so a "first reachable" selection rule is not implementable at this seam and is dropped. **Honest critical-path cost of a not-served prime:** if `requests[0]`'s backend is not served, its preflight fails — but that is a real (bounded) network round-trip, and under a fallback chain the not-served primary *advances to the next backend*, which may itself stream. So a not-served prime costs **one or more bounded preflight/chain hops paid serially** before the rest fan out — not literally ≈0. That cost is bounded by the per-lens deadline (below), and the primed slot still records its own exit code; the rest always fan out regardless (a priming failure never aborts the batch). The `prime + max(rest)` penalty is therefore paid on any not-served-or-slow prime, bounded, and is exactly the overhead the configurable `parallel` strategy exists to let a no-cache deployment avoid.
- **Chosen (deadline lower-floor WARNS, never silently resets; keyed to an absolute sanity floor, not the inactivity `timeout`):** the round-2 guard reset any `deadline` below the inactivity `timeout` to 900 — but a small *total* deadline on a fast backend is a legitimate operator choice (Configurable, not asserted), so a silent reset neutered the very knob this ticket adds. Instead: keep the `-gt 0` numeric guard (a non-positive/non-numeric value is a plumbing fault → reset to 900), and replace the lower-floor reset with a **loud one-line WARNING** when `deadline` is below a small absolute sanity floor (**`DEADLINE_SANITY_FLOOR=60` s**, a named constant, *not* the inactivity `timeout`) — `adversarial.spec_review.deadline (<v>s) is below the 60s sanity floor; a deadline this small may expire a lens before its primary backend can answer and advance the chain to a weaker fallback`. The operator's configured value is **honoured** (not reset); the risk is surfaced, not hidden. This resolves both the configurability regression and the silent-reset fail-open.
- **Assumes:** the FAFF-903 shared-prefix wire shape (`review-call.mjs:2148`) and the FAFF-915/FAFF-1039 trim purity are unchanged — dispatch order is the only variable this ticket introduces.

## 4. HOW — Behavior

**Architecture and approach.** The occupant already builds the full `LensRequest[]` once and makes a single `fan-out.mjs` call. This change (a) resolves the strategy + deadline from config, (b) threads `--deadline` into each `LensRequest.argv` (identical across lenses, like `--timeout`), and (c) passes `--strategy` to the one `fan-out.mjs` call. `fan-out.mjs` selects the dispatch shape; its collect/return contract is unchanged.

```
PROCEDURE fanOut(requests, {strategy, spawnFn, ...}):
  1. strategy defaults to "parallel" when absent (byte-identical to today).
  2. IF strategy == "parallel":
       promises = requests.map(runOne); results = await Promise.allSettled(promises)   # today's path
  3. IF strategy == "serial":
       results = []; FOR each req in requests: results.push(await runOne(req))
  4. IF strategy == "prime-then-parallel":
       primed = await runOne(requests[0])                     # populate the shared prefix
       rest   = await Promise.allSettled(requests[1..].map(runOne))
       results = [primed, ...rest]
  5. Return results in INPUT-REQUEST ORDER for every strategy (order guarantee preserved).
  6. A spawn-level fault on ANY child still fails the batch as today (unchanged).
```

**Occupant resolution (in `faffter-dark-spec-review/SKILL.md` bash, before the single `fan-out.mjs` call):**

```
strategy=$(faff config get adversarial.spec_review.dispatch_strategy \
           -d "$(faff config get adversarial.dispatch_strategy -d prime-then-parallel)")
deadline=$(faff config get adversarial.spec_review.deadline \
           -d "$(faff config get adversarial.deadline -d 900)")
# Inactivity-timeout resolution (unchanged two-read fallback) PLUS its own numeric guard: a
# non-numeric/empty/non-positive timeout is a plumbing fault reset to its 120 default, so no later
# comparison can silent-fail on an unparseable timeout (the round-2 `2>/dev/null`-swallow fail-open).
timeout=$(faff config get adversarial.spec_review.timeout)
[ -z "$timeout" ] && timeout=$(faff config get adversarial.timeout -d 120)
[ "$timeout" -gt 0 ] 2>/dev/null || timeout=120
# Deadline numeric guard — mirror the existing timeout/max_tokens resolutions in this same flow: a
# present-but-non-positive-integer value (empty / non-numeric / float / 0 / negative) resets to the
# 900 default, so no NaN / 0 / negative reaches review-call.mjs's `Number(value)*1000` deadline math
# (an unguarded NaN fires setTimeout immediately; a 0 zeroes every backend slice — both make every
# lens fail instantly and, worse, misreport as an infra outage that rides the retry loop).
[ "$deadline" -gt 0 ] 2>/dev/null || deadline=900
# Sanity-floor WARNING (never a reset): --deadline is the TOTAL wall-clock across the whole fallback
# chain. A deadline below a small ABSOLUTE floor (60s, NOT the inactivity timeout) risks expiring a
# lens before its primary answers and advancing to a weaker fallback — but a small total budget on a
# fast backend is a legitimate operator choice, so HONOUR the configured value and surface the risk
# loud rather than silently resetting it (Configurable, not asserted).
DEADLINE_SANITY_FLOOR=60
if [ "$deadline" -lt "$DEADLINE_SANITY_FLOOR" ] 2>/dev/null; then
  echo "WARNING: adversarial.spec_review.deadline (${deadline}s) is below the ${DEADLINE_SANITY_FLOOR}s sanity floor; a deadline this small may expire a lens before its primary backend can answer and advance the chain to a weaker fallback." >&2
fi
# thread --deadline "$deadline" into every LensRequest.argv (identical across lenses, like --timeout)
node "$FANOUT" --requests "$requests_json" --strategy "$strategy"
```

**Edge cases and error handling:**

- **Priming lens fails / unavailable / times out.** The primed result is recorded with its own exit code (non-served / DEADLINE / config-fault) exactly as any lens; the rest still fan out. On a cache-miss because priming failed, lenses 2..N cold-miss. **Honest critical-path cost:** because `requests[0]` is *awaited before* the rest start, a prime that runs its full duration (or hangs to its deadline) makes the pass wall-clock `prime_duration + max(full_2..N)`, whereas today's `parallel` overlaps everything at `max(prime_duration, full_2..N)`. On a **prefill-serialising** backend (the measured `spark-qwen-3-8` regime the ~19x premise implies — concurrent prefills contend, so they do not overlap anyway) this added latency is near-zero and the cache win dominates. On an **overlapping / no-cache** backend the prime is pure serial overhead — up to ~2x today's `parallel` on a prime-failure or no-cache pass. This is *not* "no worse than today" unconditionally; it is no worse than today **only on the regime the default targets**, and the AC below is satisfied *by config* on the other regimes (see the next failure mode and the no-worse-than-today AC).
- **Single-lens pass (N=1).** `prime-then-parallel` degenerates to a single awaited `runOne` — identical to `serial` and to `parallel` for N=1.
- **`--strategy` omitted or unrecognised.** Omitted → `parallel` (today). An unrecognised value is a usage fault (exit non-zero) — never silently coerced, so a typo'd config is loud, not a silent behaviour swap.
- **Deadline elapsed.** `review-call.mjs` returns `EXIT.DEADLINE(8)`; a hung lens no longer runs the inactivity window indefinitely. The occupant's per-lens outcome table (`faffter-dark-spec-review/SKILL.md`) has **no exit-8 row today** — this change adds one explicitly (see the new `**Chosen:**` below), because the current catch-all ("any other exit → `unavailable`, kind `config-fault`") would misclassify a bounded *infra* timeout as a *config* fault, and an implementer left to "fill in the row" might instead mirror `review-call.mjs`'s own `main()` `DEADLINE → pass+skip`, which would silently downgrade a timed-out lens to no-objection — the exact fail-open the transport floor exists to prevent. **Chosen (pinned disposition):** `EXIT.DEADLINE(8)` maps to lens outcome `unavailable`, kind **`infra-configured`** (swing-capable — a slow/hung backend is transient, so it feeds the swing-capable `unavailable` → resumable `faff-awaiting-spec-review` hold, never a silent pass and never a `config-fault` park). This is a required, named row, not an inference.

**Failure modes — how the approach falls over, and how you'd notice:**

- **The failure:** On a backend with **no** prefix cache (or one that overlaps concurrent prefills rather than serialising them), `prime-then-parallel` runs one serial prime *before* N-1 concurrent full prefills — up to ~2x pure `parallel`'s wall-clock (the `prime + max(rest)` vs `max(...)` critical-path cost above), because priming buys nothing there and the prime no longer overlaps. **How you'd know:** on such a backend, measured prime-then-parallel wall-clock > parallel wall-clock (the always-on in-band self-check below surfaces exactly this as an operator advisory each run). **What it means:** proceed — this is exactly why the strategy ships configurable; a no-cache / overlapping deployment selects `parallel` and pays exactly today's cost. AC "no worse than today" is satisfied **by the config** (the operator selects `parallel` on that regime), not by the `prime-then-parallel` default being universally optimal — which it is explicitly not.
- **The failure:** The prefix bytes are not actually byte-identical across lenses (a stray per-lens value leaks into the shared block), so even serial priming never produces a hit. **How you'd know:** lens 2's prefill time ≈ lens 1's (no cache hit) even under `serial`/`prime-then-parallel`. **What it means:** the FAFF-903/FAFF-915 prefix-purity invariant is broken — fix that, not the dispatch strategy.

**Anti-pattern:** Forking `fan-out.mjs` or hand-rolling a per-lens bash loop to get serial/prime behaviour. Why: the transport is reuse-never-fork (`SKILL.md:216`) and a bash loop is the exact harness-shaped stall FAFF-706 removed — the strategy belongs *inside* `fan-out.mjs`.

**Anti-pattern:** Perturbing the shared context+diff block to carry any per-lens value. Why: one changed prefix byte invalidates the cache for every subsequent lens (exact-prefix matching), erasing the whole win.

## 5. Scenarios — born-verifiable main objectives

```
Given a prefix-caching backend and a 3-lens spec-review over a byte-identical shared prefix
When dispatched under prime-then-parallel
Then lens 1 pays one full prefill and lenses 2-3 hit the cache (near-zero prefill),
     so total prefill work is ~1 full prefill, not ~3
```

```
Given dispatch_strategy = parallel (or the --strategy flag omitted)
When the lenses are dispatched
Then all N children are spawned concurrently and awaited together — byte-identical to today's fan-out
```

```
Given a lens whose backend streams slowly (never idle) for longer than the configured deadline
When the per-lens total wall-clock deadline elapses
Then that lens returns EXIT.DEADLINE(8) and the pass completes in bounded time,
     rather than running the inactivity window indefinitely
```

```
Given no dispatch_strategy set in config
When the strategy is resolved
Then it defaults to prime-then-parallel
```

```
Given prime-then-parallel and an injected spawnFn where requests[0] (the priming lens) fails/non-serves
When the pass is dispatched
Then requests[1..] still dispatch, and the returned LensResult[] carries the primed failure in slot 0
     plus the rest — a priming failure never aborts the batch
```

```
Given adversarial.spec_review.deadline set to a non-positive / non-numeric value (0, "", "abc")
When the occupant resolves the deadline
Then the -gt 0 guard resets it to 900, so no NaN/0 reaches review-call.mjs's Number(value)*1000 math
```

```
Given adversarial.spec_review.deadline set to a positive value below the 60s sanity floor (e.g. 30)
When the occupant resolves the deadline
Then the configured value (30) is HONOURED (not reset) and a single WARNING line naming the 60s floor is emitted on stderr
```

```
Given adversarial.spec_review.timeout resolved to a non-numeric/empty value while deadline is a valid positive integer
When the occupant resolves the inactivity timeout
Then the -gt 0 guard resets timeout to 120, so no later comparison silent-fails on an unparseable timeout
```

```
Given prime-then-parallel where requests[0]'s backend is not served (preflight fails / chain advances)
When the pass is dispatched
Then requests[0] is still the prime (matching `await runOne(requests[0])`), the primed slot records its own exit code,
     and requests[1..] fan out regardless — no pre-dispatch reachability selection is attempted
```

```
Given an unrecognised dispatch strategy (a typo'd config value or --strategy argument)
When fan-out.mjs / the occupant resolves the strategy
Then it exits non-zero (fails loud) rather than silently coercing to parallel
```

```
Given a fan-out LensResult whose exit is EXIT.DEADLINE(8)
When the occupant applies its per-lens outcome table
Then that lens is recorded outcome=unavailable, kind=infra-configured — never config-fault and never pass+skip
```

```
Given prime-then-parallel over a backend with no realised prefill-cache benefit (post-prime/prime TTFT ratio ≥ 1/5)
When the pass returns
Then the occupant emits exactly one operator advisory naming the TTFT ratio and suggesting the parallel strategy — advisory only, never gating
```

```
Given prime-then-parallel over a backend that does not expose TTFT for a lens
When the self-check runs
Then it records "not-computed" and emits NO advisory — it never falls back to wall-clock or manufactures a false positive
```

- The `LensResult[]` returned by `fan-out.mjs` is in input-request order under every strategy.

## 6. Design Decision Rationale

**Which dispatch strategy is the default?** Options: (1) prime-then-parallel, (2) serial, (3) keep parallel. Serial pays one prefill then N-1 near-free prefills but serialises all decodes; parallel pays N full prefills; prime-then-parallel pays one full prefill then overlaps the N-1 near-free prefills + decodes. **Chosen:** prime-then-parallel — serial's prefill cost with parallel's wall-clock on the only part that still costs anything (decode is ~3% of response time at scale per the ticket's sweep). Confirmed by the operator's 2026-09-19 correction: post-prime lenses prefill only their ~1-2 sentence brief (~1.2% of a 128k prefix), so there is no meaningful post-prime prefill contention.

**Configurable, or assert prime-then-parallel everywhere?** **Chosen:** configurable (`adversarial.spec_review.dispatch_strategy`, default prime-then-parallel). A no-cache backend gets nothing from priming and is marginally better on pure parallel; the operator was explicit that the measured sweep is evidence for `spark-qwen-3-8`, not for every backend. Direction 3 (config) and Direction 1 (prime default) are complementary, not alternatives.

**Where to implement?** Options: in `fan-out.mjs`, in the occupant bash, or a new dispatcher. **Chosen:** in `fan-out.mjs` behind `--strategy` — it already owns dispatch, keeps concurrency in faff's own code (FAFF-706 principle), stays harness-agnostic, and honours reuse-never-fork by extension. Occupant resolves config and passes the flag.

**How to stop one slow lens stalling the pass?** Options: streaming partial return; per-lens total wall-clock deadline. **Chosen:** the deadline (Direction 4) via the existing `review-call.mjs --deadline` — `--timeout` is only an inactivity window, so a slowly-streaming backend never trips it (round 1 ran 28 min wall / 8 s CPU). A total-wall-clock deadline turns that stall into a classifiable `EXIT.DEADLINE(8)`. Streaming partial return is a larger await-all re-architecture, deferred (OUT OF SCOPE).

**Correct the prose, or leave it?** **Chosen:** correct `SKILL.md:55/126/217` — AC explicitly requires the FAFF-903 "lens 1 populates … lenses 2-4 hit it" claim to become true of the shipped path *or be corrected*; making prime-then-parallel the default makes it true, and the "always concurrent, never serial" prose must be updated to describe the priming step so the contradiction the ticket found is closed.

## 7. Open Questions and Assumptions

**Open Questions:** none — the operator settled directions 1 (prime default), 3 (configurable), and 4 (bound total wall-clock) on 2026-09-19; direction 2 (auto-detect caching) is explicitly out of scope pending a backend capability signal.

**Assumptions:**

- **Assumes:** the FAFF-903 shared-prefix wire shape (`review-call.mjs:2148`) and FAFF-915/FAFF-1039 trim purity are intact and unchanged. Validate: confirm the shared block is still assembled byte-identically across lenses before relying on any cache hit (grep the role-swap seam; the trim is `pure and identical across lenses` per `review-call.mjs:2067`).
- **Assumes:** `review-call.mjs --deadline` (total wall-clock, `EXIT.DEADLINE=8`) is present and reachable from the spec-review dispatch path. Validate: `grep -n "totalDeadlineMs\|EXIT.DEADLINE" review-call.mjs`.
- **Assumes (the load-bearing cache property):** the backend's prefix cache is **connection-independent** — it persists across the distinct HTTP connections each `review-call.mjs` child opens, and survives the gap between the prime's completion and the rest's dispatch. This is the single property the entire prime-then-parallel win rests on; if the cache is per-connection or evicts between requests, the default regresses to the ~2x serial-overhead failure mode above for no benefit. **This assumption is now checked in-band on every run** (not merely by a manual pre-adoption probe): the always-on strategy self-check (§3/§4) compares the post-prime/prime **TTFT** (prefill) ratio each pass — TTFT, not wall-clock, because the cache saves prefill only — and advises switching to `parallel` when no prefill-cache benefit is seen (or records `not-computed` when the backend exposes no TTFT, never a false advisory). So a backend that silently breaches connection-independence is surfaced at review time rather than only by a future manual audit. A deliberate pre-adoption two-request probe is still the fastest way to confirm before trusting the default on a new backend; on a backend where it cannot be confirmed, select `parallel`.

## 8. DONE — Definition of Done

### From WHY
- [ ] On a prefix-caching backend, a multi-lens spec-review pays full prefill once, not once per lens (the ~19x-on-later-lenses regression is gone under the default strategy).

### From WHAT (config + interfaces)
- [ ] `adversarial.spec_review.dispatch_strategy` resolves `parallel|serial|prime-then-parallel` via `spec_review.* → adversarial.* → default`, defaulting to `prime-then-parallel`; an unrecognised value fails loud.
- [ ] `adversarial.spec_review.deadline` resolves a total-wall-clock seconds value via the same three-tier fallback and is threaded into every lens's `review-call.mjs --deadline`; a non-positive/non-numeric value resets to 900 (`-gt 0` guard). The inactivity `timeout` resolution carries its own `-gt 0` guard (non-numeric → 120), so no comparison silent-fails on an unparseable timeout. A positive `deadline` below the 60 s absolute sanity floor is **honoured** (not reset) with a single stderr WARNING — the operator's configured value stands.
- [ ] `fan-out.mjs` accepts `--strategy`; omitted → `parallel` (byte-identical to today); output is `LensResult[]` in input-request order under every strategy.
- [ ] Under `prime-then-parallel` the priming lens is `requests[0]` (matching the `await runOne(requests[0])` procedure — no pre-dispatch reachability rule); a not-served prime records its own exit code and costs one bounded preflight/chain hop, and `requests[1..]` fan out regardless (a priming failure never aborts the batch).
- [ ] The occupant maps a fan-out `LensResult.exit == EXIT.DEADLINE(8)` to `unavailable`/`infra-configured` (not `config-fault`, not `pass+skip`).
- [ ] Under `prime-then-parallel` the occupant emits an in-band advisory when the post-prime/prime **TTFT** (prefill) ratio is ≥ 1/5 (no prefill-cache benefit observed), and records `not-computed` with **no** advisory when a lens exposes no TTFT; advisory only, never gating, never a wall-clock fallback.

### From HOW (behaviour)
- [ ] `prime-then-parallel` awaits `requests[0]` alone, then fans out `requests[1..]` concurrently.
- [ ] `serial` dispatches one lens at a time; `parallel` spawns all at once (unchanged).
- [ ] A priming-lens failure still fans out the rest (no worse than today); N=1 degenerates to a single awaited call.
- [ ] A lens exceeding the deadline returns `EXIT.DEADLINE(8)` and the pass completes in bounded time.
- [ ] A spawn-level child fault still fails the batch as today.

### From HOW (docs)
- [ ] `faffter-dark-spec-review/SKILL.md` (`:55`, `:126`, `:217`) is updated to describe the prime-then-parallel dispatch, and the FAFF-903 "lens 1 populates the cache, lenses 2 to 4 hit it" claim is true of the shipped path (or corrected).

### From tests
- [ ] `fan-out.mjs --selftest` (pure) covers each strategy's ordering + await semantics with an injected `spawnFn` (no real spawn).
- [ ] **Priming-failure path (pure, injected `spawnFn`):** with `requests[0]`'s injected spawn returning a failure/non-served exit, assert `requests[1..]` still dispatch and the returned `LensResult[]` carries the primed failure in slot 0 plus the rest — i.e. a priming failure never aborts the batch. (Covers the §4 "Priming lens fails" edge case + its DONE item.)
- [ ] **Config-resolution (occupant bash, deterministic):** assert the occupant resolution resolves to `prime-then-parallel` when no key is set (the two defaults differ — `fan-out.mjs`'s `--strategy` default is `parallel`, so the documented `prime-then-parallel` default holds only via the occupant's `-d` chain), resolves the `spec_review.* → adversarial.* → default` precedence, that the `-gt 0` numeric guard resets a non-positive/non-numeric deadline to 900, that the inactivity `timeout`'s own `-gt 0` guard resets a non-numeric timeout to 120, and that a positive `deadline` below the 60 s sanity floor is **honoured** (left unchanged) while a single WARNING is emitted on stderr (assert both the honoured value and the warning — never a reset to 900). (Covers the deadline scenarios + the dispatch_strategy/deadline DONE items.)
- [ ] **Strategy validation (fails loud):** feed an unrecognised `--strategy` value to `fan-out.mjs` (and an unrecognised `dispatch_strategy` through the occupant resolution) and assert a non-zero exit — never a silent coercion to `parallel`. (Covers the unrecognised-strategy scenario + the "fails loud" DONE item.)
- [ ] **Exit-8 outcome mapping (occupant, deterministic):** feed a fixture `LensResult` with `exit == EXIT.DEADLINE(8)` through the per-lens outcome table and assert the recorded outcome is `unavailable`/`infra-configured` — explicitly not `config-fault` and not `pass+skip`. (Covers the exit-8 scenario + the exit-8 DONE item; guards the fail-open the spec names.)
- [ ] **In-band self-check advisory (occupant, deterministic):** with injected per-lens **TTFT** timings whose post-prime/prime ratio is ≥ 1/5, assert the occupant emits exactly one advisory line naming the ratio + the `parallel` suggestion; with a ratio < 1/5, assert none; with a lens whose TTFT is absent, assert the self-check records `not-computed` and emits **no** advisory (never a wall-clock fallback); assert the advisory never changes the verdict in any case. (Covers the self-check scenarios + DONE item; makes the no-prefill-cache regression observable in-band on any TTFT-exposing backend without false positives from decode.)
- [ ] **Prefix bytes byte-identical across lenses (named test):** a pure assertion over `build-lens-requests.mjs` output that the assembled shared/prefix block (the `system`-slot context+spec bytes) is **byte-identical** across all N `LensRequest`s — only each request's `--system` (trailing per-lens brief) differs. A one-byte leak into the shared prefix (the §4 anti-pattern) fails this test. (Guards the FAFF-903/FAFF-915 invariant with a decidable check, not an assumption note.)
- [ ] **Cache-hit observability — the headline AC's verification, with a pinned threshold and a named source.** The pure selftest and dispatch-order smoke test cannot observe a cache hit by construction, so the "~1 full prefill, not ~N" claim is verified by a **timed integration probe against a real prefix-caching backend** (gated behind an env flag / marked slow, run when a caching backend is configured, skipped otherwise): dispatch a 3-lens pass over a fixed byte-identical prefix under `prime-then-parallel` and assert the **pinned pass/fail line — the post-prime lenses' TTFT ≤ 1/5 of the prime's TTFT** (the ~19x cache-hit signal the ticket measured; a build where lens-2/3 is 40% of lens-1 is a decidable *fail*, not an ambiguous "small fraction"). **Measurement source (named): TTFT** — the same prefill observable the in-band self-check uses (never wall-clock, which includes decode); the probe and the self-check therefore agree by construction. When no caching backend is available the probe records `skipped` (not `pass`) — so this headline "1 prefill not N" AC is *decidable only on a prefix-caching backend*, which is the honest scope: on a no-cache backend the decidable property is instead "no worse than today," carried by the config choice (`parallel`) and surfaced by the in-band TTFT self-check, not by this probe.

**Integration smoke test:**

```
Build LensRequest[] for 3 lenses over a fixed shared prefix; call
  node fan-out.mjs --requests <reqs> --strategy prime-then-parallel
with an injected spawnFn recording dispatch order + start times.
Assert: request[0] completes before requests[1..] start; requests[1..] start together;
        results returned in input order. (Plumbing connected.)
```

confidence: high
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```