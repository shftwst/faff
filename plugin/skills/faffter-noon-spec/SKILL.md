---
name: faffter-noon-spec
description: "Default spec producer via faff-prep: turn an issue and explore findings into lite-nlspec (WHY-WHAT-HOW-DONE) with a confidence self-rating."
user-invocable: false
judgement_seam: confidence, marker, specqual
---

# faffter-noon-spec

The default spec producer turns an issue and explore findings into a buildable **lite nlspec arc** (WHY → WHAT → HOW → DONE): the minimum a coding agent needs without reopening decisions.

The implicit `spec` default when unset; `faffter-dark-nlspec` supplies the heavier full-nlspec alternative with the same slot and contract. This producer can be invoked standalone, tested and swapped.

```yaml
slots:
  spec: faffter-noon-spec   # the default — explicit for clarity
```

## When it runs

Invoked by faff-prep as the configured `spec` skill (the default when the slot is unset). Can also be invoked standalone: "write the spec for SHF-123" produces the spec body for review without the tracker lifecycle.

## Input

The caller provides:

- Issue title, description, acceptance criteria, labels, dependencies
- Explore findings (codebase state, architecture, relevant files)
- The spec contract from the gateway (_Spec readiness (fixed)_) — the canonical markers and writing-style rules this output must satisfy

## Output

Emit one markdown document following the four-phase arc and ending with a confidence self-rating line. Faff-prep validates via `faff contract spec-readiness`, then attaches it and owns lifecycle. This producer owns only the body; the gateway _Spec readiness (fixed)_ section owns the marker contract.

## The lite nlspec arc

Motivation to verifiable done, in four phases. Every non-trivial decision carries a canonical marker (`**Chosen:**` / `**Punt:**` / `**Assumes:**`) per the gateway Spec-readiness contract.

### 1. WHY — Problem and scope

- One paragraph: status quo → pain → what this change does about it.
- Design principles — any non-obvious constraints that should govern implementation, as bold-lead sentences. Omit when there are none.
- Out of scope — what this deliberately does NOT do, each with a one-line note on where it could be added later (extension point).

### 2. WHAT — Data and interfaces

- Type shapes, API surfaces, component props, data schemas the build agent needs to know exist. Prose where precision doesn't matter; a shape sketch where it does.
- Key technical decisions with brief pros/cons — each concluded with a canonical marker.
- Open questions collected in an "Open Questions" section (`**Punt:**`); external prerequisites in an "Assumptions" section (`**Assumes:**`).

### 3. HOW — Behaviour

- Architecture and approach — how the pieces connect.
- Pseudocode at ambiguity points — anywhere prose alone could be read two ways, add a setup/action/assert or step-by-step block.
- Risks, edge cases, what could go wrong.

### Scenarios — born-verifiable main objectives

- A dedicated `## Scenarios` section, after HOW and before DONE. For each **main objective above the complexity bar**, render the objective as Given-When-Then so what the work must achieve is expressed as a scenario, not just prose — the objective is born verifiable:

  ```
  Given <precondition>
  When <the change/action>
  Then <the observable, testable outcome>
  ```

