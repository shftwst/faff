# FAFF-640 — `economics --by class` / `--by day` must count engine spend, not just claim to

> Spec: faffter-dark-nlspec · 2026-07-25 · interactive · confidence: high

This spec is for the build agent implementing FAFF-640, and for the reviewer checking it. It changes the pure breakdown core in `plugin/skills/faff/bin/lib/economics.js` and the engine-spend reader in `plugin/skills/faff/bin/lib/budget.js`.

## 1. WHY — problem and principles

**The load-bearing idea:** an axis breakdown reconciles by comparing *its own rows* against *a top-line target*. FAFF-604 widened the target for the `model` axis (target = transcript total + engine spend) but left `class` and `day` summing transcript rows against a transcript-only target — so they still report `reconciles: true` while measuring a strictly smaller population than the `tokens_total` an operator just read at the top of the same output.

**Problem.** On a mixed fleet (Claude transcript plus a spawned codex lane), `faff economics --by class` and `--by day` show a `grand_total` with the codex tokens missing, next to an explicit `reconciles: true`. The operator has no way to tell the census is partial — `source` says `"transcript"` on both, but nothing says "and there is a second source you are not seeing". This change folds engine spend into both axes so every non-mcp axis measures the same population the top line does.

**Design principles.**

**Reconciliation is a claim about coverage, not about arithmetic.** `reconciles: true` currently means "these rows add up to a number I chose to compare them against". If the axis can pick its own target, the flag is unfalsifiable. Every axis that reconciles against a top line must reconcile against *the* top line — the one including engine spend.

**Never price one engine's tokens at another engine's rate.** The existing `priced_at_model` approximation is acceptable *within* the transcript population (one fleet, similar rates). Extending it across a codex lane would be a silent mispricing, which is the same class of quiet dishonesty this ticket exists to remove.

**A transcript-only run must still emit byte-identical JSON.** FAFF-604 established this and its tests enforce it. Every change here is gated on `engineSpend.records > 0` / a non-zero engine fold, so a single-source run's output — down to absent keys and exact float values — is unchanged.

**Reference context.**

