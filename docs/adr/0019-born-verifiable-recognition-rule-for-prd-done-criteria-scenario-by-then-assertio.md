# ADR 0019 — Born-verifiable recognition rule for PRD done-criteria: scenario-by-Then, assertion-by-MUST-or-comparator, else prose

- **Status:** Accepted
- **Date:** 2026-06-27
- **Issue:** FAFF-254

## Context

FAFF-254's strict form-check must mechanically decide, per done-criterion, whether it is *shaped* as something verifiable. A string validator can only judge **form**, never **truth** — it cannot know whether "p99 < 200ms" is actually measurable or whether a `Then` outcome is genuinely observable. So the rule has to be a deterministic, teachable proxy for born-verifiability, and it drives a **hard FAIL** on a Frozen PRD (the freeze precondition) — the precision of the rule is the load-bearing risk.

Options considered:
- **Require full Given-When-Then on every criterion** — too rigid for non-functional constraints (latency, availability), which are naturally single assertions; FAFF-10 deliberately ships *two* forms for exactly this reason.
- **A free-text "looks verifiable" heuristic / LLM judgement** — not deterministic, can't gate reproducibly, and re-imports the semantic-verifiability question the validator explicitly refuses to answer.
- **Reuse FAFF-10's two complementary forms** at PRD (container) altitude.

## Decision

**A PRD done-criterion is classified `scenario` if it contains a capitalised `Then` keyword (behavioural, FAFF-10's observable); else `assertion` if it carries an explicit obligation token (`MUST`/`MUST NOT`, case-insensitive) or a relational comparator (`<`, `>`, `<=`, `>=`, `=`, `≤`, `≥`); else `prose` — which is NOT born-verifiable and FAILs the strict check.** Italic placeholders (`^_.*_$`) and blank lines are stripped before classification; a unit is one markdown list item or one Given/When/Then block.

This lifts FAFF-10's behavioural-vs-non-functional split to container altitude unchanged: one language, two altitudes. The rule is deliberately conservative — it gates form, not truth.

## Consequences

- **The house standard for born-verifiability at PRD altitude.** Every PRD's `## Acceptance criteria`, and the generated template stub, are written to this rule; the evaluator (FAFF-34) inherits the same two forms when it marks a delivered artefact against scenario `Then`-outcomes and assertion constraints.
- **Two named, accepted false-edges (form ≠ truth):**
  - *False pass:* `MUST`/comparator can pass a well-formed but unverifiable assertion ("the UX MUST feel delightful"). Accepted — semantic verifiability is the evaluator's/human's job, not the deterministic gate's.
  - *False fail:* a behavioural criterion phrased without the literal capitalised `Then` ("the run halts and escalates") is classified `prose` and rejected. Narrow; the template stub + docs teach the GWT shape. Widening the recogniser is a noted extension point if author friction proves high in practice.
- **Capitalised-`Then` only** (not case-insensitive) keeps lowercase prose "…and then…" from masquerading as a scenario — at the cost of requiring the GWT convention's capitalisation, which the template enforces by example.
- The rule is a stable contract: changing it changes which existing PRDs pass `--strict` and which Frozen PRDs validate, so future widening must be additive (accept more forms), never narrowing.