- **One scenario format, read by every counter.** Write each behavioural scenario as its own fenced block (plain or `holdout`), one step per line, each line starting with a capitalised `Given`, `When`, `Then` or `And`, with no bullet and no bold. The scenario counters do not read a bulleted scenario (`- Given … Then …`), bold keywords (`**Given**`) or a lowercase `then`, and `faff admissible --lights-out` refuses a spec whose scenarios use only those forms.
- **Proportionate, not always-on.** Emit a scenario only for a non-trivial behavioural objective with a non-obvious observable outcome. Trivial objectives get none — a scenario for them is bloat, and the house skimmability rule outranks blanket consistency. The producer judges the bar; many small specs will have a short `## Scenarios` section or, legitimately, none.
- **Non-functional objectives → assertions, not scenarios.** A constraint like "no PII in logs" or "p99 < 200ms" is an assertion/constraint line, not a forced Given-When-Then — two complementary forms, one for behaviour, one for non-functional.
- This is the same language as holdout BDD; a holdout is just the withheld subset of these scenarios.
- **Anti-pattern:** restating the DONE checklist as Given-When-Then. Why: DONE already mirrors the body; scenarios sharpen the WHAT's main objectives, they don't duplicate DONE. The dedicated section + complexity bar exist to avoid exactly this.
- **Marking a holdout (optional).** Withhold a scenario from the builder for the code-blind evaluator by marking it in place — a fenced GWT block whose fence-info is `holdout` (```` ```holdout ```` / `~~~holdout`), or a bullet prefixed `holdout:` (stripped before classification). Mark a minority (never more than half, never all — the builder keeps at least one visible scenario), and only a scenario whose behaviour the body already requires — never the sole statement of a requirement. DONE items are never marked.
- Never make a Scenarios unit's check a repository test file passing — the holdout cannot read or run one. Restate the behaviour as an observable Given/When/Then and put the test-file check in its own DONE item instead.
- Every Scenarios unit needs an observable `Then`, or for a non-functional objective a `MUST` or comparator: a prose unit (no `Then`, no `MUST`, no comparator) cannot be judged code-blind, and a holdout-marked prose unit is also withheld from the builder, so it checks nothing.

### 4. DONE — Definition of Done (closed-loop)

- Write `- [ ]` checkboxes. Each WHY/WHAT/HOW requirement has a testable DONE item, and each item maps back to a requirement.
- Each item concrete enough to write a test against. "Works correctly" is not a DONE item; "returns 401 with body `{ error: \"session_expired\" }`" is.
- Put a check the running system cannot show (a repository test file passing, a symbol being exported) in its own DONE item, apart from any CLI or HTTP behaviour. `faff dod classify` sends such an item to the review/merge test floor, so behaviour stated in the same item is not judged by the holdout.
- Tag a done-item only a person can check with `needs-human: <reason>`, after any `[ac-N]` id. Every other done-item must be machine-checkable.
- **Eval coverage.** If the work introduces or changes an LLM-judgement seam, add a DONE item to register its grader `KIND` + ≥1 eval case + the seam-registry row in this same ticket (recording the baseline value is a separate human step, never blocked on here).
- If the work spans a structural boundary (two independent concerns), recommend a split instead of speccing both.

## Self-review before returning (mandatory, all sizes)

**Draft check before review.** Pipe the draft to `faff admissible --spec - --author-diagnostics`. Count each `major` entry once. Rewrite its named units with an observable Then, MUST or comparator. Move each `test_file` check into its own DONE item. For `R2a.done-present`, write the required DONE checkboxes. For human-marker findings, tag person-only items `needs-human: <reason>`, fix or remove empty markers, make other checks runnable and keep at least one untagged item. Recheck once and retain unresolved findings for the rating cap. Log `notes` or a command failure without blocking the spec.

Before emitting the spec + self-rating, dispatch a **clean-context subagent** to check it against the codebase. Fresh context checks missed conventions, architectural fit, vague ACs, codebase-answerable `**Punt:**` items, false `**Assumes:**` and scope creep from the spec and codebase alone, as `/faff-graft` will. This is the default producer's delegated quality responsibility, mandatory for **every** fresh spec in both modes, regardless of size, in addition to marker conformance and self-rating. **When this producer is itself dispatched as a subagent** (gateway → **Sibling-skill invocation → Producer dispatch**), verify **in-context** in a fresh-reasoning pass with spec and codebase instead of nesting another subagent. Every claim still needs codebase verification before the spec is trusted.

**No size threshold.** Small specs still risk vague ACs, false `**Assumes:**` and missed conventions. "It's a one-line change, the review is overkill" is a capacity-shaped rationalisation banned by the gateway's forbidden-park-reasons list. Dispatch the review.

**Dispatch.** `Agent` tool with `subagent_type: Explore` (read-only — the reviewer must not edit the spec; it returns findings, this skill applies them). The prompt includes the full spec (markers and all), the issue title/description/dependency context, and an explicit brief to read the spec then verify each claim against the codebase, returning structured findings (one per issue, each with severity `blocker` / `major` / `minor` and a one-line fix). Keep findings under ~400 words. The reviewer must check:

- **Codebase fit** — does each `**Chosen:**` match how the codebase already does similar things? Flag new patterns where an established one exists, or ignored existing utilities.
- **Assumes-validity** — for every `**Assumes:**`, does the assumed thing actually exist in the repo? Flag any that don't.
- **Punt-resolvability** — for every `**Punt:**`, is the answer already findable in the codebase? If so it should be a `**Chosen:**`.
- **AC testability** — is each AC concrete and testable? Flag "works correctly", "is performant", or anything lacking a clear pass condition.
- **Skimmability** — flag invented labelling schemes (`F2`, `R3`, `Phase 4`) that should be descriptive subjects; flag sections that assume the reader holds a source ADR / parent ticket in their head. Tracker IDs (`SHF-247`) are fine.
- **Scope creep** — anything outside the issue's stated intent (an opportunistic refactor smuggled in).
- **Missing surface** — obvious code paths / edge cases the spec omits that the codebase shows are relevant.
- **Interface mismatch** — do proposed API shapes / props / schemas match how callers already work?

**Acting on findings.** `blocker` (spec is wrong about a codebase fact, false `**Assumes:**`, or a `**Chosen:**` that contradicts established convention) → revise: apply the fix, or convert the affected `**Chosen:**` to a `**Punt:**` noting the conflict; if it can't be fixed without architectural reframing, return a `low` rating with the blocker noted so the caller parks. `major` (vague AC, scope creep, a missed edge case the codebase shows is relevant) → fix where mechanical, else leave as `**Punt:**` with the reviewer's note. `minor` → fold where trivial, else note.

**Return the review.** Include each original finding's severity in the readiness block's `self_review` array, including fixed or dismissed findings. Append one `"major"` per entry in the recheck's `major` array, even when an entry names several units. Use `[]` only after a completed review found none. Return findings and resolutions alongside the spec for the prep log. Missing review evidence is a process failure.

**When NOT to run.** Only when the caller signals a **narrowing-only refresh** — the original spec was already vetted and is being scoped down to a remaining delta, not redrafted whole-cloth. The caller owns that signal; absent it, the review runs.

## Confidence self-rating

End the spec with its confidence line:

```
confidence: high | medium | low
```

The three levels and the gate each maps to are part of the **fixed spec-readiness contract** in the gateway (_Spec readiness (fixed)_), which also defines the line's format. Either way, this skill emits it, it does not define it. In short: `high` = every decision marked, no open questions, DONE mirrors the body; `medium` = an open `**Punt:**` that `faff punt-scan "$spec_file"` does not report `eligible`, or patchy explore findings; `low` = significant unknowns or possible split. Rate open decisions, not polish: a slip the builder can settle without making a new decision (a field missing from one example, an obvious unstated default) is fixed in the draft and does not lower the rating. A Punt is eligible only when it is tagged `(non-blocking)` **and** cross-referenced under OUT OF SCOPE; an unsupported tag leaves it blocking. A spec whose only open items are eligible Punts can self-rate `high`. This is a mechanical read of the scanner, never a self-certification of the tag; tag honesty is the spec-review lens's call.

Prep stages the effective rating for routing and later spec-health checks. When returning a fresh spec outside prep, apply `faff contract spec-readiness` to its block and retain the returned confidence in both the line and block.

## Contract artifact

Emit the gateway's **Spec readiness (fixed)** example shape. In the JSON, `decisions` is an array of marker objects and `self_review` an array of severities.

## Rules

- This is the **minimum** structure. Richer producers (like `faffter-dark-nlspec`) may add formal types, appendices, and rationale sections — as long as they satisfy the same gateway spec-readiness contract.
- The canonical markers are mandatory and defined in the gateway Spec-readiness contract — this skill uses them, it does not define them. If the contract is unavailable, fall back to `**Chosen:**` / `**Punt:**` / `**Assumes:**`.
- **Punt ownership.** When a `**Punt:**`'s class is clear — a product-scope call, an architecture pick, a test-strategy question, a security decision — emit the optional `(decides: <owner>)` suffix per the gateway Spec-readiness contract (`product | architecture | qa | security | any`, or a free-form handle). Omit it when the class is ambiguous; never guess. The `faff-contract:spec-readiness` block is unchanged either way — a tagged punt still emits `{ "marker": "punt" }`.
- Pseudocode is language-agnostic. Do not write in a specific programming language — the build agent translates to the project's language.
- The spec must be buildable by a coding agent with only the spec as context. If a section needs external knowledge not in the explore findings, mark it `**Assumes:**`.
- Write to be skimmed: no invented labelling schemes, restate subjects on cross-reference (the writing-style rules live in the gateway Spec-readiness contract and apply fully).
