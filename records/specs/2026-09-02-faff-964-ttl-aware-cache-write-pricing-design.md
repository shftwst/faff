_FINAL spec — supersedes the earlier comment. Both punts resolved by human decision; confidence high; spec-review approve. This is the version to build from._

# TTL-aware cache-write pricing: split cache_write into 5m and 1h classes

> Spec: faffter-dark-nlspec · 2026-09-02 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-964.

> Revised 2026-09-02 — both open punts resolved by human decision: (1) unknown-TTL (aggregate-only) residual routes to `cache_write_1h` (2x) for **both** the governor and reporting — one constant, no surface divergence, honouring ADR-0059's overcount-never-undercount posture; (2) keep the split-by-field design (read whichever ephemeral field the usage carries) rather than assuming all-1h. Confidence raised medium → high (no open architecture punts remain).

This spec addresses FAFF-964 — `budget.cost` and `economics` price every cache-creation token at the 5-minute rate (1.25x input), but faff's runs use a 1-hour cache TTL billed at 2x, so the cache-write leg is undercounted by 2/1.25 = 1.6x for 1h writes. The `cache_write` token class is referenced across five library files and eight test files, so renaming it is a coordinated lockstep change, not the two-file edit the ticket's Scope section first suggested.

## 1. WHY — Problem and Principles

**The load-bearing model.** Cache-creation tokens are billed at two rates by time-to-live: a 5-minute write costs 1.25x the base input rate, a 1-hour write 2x. The transcript reports the two separately under `usage.cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`, alongside the flat aggregate `usage.cache_creation_input_tokens`. faff's price map collapses both into one `cache_write` class at the 5m rate, so any 1h write is priced 1.6x too low.

**Problem statement.** `PRICE_PER_MTOK` gives each model a single `cache_write` rate at 1.25x input, and `TOKEN_CLASS_FROM_USAGE` maps the class to the flat aggregate, discarding the TTL split. faff's measured L3/L4 runs use a 1h TTL that never times out (`eval/TOKENOMICS.md`: 0 of 280 inter-call gaps exceed 1h), so the cache-write leg is systematically undercounted. This change splits `cache_write` into a 5m and a 1h class, reads the two ephemeral sub-fields, and prices each at its own rate, so `budget.cost` (the default-armed L4 dollar governor) and `economics` report TTL-correct dollars.

**Design principles.**

**One token-attribution path, parity preserved.** budget.js has one transcript read/parse loop (`sumTranscriptFileByModelClass`), and the scalar total (`sumTranscriptFile`) is derived by summing the classes (the FAFF-229/408 single-path guard-rail). The split MUST keep this: the sum of all token-delta classes on any file equals the derived scalar total; every cache-creation token lands in exactly one write class.

**Governor overcounts, never undercounts (ADR-0059).** `budget.cost` may only breach early, never silently pass unmetered. The resolved unknown-TTL fallback (residual → `cache_write_1h`, 2x) respects this. Reporting uses the **same** fallback — one pricing source, no surface divergence (see D-residual).