| Location | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/economics.js:347-454` | `economicsBreakdown` — the pure core; class branch `:394-404`, model branch `:405-420`, day branch `:421-433` |
| `plugin/skills/faff/bin/lib/economics.js:440-451` | The bug: `engineFolded` gated `axis === "model"`; `out.source` derived from it |
| `plugin/skills/faff/bin/lib/economics.js:944-949` | `cmdEconomics` already passes `engineSpend` for every axis — class/day ignore an argument they are handed |
| `plugin/skills/faff/bin/lib/economics.js:199-204` | `economicsDayOf` — day key is the leading `YYYY-MM-DD` of the record timestamp, else `"unknown"` |
| `plugin/skills/faff/bin/lib/economics.js:687-695` | Generic class/day/model renderer; class header prints `(priced at X)` |
| `plugin/skills/faff/bin/lib/budget.js:624-650` | `readEngineSpend` — reads `ts` into `rec` but never retains it |
| `plugin/skills/faff/bin/lib/budget.js:660-696` | `measureRunSpend` — reads only named fields off the reader's result |
| `plugin/skills/faff/bin/lib/engine-codex.js:236-245` | The writer: `ts` is `new Date().toISOString()`, plus the four token classes |
| `plugin/skills/faff/bin/lib/economics.js:553-608` | `--by effort` — the honest-partial-coverage precedent (`coverage_pct`, nullable `reconciles`) |
| `test/economics.test.mjs:321-345`, `:777-795` | Existing class-axis reconciliation test (transcript-only) and the FAFF-604 mixed-fleet model-axis test |

**Scope.** One reporting command's data layer. Nothing here touches the budget governor, ceilings, or the writer — the numbers gated on are already combined (`budget.js:1003`).

## 2. Out of scope

- **The `--by mcp` axis.** Its census is per-tool cache-read attribution inside a transcript; a codex lane produces no MCP blocks to attribute. Extension point: `economicsMcpBreakdown` (`economics.js:460`).
- **The `--by effort` axis.** Reads `events.jsonl`, already reports `coverage_pct` and a nullable `reconciles`. Untouched.
- **The estimate path.** When the transcript is unresolvable, `cmdEconomics:940-942` short-circuits every axis to empty rows and `reconciles: false` — even with measured engine spend on disk. A lost-data gap, not a false claim, so a different ticket. Extension point: the `measuredSource !== "transcript"` branch at `economics.js:940`.
- **The `--by model` source label never reaching the text table** — FAFF-641 owns it. This spec touches only the class-axis header line (`economics.js:688`).
- **The raw-vs-baselined asymmetry.** The axis target is `measuredTotal`, the *raw* transcript sum, not the run-delta `tokens_total`. Pre-existing (`economics.js:918-920`), unchanged, and orthogonal — the engine half needs no baseline either way, being run-scoped (`budget.js:604-606`).

## 3. WHAT — vocabulary, types, interfaces

| Term | Meaning |
|---|---|
| Transcript half | Tokens summed from the session-owned `*.jsonl` transcripts |
| Engine half | Tokens read from the run's `engine-spend.jsonl` |
| Fold | Adding the engine half into an axis' rows *and* into that axis' reconciliation target, together |
| Mixed fleet | A run where both halves are non-empty |

**Reader result — one additive field.**

```
RECORD EngineSpendRead:                    # budget.js readEngineSpend, extended
  totals:    ClassCounts                   # unchanged
  by_model:  Map<ModelId, ClassCounts>     # unchanged
  by_day:    Map<DayKey, Map<ModelId, ClassCounts>>   # NEW, additive
  engines:   List<String>                  # unchanged
  records:   Int                           # unchanged
  malformed: Int                           # unchanged

  DayKey = leading "YYYY-MM-DD" of rec.ts, else "unknown"   # same rule as economicsDayOf
  CONSTRAINT sum over by_day == sum over by_model == totals
```

**Chosen:** fold engine spend into `class` and `day` (ticket option 1), rather than keeping them transcript-only behind a loud exclusion (option 2). Rationale: the top line, `--by model`, and the budget governor all already measure the combined population. A fourth "transcript-only" population reachable only from two of five axes is a trap for the reader, and a `covers:` field would document the inconsistency rather than remove it. Loud exclusion is also strictly more code on the class axis than folding is — the four class buckets already exist in `engineSpend.totals`.

**Chosen:** extend `readEngineSpend` with an additive `by_day`, rather than adding a second reader. Rationale: every consumer reads named fields off the result object — `measureRunSpend` (`budget.js:666-677`), `cmdBudget` (`budget.js:1000-1013`, `:1068`, `:1203-1207`), `cmdEconomics` (`economics.js:781-840`). None enumerates keys, none serialises the object wholesale. A second reader would double-parse the same file and let the two views drift.

**Chosen:** `by_day` is nested day → model → counts, mirroring the transcript's `byDay` shape (`economics.js:351`), so the day axis' existing per-model pricing loop (`:425-430`) prices engine rows at their own model with no new pricing code.

**Chosen:** the class axis keeps `priced_at_model` with exactly its current meaning — the *transcript* half's dominant-model pricing basis — and prices the engine half per its own model, summing the two. Rationale: this preserves byte-identical output for transcript-only runs (adding zero), never prices codex tokens at a Claude rate, and avoids the alternative (switching the whole class axis to exact per-model pricing) which would silently change the cost figures of existing multi-model transcript-only runs.

**Chosen:** `out.source` becomes `"transcript+engine-spend"` for class and day too, on the same `engineFolded > 0` condition already used for the model axis — the vocabulary is unchanged, only the axis gate is removed.

**Assumes:** the resolved price map (ADR-0048, `resolveEconomicsPriceMap`) contains rates for the models named in `engine-spend.jsonl`. *Validation:* the existing unpriced-engine warning path already covers the miss (`economics.js:816-828`) — the build agent should confirm a folded-but-unpriced engine model produces `cost: null` on the affected rows rather than a confident understatement.

## 4. HOW — behaviour

```
PROCEDURE readEngineSpend(runDir):          # budget.js — additive
  1. Build by_day alongside by_model in the SAME record loop
  2. day = leading YYYY-MM-DD of rec.ts if it matches, else "unknown"
  3. Accumulate the four classes into by_day[day][model], same guards as by_model
  4. Return by_day as a new key; every existing key and value is unchanged
