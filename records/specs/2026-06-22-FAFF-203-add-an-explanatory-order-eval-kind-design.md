# Spec: FAFF-203 — Add an `explanatory-order` eval kind (covers Edit A — lead-with-the-model)

> Spec: faffter-dark-nlspec · 2026-06-22 · autonomous · confidence: high · Full spec on this comment.

**Artifact:** build spec for FAFF-203, for the build agent (faff-graft) and human reviewers. It closes the eval-coverage gap FAFF-193 named: the judgement-eval harness has no kind that grades multi-line explanatory ordering, so Edit A ("Lead with the load-bearing model") ships with normalise-oracle-only coverage. This spec adds a dedicated `explanatory-order` eval kind, routed through the existing `ordering` rank-correlation grader, with its own fixture/render/criteria wiring.

> **Build note (load-bearing):** the FAFF-203 surface — the Edit A prose, `eval/cases/gloss-003.json`, the harness as described here — lives on **`origin/main`** (FAFF-193 PR #139), which is **ahead of the stale local working tree**. The graft worktree must branch off an up-to-date `origin/main`, or the explore findings here will not match the tree.

## 1. WHY — Problem and Principles

**Problem statement.** FAFF-193 added the rendering rule "Lead with the load-bearing model" (Edit A) but the judgement-eval harness only grades one-liners (`gloss`) and backlog-ordering (`ordering`), so Edit A — which governs the ordering of *multi-line explanatory prose* — has no behavioural eval. The result is a shipped rendering rule whose conformance can't regress-gate. This change adds an `explanatory-order` eval kind that grades whether a model orders a scrambled set of explanatory segments lead-with-the-model-first, then mechanism → method → so-what.

**Design principles.**

- **Reuse the ordering grader; add zero grader math.** Edit A's ordering is exactly a rank judgement, and the harness already has `rankCorrelation` — the deterministic, LLM-free grader for ordered sequences. The new kind is a *distinct registry entry with its own fixture/render/criteria wiring* that **routes its grade through the existing `ordering` arm and the existing `oracle.ordering` field**. No new grading function.
- **Wire new envelope reads at both ends (FAFF-134 anti-pattern).** The kind emits its prediction in `env.ordering` (the same field `ordering` uses). Because `explanatory-order` routes through the ordering grade-branch, the grader read-end needs no per-kind change — but the driver emit-end (MODE_INSTRUCTION, render branch, criteria loader) does.
- **Criteria prose is sliced verbatim from the shipped SKILL.md, fail-loud on drift.**
- **Deterministic core ships autonomously; the frontier baseline is a human-supervised carve-out.** Per repo precedent (FAFF-156/159/166/169, ADR-0004).

## 2. OUT OF SCOPE

- The frontier baseline (real `claude -p` reps) — human-supervised follow-up (ADR-0004).
- A live-driver variant.
- Editing Edit A's prose / the normalise checks.
- Grading "hoist-or-flag" or "surface the concrete" (Edit B, covered by gloss-003).

## 3. WHAT — Vocabulary, Types, and Interfaces

```
RECORD ExplanatoryOrderCase:
  id: String                       # e.g. "explanatory-order-001"
  kind: "explanatory-order"
  fixture: ExplanatoryFixture
  question: String
  oracle: { ordering: List<String> }   # canonical segment-id order (reuses ordering oracle field)

RECORD ExplanatoryFixture:
  segments: List<Segment>          # SCRAMBLED order

RECORD Segment:
  id: String
  text: String
```

**Envelope:** one fenced `faff-eval:judgement` block `{ "case_id": "<ID>", "ordering": ["<segment-id>", ...] }` — the same `ordering` field the `ordering` kind uses.

**Design decisions.** Distinct kind routing through ordering grade-branch + `oracle.ordering`. `validateCase` maps `explanatory-order` to the `ordering` oracle field. `FIXTURE_SHAPE["explanatory-order"] = ["segments"]`. Tolerance: ordering grader-class (0.0).

## 4. HOW — Behavior

Five touch-points:

1. **`eval/grader.mjs`** — add `"explanatory-order"` to `KINDS` (not `CLOSED_SET_KINDS`); extend `validateCase` oracle-exclusivity so it expects `oracle.ordering`; add `FIXTURE_SHAPE["explanatory-order"] = ["segments"]`; widen the `grade` `ordering` guard to also match `"explanatory-order"`.
2. **`eval/cli-driver.mjs`** — add `EXPLANATORY_ORDER_INSTRUCTION` (output-only-hardened); register in `modeInstructionFor`; add `renderFixturePrompt` branch (rubric + scrambled segments + question); add `loadLeadWithModelProse` via `extractSection(skillPath, "## Lead with the load-bearing model", "## Synthesis — the issue-gloss contract", ...)` and register in `criteriaFor`.
3. **`eval/cases/explanatory-order-001.json` and `…-002.json`** — two scrambled-segment cases with `oracle.ordering`, ≥2 oracle segments each.
4. **`eval/run-evals.mjs`** — extend `toleranceFor` so `explanatory-order` returns the ordering tolerance.
5. **`eval/baselines/`** — frontier-baseline recording carved to human-supervised follow-up.

**Grading:**
```
predicted := env.ordering OR []
score := rankCorrelation(predicted, case.oracle.ordering)
graded := (score === 1) ? "PASS" : "PARTIAL"
signature := JSON.stringify(predicted)
```

**Edge cases.** Empty/garbage `env.ordering` → `rankCorrelation` returns 1.0 for n<2 by its existing contract; mitigate at the **case** level (≥2 oracle segments) + a dry-smoke assertion that an empty ordering does not vacuously PASS. Anchor drift → `extractSection` throws. `validateCase` rejection for wrong oracle field / missing `fixture.segments`.

## 8. DONE

- `"explanatory-order"` in `KINDS`, not `CLOSED_SET_KINDS`.
- `validateCase` maps it to `oracle.ordering`; wrong oracle field / missing `fixture.segments` throw `CaseError`.
- `FIXTURE_SHAPE["explanatory-order"] = ["segments"]`.
- `grade` routes via `rankCorrelation`; PASS on score===1, PARTIAL otherwise; empty ordering vs ≥2-segment oracle does not PASS.
- `EXPLANATORY_ORDER_INSTRUCTION`, `modeInstructionFor`, `renderFixturePrompt` branch, `loadLeadWithModelProse` + `criteriaFor`.
- Two cases exist and pass `validateCase`.
- `toleranceFor` returns ordering grader-class.
- `loadCases` picks up the new cases.
- `test/eval-explanatory-order-drysmoke.test.mjs` covers registry/grade/guard/validate/criteria, no frontier spawn.
- `test/eval-grader.test.mjs` invariants updated: cases.length +2, kind added to completeness list + ≥2-cases loop.
- `node --test` passes.
- Follow-up ticket (label `faff-automation-hold`) filed/recommended for the human-supervised frontier baseline, referenced in PR.

confidence: high