**Reference the tokenomics suite, do not re-derive.** `eval/tokenomics.mjs` already reads the ephemeral split (`CACHE_MULT = { read: 0.1, write_5m: 1.25, write_1h: 2.0 }`) and routes un-bucketed writes to 1h (line 144). The build reuses those multipliers, field names, and residual direction.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/budget.js` | JS (CJS) | Governance region. Owns `TOKEN_DELTA_CLASSES`, `TOKEN_CLASS_FROM_USAGE`, `PRICE_PER_MTOK`, the read loop, pricing functions. Primary changes here. |
| `plugin/skills/faff/bin/lib/economics.js` | JS (CJS) | Factory region. Imports class list + price symbols; iterates `TOKEN_DELTA_CLASSES` in `--by class\|model\|day` and THREE per-usage read loops (transcript ~366, dominant-model scalar ~598, `economicsPhaseBreakdown` ~842). `economicsMcpBreakdown` (~523) reads no cache-write from usage — NO change. |
| `plugin/skills/faff/bin/lib/engine-codex.js` | JS (CJS) | `sumCodexUsage` (~119) emits flat `{input,output,cache_write,cache_read}`; codex reports no TTL split (unknown-TTL → route). `readEngineSpend` (~664) reads `rec[cls]` — a renamed class silently drops persisted codex spend unless routed + back-compat-read. |
| `plugin/skills/faff/bin/lib/events.js` | JS (CJS) | Emits token-delta events (~934/942) and VALIDATES `data.tokens` against `TOKEN_DELTA_CLASSES` (~227-235). Emit + validator move in lockstep; validator must still accept legacy-shape persisted events on re-read. |
| `plugin/skills/faff/bin/lib/resume.js` | JS (CJS) | References `cache_write` (resume token accounting). Lockstep. |
| `eval/tokenomics.mjs` | JS (ESM) | Reference impl of the split, the 5m/1h multipliers, and residual→1h (line 144). Not modified; mirrored. |
| `records/adr/0048-...md`, `records/adr/0059-...md` | Markdown | Price-map lineage + overcount posture. Amendment note added. |

**Scope statement.** The next refinement of the ADR-0048 per-model × per-class price map (after FAFF-427 wired it into budget.cost, FAFF-446 removed the flat scalar): split one class (cache_write) by TTL. No ceiling semantics, config schema, or region boundary change; touches every file naming the `cache_write` class plus tests.

## 2. OUT OF SCOPE

- **Reinterpreting already-minted ledgers.** A ledger minted under the old shape keeps its recorded price (`envelopeFromLedger`). Why: an in-flight L4 ceiling must never change mid-run from a code upgrade (ADR-0059/446 posture). Permanent invariant.
- **Changing cache-read pricing / read:write attribution.** cache_read is unaffected by TTL. `attributeCacheRead` untouched.
- **Setting or requesting a cache TTL from faff.** faff sets no `cache_control`/TTL — the harness controls it; faff only measures. Out of the metering surface.
- **Config override for the two new rates.** `budget.price_per_mtok_by_model` already merges whole per-model rows via `resolveEconomicsPriceMap`; no new knob.
- **Dropping the 5m class as provably-always-zero.** The resolution keeps the field-split (D-fivem); retiring the 5m class needs cross-transcript evidence — a future ticket.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| 5m write | Cache-creation write with a 5-minute TTL, billed 1.25x input. At `usage.cache_creation.ephemeral_5m_input_tokens`. |
| 1h write | Cache-creation write with a 1-hour TTL, billed 2x input. At `usage.cache_creation.ephemeral_1h_input_tokens`. |
| Aggregate cache-creation | The flat `usage.cache_creation_input_tokens` — sum of both TTLs. Always present; the ephemeral sub-fields may be absent. |
| Un-split residual | `aggregate - ephemeral_5m - ephemeral_1h`, clamped at 0. Routed to `cache_write_1h` (resolved). |
| Token-delta class | A pivot category in `TOKEN_DELTA_CLASSES`; the cache-write category grows from one class to two. |

**Token-delta classes (the taxonomy change).**

```
TOKEN_DELTA_CLASSES (before): ["input", "output", "cache_write", "cache_read"]
TOKEN_DELTA_CLASSES (after):  ["input", "output", "cache_write_5m", "cache_write_1h", "cache_read"]
```

Every accumulator literal `{ input, output, cache_write, cache_read }` gains the two keys and drops `cache_write`; every hard-coded scalar sum becomes `... + c.cache_write_5m + c.cache_write_1h + ...`. Prefer iterating `TOKEN_DELTA_CLASSES` over hard-coded sums where the loop form already exists.

**Usage extraction (the nested-read change).** The ephemeral split is nested under `usage.cache_creation`; a flat-key map can't express it. One pure helper both read loops call:

```
PROCEDURE classCountsFromUsage(usage) -> { input, output, cache_write_5m, cache_write_1h, cache_read }:
  # input / output / cache_read: unchanged flat reads via TOKEN_CLASS_FROM_USAGE
  cc := usage.cache_creation (object) OR {}
  ephem_5m := finite(cc.ephemeral_5m_input_tokens) OR 0
  ephem_1h := finite(cc.ephemeral_1h_input_tokens) OR 0
  aggregate := finite(usage.cache_creation_input_tokens) OR 0
  residual := max(0, aggregate - ephem_5m - ephem_1h)
  (r5, r1h) := routeUnknownTtlWrite(residual)     # RESOLVED: residual -> cache_write_1h
  cache_write_5m := ephem_5m + r5
  cache_write_1h := ephem_1h + r1h
