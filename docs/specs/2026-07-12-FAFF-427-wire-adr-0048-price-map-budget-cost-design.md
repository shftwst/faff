# FAFF-427 — Wire the ADR-0048 per-class×per-model price map into budget.cost; make a dollar ceiling the default L4 governor

> Spec: faffter-dark-nlspec · 2026-07-11 · autonomous · confidence: high. Full spec on Linear FAFF-427.

This spec addresses FAFF-427 for the build agent and human reviewers: it wires the ADR-0048 per-model × per-class price map into the `budget.cost` ceiling dimension, reconciles the two coexisting cost figures ADR-0048 deferred, and makes a dollar ceiling the default-recommended L4 spend governor.

## 1. WHY — Problem and Principles

**Load-bearing model:** faff already owns an accurate pricing source — the built-in `PRICE_PER_MTOK` map (model-id → `{input, output, cache_write, cache_read}` USD/MTok) plus the `budget.price_per_mtok_by_model` config override, shipped by FAFF-410 per ADR-0048 — but the *governing* cost dimension (`budget.cost` in `faff budget check`) never consults it. This change moves that map into the budget (governance) module, gives the budget token walk a per-model split, and prices the cost ceiling from the map by default — so a dollar ceiling finally measures dollars.

**Problem:** `budget.cost` activates only when the flat scalar `budget.price_per_mtok` is set (> 0; shipped default `"0"` = disabled) and then prices all four token classes at that one rate — pricing cache_read (85.5% of measured traffic) at output-class rates, a fiction. `budget.tokens` is dominated by cache_read so meaningful ceilings need tens of millions and are semantically weak. Result: the only honest L4 spend governor a user can arm today is a fiction or a proxy.

**Design principles:**

**Fail toward breaching, never toward silence.** The cost dimension is a governor: any pricing gap (unknown model, missing baseline) must overcount or warn loudly — never silently undercount, which makes a ceiling vacuously unbreachable (the same posture as FAFF-364's vacuous-`until` refusal).

**Governance never imports factory.** `bin/lib/budget.js` is governance-region; `bin/lib/economics.js` is factory-region and may import from governance, never the reverse (FAFF-359 region direction). The price map therefore *moves* to governance; factory re-imports it.

**One token walk.** FAFF-408 fixed a single transcript read/parse loop from which all token views derive. The per-model split extends that one loop; it does not add a second.

**Human-explicit config outranks the default.** An explicitly set `budget.price_per_mtok > 0` keeps today's flat-scalar behaviour byte-for-byte (with a deprecation warning) — the map is the *default*, not a silent override of deliberate config (same posture as `mintAtCeiling`'s explicit-wins rule).

