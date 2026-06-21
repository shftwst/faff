# Spec — FAFF-193: Rendering adaptor clarity rules ("lead with the model" + "surface the concrete") + gloss eval

> Spec: faffter-dark-nlspec · 2026-06-21 · autonomous · confidence: high.

Buildable nlspec spec for **FAFF-193**. Edits one skill prompt (`plugin/skills/faffidavit-rendering/SKILL.md`) plus one eval fixture (`eval/cases/gloss-003.json`) and the case-count assertion that guards the set. A rendering-PROSE change: the safety dependency is the judgement-eval gloss-fidelity baseline, not the deterministic seam harness.

## 1. WHY — Problem and Principles

**Problem statement.** The rendering adaptor's humanisation guidance is currently expressed as bans (don't lead with mechanics; don't write abstraction labels like "principle 6") with no matching *positive* rule telling a render which load-bearing statement to surface or which concrete noun to name. Authors satisfy the bans while still burying the governing idea or paraphrasing a real field name (`cache_read_input_tokens`) into a vague category ("token tracking"). This adds the two positive twins — "lead with the load-bearing model" and "surface the concrete" — plus a gloss eval case that mechanically catches the abstraction failure.

**Design principles.**
- **Form not substance — the load-bearing constraint.** The adaptor normalises *how output looks/reads*, never *what it asserts*. Both new rules reorder or surface content the source already holds; neither authors content it lacks. A render that fabricates a model or invents a concrete noun is worse than the vagueness it replaces.
- **Twin the existing bans, don't restate them.** Edit B is the positive face of the principle-6 ban inside `### Humanisation rule`; add the positive instruction, don't re-paste the banned-forms table (≥6 duplicated lines would trip the dedup lint).

## 2. OUT OF SCOPE
- **An `explanatory-order` eval kind** — a new kind grading multi-line explanatory ordering (would let an eval cover Edit A); touches `KINDS`, the grader, drivers, and a fresh baseline — disproportionate. Recorded as a settled `Chosen:` (deferred to a future ticket), not an open Punt.
- **Rewriting the principle-6 ban / `Allowed:` block** — Edit B adds *after* the `Allowed:` block; the existing ban stays verbatim.
- **Propagating to wtf/map/tidy** — they reference the adaptor by pointer, so they inherit the new rules with no edit.

## 3. WHAT — Edits

- **Edit A:** new section `## Lead with the load-bearing model`, AFTER `## When prose still wins`, BEFORE `## Synthesis`.
- **Edit B:** "Surface the concrete" instruction appended INSIDE `### Humanisation rule`, after the `**Allowed:**` list, before `**Test:**`.
- **Edit C:** two new checklist clauses appended to the `**Checks:**` sentence-list in `## Validation / normalise`.
- **Edit D (mechanical):** bump `test/eval-grader.test.mjs` `cases.length` assertion 39 → 40.
- **Eval:** `eval/cases/gloss-003.json` — `kind:"gloss"`, fixture ISS-CC, oracle populating only `gloss_rubric` (must_include `[["cache","cached"],["token","usage","read"]]`, must_avoid `["optimi","improve performance","leverage","efficiency"]`).

## 6. DESIGN DECISION RATIONALE
- **Should an eval cover Edit A?** **Chosen (resolved 2026-06-21):** accept **normalise-only coverage** for Edit A. A dedicated `explanatory-order` eval kind remains a separate future ticket (human call), not a blocker.
- **Form-not-substance enforcement?** **Chosen:** hoist-or-flag (Edit A) + surface-don't-invent (Edit B), with explicit anti-patterns.

## 8. DONE — Definition of Done
- Both rules added; both phrased as reorder/surface, never author.
- Two normalise checks added (hoist-or-flag; surface-or-flag).
- `gloss-003.json` added; `validateCase` passes; gloss-fidelity baseline doesn't regress.
- `test/eval-grader.test.mjs` asserts `cases.length === 40`.
- `faff validate-adapters` green; `node --test` passes.

confidence: high