```

```
PROCEDURE economicsBreakdown(..., engineSpend):     # economics.js
  1. engineFolded := total of engineSpend.by_model  (drop the axis === "model" gate)
  2. class axis, when engineFolded > 0:
     a. Row total := transcript byClass[cls] + engine totals[cls]
     b. Row cost := transcript part at priced_at_model + engine part per engine model
     c. Row cost := null if EITHER part carries tokens it cannot price
     d. priced_at_model unchanged — it still names the transcript half's basis
  3. day axis, when engineFolded > 0:
     a. For each (day, model, counts) in engineSpend.by_day: merge into the day's
        model map, creating the day row if absent
     b. The existing per-model cost loop prices engine models at their own rate
     c. Rows stay sorted by day ascending; a day present only in engine spend appears
  4. target := topLineTotal + engineFolded          (unchanged expression, wider reach)
  5. out.source := engineFolded > 0 ? "transcript+engine-spend" : "transcript"
```

**Renderer — one line.** When the class axis' `source` is `"transcript+engine-spend"`, the header at `economics.js:688` reads `(priced at X · engine spend priced per engine model)`. Everything else in `renderEconomicsBreakdown` is untouched.

**Edge cases.**

- **Engine record with a missing or unparseable `ts`** → day `"unknown"`, matching `economicsDayOf`'s fallback. It still counts toward the grand total, so reconciliation holds.
- **Malformed engine lines** are skipped and counted as today. The same reader result feeds both the top line and the fold, so an under-read under-reports both sides equally and reconciliation stays true.
- **Engine spend present, transcript empty but resolvable** → transcript rows zero, engine rows carry the total, axis reconciles against `0 + engineFolded`.
- **Class row where the transcript half is unpriceable but the engine half is priceable** → `cost: null`. Reporting only the engine portion would be a confident understatement, the same failure `cmdEconomics:829-836` already refuses at the top line.
- **Day rows keep their existing `anyPriced` convention.** This differs from the class rule above; it is pre-existing behaviour on that axis and is deliberately not changed — changing it would move numbers on transcript-only runs.

**Anti-pattern:** recomputing engine totals inside `economicsBreakdown` from anything other than the `engineSpend` object handed in. Why: the top line and the fold must come from one read, or a concurrent append between two reads makes `reconciles` flap.

**Anti-pattern:** adding a `covers:` field or a warning *as well as* folding. Why: once the population matches, a coverage caveat describes a problem that no longer exists, and readers learn to ignore it.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run with both a session transcript and engine-spend records
When faff economics --by class --json is run
Then the four class rows sum to (raw transcript total + engine-spend total),
     reconciliation.reconciles is true against that same target,
     and breakdown.source is "transcript+engine-spend"
```

```
Given engine-spend records timestamped on a day the transcript has no records for
When faff economics --by day --json is run
Then that day appears as its own row carrying the engine tokens,
     rows stay sorted by day ascending,
     and the grand total still equals the combined top line
```

- A transcript-only run's `--by class` and `--by day` JSON is byte-identical to the pre-change output.
- `readEngineSpend`'s existing return keys and values are unchanged for every input; `by_day` totals equal `by_model` totals equal `totals`.

## 6. Design decision rationale

**Fold, or make the exclusion loud?** Loud exclusion is cheap and honest but freezes a second population into the tool permanently, and the operator still cannot get a complete class or day view anywhere. **Chosen:** fold — the top line already includes engine spend; an axis that reconciles against it must measure it.

