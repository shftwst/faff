# FAFF-410 — `faff economics --by class|model|mcp`: fold the token-breakdown axes into economics

> Spec: faffter-dark-nlspec · 2026-07-09 · autonomous · confidence: high. Full spec on Linear FAFF-410.

This is the build spec for FAFF-410 — extending the existing `faff economics` subcommand (the single bundled CLI at `plugin/skills/faff/bin/faff`) with a `--by class|model|mcp` (and `--by day`) token-and-cost breakdown. Audience: the build agent implementing it, and the human reviewer of the PR. It is the durable landing of the FAFF-407 spike's headline recommendation.

## 1. WHY — Problem and Principles

**The load-bearing idea:** faff already walks the run's session-owned transcripts once, to a single scalar token total (`measureTokens`), and prices that scalar at a flat rate (`economics`). A *breakdown* is the **same walk, pivoted** — instead of collapsing every usage record to one number, accumulate it into per-class, per-model, per-day, and per-MCP-tool buckets, and price each bucket at a per-model × per-class rate. Nothing new is measured; the existing measurement is disaggregated.

**Problem statement.** FAFF-407 proved the breakdown (token-class, per-model, per-MCP) is high-value for finding optimisation wins, but produced it in a throwaway `scripts/token-breakdown.mjs`. Its explicit recommendation was to make the breakdown durable by *extending* `faff economics` (FAFF-357), which already walks the identical transcript token path — not by building a parallel `faff tokens` command that would duplicate the ledger walk. This ticket does that.

**Design principles** (would cause rejection of an otherwise-valid build):

