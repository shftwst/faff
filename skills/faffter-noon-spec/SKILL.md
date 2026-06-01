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
- The spec contract from the `spec_contract` slot (default `faffidavit-spec`) — the canonical markers and writing-style rules this output must satisfy

## Output

A single markdown document following the four-phase arc below, ending with a confidence self-rating line. The caller validates it against the `spec_contract` slot, then attaches it to the issue. This skill produces the body; it does not define the marker contract (that's `faffidavit-spec`) and does not handle attachment or lifecycle (that's faff-prep).

## The lite nlspec arc

Motivation to verifiable done, in four phases. Every non-trivial decision carries a canonical marker (`**Chosen:**` / `**Punt:**` / `**Assumes:**`) per the `spec_contract` slot.

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

## Confidence self-rating

End the output with a confidence line on its own:

```
confidence: high | medium | low
```

- **high** — every decision is marked, no open questions remain, DONE mirrors the body completely.
- **medium** — some `**Punt:**` items exist but are non-blocking, or the explore findings were ambiguous in places.
- **low** — significant unknowns, architectural uncertainty, or the issue may need splitting.

This line is consumed by faff-prep for its autonomous gate decision (medium/low → park). faff-prep strips it before attaching — downstream consumers never see it. It is a signal back to the caller, not part of the spec.

## Rules

- This is the **minimum** structure. Richer producers (like `faffter-dark-nlspec`) may add formal types, appendices, and rationale sections — as long as they satisfy the same `spec_contract`.
- The canonical markers are mandatory and owned by the `spec_contract` slot — this skill uses them, it does not define them. If the contract is unavailable, fall back to `**Chosen:**` / `**Punt:**` / `**Assumes:**`.
- Pseudocode is language-agnostic. Do not write in a specific programming language — the build agent translates to the project's language.
- The spec must be buildable by a coding agent with only the spec as context. If a section needs external knowledge not in the explore findings, mark it `**Assumes:**`.
- Write to be skimmed: no invented labelling schemes, restate subjects on cross-reference (the writing-style rules live in the `spec_contract` slot and apply fully).