**Per-model pricing on the class axis, or keep `priced_at_model`?** Exact per-model pricing is correct but changes cost values on existing multi-model transcript-only runs — a silent numeric regression for everyone, to fix a mixed-fleet problem. **Chosen:** transcript half at `priced_at_model`, engine half at its own rate, summed.

**Extend `readEngineSpend`, or add a reader?** **Chosen:** extend, additively — the contract other callers depend on is field-access only, verified across all three call sites.

## 7. Open questions and assumptions

**Open questions:** none.

**Assumptions:** the price map resolves the engine lane's model ids — see the **Assumes:** in section 3, with its validation instruction.

## 8. DONE

### From WHY
- [ ] On a mixed-fleet run, `--by class` and `--by day` `reconciliation.grand_total` equals `top_line_total`, and that target includes the engine-spend total.

### From WHAT
- [ ] `readEngineSpend` returns `by_day` as `Map<day, Map<model, counts>>`; summing it equals `by_model` and `totals`.
- [ ] Every pre-existing key of `readEngineSpend`'s result is unchanged in name and value.
- [ ] `breakdown.source` is `"transcript+engine-spend"` for class, day, and model when the fold is non-zero, `"transcript"` otherwise.
- [ ] `priced_at_model` still names the transcript half's dominant model on mixed and transcript-only runs alike.

### From HOW
- [ ] `engineFolded` is computed for every axis, with no `axis === "model"` gate.
- [ ] Class row totals equal transcript class counts plus engine class counts.
- [ ] Class row cost equals transcript-at-dominant plus engine-at-own-model; `null` when either token-bearing part is unpriceable.
- [ ] Day rows merge engine counts into the matching day's model map; a day present only in engine spend appears as its own row.
- [ ] The class-axis text header names the per-engine pricing when source is `"transcript+engine-spend"`.
- [ ] An engine record with a missing/malformed `ts` lands in `"unknown"` and still counts toward the grand total.
- [ ] A malformed engine-spend line is skipped, counted, warned about; reconciliation still holds.

### Parity
- [ ] The existing transcript-only assertions at `test/economics.test.mjs:321-345` and `:397-411` pass unchanged, including exact `grand_total`, `source`, and `priced_at_model`.
- [ ] A transcript-only `--by class --json` and `--by day --json` run emits byte-identical output to the pre-change binary.

### Tests to add
- [ ] Mixed-fleet `--by class --json`: combined grand total, `reconciles: true`, `source: "transcript+engine-spend"`.
- [ ] Mixed-fleet `--by day --json`: engine-only day row present, ordering held, combined grand total.
- [ ] Mixed fleet with differing rates: class row cost equals the two-part sum.
- [ ] `readEngineSpend` selftest: `by_day` totals reconcile to `by_model`; a `ts`-less record buckets to `"unknown"`.

confidence: high

---

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized?** No issues. One coherent concern: two axes learn to fold in the half of the census they currently ignore. Touching `economics.js` and `budget.js` is expected for a change of this shape, and the extension is symmetric with work already done for the model axis. Comfortably a 1–3 day unit. Worth putting a size estimate on it so the sequencing against 641 and 642 is honest rather than implied.

**Workstream fit?** Belongs with 641 and 642, not in the portability project. These three deliver one observable outcome: after a mixed-fleet run, the spend numbers can be acted on. That is a different outcome from "the harness runs anywhere", which is what FAFF-604's project promises. Dropping all three into "Harness portability — L2/L3 anywhere" gives that container two outcomes and no meaningful completion bar. The cleaner home is a follow-up outcome project — "mixed-fleet spend you can trust", or whatever wording fits — holding 640, 641 and 642. That is a proposal, not a call to make from here; if the portability project's Definition of Done already names spend reporting, this read is wrong.