- **Reuse the walk, don't rebuild accounting.** The breakdown must select the *same* transcript records `measureTokens`/`sumTranscriptFile` already sum, so the breakdown reconciles to the top-line total. A second, independently-scoped census is a defect (it silently disagrees with `faff budget check`).
- **Non-leak invariant (inherited from FAFF-407).** The command emits **sizes, counts, names, model-ids, and derived costs only** — never transcript payload content. Payloads are read solely to measure serialised size (MCP request/response bytes). No code path logs or returns a payload string.
- **Additive and back-compatible.** `faff economics` with no `--by` flag is byte-for-byte unchanged. The `--by` axes are a strictly additive surface.
- **Composes with, does not depend on, FAFF-408/409.** This is the data *consumer*; 408 (phase-tagged token events) and 409 (per-tool MCP cache-amplification) are *producers* landing in the same run. This spec must build and pass on `main` regardless of whether 408/409 have merged — it reads transcripts directly, exactly as the FAFF-407 reference does.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` → `cmdEconomics` (~line 2970) | Node | The subcommand this extends; JSON-only output today |
| `plugin/skills/faff/bin/faff` → `computeUnitEconomics` (~line 2889) | Node | Pure top-line economics core (buckets, cost) — unchanged by this work |
| `plugin/skills/faff/bin/faff` → `measureTokens` (~line 2597), `sumTranscriptFile` (~line 2550), `BUDGET_TOKEN_USAGE_KEYS` (~line 2467), `transcriptBaseDir` (~line 2540), `childOwningSession` (~line 2578) | Node | The exact token-measurement path whose record selection and file scoping the breakdown must mirror |
| `scripts/token-breakdown.mjs` (FAFF-407, on `origin/main`) | Node | Reference implementation: `PRICE_PER_MTOK` map, four-class pivot, `byDay`/`byModel`/`byClass`/`mcpTools` accumulators, reconciliation, non-leak discipline |
| `test/economics.test.mjs` | Node `node:test` | Existing integration harness (`fixture()`, `withTranscripts()`) to extend |
| `docs/guide/cli.md` (economics row ~line 49) + CLI inline help (~line 5841) | Markdown / Node | Doc surfaces that must stay in sync; `faff lint-cli-doc` gate |

**Scope statement.** This sits at the CLI's cost-reporting surface — one new flag family on an existing subcommand, reusing the transcript walk that `budget` and `economics` already share.

## 2. OUT OF SCOPE

- **`--by phase` (prep / build / review / orchestrator).** — *Why excluded:* FAFF-407 proved phase attribution is unresolvable from transcripts alone; it needs the token-tagged `events.jsonl` that **FAFF-408** adds. — *Extension point:* once FAFF-408 lands, a `--by phase` axis joins spend to phase via `events.jsonl` `data.tokens`; add it as a fifth `BY_AXES` value reading the event stream instead of pivoting transcripts.
- **Precise per-tool MCP cost (measured cache-amplification).** — *Why excluded:* the true amplified footprint is what **FAFF-409** measures; this spec uses the FAFF-407 *estimate* (payload bytes × a single global amplification factor), explicitly labelled an estimate. — *Extension point:* when FAFF-409 lands, `--by mcp` swaps its estimate for the measured figure.
- **Cross-run / whole-corpus breakdown.** — *Why excluded:* `economics` has a single-run identity (one resolved `runDir`); a corpus-spanning breakdown is a different denominator than the reference script's whole-corpus walk and would change economics' contract. — *Extension point:* a future `faff economics --all-runs` (or a corpus-level `faff tokens census`) could aggregate across run dirs.
- **Reconciling the top-line flat-priced cost against the per-model × per-class breakdown cost.** — *Why excluded:* the legacy flat `budget.price_per_mtok` and the new per-model×class map are two pricing models; making them agree is its own decision. — *Extension point:* a follow-up can migrate the top-line cost onto the per-model×class map, or emit a reconciliation delta.
- **Deleting `scripts/token-breakdown.mjs`.** — *Why excluded:* it is referenced by the FAFF-407 report (`verification/reports/token-usage-breakdown/`) as the spike artifact; the durable logic moving into the command does not require removing the artifact. — *Extension point:* a later cleanup pass may retire it once the report is archived.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| token class | One of the four `BUDGET_TOKEN_USAGE_KEYS`, short-labelled: `input` (`input_tokens`), `output` (`output_tokens`), `cache_write` (`cache_creation_input_tokens`), `cache_read` (`cache_read_input_tokens`) |
| model | The real transcript `message.model` string (e.g. `claude-opus-4-8`) — **not** a `models.*` dispatch-lane token (`sonnet`/`opus`/…). Distinct vocabularies; do not conflate |
| axis | The `--by` grouping key: `class` \| `model` \| `mcp` \| `day` |
| bucket | An accumulator `{ input, output, cache_write, cache_read, total, cost }` |

**New flag surface on `economics`.**

```
faff economics [--run-dir DIR] [--root DIR] --by <class|model|mcp|day> [--json] [--selftest]
```

- `--by <axis>` — required value from the closed set `{ class, model, mcp, day }`. An unrecognised value exits non-zero with a message naming the legal set (fail-loud, mirroring `validateModelLane`).
- With `--by` and **without** `--json` → render a skimmable text table (the human default for the breakdown).
- With `--by` **and** `--json` → the breakdown rides as a `breakdown` object in the JSON result.
- **No `--by`** → today's behaviour, unchanged (the existing always-JSON `UnitEconomics` blob).

**Result shape (JSON, `--by X --json`).** The existing `UnitEconomics` object gains one field:

```
RECORD Breakdown:
  axis: "class" | "model" | "mcp" | "day"
  source: "transcript" | "estimate"        # mirrors measureTokens.source
  rows: List<BreakdownRow>                  # ordered; see ordering rules in HOW
  reconciliation: {
    grand_total: int                        # sum of all rows' .total
    top_line_total: int | null              # measureTokens total for the run (null when source=estimate)
    reconciles: bool                        # grand_total === top_line_total (class/model/day axes)
  }

RECORD BreakdownRow:                         # class | model | day axis
  key: string                               # class label, model-id, or YYYY-MM-DD
  input: int; output: int; cache_write: int; cache_read: int
  total: int
  cost: number | null                       # priced per-model × per-class; null if no price resolvable

RECORD McpRow:                               # mcp axis only
  tool: string                              # mcp__* tool name
  call_count: int
  request_bytes: int
  response_bytes: int
  est_cache_tokens: int                     # ESTIMATE via global amplification factor
  est_cost: number | null                   # ESTIMATE, labelled as such
