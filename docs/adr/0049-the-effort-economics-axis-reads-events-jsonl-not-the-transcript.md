# ADR 0049 — The effort economics axis reads events.jsonl, not the transcript

- **Status:** Proposed
- **Date:** 2026-07-09
- **Issue:** FAFF-415

## Context

`faff economics --by class|model|mcp|day` (ADR-0048 / FAFF-410) all pivot the SAME
transcript walk `budget check` sums, so each axis reconciles to the top-line token
total by construction. That works because class, model, day and MCP-tool are all
recoverable from the transcript `usage`/content records.

Reasoning-effort is different in kind: it is a **request-time** setting. The
transcript records only **response** usage and carry **no effort field** (verified: 0
transcript records mention effort). Effort therefore cannot be recovered from the
transcript walk at all — a `--by effort` axis modelled on the other axes would have
nothing to pivot on. Effort is only knowable at **dispatch time**, where FAFF-408
already established a per-phase telemetry lane: `events.jsonl`, whose phase-closing
events carry a four-class token delta. FAFF-415 tags those same events with the
effort the dispatcher chose.

## Decision

`faff economics --by effort` is the **one `--by` axis that reads the run's
`events.jsonl` rather than the transcript walk**. It buckets dispatch events by their
`data.effort` label, sums the `data.tokens` deltas each carries, and:

- prices each bucket at the run's **dominant model** (derived from the transcript;
  events carry no model), so the cost is explicitly an **ESTIMATE** (`cost_basis:
  "estimate"`) — one inferred rate card, not a per-record price;
- reports **`coverage_pct`** (events token total ÷ transcript top-line) instead of a
  boolean reconciliation, because `events.jsonl` only captures tagged dispatch windows
  and generally does NOT span the whole run. `reconciles` stays available (true only
  when the tagged deltas happen to equal the top-line) but the honest figure is
  coverage;
- rolls untagged-but-token-bearing events into a trailing `(none)` bucket so the
  attribution gap is visible rather than hidden.

The source label is `events` (distinct from the transcript axes' `transcript`), and
the axis degrades to `source: "estimate"` with empty rows when no `events.jsonl`
exists.

## Consequences

- **Effort becomes a first-class queryable dimension** — the per-slot `{model,
  effort}` routing lever this ticket blocks can now attribute spend to the effort that
  produced it, which was impossible from the transcript alone.
- **A `--by` axis deliberately breaks the FAFF-410 reconcile-by-construction
  invariant** — that invariant held only because those axes shared the transcript
  source. The effort axis names its divergence loudly (`source: "events"`,
  `cost_basis: "estimate"`, `coverage_pct`) so a reader never mistakes an
  events-derived partial view for the transcript-summed whole.
- **Attribution is only as complete as dispatch tagging** — effort telemetry covers
  exactly the dispatches whose emitter tagged the phase event. Coverage < 100% is
  expected and reported, not an error; the `(none)` bucket quantifies the untagged
  remainder.
- **Non-leak holds unchanged** — effort is a single closed-vocab label; the axis emits
  only counts, token totals, labels, the model-id and derived cost, never payload.
- **Additive** — `events append` still accepts effort-free payloads byte-identically
  (schema stays `1`), and `economics` with no `--by` is unchanged.