**Deps surfaced?** One real implicit edge. The spec treats 641 as unrelated, and in the narrow "does my code call their code" sense that's true. But 640 changes the meaning of two things 641 is about to put on screen. First, `priced_at_model`: a class row's cost becomes a sum of two rates, and the label no longer explains the number beside it — which is exactly what 641's summary line renders. Second, per-row `source`: today it is a per-row field only on the model axis, where each row is genuinely single-source. Fold engine spend into class and day and every row becomes an aggregate of both, so there is no single value for a per-row source column to carry.

Neither is a reason to merge. It is a reason to link **640 blockedBy 641** and land 641 first — it's cheap, high confidence, and it puts the rendering surface in place before the data underneath goes mixed. Then 640 carries the acceptance criterion that class/day rows render a truthful source and the priced-at label does not claim the engine half.

There is also a light collision with 642: 640 extends `readEngineSpend` while 642 adds an `attribution` field to each spend record. Both touch the engine-spend record and its reader. Additive on both sides, so not a blocker — but they shouldn't be in flight at the same time without one of them owning the record shape.

**Risk profile?** One thing to name. Changing what class and day reconcile against means a run that previously reported `reconciles: true` can flip, with no change to the run itself. The model axis already carries a stated byte-identical guarantee for transcript-only runs. Carry that guarantee explicitly into this ticket's acceptance criteria for the class and day axes too, and make sure the selftest cases pin it. That's where a silent regression would hide.

---

## Spec revision — folded from spec review (2026-07-25)

Amends the spec comment above. The spec-review gate returned `revise` with one major objection; this resolves it, and the spec is `approve` as amended.

**Objection (architectural, major):** no per-row `source` for folded class/day rows — FAFF-641's `mixed` rendering has nothing to render.

FAFF-641 specifies that a row drawing on both censuses carries `source: "transcript+engine-spend"` and renders `mixed`, and treats answering that as what makes this ticket a no-further-change landing. As written, this spec produces no such field: §4 step 5 sets only the axis-level `out.source`, and §3's record shape, the HOW, and the whole DONE list never mention a per-row source on class or day rows. After both land, a mixed-fleet `--by class` table would print 641's census-basis line — legend and all — above a table with no `source` column, and 641's `mixed` branch would be unreachable code. Each spec assumed the other had done it.

**Resolution — this spec stamps the per-row source.** Of the two available directions, stamping here is the one that keeps the rendering contract whole: 641's abbreviation table already names `mixed`, and a folded row genuinely *is* an aggregate of both censuses, so the field is describing a real property rather than padding a column.

Amendments:

**§3, record shape** — a folded class or day row carries `source: "transcript+engine-spend"`, the same vocabulary the axis-level field uses. A row on a transcript-only run carries no `source` key at all, preserving the byte-identical guarantee.

**§4, step 2 (class axis) and step 3 (day axis)** — when `engineFolded > 0`, each emitted row gains `source: "transcript+engine-spend"`. Rows on a run with no engine spend are untouched.

Note the asymmetry with the model axis, and that it is deliberate: model rows stay single-source (`transcript-jsonl` or `exec-json-events`) because each row *is* one lane's spend for one model. Class and day rows aggregate both lanes by construction, so `mixed` is the only truthful value for them. A build agent should not "unify" these into one rule.

**§8, DONE** — two criteria added:

- [ ] On a mixed-fleet run, every emitted class and day row carries `source: "transcript+engine-spend"`.
- [ ] On a transcript-only run, no class or day row carries a `source` key — asserted on the absent key, not just its value.

**Retained after amendment:**

confidence: high
spec-review: approve

---

**Sequencing, from the methodology critique.** FAFF-640 is now `blockedBy` FAFF-641 — 641 puts the rendering surface in place before the data underneath goes mixed, and it ships standalone value today with no data change at all. The edge has been applied to the tracker.

Also worth carrying into the build: FAFF-642 adds an `attribution` field to the same spend record this ticket extends with `by_day`. Both are additive and neither needs the other, so there is no blocking edge — but they should be sequenced rather than run in parallel, and whichever lands first owns the record's documented shape.