```

`TOKEN_CLASS_FROM_USAGE` is retained for the three flat classes; the two cache-write classes are computed by this helper. The budget.js transcript loop AND all three economics per-usage read loops delegate to `classCountsFromUsage` (`economicsMcpBreakdown` needs no change). Export `classCountsFromUsage` from budget.js; import into economics.js.

**Persisted-record extraction (the two back-compat surfaces).**
- **Engine-spend (`engine-codex.js` / `readEngineSpend`).** `sumCodexUsage` builds from `usage.cache_write_input_tokens` (no TTL split). On WRITE, route the whole amount through `routeUnknownTtlWrite` (→ 1h). On READ, `readEngineSpend` MUST treat a legacy bare `cache_write` record as unknown-TTL residual (route it), never iterate past it, else persisted codex spend silently drops (ADR-0059 undercount). One shared `routeUnknownTtlWrite(n)` serves the usage residual and both record sites.
- **Token-delta events (`events.js`).** Emit site switches to the new keys in lockstep. The `data.tokens` validator rejects out-of-set and missing/non-integer keys, so a legacy event fails both paths; normalise a legacy event (its `cache_write` → `cache_write_1h`) before validation so resume/replay across the upgrade doesn't fail.

**Parity invariant.** For any usage record: `cache_write_5m + cache_write_1h == max(ephem_5m + ephem_1h, aggregate)`. Normal case = aggregate; aggregate-only → whole aggregate in `cache_write_1h`; sub-fields-exceed-aggregate (malformed) → sub-fields win, residual 0. The five-class sum still equals the scalar total on every file.

**Price map (both rates per row).**

```
PRICE_PER_MTOK[model] (before): { input, output, cache_write, cache_read }
PRICE_PER_MTOK[model] (after):  { input, output, cache_write_5m, cache_write_1h, cache_read }
```

For each row, `cache_write_5m := old cache_write` (1.25x) and `cache_write_1h := input * 2`. Concretely: fable {5m 12.5, 1h 20}, opus {5m 6.25, 1h 10}, sonnet {5m 3.75, 1h 6}, haiku {5m 1.25, 1h 2}. `PRICE_TABLE_AS_OF` unchanged. `economicsPriceForModel` hard-codes the keys in its returned row — edit it to return both cache-write rates.

**The residual-routing constant.**

```
UNKNOWN_TTL_WRITE_CLASS := "cache_write_1h"   # RESOLVED (D-residual): one constant, both surfaces
PROCEDURE routeUnknownTtlWrite(residual) -> (to_5m, to_1h):  to_1h := residual; to_5m := 0
```

## 4. HOW — Behavior

**Architecture and approach.** Coordinated edits across five lib files plus tests:
1. Grow `TOKEN_DELTA_CLASSES` and every accumulator literal / hard-coded class sum across budget.js, economics.js, events.js, engine-codex.js, resume.js.
2. Add `classCountsFromUsage` + `routeUnknownTtlWrite` (residual → 1h) in budget.js; export both. Route the budget.js transcript loop and all three economics per-usage read loops through `classCountsFromUsage`.
3. Give each `PRICE_PER_MTOK` row both cache-write rates; verify `economicsPriceForModel` / `conservativePriceRow` / `priceModelClassSums` read the new keys.
4. Engine spend: route `sumCodexUsage`'s write on emit; make `readEngineSpend` back-compat-read a legacy bare `cache_write` via `routeUnknownTtlWrite`.
5. Events: switch the emit site to the new keys; normalise a legacy persisted event before the validator.

**The residual-routing policy (resolved).** The un-split residual routes entirely to `cache_write_1h` (2x), for **both** governor and reporting — one module constant `UNKNOWN_TTL_WRITE_CLASS = "cache_write_1h"`, no surface divergence. Honours ADR-0059's overcount posture, matches tokenomics.mjs's observed-default (line 144), keeps one pricing source. Trade-off accepted: a genuinely-5m foreign transcript reporting only the aggregate is over-priced at 1h — the safe direction over under-counting real 1h writes.

**Read loop, after (budget.js `sumTranscriptFileByModelClass`).**

```
PROCEDURE sumTranscriptFileByModelClass(file):
  for each parseable record with a usage object:
    model := rec.message.model OR "unknown"
    counts := classCountsFromUsage(usage)       # the ONE extractor
    for cls in TOKEN_DELTA_CLASSES:
      by_class[cls] += counts[cls]; by_model[model][cls] += counts[cls]
  return { by_model, by_class }