```

**Pricing map (per-model × per-class USD per 1M tokens).** A built-in code constant seeded from the FAFF-407 reference (`PRICE_PER_MTOK`), covering the shipped Claude models with the four-class rates. Unknown/local models price at `$0` (never crash, never guess). A dated model-id suffix (`-YYYYMMDD`) is stripped before lookup, exactly as the reference's `priceFor` does.

## 4. HOW — Behavior

**Architecture and approach.** Add three things to `plugin/skills/faff/bin/faff`, all additive:

1. A built-in `PRICE_PER_MTOK` constant + `priceFor(model)` helper (lifted from the reference script, deduplicated with `BUDGET_TOKEN_USAGE_KEYS`).
2. A pure core `economicsBreakdown(records, axis, priceMap)` that pivots pre-parsed usage records into buckets — no I/O, unit-testable like `computeUnitEconomics`.
3. An I/O reader that selects the run's session-owned transcript files (the **same** selection `measureTokens` uses) and streams their records into the core, plus a renderer branch in `cmdEconomics` for the `--by` path.

**Record selection — reuse, do not re-invent.** The breakdown reader walks `transcriptBaseDir(cwd, env)` and selects exactly the files `measureTokens` sums: the run session's `<sid>.jsonl` plus every `agent-*.jsonl` whose `childOwningSession(file) === sid` (the FAFF-229 first-record-sessionId scoping — **not** mtime). For each selected file, parse each line and select the usage object with the **same** rule as `sumTranscriptFile`: `rec.message.usage ?? rec.usage`, any record type (not assistant-only). This identity of selection is what makes the breakdown reconcile to the top-line total.

```
PROCEDURE economics_breakdown(root, runDir, cwd, env, axis, priceMap):
  1. Resolve sid, base = transcriptBaseDir(cwd, env); files = measureTokens's selected set.
  2. IF no sid / base missing / session file missing:
       return { source: "estimate", rows: [], reconciliation: { top_line_total: null, reconciles: false } }
       # degrade exactly as measureTokens returns source:"estimate"
  3. FOR each selected file, FOR each record with a usage object:
       model = rec.message.model || "unknown"
       day   = YYYY-MM-DD from rec.timestamp (or "unknown")
       fold the four class counts into: grand, byClass, byModel[model], byDay[day]
       (mcp axis additionally scans tool_use / tool_result blocks — see MCP below)
  4. Build rows for the requested axis; price each row per-model × per-class via priceMap.
  5. reconciliation.grand_total = sum(rows.total);
     reconciliation.top_line_total = measureTokens(...).total;
     reconciliation.reconciles = (grand_total === top_line_total)   # class|model|day only
  6. return breakdown
