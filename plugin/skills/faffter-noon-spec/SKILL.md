---
name: faffter-noon-spec
description: "Default `spec` producer — turns an issue plus explore findings into a buildable lite-nlspec spec (WHY-WHAT-HOW-DONE) with a confidence self-rating. The light default. Runs via faff-prep, not the user `/` menu."
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

A single markdown document following the four-phase arc below, ending with a confidence self-rating line. The caller (faff-prep) validates it via `faff contract spec-readiness`, then attaches it to the issue. This skill produces the body; it does not define the marker contract (that's the gateway _Spec readiness (fixed)_ section) and does not handle attachment or lifecycle (that's faff-prep).

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

- A testable checklist mirroring the body sections 1:1. Every WHY/WHAT/HOW requirement gets a matching DONE item. Missing DONE items reveal untestable requirements; orphaned DONE items reveal ungrounded ones.
- Each item concrete enough to write a test against. "Works correctly" is not a DONE item; "returns 401 with body `{ error: \"session_expired\" }`" is.
- Put a check the running system cannot show (a repository test file passing, a symbol being exported) in its own DONE item, apart from any CLI or HTTP behaviour. `faff dod classify` sends such an item to the review/merge test floor, so behaviour stated in the same item is not judged by the holdout.
- Tag a done-item only a person can check with `needs-human: <reason>`, after any `[ac-N]` id. Every other done-item must be machine-checkable.
- **Eval coverage.** If the work introduces or changes an LLM-judgement seam, add a DONE item to register its grader `KIND` + ≥1 eval case + the seam-registry row in this same ticket (recording the baseline value is a separate human step, never blocked on here).
- If the work spans a structural boundary (two independent concerns), recommend a split instead of speccing both.

## Self-review before returning (mandatory, all sizes)

**Deterministic Scenarios check (first, before the reviewer pass).** Pipe the draft to `faff admissible --lights-out --spec - --json` and parse stdout. Treat every `warnings[]` line starting `scenarios-prose advisory:` or `scenarios-code-surface advisory:` as a `major` finding naming the listed unit ids. Read `admissible` and `reasons` too: an R1 refusal (`born-verifiable scenario(s)`) while the Scenarios section has at least one unit is a `major` format finding; with no Scenarios units, note it in the review record only, since a spec may legitimately have none. Rewrite each named unit before self-rating: give it an observable `Then` (or a `MUST` or comparator for a non-functional objective), and move a test-file check to its own DONE item. Re-run once; a warning that remains stays an open finding under the existing rating cap. A failed command (no JSON on stdout) is noted in the review record and never blocks the spec. Treat a refusal naming `R2c`, `R2d` or `R2e` as a `major` finding too: tag a person-only item `needs-human: <reason>`, rewrite any other item so a test or command can check it, keep at least one item that is not tagged, and give or drop an empty-reason marker.

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

**Self-rating downgrade rule.** If the review surfaces ≥1 `blocker` or ≥3 `major` findings, the spec **cannot** self-rate `high` regardless of how it felt pre-review — cap at `medium`. This stops rationalising past honest findings. Applies to every spec, regardless of size.

**Return the review.** Emit the review's findings + the resolution decisions (what was applied, what was left as `**Punt:**`, what was dismissed and why) alongside the spec, so the caller can log the audit trail. A missing review record is a process failure.

**When NOT to run.** Only when the caller signals a **narrowing-only refresh** — the original spec was already vetted and is being scoped down to a remaining delta, not redrafted whole-cloth. The caller owns that signal; absent it, the review runs.

## Confidence self-rating

End the output with a confidence line on its own:

```
confidence: high | medium | low
```

The three levels and the gate each maps to are part of the **fixed spec-readiness contract** in the gateway (_Spec readiness (fixed)_), which also defines the line's format. Either way, this skill emits it, it does not define it. In short: `high` = every decision marked, no open questions, DONE mirrors the body; `medium` = an open `**Punt:**` item that `faff punt-scan` does not report `eligible`, or patchy explore findings; `low` = significant unknowns or possible split. Rate open decisions, not polish: a slip the builder can settle without making a new decision (a field missing from one example, an obvious unstated default) is fixed in the draft and does not lower the rating. A Punt is eligible only when it is tagged `(non-blocking)` **and** cross-referenced under OUT OF SCOPE; prose saying it does not block does not make it eligible. A spec whose only open items are eligible Punts can self-rate `high`. This is a mechanical read of the scanner, never a self-certification of the tag; tag honesty is the spec-review lens's call.

This line is consumed by faff-prep for its autonomous gate decision (`high` → promote; `medium` → attach + flag for human review; `low` → park) and is **retained on the attached spec** — it is durable provenance and a re-spec signal, not stripped. `/faff-tidy`'s spec-health pass reads the retained rating and reconciles it against later comments and codebase drift; the routing verdict treats a retained `confidence: medium` as `needs-decision-first`. It is both a signal to the caller and a lasting property of the spec.

## Contract artifact

After the prose spec and the `confidence:` line, append **one** fenced code block — tagged `faff-contract:spec-readiness`, as the **last** thing in the output — declaring the markers you just wrote, so faff-prep (the consumer) parses them **deterministically** (no LLM re-read of your prose) and pipes them to `faff contract spec-readiness`. You authored the markers and the confidence token, so you declare them directly; the block mirrors the prose, it is not a second source of truth.

````
```faff-contract:spec-readiness
{ "confidence": "<your confidence token: high|medium|low>",
  "decisions": [ { "marker": "chosen" | "punt" | "assumes" | "none" }, ... one per non-trivial decision section, in document order ] }
```
````

- **One** block, at the very end. `decisions` lists each non-trivial decision section's canonical marker in order (`chosen` / `punt` / `assumes`; `none` only if a multi-option section is missing one — a clean spec has none).
- Do **not** include `provenance_present` — faff-prep computes that from the provenance stamp it adds at attach time.
- The block is machine-only (a human reader can ignore it). **Always emit it** — it is the deterministic path; a present-but-malformed block fails loud downstream (producer breakage), so emit valid JSON matching the shape exactly. (Omitting it falls back to faff-prep reading your prose — the absent-block fallback.)

## Rules

- This is the **minimum** structure. Richer producers (like `faffter-dark-nlspec`) may add formal types, appendices, and rationale sections — as long as they satisfy the same gateway spec-readiness contract.
- The canonical markers are mandatory and defined in the gateway Spec-readiness contract — this skill uses them, it does not define them. If the contract is unavailable, fall back to `**Chosen:**` / `**Punt:**` / `**Assumes:**`.
- **Punt ownership.** When a `**Punt:**`'s class is clear — a product-scope call, an architecture pick, a test-strategy question, a security decision — emit the optional `(decides: <owner>)` suffix per the gateway Spec-readiness contract (`product | architecture | qa | security | any`, or a free-form handle). Omit it when the class is ambiguous; never guess. The `faff-contract:spec-readiness` block is unchanged either way — a tagged punt still emits `{ "marker": "punt" }`.
- Pseudocode is language-agnostic. Do not write in a specific programming language — the build agent translates to the project's language.
- The spec must be buildable by a coding agent with only the spec as context. If a section needs external knowledge not in the explore findings, mark it `**Assumes:**`.
- Write to be skimmed: no invented labelling schemes, restate subjects on cross-reference (the writing-style rules live in the gateway Spec-readiness contract and apply fully).
