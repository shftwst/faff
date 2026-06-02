# faffter-noon-spec

The default spec producer. Turns an issue plus explore findings into a buildable spec following the **lite nlspec arc** (WHY → WHAT → HOW → DONE). Lightweight by design — the minimum a coding agent needs to build without re-litigating decisions.

This is the implicit default for the `spec` slot when none is configured. It's the light counterpart to `faffter-dark-nlspec` (the heavy, formal full-nlspec producer): same slot, same contract, less ceremony. Extracted here so it can be invoked standalone, tested, and swapped.

```yaml
planning_skills:
  spec: faffter-noon-spec   # the default — explicit for clarity
```

## When it runs

Invoked by faff-prep as the configured `spec` skill (the default when the slot is unset). Can also be invoked standalone: "write the spec for SHF-123" produces the spec body for review without the tracker lifecycle.

## Input

The caller provides:

- Issue title, description, acceptance criteria, labels, dependencies
- Explore findings (codebase state, architecture, relevant files)
- The spec contract from the `spec_adaptor` slot (default `faffidavit-spec`) — the canonical markers and writing-style rules this output must satisfy

## Output

A single markdown document following the four-phase arc below, ending with a confidence self-rating line. The caller validates it against the `spec_adaptor` slot, then attaches it to the issue. This skill produces the body; it does not define the marker contract (that's `faffidavit-spec`) and does not handle attachment or lifecycle (that's faff-prep).

## The lite nlspec arc

Motivation to verifiable done, in four phases. Every non-trivial decision carries a canonical marker (`**Chosen:**` / `**Punt:**` / `**Assumes:**`) per the `spec_adaptor` slot.

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

### 4. DONE — Definition of Done (closed-loop)

- A testable checklist mirroring the body sections 1:1. Every WHY/WHAT/HOW requirement gets a matching DONE item. Missing DONE items reveal untestable requirements; orphaned DONE items reveal ungrounded ones.
- Each item concrete enough to write a test against. "Works correctly" is not a DONE item; "returns 401 with body `{ error: \"session_expired\" }`" is.
- If the work spans a structural boundary (two independent concerns), recommend a split instead of speccing both.

## Self-review before returning (mandatory, all sizes)

Before emitting the spec + self-rating, dispatch a **clean-context subagent** to review the freshly drafted spec against the codebase. By the time the spec is drafted this skill's context is saturated with explore findings and the framing it locked in early — that makes it hard to spot missed conventions, decisions that don't fit the architecture, vague ACs, `**Punt:**` items the codebase actually answers, false `**Assumes:**`, or scope creep. A reviewer with fresh context — given only the spec and the codebase — sees the spec the way `/faff-workit` will. This is the producer's own quality bar (the gateway makes a delegated `spec` skill responsible for its own quality; this is how the default discharges it), and it runs for **every** fresh spec regardless of size, in both interactive and autonomous mode, in addition to marker conformance and self-rating.

**No size threshold.** Small specs go wrong in the same ways large ones do (vague ACs, false `**Assumes:**`, missed convention) — they're just shorter, which makes the review faster, not unnecessary. "It's a one-line change, the review is overkill" is the same capacity-shaped rationalisation banned by the gateway's forbidden-park-reasons list. Just dispatch.

**Dispatch.** `Agent` tool with `subagent_type: Explore` (read-only — the reviewer must not edit the spec; it returns findings, this skill applies them). The prompt includes the full spec (markers and all), the issue title/description/dependency context, and an explicit brief to read the spec then verify each claim against the codebase, returning structured findings (one per issue, each with severity `blocker` / `major` / `minor` and a one-line fix). Keep findings under ~400 words. The reviewer must check:

- **Codebase fit** — does each `**Chosen:**` match how the codebase already does similar things? Flag new patterns where an established one exists, or ignored existing utilities.
- **Assumes-validity** — for every `**Assumes:**`, does the assumed thing actually exist in the repo? Flag any that don't.
- **Punt-resolvability** — for every `**Punt:**`, is the answer already findable in the codebase? If so it should be a `**Chosen:**`.
- **AC testability** — is each AC concrete and testable? Flag "works correctly", "is performant", or anything lacking a clear pass condition.
- **Skimmability** — flag invented labelling schemes (`F2`, `R3`, `Phase 4`) that should be descriptive subjects; flag sections that assume the reader holds a source ADR / parent ticket in their head. Tracker IDs (`SHF-247`) are fine.
- **Scope creep** — anything outside the issue's stated intent (an opportunistic refactor smuggled in).
- **Missing surface** — obvious code paths / edge cases the spec omits that the codebase shows are relevant.
- **Interface mismatch** — do proposed API shapes / props / schemas match how callers already work?

**Acting on findings.** `blocker` (spec is wrong about a codebase fact, false `**Assumes:**`, or a `**Chosen:**` that contradicts established convention) → revise: apply the fix, or convert the affected `**Chosen:**` to a `**Punt:**` noting the conflict; if it can't be fixed without architectural reframing, return a `low` rating with the blocker noted so the caller parks. `major` (vague AC, scope creep, missed edge case) → fix where mechanical, else leave as `**Punt:**` with the reviewer's note. `minor` → fold where trivial, else note.

**Self-rating downgrade rule.** If the review surfaces ≥1 `blocker` or ≥3 `major` findings, the spec **cannot** self-rate `high` regardless of how it felt pre-review — cap at `medium`. This stops rationalising past honest findings. Applies to every spec, regardless of size.

**Return the review.** Emit the review's findings + the resolution decisions (what was applied, what was left as `**Punt:**`, what was dismissed and why) alongside the spec, so the caller can log the audit trail. A missing review record is a process failure.

**When NOT to run.** Only when the caller signals a **narrowing-only refresh** — the original spec was already vetted and is being scoped down to a remaining delta, not redrafted whole-cloth. The caller owns that signal; absent it, the review runs.

## Confidence self-rating

End the output with a confidence line on its own:

```
confidence: high | medium | low
```

The three levels and the gate each maps to are part of the **fixed spec-readiness contract** in the gateway (_Core contracts and adaptor slots → Spec readiness_); the line's format is owned by the `spec_adaptor` slot (default `faffidavit-spec` → _Confidence self-rating_). Either way, this skill emits it, it does not define it. In short: `high` = every decision marked, no open questions, DONE mirrors the body; `medium` = non-blocking `**Punt:**` items or patchy explore findings; `low` = significant unknowns or possible split.

This line is consumed by faff-prep for its autonomous gate decision (`high` → promote; `medium` → attach + flag for human review; `low` → park) and is **retained on the attached spec** — it is durable provenance and a re-spec signal, not stripped. `/faff-tidy`'s spec-health pass reads the retained rating and reconciles it against later comments and codebase drift; the routing verdict treats a retained `confidence: medium` as `needs-decision-first`. It is both a signal to the caller and a lasting property of the spec.

## Rules

- This is the **minimum** structure. Richer producers (like `faffter-dark-nlspec`) may add formal types, appendices, and rationale sections — as long as they satisfy the same `spec_adaptor`.
- The canonical markers are mandatory and owned by the `spec_adaptor` slot — this skill uses them, it does not define them. If the contract is unavailable, fall back to `**Chosen:**` / `**Punt:**` / `**Assumes:**`.
- Pseudocode is language-agnostic. Do not write in a specific programming language — the build agent translates to the project's language.
- The spec must be buildable by a coding agent with only the spec as context. If a section needs external knowledge not in the explore findings, mark it `**Assumes:**`.
- Write to be skimmed: no invented labelling schemes, restate subjects on cross-reference (the writing-style rules live in the `spec_adaptor` slot and apply fully).