```

**Per-class pricing.** A row's cost sums, over the four classes, `count[class] / 1e6 * priceMap[model][class]`. For the `class` axis (no per-row model) price each class at the **run's dominant model** (the most-token-bearing model in the walk), and name that model in the output so the basis is explicit. For the `model` axis, each row prices at its own model. For `day`, price each day's per-model sub-totals then sum (a day mixes models). Rows whose model has no price resolve `cost: null` (kept distinct from `cost: 0`).

**`--by mcp` (estimate).** Mirror the reference `scripts/token-breakdown.mjs` MCP path: index `tool_use.id → tool.name` for `mcp__*` names; count `call_count`; measure `request_bytes = JSON.stringify(tool_use.input).length` and `response_bytes` from matched `tool_result` content length; estimate cache tokens as `response_bytes-derived × cache_amp_factor`, where `cache_amp_factor = byClass.cache_read / (byClass.input + byClass.cache_write)` (a single global ratio). Every MCP figure that is not a direct count/byte-size is labelled **estimate** in both JSON (`est_*` keys) and the human table. **Never** emit payload content — only `.length`.

**Ordering (deterministic, for stable output + selftests).** `class` → fixed order `input, output, cache_write, cache_read`. `model` → descending by `total`, ties broken by model-id ascending. `day` → chronological ascending. `mcp` → descending by `call_count`, ties by tool name ascending.

**Output rendering.** All human-facing output routes through the configured `rendering_adaptor` normalise pass (skimmable table, not run-on prose). The `--by X --json` path emits the `breakdown` object; the `--by X` (no `--json`) path emits a compact table: one row per bucket, columns per class + total + cost, a totals/reconciliation footer. The no-`--by` path is untouched.

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure:** the breakdown selects a *different* record set than `measureTokens` (e.g. assistant-only, or mtime-scoped children), so `--by class` total silently disagrees with `faff budget check`. **How you'd know:** `reconciliation.reconciles === false` on a run where `source === "transcript"`; the selftest reconciliation assertion fails. **What it means:** fix the selection to match `sumTranscriptFile`/`childOwningSession` exactly — do not proceed with a divergent census.
- **The failure:** `--by mcp` presents its amplification *estimate* as if it were measured, over-stating MCP's share (the FAFF-175 "~39%" trap). **How you'd know:** the figure moves with the global `cache_amp_factor` rather than per-tool reality; FAFF-409, when it lands, contradicts it. **What it means:** the estimate is acceptable **only** while explicitly labelled; the label is a hard requirement, not cosmetic.
- **The failure:** unknown/local model prices as `$0` and the reader treats a whole run as free. **How you'd know:** `cost: null` rows (or `$0`) dominate a run that used real models — the model-id column shows an unrecognised string. **What it means:** proceed (never crash), but surface the unpriced model in output so a human can extend `PRICE_PER_MTOK`.

**Anti-pattern:** re-walking transcripts a second time with bespoke selection logic. Why: it re-imports the FAFF-229 over-count bug and breaks reconciliation. Reuse `measureTokens`' file set and `sumTranscriptFile`'s record rule.

**Anti-pattern:** keying `--by model` off `models.build`/`models.spec` config tokens. Why: those are abstract dispatch lanes (`sonnet`/`opus`), not the real `message.model` ids the transcripts and the price map use.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a run whose session-owned transcripts contain records across all four token classes
When `faff economics --by class --json` runs
Then the output has one row per class (input, output, cache_write, cache_read)
 And reconciliation.reconciles is true (sum of class totals === measureTokens total)
```

```
Given transcripts with records from two distinct message.model values
When `faff economics --by model --json` runs
Then there is one row per model, each priced at that model's per-class rate
 And the model rows sum (reconciliation.grand_total) to the top-line total
```

```
Given transcripts containing mcp__* tool_use / tool_result blocks
When `faff economics --by mcp --json` runs
Then each tool row carries call_count, request_bytes, response_bytes, and an est_cache_tokens figure
 And no field of the output contains any transcript payload string (non-leak assertion)
```

```
Given a run with no resolvable session id (CLAUDE_CODE_SESSION_ID unset)
When `faff economics --by class` runs
Then it degrades to source:"estimate" with empty rows and exits 0 (no crash)
```

Non-functional assertions:

- `--by` with an unrecognised axis value exits non-zero and names the legal set `{class, model, mcp, day}`.
- `faff economics` with no `--by` flag produces byte-for-byte the pre-change output.
- No output path (JSON or table, any axis) emits transcript payload content — only counts, sizes, names, model-ids, costs.

## 6. DESIGN DECISION RATIONALE

**Where does per-model × per-class pricing live — code constant, config, or both?**
- *Code-constant only* (reference-script approach): simplest, one source, but not user-tunable.
- *Config-only*: flexible but forces every user to author a price map before costs work.
- *Built-in default + optional config override*: ships working out of the box, tunable when needed. The config parser already handles nested maps / inline-JSON (`parseYamlSubset`), and `models.build_by_confidence` is an existing matcher-over-scalar precedent.
- **Chosen:** built-in `PRICE_PER_MTOK` default map (code constant, seeded from the FAFF-407 reference) **plus** an optional `budget.price_per_mtok_by_model` config override consulted first when present. Precedence: `config[model][class]` → built-in `PRICE_PER_MTOK[model][class]` (dated-suffix-stripped) → `$0`. Rationale: works with zero config, stays configurable per faff's governing principle, and reuses proven parser + precedent shapes.

