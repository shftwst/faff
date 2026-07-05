# Cost-per-shipped-issue — per-run unit economics in the run summary

> Spec: faffter-dark-nlspec · 2026-07-04 · autonomous · confidence: high.

This spec defines a **per-run unit-economics block** for the `/faff-beep-boop` run summary (and its tracker digest). It is a **pure rendering/derivation** slice — it composes data faff already produces (the run ledger, `faff budget check`'s transcript-summed tokens, and the per-subagent transcript files) into **cost-per-shipped-issue** + **cost-per-attempt**.

## 1. WHY — Problem and Principles

faff already *measures* everything needed to price a run — the run ledger records which issues shipped/parked/errored, and `faff budget check` already sums this run's tokens (orchestrator transcript + every owned child `agent-*.jsonl`, baselined at run start via `tokens_at_start`). What's missing is a **derivation-and-render step** that divides that spend across the ledger's terminal buckets and prints *cost-per-shipped-issue* + *cost-per-attempt*. No new meter is built; an existing meter's reading is *attributed and displayed*.

**Design principles.**

- **Deterministic tools over prose.** The arithmetic belongs in the `faff` CLI as a pure subcommand, not in beep-boop prose. The LLM renders the returned block; it never computes.
- **Rendering only — producers stay untouched.** `faff budget check`, the ledger writer, and the events log are **not modified**.
- **Degrade honestly, never fabricate.** When `price_per_mtok` is unset, render token figures only. When per-issue attribution data is absent, render the run-level figure and omit the per-issue number. Carry the `tokens_source` label (`transcript` vs `estimate`).

## 2. OUT OF SCOPE

- Rolling / last-N-runs cost trend in `/faff-wtf` (named follow-up).
- New measurement machinery.
- Storing the cost/total in the ledger or an event.
- Per-issue attribution for non-build subagents.
- Real CI/compute-dollar metering.

## 3. WHAT — Types

A `faff economics --run-dir <dir> [--json]` subcommand, pure and read-only like `budget check` / `runcheck` — no tracker call, no network, no LLM. It reads the run ledger + calls the existing token-measurement path + optionally scans meta.json, and emits a **UnitEconomics** JSON block.

```
RECORD UnitEconomics:
  run_id, tokens_total, tokens_source, price_per_mtok, cost_total (null when price=0),
  buckets: List<BucketLine{bucket,count}>, shipped_count, attempt_count,
  cost_per_shipped: UnitCost | null, cost_per_attempt: UnitCost | null,
  per_issue: List<IssueCost{issue,bucket,tokens,cost}>, zero_ship: boolean, warnings: List<string>
RECORD UnitCost: denom, tokens_each, cost_each (null when price=0)
```

**Chosen decisions:** derive-at-render (ledger stays minimal); per-bucket **counts** always, per-bucket token/cost only as an aggregate of successfully-attributed issues (`—` where none); subcommand name `faff economics`.

## 4. HOW — Behaviour

At run-end, in beep-boop's `## Reporting` step, the orchestrator calls `faff economics --run-dir <run-dir> --json`. The subcommand:

1. Read run-ledger.json.
2. Derive run token spend + source via the same token path budget check uses (measureTokens over the run's session transcript + owned child agent-*.jsonl, baselined by ledger.budget.tokens_at_start).
3. price := ledger.budget.envelope.price_per_mtok (default 0). cost_total := price>0 ? tokens_total/1e6×price : null.
4. Tally buckets from ledger.outcomes (non-empty only). shipped_count := outcomes==shipped; attempt_count := outcomes NOT IN {routed-out, unreached-budget}.
5. cost_per_shipped / cost_per_attempt := UnitCost divided by respective denom, or null when denom 0.
6. Best-effort per-issue attribution (below).
7. zero_ship := shipped_count==0 AND tokens_total>0.
8. warnings: push inflation warning when tokens_at_start==0 with spend.

**Per-issue attribution.** For each `agent-*.jsonl` whose `childOwningSession == run session id`, read sibling `agent-*.meta.json`; extract first `[A-Z]+-\d+` in `description`; skip when absent, non-issue, or not a ledger outcome key; else sum its tokens → IssueCost.

**Rendering in beep-boop.** A `## Unit economics` section immediately after the `Stop reason:` block: run spend + source (+ `· $X` when priced), cost-per-shipped (loud `⚠ ZERO-SHIP` when zero_ship), cost-per-attempt, per-bucket counts, per-issue attributed line (omitted when empty), inflation warning when present.

**Tracker digest.** One condensed line appended: `Economics: <tokens_total> tokens (<source>)[, $<cost_total>] · <shipped_count> shipped · <cost_per_shipped or ZERO-SHIP>`.

**Edge cases.** price=0 → cost null, no dollar column, never `$0.00`; estimate source → labelled, per-issue skipped; zero attempts → cost_per_attempt null; tokens_at_start=0 with spend → inflation warning; per_issue empty → omit line; empty ledger → run spend + "no build outcomes this run" note.

**Anti-patterns:** dividing run total evenly across buckets to fabricate a per-bucket split; adding fields to the ledger or events.

## 5. SCENARIOS

- 2 shipped / 12M tokens / price unset → run spend 12M (transcript), cost-per-shipped 6M tokens/issue, no dollar column.
- 0 shipped / 17M tokens → zero_ship true, loud `⚠ ZERO-SHIP`.
- price=5 / 1 shipped / 4M tokens → cost_total $20.00, cost_per_shipped "4M tokens · $20.00".
- attributed subagents → per-issue token figures; subagent with no issue id contributes to run total but no per-issue line.

Assertions: pure (no tracker/network/LLM); run-level figures never depend on meta.json; producers byte-unchanged.

## 8. DONE

- [ ] Pure `faff economics --run-dir <dir> [--json]` subcommand emits UnitEconomics JSON matching the record shape.
- [ ] `attempt_count` excludes routed-out + unreached-budget.
- [ ] `cost_*` null and no dollar column when price=0; cost twins when >0.
- [ ] `--selftest` covers priced/unpriced, zero-ship, zero-attempt, tokens_at_start=0 warning, empty/absent per-issue.
- [ ] Pure — no tracker/network/LLM.
- [ ] Run-level figures render identically regardless of per-issue attribution.
- [ ] beep-boop `## Reporting` calls `faff economics` and renders a `## Unit economics` section.
- [ ] Tracker status update carries condensed one-line form.
- [ ] Per-issue attribution reads meta.json gated by session ownership, matching `[A-Z]+-\d+`.
- [ ] zero_ship renders loudly; estimate surfaced; tokens_at_start=0 warns; empty ledger renders without erroring.
- [ ] `budget check`, ledger writer, events log byte-unchanged (verified by diff).
- [ ] REGION_MAP + REGION_SELFTEST_ARGV register `economics` (factory); docs/guide/cli.md row added.

confidence: high
spec-review: approve