```

`sumTranscriptFileByClass` and `sumTranscriptFile` derive unchanged (one loop; scalar total still the class sum).

**Edge cases.**
- No `cache_creation`, flat aggregate present: sub-fields 0, whole aggregate → residual → `cache_write_1h`. Parity holds.
- Only one sub-field: missing reads 0; residual → `cache_write_1h`. Parity holds.
- Neither aggregate nor sub-fields: all cache-write 0. Unchanged.
- Sub-fields present, aggregate absent: residual clamps to 0; classes carry sub-fields.
- Malformed/non-finite: coerced to 0 as today's `Number.isFinite` guard.
- Legacy engine-spend record (bare `cache_write`): `readEngineSpend` routes via `routeUnknownTtlWrite` (→ 1h); never dropped.
- Legacy persisted event (bare `cache_write`): normalised (→ `cache_write_1h`) before validation.
- Legacy ledger with recorded flat price: untouched (`envelopeFromLedger`).

**Failure modes.**
- **Split changes the scalar total** (token dropped/double-counted), breaking the FAFF-229/408 parity guard. Know: parity selftest fails; `--by class` no longer reconciles. Means: re-derive so exactly one class gets the residual.
- **A legacy persisted codex record or event drops its cache-write on re-read.** Know: back-compat tests show spend vanishing or a resumed event failing `data.tokens`. Means: the `readEngineSpend` / event-normalisation bridge is missing or mis-keyed — restore `routeUnknownTtlWrite`.

**Anti-pattern:** a second private read loop for the ephemeral fields — re-introduces the divergent-recount hazard; extend `classCountsFromUsage`, keep one loop. **Anti-pattern:** pricing the residual at $0 to "avoid guessing" — an undercount for the governor; the residual routes to 1h, never to nothing.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a usage record with cache_creation.ephemeral_1h_input_tokens = 1_000_000 and no 5m tokens, for claude-opus-4-8
When economics/budget prices the run
Then the 1h write leg is priced at 2x input ($10.00), not 1.25x ($6.25)
```

```
Given a transcript file with mixed 5m and 1h cache-creation writes
When sumTranscriptFileByClass and sumTranscriptFile are computed on it
Then the sum of the five token-delta classes equals the scalar total (parity holds for well-formed records)
```

- A `--by class` breakdown MUST list `cache_write_5m` and `cache_write_1h` as distinct rows and MUST reconcile to the top-line total.

## 6. Design Decision Rationale

**How to express the TTL split in the taxonomy?** Options: (a) two classes; (b) one class priced by a per-record blend. (b) loses the per-class pivot and hides the mix. **Chosen:** two classes `cache_write_5m` / `cache_write_1h` — preserves the pivot, mirrors tokenomics.mjs.

**How to read the nested ephemeral fields without a second loop?** Options: (a) one `classCountsFromUsage` helper; (b) extractor-function values in `TOKEN_CLASS_FROM_USAGE`. (b) is a wider refactor for one nested case. **Chosen:** (a) — one read path, minimal blast radius.

**What rate for the two new classes?** **Chosen:** `cache_write_5m := 1.25x input`, `cache_write_1h := 2x input`, mirroring `CACHE_MULT`.

**D-residual — where does the un-split residual go?** Options: (a) `cache_write_1h` for both surfaces; (b) `cache_write_5m`; (c) split (governor 1h, reporting 5m). **Chosen (human-resolved 2026-09-02):** (a). One constant, no divergence; honours ADR-0059, matches tokenomics.mjs line 144, keeps a single pricing source. Rejected (b) — re-introduces the 1.6x undercount for aggregate-only transcripts; rejected (c) — the divergence costs the single-source simplicity for a marginal reporting gain judged not worth it.

**D-fivem — keep the 5m class, or assume all-1h?** Options: (a) keep the field-split; (b) assume all-1h with a 5m fallback for foreign transcripts. **Chosen (human-resolved 2026-09-02):** (a). faff sets no TTL and measured runs are all-1h, but a foreign transcript could emit 5m; the field-split reads whichever with no baked-in assumption. Retiring the 5m class deferred to future evidence.