**Does `--by` reuse the legacy flat `budget.price_per_mtok` scalar?**
- **Chosen:** No. The `--by` breakdown prices via the per-model×class map only; the flat scalar continues to drive the existing top-line `computeUnitEconomics` cost, unchanged. Rationale: a per-mtok flat rate cannot express per-class pricing; conflating them would either break back-compat or silently mis-price. The divergence between the two cost figures is named OUT OF SCOPE (reconciliation is a follow-up).

**Single-run scope vs the reference script's whole-corpus walk.**
- **Chosen:** single-run — the breakdown pivots exactly the run's session-owned transcript set that `measureTokens` sums for this `runDir`. Rationale: preserves economics' single-run identity and guarantees reconciliation to the top-line; corpus-spanning is a different command (OUT OF SCOPE).

**Output: JSON-only vs add a human table.**
- **Chosen:** `--by X --json` → `breakdown` in JSON; `--by X` (no `--json`) → skimmable table via `rendering_adaptor`. The no-`--by` default path stays JSON-only (unchanged). Rationale: a breakdown is a human-scanning artifact; a table is the readable default, JSON the machine path — without disturbing the existing default output.

**Retire `scripts/token-breakdown.mjs`?**
- **Chosen:** keep it as the FAFF-407 spike artifact (referenced by the report); the command is the durable home. Rationale: the ticket permits "kept as the spike artifact only"; deleting it would dangle report references for no benefit.

**Selftest / CI wiring.**
- **Chosen:** extend the existing pure-core `economicsSelftest()` with `--by` reconciliation + ordering cases, and extend `test/economics.test.mjs` (integration, via `fixture()`/`withTranscripts()`) with `--by class|model|mcp|day` cases. `economics --selftest` and `test/economics.test.mjs` already run under the `node --test` CI step in `.github/workflows/validate.yml`, so no new step is strictly required; the build must **confirm** the new selftest cases actually execute in CI and add an explicit `faff economics --selftest` step only if that coverage is not already exercised. Rationale: reuses the wired path; avoids a redundant CI step.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — all decisions are closed above.

**Assumptions:**
- **Assumes:** `scripts/token-breakdown.mjs` exists on the branch base as the reference (it is on `origin/main`; the local checkout was one commit behind at prep time). *Validation:* `git show origin/main:scripts/token-breakdown.mjs` or `ls scripts/token-breakdown.mjs` after pulling `main`; the branch is cut from up-to-date `main`.
- **Assumes:** transcript records carry `message.model` and `timestamp` fields as the reference relies on. *Validation:* inspect a real `~/.claude/projects/<cwd>/<sid>.jsonl` record; the reference's `dayOf`/model extraction already tolerates their absence (`"unknown"`).

## 8. DONE — Definition of Done

### From WHY
- [ ] `faff economics --by class|model|mcp` renders the reconciled breakdown with cost (the FAFF-407 recommendation, landed durably in economics).
- [ ] The breakdown reuses `measureTokens`' file selection + `sumTranscriptFile`'s record rule (no second census).
- [ ] No output path emits transcript payload content — sizes/counts/names/model-ids/costs only (non-leak invariant).
- [ ] `faff economics` with no `--by` flag is byte-for-byte unchanged.

### From WHAT (flags, types)
- [ ] `--by` accepts exactly `{class, model, mcp, day}`; an unrecognised value exits non-zero naming the legal set.
- [ ] `--by X --json` emits a `breakdown` object matching the Breakdown/BreakdownRow/McpRow shape; `--by X` (no `--json`) emits a skimmable table.
- [ ] Built-in `PRICE_PER_MTOK` per-model×class map present; optional `budget.price_per_mtok_by_model` config override consulted first; dated model-suffix stripped; unknown model → `$0`/`cost:null`.

### From HOW (behaviour)
- [ ] `--by class` rows fixed-ordered input/output/cache_write/cache_read; `reconciliation.reconciles === true` when `source==="transcript"`.
- [ ] `--by model` prices each row at its own model; rows sum to the top-line total.
- [ ] `--by day` groups by `YYYY-MM-DD` from `timestamp`, chronological; prices per-model within each day.
- [ ] `--by mcp` reports call_count / request_bytes / response_bytes + an **estimate**-labelled cache figure; ordered by call_count desc.
- [ ] No session id → `source:"estimate"`, empty rows, exit 0 (no crash).

