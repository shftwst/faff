# FAFF-415 — Telemetry: record reasoning-effort per dispatch + surface it in `faff economics`

- **Issue:** FAFF-415 (feature) · sibling of FAFF-408 (per-phase token events), FAFF-409 (measured MCP amplification), FAFF-410 (`economics --by`)
- **Confidence:** high

## WHY

Per-slot `{model, effort}` routing (the lever this ticket blocks) is unmeasurable
without capturing which reasoning-effort each dispatch used — you can't route what you
can't attribute. Effort is a real cost lever: reasoning tokens bill as **output**
(\$25/Mtok at Opus) and compound into cache at the ~14× amplification FAFF-407
measured.

## Grounded constraint (decides the architecture)

Reasoning-effort is a **request-time** setting. The transcript `usage` records log
**response** usage only and carry **no effort field** — so effort **cannot** be
recovered from the transcript walk `faff economics --by class|model|mcp|day` uses.
It must be **captured at dispatch time**, riding the `events.jsonl` per-phase token
lane FAFF-408 established. This spec does NOT attempt to derive effort from the
transcript sum.

## WHAT

Two additive changes to the single bundled CLI (`plugin/skills/faff/bin/faff`), plus
tests and docs.

### 1. `faff events append` — accept an optional `data.effort` label

- A new closed vocabulary `EFFORT_LEVELS = {low, medium, high, xhigh, max}`.
- `eventViolations` gains one additive rule: **when `data.effort` is present it must
  be one of `EFFORT_LEVELS`**; absent ⇒ unchanged (byte-identical record, schema
  stays `1`). Non-leak: `effort` is a single label, never payload content.
- The caller (the dispatcher, which knows the effort it chose at request time)
  supplies `data.effort` in the append payload. The existing `--tokens` merge already
  starts `base` from `payload.data`, so `effort` rides alongside `data.tokens` on the
  same phase-closing event with no further append-path change.

### 2. `faff economics --by effort` — a new axis, sourced from `events.jsonl`

Unlike the FAFF-410 axes (which pivot the transcript walk), **`--by effort` reads the
run's `events.jsonl`** — that is the only place effort is recorded. This divergence is
the one real design decision; it is captured in an ADR.

- Add `effort` to the `--by` legal set (`BY_AXES`).
- New pure core `economicsEffortBreakdown(events, priceMap, dominantModel, topLineTotal)`:
  - Bucket every event by `data.effort` (fixed severity order `low, medium, high,
    xhigh, max`); events that carry a `data.tokens` transcript delta but **no**
    `data.effort` fall into a `(none)` bucket so the view stays honest about the
    attribution gap.
  - Per bucket: `count` (number of dispatches) + the summed four-class token delta
    (`data.tokens` transcript deltas only; `null`/estimate deltas count the dispatch
    but contribute 0 tokens).
  - `cost` priced at the run's **dominant model** (from the transcript walk; events
    carry no model) via the FAFF-410 `PRICE_PER_MTOK` map — `null` when the dominant
    model is unknown/unpriced or no transcript is resolvable. Because the pricing model
    is inferred rather than per-record, this cost is an **ESTIMATE** (labelled).
  - Reconciliation reports `events_token_total` (sum of all event deltas) vs the
    transcript `top_line_total` and a `coverage_pct` — because `events.jsonl` only
    captures tagged dispatch windows, effort generally does NOT reconcile to the
    top-line; `coverage_pct` states how much of the run's spend is effort-attributable
    rather than pretending to a false 100%.
- `--by effort --json` rides the same `breakdown` object shape; `--by effort` without
  `--json` prints a skimmable table (rows + coverage line). Source label is `events`
  (distinct from the transcript axes' `transcript`), or `estimate` when no events log
  exists.

### Invariants (unchanged)

- **No `--by` → byte-for-byte unchanged** (always-JSON `UnitEconomics`, no `breakdown`).
- **Non-leak** — counts, sizes, names, model-ids, effort-labels and derived costs
  only; never transcript/event payload content.
- Additive: `schema` stays `1`; every pre-existing event and economics output is
  unaffected.

## HOW

- `plugin/skills/faff/bin/faff`:
  - `EFFORT_LEVELS` const + the `data.effort` rule in `eventViolations` (+ events
    `--selftest` cases: valid label accepted, invalid rejected, effort alongside a
    valid token delta accepted).
  - `economicsEffortBreakdown` pure core + `readRunEvents(runDir)` I/O reader; branch
    in `cmdEconomics` for `byAxis === "effort"` (reads events, derives dominant model
    from the transcript when available); `renderEconomicsBreakdown` effort branch;
    `economics --selftest` cases for the pure core (bucketing, `(none)`, pricing at
    dominant, coverage, non-leak).
- `docs/guide/cli.md`: extend the `economics` and `events` rows for `effort`.
- `docs/adr/0049-*`: the effort axis reads `events.jsonl`, not the transcript.
- `test/economics.test.mjs`: an integration test writing an `events.jsonl` with
  effort-tagged token deltas and asserting the `--by effort` breakdown buckets,
  coverage, and non-leak.

## DONE

- `faff events append` accepts `data.effort ∈ {low,medium,high,xhigh,max}` and rejects
  any other value (exit 1); absent effort is byte-identical to before.
- `faff economics --by effort` buckets a run's effort-tagged dispatches from
  `events.jsonl`, prices them at the dominant model (ESTIMATE), reports coverage vs the
  top-line, and never leaks payload; `--json` and table forms both work.
- No `--by` output is byte-for-byte unchanged.
- Gates green: `lint-cli-doc`, `lint-refs`, `validate-adapters`, `adr validate`,
  `economics --selftest`, `events --selftest`, `node --test` (no new failures vs
  origin/main baseline).
