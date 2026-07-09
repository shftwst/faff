# FAFF-418 — Quality/outcome telemetry (the quality mirror of economics)

- **Issue:** FAFF-418 · **Type:** feature · **Blocks:** FAFF-413 · **Mirrors:** FAFF-415
- **Confidence:** high

## WHY

The cost half of the cost/quality loop is fully instrumented (`faff economics` +
FAFF-408/410/415). The **quality half is a stub**: whether a build shipped, parked,
or was caught by a gate — and how much rework it took — is measured only *manually*
inside FAFF-411. A cost-only loop optimises toward *cheap-but-worse* and cannot see
it happening: a cheaper build model that parks/reworks more is net-negative, and
nothing surfaces that automatically. FAFF-413 ("route on observed outcomes") **cannot
be built until outcomes are logged**. This ticket makes the quality record durable and
queryable, exactly as economics did for cost.

## WHAT

Two additive pieces, both riding lanes that already exist:

1. **Log** — extend the FAFF-35 `events.jsonl` `issue-outcome` event with two
   **optional, additive** `data` fields (schema stays `1`):
   - `data.gate` — *which quality gate caught the failure*, a closed vocabulary
     `structural | adversarial | holdout | ci`. Present only on a non-shipped outcome
     that a gate caught; absent when nothing caught it (a clean ship, or a
     non-gate park such as budget/ambiguity).
   - `data.rework_turns` — a non-negative integer: the number of fix-and-re-run
     loops the build took after a gate flagged a defect (a clean first pass = `0`).
   The terminal **outcome** itself is already logged (ledger `outcomes` map +
   `issue-outcome.data.outcome`), so no new store and no new event type.

2. **Report** — a new pure `faff quality [--run-dir DIR] [--json]` subcommand that
   reads the run ledger (authoritative terminal outcomes) + `events.jsonl` (gate /
   rework detail) and emits a `QualityReport`: outcome buckets, `park_rate`,
   `rework` rollup, and a `gate_catch` distribution. Pairs with `economics` by
   **sharing `run_id` and the exact shipped/attempt denominators** (same
   `ECONOMICS_BUCKET_ORDER` + `BUDGET_NON_ATTEMPT_OUTCOMES`), so `$/quality` =
   `economics.cost_per_shipped` read beside `quality.park_rate` — no cost duplicated
   into quality.

Non-leak parity with economics: outcomes / gate-names / counts only, never payload.

## HOW

### Resolved open questions (from the ticket)

- **New subcommand vs fold into `economics`?** → **New `faff quality` subcommand.**
  `economics` is cost-shaped: every `--by` axis pivots *token totals* and prices
  them. A quality view is rates-and-distributions, not token buckets — folding it in
  would either change economics' byte-identical output (forbidden) or bolt an
  ill-fitting axis on. A separate pure command that shares the run ledger and the
  same denominators keeps both lean and lets a caller read them together. See ADR 0051.
- **Where "which gate caught it" is recorded?** → on the **`issue-outcome` event's
  `data.gate`**, not a new event type and not a private artifact scrape. The
  orchestrator already emits exactly one `issue-outcome` per issue (single-writer);
  attaching the catching gate to that same terminal event is the minimal additive
  change. `review-verdict.json` / `ac-checklist.json` / the holdout verdict remain the
  build-time *source of truth* the orchestrator reads the gate from; the event is the
  durable, queryable projection.
- **Counting rework turns unambiguously?** → `rework_turns` = **the count of
  fix-and-re-run loops driven by a failing gate** (each review `fail` → iterate, and
  each post-PR CI-red → fix push). A build that passed every gate first time is `0`.
  Review *rounds* and iterate-fix pushes both count; independent, non-gate commits do
  not.

### Command shape

`cmdQuality(args)` — pure, read-only (no tracker/network/LLM; parity with
`economics`/`budget check`/`runcheck`):

- Resolve the run dir exactly as `economics` does (`--run-dir` → `$FAFF_RUN_DIR` →
  `latestRunDir`); missing → exit 2.
- `readLedger(runDir)` (unreadable → exit 2) + `readRunEvents(runDir)` (absent →
  empty, `source: "ledger"`).
- `computeQualityReport(ledger, events)` — a **pure core** (no I/O) so `--selftest`
  drives it, returning:

```
{
  run_id,
  outcomes: [{ bucket, count }, …],          // ECONOMICS_BUCKET_ORDER, ledger-authoritative
  shipped_count, attempt_count,              // identical derivation to economics
  parked_count,
  park_rate,                                 // parked / attempt_count, null when attempt_count==0
  rework: { total_turns, reworked_attempts, rework_rate, mean_turns, tagged_attempts },
  gate_catch: [{ gate, count }, …],          // from issue-outcome data.gate, fixed gate order
  per_issue: [{ issue, outcome, gate?, rework_turns? }],
  source,                                    // "ledger+events" | "ledger"
  warnings: [],
}
```

- Rates use `attempt_count` (dispatched builds — outcomes minus
  `BUDGET_NON_ATTEMPT_OUTCOMES`) as the denominator, matching `economics`'
  `cost_per_attempt` so the two reconcile by construction. `attempt_count == 0` →
  rates `null` (never `0/0`).
- `gate_catch` / `rework` derive from `issue-outcome` events; on a run with no
  `events.jsonl` (`source: "ledger"`) they degrade to `gate_catch: []` and
  `rework.*: null` — the outcome buckets (from the ledger) still render.
- `--json` prints the `QualityReport`; no flag prints a skimmable table
  (`renderQualityReport`). `--selftest` runs the pure-core table.

### Schema validator (event lane)

In `eventViolations`, add — only when the field is present on an event whose
`data` is an object:

- `data.gate` (any event type; enforced meaningfully on `issue-outcome`) must be a
  string in `GATE_CATCH_VOCAB = {structural, adversarial, holdout, ci}`.
- `data.rework_turns` must be a non-negative integer.

Both are optional and coexist with the existing `data.tokens` / `data.effort` tags;
`schema` stays `1`. Absent fields ⇒ record byte-identical to before.

### Prose wiring (lean, additive)

Extend the beep-boop `issue-outcome` events-table note: when emitting `issue-outcome`
for a non-shipped build, also carry `data.gate` (the gate that caught it, from the
build return token / `review-verdict.json` / holdout verdict) and `data.rework_turns`
(the build's fix-loop count). One additive sentence; no existing prose changes.

## DONE

- `faff quality --selftest` passes (priced/unpriced-agnostic; covers zero-attempt,
  empty ledger, events-vs-ledger source, gate distribution, rework rollup).
- `faff quality --run-dir <dir> --json` emits the `QualityReport`; no-flag prints a
  table; missing run dir exits 2.
- `faff events append` accepts `data.gate` (valid vocab) + `data.rework_turns`
  (non-negative int), rejects an off-vocab gate / negative / non-integer rework; a
  gate/rework-free payload stays byte-identical. `events --selftest` covers all.
- `economics` output byte-identical (no `--by` and every axis); `economics
  --selftest` still passes.
- `docs/guide/cli.md` gains a `faff quality` row and the extended `events` note;
  ADR 0051 records the two design decisions. `node --test`, `lint-cli-doc`,
  `lint-refs`, `validate-adapters`, `adr validate` all green.
- Non-leak: only counts / gate-names / outcome-names / rates emitted.