**Reference context:**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/budget.js` | `envelopeFrom` (cost gated on `price_per_mtok > 0`, ~line 154), `cmdBudget` flat-scalar cost (~line 437), `sumTranscriptFileByClass`/`measureTokensByClass` (per-class, no per-model), `computeBudgetState` (pure breach core — unchanged) |
| `plugin/skills/faff/bin/lib/economics.js` | Current home of `PRICE_PER_MTOK` (~line 165), `economicsPriceForModel` (dated-suffix strip), `resolveEconomicsPriceMap` (config-over-builtin merge); `computeUnitEconomics` top-line still flat-scalar |
| `plugin/skills/faff/bin/lib/lights-out.js` | `spendTimeCeilingSet` (~line 423: cost counts only when `price_per_mtok > 0`), `budget-ceiling` refusal message (~line 320), `mintAtCeiling` |
| `docs/adr/0048-per-model-x-per-class-token-pricing-model.md` | Names the map + precedence; explicitly defers the "two cost figures coexist" reconciliation to this work |
| `test/budget.test.mjs`, `test/economics.test.mjs`, `test/lights-out.test.mjs` | Existing coverage to extend; each module also carries a `--selftest` table |

**Scope:** this is a CLI-internal change to the budget/economics/lights-out modules plus their documentation; no skill-prose control flow, tracker behaviour, or contract vocabulary changes.

## 2. OUT OF SCOPE

- **Estimate-only metering degrade/refuse** — when `tokens_source: estimate` there is no per-model data to price; this ticket leaves the cost dimension `null` with a loud warning in that case (flat-scalar estimate pricing unchanged where explicitly configured). The refuse-or-degrade policy for estimate-only L4 metering is FAFF-428 (explicitly sequenced after this ticket; same `cmdBudget` region — do not build the pair concurrently). Extension point: the `tokens_source === "estimate"` branch of `cmdBudget`.
- **Real CI/compute metering** — `cost` remains tokens×price; unchanged posture from FAFF-36.
- **Rate-card freshness** — the built-in map stays a point-in-time snapshot; the config override remains the escape hatch (ADR-0048 consequence, unchanged).
- **Per-issue cost attribution** — `economics --by`/`per_issue` semantics are untouched beyond the top-line pricing source; the breakdown axes already use the map.
- **Removing `budget.price_per_mtok`** — the key stays accepted (deprecated, explicit-wins). Removal is a future cleanup once configs migrate. Extension point: `envelopeFrom` + the `DEFAULTS` registry entry.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| pricing source | Which rule prices the cost dimension: `flat` (legacy scalar × total tokens) or `map` (per-model × per-class via the ADR-0048 map) |
| resolved price map | Built-in `PRICE_PER_MTOK` merged under `budget.price_per_mtok_by_model` (config wins per-model) — the exact FAFF-410 precedence, unchanged |
| unpriced model | A model-id present in the transcript but absent (after `-YYYYMMDD` suffix strip) from the resolved price map |

**Moved (not redesigned) — pricing primitives relocate to governance:** `PRICE_PER_MTOK`, `economicsPriceForModel`, `resolveEconomicsPriceMap` move from `economics.js` into `budget.js` (governance region) with behaviour identical; `economics.js` imports them from `./budget` (allowed factory→governance edge) and its module exports keep re-exporting them so existing tests/callers are untouched.

**New/changed shapes (pseudocode):**

```
FUNCTION sumTranscriptFileByModelClass(file):
  # extends the ONE FAFF-408 read/parse loop — per-class sums now also bucketed by model
  RETURNS { by_model: Map<model_id, {input, output, cache_write, cache_read}>,
            by_class: {input, output, cache_write, cache_read} }   # by_class == sum over models (parity)

FUNCTION measureTokensByModelClass(opts):   # same file-selection resolver as measureTokensByClass
  RETURNS { by_model, totals, source: "transcript" } | { source: "estimate" }

FUNCTION priceModelClassSums(by_model, priceMap):
  RETURNS { cost: Number,                    # Σ model Σ class tokens/1e6 × rate
            unpriced_models: [model_id] }    # priced conservatively — see HOW

BudgetEnvelope (additive field):
  pricing: "flat" | "map"    # flat iff explicit price_per_mtok > 0; else map
  ceilings.cost: Number|null # now set whenever budget.cost is configured (no longer gated on price_per_mtok)

