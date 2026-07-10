# ADR 0051 — Quality telemetry is a separate `faff quality` command riding the issue-outcome event

- **Status:** Proposed
- **Date:** 2026-07-09
- **Issue:** FAFF-418

## Context

The cost half of faff's cost/quality loop is instrumented end to end: `faff
economics` (FAFF-357/410) reports cost-per-shipped/attempt and pivots token spend by
class/model/mcp/day/effort. The **quality half** — did a build ship, park, or get
caught by a gate, and at what rework cost — was measured only manually inside
FAFF-411. FAFF-413 ("route on observed outcomes") cannot be built until those
outcomes are logged durably and queryably. This ADR settles two design questions the
ticket left open: **where the quality report lives**, and **where "which gate caught
it" is recorded**.

## Decision

**1. Quality is a new pure `faff quality` command, not folded into `economics`.**

`economics` is cost-shaped: every `--by` axis pivots *token totals* and prices them,
and its no-`--by` output is a contract that must stay byte-identical. A quality view is
rates-and-distributions (park rate, rework rate, gate-catch distribution) — not token
buckets. Folding it in would either mutate that byte-identical output (forbidden by the
ticket) or bolt on an axis that does not pivot tokens. So quality is its own read-only
command. The `$/quality` pairing the ticket wants is achieved not by duplicating cost
into quality but by **both commands sharing the run ledger, the same `run_id`, and the
exact same shipped/attempt denominators** (`ECONOMICS_BUCKET_ORDER` +
`BUDGET_NON_ATTEMPT_OUTCOMES`). A reader composes `economics.cost_per_shipped` with
`quality.park_rate` on one run and the two reconcile by construction.

**2. "Which gate caught it" and "rework turns" ride the existing `issue-outcome`
event's `data`, not a new event type or an artifact scrape.**

The orchestrator already emits exactly one `issue-outcome` event per issue
(single-writer, FAFF-35). Two optional, additive fields go on that same terminal
event (schema stays `1`):

- `data.gate` — the quality gate that caught a non-shipped build, from a closed
  vocabulary `{structural, adversarial, holdout, ci}`.
- `data.rework_turns` — a non-negative integer count of gate-driven fix-and-re-run
  loops (clean first pass = `0`).

The build-time sources of truth (`review-verdict.json`, `ac-checklist.json`, the
holdout verdict) are unchanged; the event is their durable, queryable projection.

## Consequences

- **Quality becomes a first-class queryable dimension** — the outcome-based routing
  FAFF-413 needs can now read a park/rework/gate record instead of re-deriving it by
  hand, and can be read against cost on the same run.
- **`economics` stays byte-identical** — no axis, no output, no producer of it
  changes; quality is strictly additive alongside it.
- **The event schema stays frozen at `1`** — `gate`/`rework_turns` are optional
  `data` fields, exactly like the FAFF-408 `tokens` and FAFF-415 `effort` tags; an
  emitter that omits them produces a byte-identical record, and older `events.jsonl`
  with no such fields still reports (quality degrades to `source: "ledger"`, outcome
  buckets only).
- **Denominator coupling is deliberate** — quality reuses economics' attempt/shipped
  derivation rather than defining its own, so the two telemetry halves can never drift
  into disagreeing on how many builds a run attempted.
- **Non-leak holds** — gate names, outcome names, counts and rates only; never
  payload, parity with economics.