### From HOW (edge cases)
- [ ] Unpriced/unknown model surfaces as `cost:null` (distinct from `0`) with the model-id visible.
- [ ] MCP estimate is explicitly labelled `est_*` / "estimate" in both JSON and table.

### From docs / CI
- [ ] `docs/guide/cli.md` economics row updated to document `--by class|model|mcp|day` and `--json`/table modes; `faff lint-cli-doc` passes.
- [ ] CLI inline help (`usage` block, ~line 5841) updated to match the doc row.
- [ ] `economicsSelftest()` extended with `--by` reconciliation + ordering cases; `test/economics.test.mjs` extended with `--by` integration cases (incl. the non-leak assertion); both confirmed running in CI (`node --test` step in `validate.yml`); add an explicit `faff economics --selftest` CI step only if coverage is not already exercised.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. fixture with a run-ledger + withTranscripts writing records:
       two models, all four token classes, spanning two YYYY-MM-DD days, one mcp__* tool_use/result pair
  2. run economics --by class --json  → assert reconciliation.reconciles === true
  3. run economics --by model --json  → assert one row per model, rows sum to top-line
  4. run economics --by mcp --json    → assert tool row present, no payload string in output
  5. run economics (no --by)          → assert output identical to pre-change baseline
```

## Already shipped against this surface

Related Done work — context, none superseding this ticket's premise:
- **FAFF-357** (Done, PR — economics unit-economics): built `cmdEconomics`/`computeUnitEconomics` and the ledger walk this ticket *extends*. Do not rebuild the walk; add the `--by` pivot alongside it.
- **FAFF-407** (Done, PR #290 — token-usage spike): produced `scripts/token-breakdown.mjs` (the reference implementation) and the report whose recommendation *is* this ticket. Origin, not overlap.
- **FAFF-36** (Done — budget ceiling + transcript summation): owns `measureTokens`/`sumTranscriptFile`/`transcriptBaseDir`, the substrate this reuses.
- **FAFF-408 / FAFF-409** (in this run, not Done): telemetry *producers*; this ticket is their consumer and is deliberately independent of both (phase axis + measured MCP cost are OUT OF SCOPE here).

## ADR promotion intent

- **Per-model × per-class token pricing model** (from §6, DESIGN DECISION RATIONALE → pricing map): faff gains a built-in per-model×class USD price map + an optional `budget.price_per_mtok_by_model` override with a fixed precedence chain. This is cross-slice and durable — future cost surfaces (budget ceilings, an evaluate-cost helper) would inherit this pricing source rather than the legacy flat scalar. Significant enough to record; `/faff-graft` materialises the ADR on the feature branch.

## Methodology critique

Agile-delivery lens (`issue-critique`):

- **Right-sized?** Yes. One cohesive 1–3 day unit: a single `--by` flag family on an existing subcommand, all four axes sharing one transcript walk. Splitting the axes would duplicate the walk scaffolding for no benefit; they always ship together. No split.
- **Workstream fit?** Yes. Sits cleanly in the token-economics/observability workstream (FAFF-357 economics · FAFF-407 spike · FAFF-36 budget · FAFF-408/409 telemetry). Outcome-named, cohesive.
- **Deps surfaced?** Yes, and correctly *not* drawn as blockers. It composes with FAFF-408/409 but is deliberately independent (phase axis + measured MCP cost are OUT OF SCOPE), so it can build and ship on `main` in any order relative to its siblings. No hidden edge.
- **Risk profile?** Low. No novel integration, no external dependency; the FAFF-407 `scripts/token-breakdown.mjs` is a working reference and the substrate (`measureTokens`) is proven. No de-risking spike warranted.

No blocking issues.

## Spec review

spec-review: approve — single-pass, 4 lenses (architectural/infosec/methodology/QA), no objections.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" },
    { "marker": "assumes" }
  ] }
```
