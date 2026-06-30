# Spec — FAFF-304: `admissible` warns when prose DONE items will become evaluator punts

> Spec: faffter-dark-nlspec · 2026-06-30 · autonomous · confidence: high. Full spec on Linear FAFF-304.

This is the build spec for FAFF-304, for the build agent and human reviewers. It adds an **advisory warning** to `faff admissible --lights-out` that predicts, before any holdout evaluation runs, how many `needs-human` punts the spec's DONE checklist will produce — without changing the admissibility pass/fail gate.

## 1. WHY — Problem and Principles

**The load-bearing model.** The holdout evaluator forces **every prose-class DoD criterion to `needs-human`** (a fixed rule — a code-blind judge cannot machine-verify loose prose). So the count of prose DONE items is a *deterministic, knowable-in-advance* predictor of the evaluator's punt count. `admissible` already computes a DONE-item view of the spec but never surfaces this — it gives a green light that says nothing about the punts coming.

**Problem statement.** Today a spec with born-verifiable scenarios plus a DONE checklist written as prose (often just restating the scenarios) passes `admissible --lights-out` cleanly, then the evaluator punts every prose DONE item to `needs-human` and the aggregate verdict is `needs-human` — even when the feature fully works. The author gets a green admissibility light that does not predict that outcome. This change makes `admissible` emit an advisory warning naming those prose DONE items as the likely punts, so the author can fix the DoD authoring *before* eval.

**Design principles.**

- **Additive-only — never touch the gate.** The warning rides the existing `warnings[]` advisory channel. `admissible` (the boolean), `reasons[]`, `checks[]`, and the exit codes (`0` admissible / `1` inadmissible / `2` usage) are unchanged. A warning must never flip admissibility — this is an existing invariant of `admissibleVerdict` and the selftest asserts it.
- **Reuse the deterministic classifier; never fork it.** Prose-DONE detection draws from `dodClassify` (the same `classifyCriterion` the evaluator uses), not a second parser. So the warning agrees with the evaluator by construction, and it inherits the FAFF-306 section-boundary fix for free.
- **Exact predictor first, heuristic enrichment second.** The prose-DONE *count* is exact (it equals the evaluator's DONE-prose punt count). The duplicate-of-a-scenario annotation is a recall-biased advisory refinement — harmless when imprecise because it gates nothing.

## 2. OUT OF SCOPE

- Changing the evaluator's prose→needs-human rule (the L4 trust boundary).
- De-duplicating prose DONE items against scenarios (mutating the criteria set).
- Producer-side authoring guidance (a prose-only complementary follow-up).
- Warning on prose criteria in the `## Scenarios` section.
- Gating on prose DONE items (surfacing, not blocking).

## 3. WHAT

A single advisory warning string appended to `warnings[]`, emitted only under `--lights-out` and only when ≥1 prose DONE item exists. Shape:

```
prose-DONE advisory: N DONE item(s) are loose prose and will be forced to needs-human by the holdout evaluator: <item1trunc> | <item2trunc> | ...  (M appear to restate a born-verifiable scenario — candidates to remove: <dupTrunc> | ...)
```

`N` = predicted punt count (= prose DONE count). The parenthetical duplicate clause appears only when `M ≥ 1`.

## 4. HOW

A pure helper `proseDoneAdvisory(specText)` reuses `dodClassify`, filters `source:"done", class:"prose"`, and flags duplicates via one-directional token containment (`DUP_THRESHOLD ≈ 0.6`) against born-verifiable criteria. `admissibleVerdict` calls it after the existing checks and folds the rendered string into `warnings`. No new I/O, command, or LLM.

## 5. SCENARIOS

```
Given a lights-out spec with born-verifiable scenarios and a DONE checklist whose items are prose
When `faff admissible --spec <it> --lights-out --json` runs
Then admissible is true AND warnings contains a string beginning "prose-DONE advisory:" naming the prose item count
```

```
Given a lights-out spec whose DONE items are all assertions or scenarios (born-verifiable)
When `faff admissible --spec <it> --lights-out --json` runs
Then no warnings string begins with "prose-DONE advisory:"
```

```
Given a lights-out spec with N prose DONE items where M of them restate an existing scenario
When `faff admissible --spec <it> --lights-out --json` runs
Then the advisory reports count N AND names M duplicate candidates to remove
```

- The advisory MUST never change the `admissible` boolean or the process exit code for any input.
- The prose-DONE count reported MUST equal `dodClassify(spec).criteria` filtered to `source:"done", class:"prose"` length.
- `faff admissible --selftest` and `faff dod classify --selftest` MUST exit 0.

## 8. DONE — Definition of Done

- [ ] Given a lights-out spec with prose DONE items, `faff admissible --lights-out --json` `warnings` contains a `"prose-DONE advisory:"` string reporting the prose-DONE count
- [ ] The reported count equals `dodClassify(spec)` criteria filtered to `source:"done"`, `class:"prose"` (no forked classifier)
- [ ] `admissibleVerdict` returns the same `{admissible, reasons, checks, warnings}` shape; the advisory is appended to `warnings` only
- [ ] The advisory is computed only when `--lights-out` is set AND ≥1 prose DONE item exists
- [ ] Duplicate restatements named as `candidates to remove`; when none, the duplicate clause is omitted
- [ ] An all born-verifiable DONE checklist produces NO advisory
- [ ] The advisory never changes the `admissible` boolean or exit code
- [ ] `admissibleSelftest` gains the prose-DONE cases; `faff admissible --selftest` exits 0; `faff dod classify --selftest` still exits 0