run-ledger budget block (additive, mirrors FAFF-408's by_class baseline):
  budget.tokens_at_start_by_model_class: Map<model_id, {input, output, cache_write, cache_read}>
```

**Design decisions** (rationale collected in section 6): map is the default pricing source — **Chosen:** below; explicit flat scalar wins — **Chosen:**; unpriced models price conservatively — **Chosen:**; missing per-model baseline pro-rates — **Chosen:**.

## 4. HOW — Behavior

**Envelope resolution (`envelopeFrom`):** `ceilings.cost = num(b.cost)` unconditionally (null only when unset/malformed). `pricing = "flat"` when `num(b.price_per_mtok) > 0`, else `"map"`. When `pricing === "flat"`, everything downstream behaves byte-for-byte as today, plus one stderr deprecation warning naming `budget.price_per_mtok_by_model` and map pricing. `envelopeFromLedger` preserves a recorded `pricing` field; for a pre-change ledger envelope with no `pricing` field, derive it from the recorded `price_per_mtok` (`> 0` → `flat`, else `map`) so old in-flight runs keep their semantics.

**Cost measurement (`cmdBudget`), by pricing source and token source:**

```
PROCEDURE compute_cost(env, measurement, ledger, cfg):
  1. IF env.pricing == "flat":                          # legacy, byte-for-byte
       cost = price_per_mtok > 0 ? tokens/1e6 × price_per_mtok : null   (tokens = transcript delta or estimate)
  2. ELSE (map pricing):
     a. IF measurement.source == "estimate":
          cost = null; warn "cost ceiling not meterable from estimates (no per-model data)"
          # refuse/degrade policy = FAFF-428, out of scope here
     b. ELSE:
        i.  delta_by_model = current by_model sums − ledger.budget.tokens_at_start_by_model_class
            (per model per class, clamped ≥ 0)
        ii. IF the ledger has no tokens_at_start_by_model_class (pre-change ledger):
              pro-rate: scale each whole-session model×class bucket by
              (this-run scalar token delta ÷ whole-session scalar total); warn "cost pro-rated (no per-model baseline)"
        iii. { cost, unpriced_models } = priceModelClassSums(delta_by_model, resolved price map)
        iv. IF unpriced_models non-empty: warn naming them
  3. computeBudgetState(...) unchanged — breach rule `cost >= ceilings.cost` already exists
```

**Unpriced-model pricing (fail-safe direction):** tokens for a model absent from the resolved map are priced at the **costliest per-class rate present in the resolved map** (per class: the max of that class's rates across all rows), and the model-id is named in a warning. Overcounting can only breach *early* (at L4 `at_ceiling` defaults `escalate` — a human look), never lets spend run silently. `economics`' `cost: null` convention is a *reporting* idiom and stays as-is there; the governor must not adopt it.

**Baseline mint:** wherever `tokens_at_start` is written at run start (lights-out mint / orchestrator run-start), additionally write `tokens_at_start_by_model_class` from the same measurement pass. Additive — `budget check` still gates the token dimension on the scalar `tokens_at_start`, unchanged.

**lights-out preflight (`spendTimeCeilingSet` + messaging):** the cost dimension counts as a spend/time ceiling when `ceilings.cost != null` and it is *priceable*: always under `pricing: "map"` (the built-in map guarantees a price), or `price_per_mtok > 0` under `pricing: "flat"` (unchanged). The `budget-ceiling` refusal message reorders to lead with the dollar ceiling as the default governor: "set a spend ceiling: `budget.cost` (dollars — the recommended L4 governor), or `budget.tokens` / `budget.until`". `mintAtCeiling` unchanged.

**Economics reconciliation (the ADR-0048 deferred seam):** `computeUnitEconomics`'s top-line `cost_total`/`cost_per_*` migrate onto the same rule: explicit `price_per_mtok > 0` → flat (today's numbers, byte-for-byte); else map-priced from the per-model walk economics already performs (unknown models surface in `warnings`, priced per the breakdown's `cost: null` reporting convention — the top-line sums only priced rows and warns, since economics reports rather than governs). The JSON gains an additive `pricing: "flat"|"map"` field; `price_per_mtok` stays (legacy echo). Consequence: with zero config, `economics` now shows real dollars by default instead of `cost_*: null` — the `--by class|model` breakdown and the top-line now agree on one pricing source, closing ADR-0048's "two cost figures coexist".

**Edge cases:**

- Malformed `budget.cost` (non-numeric) → `null` ceiling, exactly as `num()` treats other dimensions today.
- `budget.cost` set + `pricing: flat` + `price_per_mtok = 0` is impossible by construction (`flat` requires > 0); the old "cost set but unpriced → disabled" dead zone disappears.
- Empty transcript / zero tokens → cost 0, no breach — unchanged.
- `warnings` array on `budget check` JSON reuses the FAFF-364 mechanism: present only when non-empty, so a clean run's JSON shape is unchanged.
- Partial price row (missing class) → that class rates 0 within a *known* row (existing `economicsPriceForModel` behaviour, unchanged) — the conservative-max rule applies only to *absent* rows.

**Failure modes:**

- **The map's rates drift from billing** — the dollar figure governs against stale rates. How you'd know: measured blended $ (the issue cites $16,763/17.8B tokens) diverges from provider billing. What it means: extend `budget.price_per_mtok_by_model` (the ADR-0048 escape hatch); no code change.
- **Pro-rata fallback misattributes multi-model sessions** — a pre-change ledger plus a mid-run model switch skews per-model deltas. How you'd know: the "cost pro-rated" warning is present. What it means: acceptable transitional degrade; freshly minted ledgers carry the real baseline.

**Anti-pattern:** re-implementing a second transcript walk for the per-model split. Why: FAFF-408 collapsed token accounting to one loop precisely so class/scalar/model views can never disagree.

**Anti-pattern:** letting `budget.js` require `economics.js` to reach the map. Why: governance→factory import inverts the FAFF-359 region direction; the map moves instead.

## 5. SCENARIOS

```
Given .faffrc sets budget.cost: 50 and does NOT set budget.price_per_mtok
When faff budget check runs against a run whose transcript delta prices to ≥ $50 on the map
Then the JSON reports breached: ["cost"], spent.cost is the map-priced blended figure, and tokens_source is "transcript"
```

```
Given .faffrc sets budget.cost: 50 and budget.price_per_mtok: 3 (explicit legacy config)
When faff budget check runs
Then spent.cost equals tokens/1e6 × 3 exactly as before this change, and a deprecation warning names the map
```

```
Given .faffrc sets only budget.cost: 50 (no price_per_mtok, no tokens, no until)
When faff lights-out --check runs
Then the budget-ceiling gate passes (the dollar ceiling alone is an accepted L4 spend governor)
```

```
Given a transcript containing spend on a model absent from the resolved price map
When faff budget check runs under map pricing
Then that spend is priced at the costliest per-class rates in the map and a warning names the model-id
```

Assertions (non-functional): `sumTranscriptFileByClass` totals remain byte-identical (per-model split is derivational, parity-tested); a clean `budget check` JSON gains no fields except when warnings/pricing apply as specified; `node --test` and all module `--selftest` tables pass.

## 6. DESIGN DECISION RATIONALE

**Where does the price map live once budget needs it?** Options: (a) move to `budget.js`, economics re-imports (region-clean; one source); (b) new `pricing.js` module (clean but adds a module for three symbols); (c) budget imports economics (violates region direction). **Chosen:** (a) — move `PRICE_PER_MTOK` + `economicsPriceForModel` + `resolveEconomicsPriceMap` into `budget.js`, re-exported through `economics.js` for compatibility. Smallest region-correct change; (b) is acceptable if the builder finds `budget.js` size a problem, but is not required.

**What reconciles the two cost figures?** Options: (a) map becomes the default everywhere, explicit flat scalar wins where set (back-compatible, one precedence rule); (b) map always wins, flat retired (silently changes deliberately-configured behaviour); (c) keep both figures and emit a delta (perpetuates the confusion ADR-0048 deferred). **Chosen:** (a) — map-by-default, explicit-flat-wins with a deprecation warning, applied identically in `budget check` and `economics` top-line. Honours human-explicit config; zero-config users get honest dollars for free.

**How do unpriced models price in the governor?** Options: (a) `cost: null` contribution / exclude + warn (fail-open — ceiling may never breach); (b) costliest known per-class rate + warn (fail-safe overcount). **Chosen:** (b) for `budget check`; `economics` keeps its `cost: null` reporting convention (it reports, it doesn't govern).

**How does a pre-change ledger (no per-model baseline) meter cost?** Options: (a) whole-session pricing (overcounts across runs — could falsely stop a fresh run); (b) pro-rata scale per-model buckets by the scalar this-run fraction + warn; (c) cost null until re-mint (fail-open). **Chosen:** (b) — deterministic, proportional, loudly labelled, transitional only.

**Is the reconciliation ADR-worthy?** ADR-0048 explicitly deferred it as a separate decision. **Chosen:** yes — one ADR candidate: "budget.cost prices per-model × per-class by default; explicit flat scalar wins; dollar ceiling is the recommended L4 governor" (materialised by graft via `faff adr new`, amending/superseding ADR-0048's two-figures consequence).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none blocking — every decision above carries a **Chosen:** marker.

**Assumptions:**

- **Assumes:** `readGovernanceConfig` already parses the nested `budget.price_per_mtok_by_model` YAML map (FAFF-410 shipped `resolveEconomicsPriceMap` reading it via `dig`). Validate: grep `resolveEconomicsPriceMap` call-sites in `economics.js` and run its selftest before building.
- **Assumes:** the run-start baseline write site (ledger `budget.tokens_at_start`) is reachable from the lights-out mint path in `lights-out.js` (it writes `budget: { envelope }` + baseline today). Validate: read the mint block (~line 590–610) before extending it.
- **Assumes:** FAFF-428 has not landed changes to the estimate branch of `cmdBudget` (sequenced after this ticket). Validate: `git log --oneline -5 -- plugin/skills/faff/bin/lib/budget.js` at build start.

## 8. DONE — Definition of Done

### From WHY
- [ ] A `budget.cost` ceiling breaches at the map-priced blended dollar figure with **no** `budget.price_per_mtok` configured (the measured-reality AC).

### From WHAT
- [ ] `PRICE_PER_MTOK` / `economicsPriceForModel` / `resolveEconomicsPriceMap` live in `budget.js`; `economics.js` imports and re-exports them; no `require("./economics")` appears in `budget.js`.
- [ ] The single transcript loop also buckets per-model; `sumTranscriptFileByClass` totals are parity-derived (test: by_class == Σ by_model, and equals the pre-change sums on a fixture transcript).
- [ ] `BudgetEnvelope` carries `pricing: "flat"|"map"`; `envelopeFromLedger` derives it for legacy ledger envelopes.
- [ ] The run-start baseline additionally records `tokens_at_start_by_model_class` (additive; scalar gate unchanged).

### From HOW
- [ ] Explicit `budget.price_per_mtok > 0` → flat cost byte-for-byte as today + deprecation warning (test asserts the exact legacy figure).
- [ ] Map pricing prices each class per-model (cache_read at cache_read rates — test with a cache-read-heavy fixture asserting the blended figure ≠ any flat-scalar figure).
- [ ] Unknown model → costliest per-class rate + warning naming the model-id.
- [ ] Pre-change ledger (no per-model baseline) → pro-rata cost + warning.
- [ ] Estimate-only + map pricing → `cost: null` + warning; estimate + explicit flat → unchanged estimate×flat.
- [ ] `faff lights-out --check` passes the `budget-ceiling` gate with only `budget.cost` set (AC 2: dollar ceiling accepted as the spend governor), and still refuses on `max_attempts`-only; refusal message leads with `budget.cost`.
- [ ] `economics` top-line prices via the same rule; `pricing` field emitted; top-line reconciles with `--by class`/`--by model` totals under map pricing (ADR-0048 seam closed).

### From docs/tests (same PR — docs never go stale)
- [ ] New ADR recorded via the graft ADR step (candidate named in section 6).
- [ ] `docs/guide/cli.md` lights-out + economics rows, `plugin/skills/faff-beep-boop/SKILL.md` budget-contract table (cost row, example rc, ledger `budget` block prose), and `bin/faff` usage strings updated to the new cost semantics.
- [ ] `test/budget.test.mjs`, `test/lights-out.test.mjs`, `test/economics.test.mjs` + the three `--selftest` tables cover every HOW item above; full `node --test` green.

**Integration smoke test:**

```
1. Write a fixture .faffrc with budget.cost: 0.01 (and nothing else budget-related)
2. Mint a run ledger; point budget check at a fixture transcript with mixed-model, cache-read-heavy usage
3. faff budget check --run-dir <dir> → breached includes "cost", spent.cost > 0, tokens_source "transcript"
4. faff lights-out --check with the same config → no budget-ceiling refusal
```

## Already shipped against this surface

Done tickets matched on the budget/economics/lights-out surface — related groundwork, none supersedes this premise:

- FAFF-410 (+ ADR-0048): shipped the map + `--by` breakdowns in `economics` — explicitly deferring this reconciliation.
- FAFF-407 / FAFF-408: token-usage spike + the single-loop four-class accounting this extends.
- FAFF-357: unit economics (flat-scalar top-line this migrates).
- FAFF-36 / FAFF-312 / FAFF-364: budget envelope, L4 spend/time-governor preflight, vacuous-ceiling refusal — the posture this completes.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** No issues — a single cohesive 1–3 day slice. The budget wiring and the economics top-line migration ship together deliberately: splitting them would re-open the "two cost figures coexist" seam this ticket exists to close.
- **Workstream fit?** No issues — "T2 — gates are complete" is outcome-named; a default-armed honest spend governor completes the budget gate.
- **Deps surfaced?** One finding — the FAFF-428 sequencing (build this first; never concurrently) lives in description prose plus an undirected `relatedTo` link, but no directed blocker edge. Graph readers (`faff next`, map, conflict analysis) won't serialise the pair from prose alone. Recommended: a human (or tidy) draws **FAFF-428 blockedBy FAFF-427** in the tracker; until then any run picking up FAFF-428 must honour the prose sequencing.
- **Risk profile?** No issues — internal refactor plus wiring over strong deterministic test seams (`--selftest` tables, `node --test`); no de-risking spike warranted.

confidence: high
spec-review: approve