## 7. Open Questions and Assumptions

**Open Questions.** None outstanding — both prior punts (residual direction, 5m-class necessity) resolved by human decision 2026-09-02 (D-residual, D-fivem).

**Assumptions.**
- **Assumes:** the transcript reports `usage.cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` when a TTL split exists. **Validation:** `eval/tokenomics.mjs` (lines 60-73) reads exactly these; grep a recent transcript for `ephemeral_1h_input_tokens` to confirm shape.

## 8. DONE — Definition of Done

### From WHY
- [ ] For a 1h cache-creation write, `budget.cost` and `economics` price it at 2x input, not 1.25x.
- [ ] The single-token-attribution-path invariant holds: class sum equals scalar total on every file.

### From WHAT (types/taxonomy)
- [ ] `TOKEN_DELTA_CLASSES` is `["input","output","cache_write_5m","cache_write_1h","cache_read"]`; `cache_write` gone.
- [ ] Every accumulator literal and hard-coded class sum in budget.js/economics.js includes both new keys, excludes `cache_write`.
- [ ] Each `PRICE_PER_MTOK` row carries `cache_write_5m` (= prior rate) and `cache_write_1h` (= 2x input); no bare `cache_write`.
- [ ] `economicsPriceForModel` returns both rates; `conservativePriceRow` maxes over both; `priceModelClassSums` prices both.

### From HOW (behaviour)
- [ ] `classCountsFromUsage` reads the ephemeral sub-fields, clamps the residual, routes it to `cache_write_1h` via `routeUnknownTtlWrite`.
- [ ] The budget.js loop AND all three economics per-usage read loops delegate to `classCountsFromUsage`; no second loop; `economicsMcpBreakdown` confirmed no-change.
- [ ] `sumCodexUsage` routes its write through `routeUnknownTtlWrite` (→ 1h); a fresh codex record carries the new keys.
- [ ] `readEngineSpend` back-compat-reads a legacy bare-`cache_write` record via `routeUnknownTtlWrite` (no dropped spend).
- [ ] The events emit site writes the new keys; a legacy bare-`cache_write` event is normalised (→ 1h) and passes the validator.
- [ ] `--by class` lists `cache_write_5m` and `cache_write_1h` as distinct rows and reconciles to the top-line total.

### From HOW (edge cases)
- [ ] Aggregate-only usage routes the whole aggregate to `cache_write_1h`; parity holds.
- [ ] Partial sub-fields, sub-fields-without-aggregate, non-finite values preserve parity and drop no token.
- [ ] A legacy engine-spend record and a legacy persisted event both survive re-read.
- [ ] A legacy ledger's recorded flat price is unchanged.

### From tests
- [ ] Selftests updated in lockstep: `test/budget.test.mjs`, `test/economics.test.mjs`, `test/token-breakdown-attribution.test.mjs`, `test/events.test.mjs`, `test/events-chain.test.mjs`, `test/engine-call.test.mjs`, `test/ledger-concurrency.test.mjs`, `test/eval-tokenomics.test.mjs`, `test/lights-out-resume.test.mjs`, plus the in-file `--selftest` tables in budget.js / economics.js / engine-codex.js / resume.js.
- [ ] A new test asserts a 1h write is priced at 2x and a 5m write at 1.25x for at least one model.
- [ ] A new test asserts an aggregate-only write is priced at 2x (residual → 1h).
- [ ] A new test asserts a legacy bare-`cache_write` engine-spend record and event are read/validated without loss.

### Eval coverage
- [ ] No LLM-judgement seam introduced; no grader/eval-case row required.

### Integration smoke test
```
1. Transcript with one opus record: cache_creation.ephemeral_5m=100, ephemeral_1h=200, cache_creation_input_tokens=300.
2. sumTranscriptFileByClass -> cache_write_5m=100, cache_write_1h=200, residual=0.
3. priceModelClassSums for claude-opus-4-8 -> (100/1e6)*6.25 + (200/1e6)*10.
4. Assert sumTranscriptFile == input+output+cache_write_5m+cache_write_1h+cache_read.
5. Aggregate-only opus record (cache_creation_input_tokens=300, no sub-fields) -> cache_write_1h=300, cache_write_5m=0, priced (300/1e6)*10.
```

confidence: high
build-tier: complex
spec-review: approve
