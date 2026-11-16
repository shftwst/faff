---
name: faffter-dark-nlspec
description: "Formal, full nlspec producer for the spec slot via faff-prep. Use when the configured spec format requires the heavier alternative to lite-nlspec."
user-invocable: false
judgement_seam: confidence, marker, specqual
---

# faffter-dark-nlspec

Full nlspec-format spec generation, usable as a delegated `spec` skill in faff-prep.

The nlspec format is inspired by [NLSpec-Spec](https://github.com/TG-Techie/NLSpec-Spec) by TG-Techie. No code from that project is used.

Configure in `.faff/config.yaml`:

```yaml
slots:
  spec: faffter-dark-nlspec
```

When invoked, faff-prep passes the issue context, explore findings, and the spec contract (the gateway _Spec readiness (fixed)_ section). This skill produces the spec body; faff-prep handles attachment, validation, and lifecycle.

## Input

Faff-prep provides:

- Issue title, description, acceptance criteria, labels, dependencies
- Explore findings (codebase state, architecture, relevant files)
- The spec contract from the gateway Spec-readiness section (canonical markers: `**Chosen:**`, `**Punt:**`, `**Assumes:**`)
- The writing style rules (skimmable, no invented labelling schemes)

## Output

A single markdown document following the full nlspec four-phase arc. Faff-prep reads the output, validates markers, and attaches it to the issue.

## Spec Format

### Preamble

Open with a paragraph naming the artifact, issue and audience (build agent and human reviewers).

### 1. WHY — Problem and Principles

Open with the mechanism the reader needs to understand the spec, in plain terms. State it before problem detail; do not rely on rendering to hoist it.

- **Problem statement:** status quo, pain, remedy; three sentences maximum.
- **Design principles:** bold-lead paragraphs, only for non-obvious constraints that would reject an otherwise-valid implementation. Omit if none.
- **Reference context:** when touching or mirroring existing systems, a table of System (file/module), Language and Relevance.
- **Scope statement:** one sentence locating the change in the broader system.

### 2. OUT OF SCOPE

For every excluded item, give its name, one-sentence reason for exclusion and extension point (file, module or interface). Include every related item explore excluded from this issue.

### 3. WHAT — Vocabulary, Types, and Interfaces

- **Vocabulary:** define new domain terms before first use; a term/definition table is sufficient.
- **Type definitions:** RECORD/ENUM/INTERFACE pseudocode; group related fields, annotate constraints and mark mutability.
- **API surfaces / component props / data schemas:** define the shapes the builder needs. Use type notation for precision, prose otherwise.

Every tradeoff table, comparison or architecture pick ends with a canonical spec-contract marker:
- `**Chosen:** X` / `**Decision:** X`: closed.
- `**Punt:** X or Y — needs human`: open, collected in Open Questions. When its class is clear, emit the optional `(decides: <owner>)` suffix per the gateway (`product | architecture | qa | security | any`, or a free-form handle). Omit when ambiguous; never guess. A tagged punt still declares `{ "marker": "punt" }` in the unchanged `faff-contract:spec-readiness` block.
- `**Assumes:** X exists`: external dependency, collected in Assumptions.

### 4. HOW — Behavior

Describe how the pieces connect: prose overview, pseudocode mechanics. At every ambiguity point use a labelled-steps pseudocode block, with explicit branches and outcomes. Precede complex procedures with one sentence stating what they accomplish and why.

- **Edge cases:** explicit fallback precedence, boundary conditions in pseudocode, retryable/terminal error categories and what the caller sees.
**Failure modes — how the approach falls over, and how you'd notice.** Distinct from edge cases (inputs the code must handle): these are ways the chosen approach could be wrong, and the observable that reveals it. For each non-obvious risk in the design:

- **The failure** — what could be wrong about the approach, not the code: a confound that invalidates a measurement, an assumption that silently doesn't hold, a benefit that may not exist.
- **How you'd know** — the concrete signal: the metric that wouldn't move, the test that would fail, the number that comes back null.
- **What it means** — proceed / narrow / abandon. A null or negative result is a valid outcome to name here, not a gap to hide.

Emit only above the complexity bar (same judgement as Scenarios): a spike, a novel integration, or any design whose value rests on an unvalidated assumption. A mechanical CRUD change has none — forcing the section there is bloat.

**Anti-patterns:** near the section they affect, document what NOT to do and why. Format: `**Anti-pattern:** X. Why: Y.`

**Rule inventory:** a spec whose build deletes skill prose carries a `## Rule inventory` in the format at `docs/reference/skill-authoring.md#rule-inventory`, one row per deleted rule; `faff rule-inventory check` fails the PR otherwise.

### 5. SCENARIOS — born-verifiable main objectives

A dedicated `## Scenarios` section, after HOW, expressing the spec's **main objectives** as scenarios so what the work must achieve is born verifiable — not just prose the verifier has to re-derive.

**Coverage — proportionate, not always-on.** Emit a scenario only for a main objective **above the complexity bar**: a non-trivial behavioural objective with a non-obvious observable outcome. Trivial objectives get none — a scenario for them is bloat, and the house skimmability rule outranks blanket consistency. The producer judges the bar.

**Behavioural objectives → Given-When-Then:**

```
Given <precondition>
When <the change/action>
Then <the observable, testable outcome>
```

**One scenario format, read by every counter.** Write each behavioural scenario as its own fenced block (plain or `holdout`), one step per line, each line starting with a capitalised `Given`, `When`, `Then` or `And`, with no bullet and no bold. The scenario counters do not read a bulleted scenario (`- Given … Then …`), bold keywords (`**Given**`) or a lowercase `then`, and `faff admissible --lights-out` refuses a spec whose scenarios use only those forms.

**Non-functional objectives → assertions/constraints**, not forced Given-When-Then. A constraint like "no PII in logs", "10k rps sustained", or "p99 < 200ms" is an assertion line — two complementary forms, behaviour vs non-functional, not one format jammed onto both.

This is the same language as holdout BDD; a holdout is just the withheld subset of these scenarios (one language, two visibilities).

**Anti-pattern:** restating the DONE checklist as Given-When-Then. Why: DONE already mirrors the body; scenarios sharpen the WHAT's main objectives, they do not duplicate DONE. The dedicated section + complexity bar exist to avoid exactly this.

**Marking a holdout.** Optionally withhold a scenario from the builder and reserve it for the code-blind evaluator — mark it in place, in this same section, never a second section or format:

- **Fenced GWT block:** open the fence with the info string `holdout` (```` ```holdout ```` or `~~~holdout`) instead of a bare fence — every criterion unit inside is a holdout.
- **Assertion bullet:** prefix the bullet `holdout:` (case-insensitive) — `- holdout: The p99 latency MUST be < 200ms`. The prefix is stripped before classification; it is never part of the stored criterion text.

**Selection rules.** Marking is optional — zero holdouts is fully valid. Mark a minority (guideline one-in-three, never more than half, and never all — the builder must retain at least one visible scenario). A holdout must verify behaviour the WHAT/HOW body already requires, never be the sole statement of a requirement — prefer a different concrete instantiation of a stated rule (other values, another path) over introducing new behaviour only a holdout states. DONE items are never marked.

Never make a Scenarios unit's check a repository test file passing — the holdout cannot read or run one. Restate the behaviour as an observable Given/When/Then and put the test-file check in its own DONE item instead.

Every Scenarios unit needs an observable `Then`, or for a non-functional objective a `MUST` or comparator: a prose unit (no `Then`, no `MUST`, no comparator) cannot be judged code-blind, and a holdout-marked prose unit is also withheld from the builder, so it checks nothing.

### 6. DESIGN DECISION RATIONALE

Collect every decision: a bold question, options with brief pros/cons, and `**Chosen:** X — rationale`. Include rejected alternatives so future readers understand the choices and the builder does not re-propose them.

Temporal anchors where relevant: "At the time of writing, library X does not support Y" — so the decision can be revisited when the landscape changes.

### 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** all `**Punt:**` items collected in one place. Each with enough context that a human reviewer can make the call without re-reading the full spec.

**Assumptions:** all `**Assumes:**` items collected in one place. Each with a validation instruction (how the build agent checks whether the assumption holds before starting).

### 8. DONE — Definition of Done

A concrete, testable checklist mirroring WHY/WHAT/HOW requirements 1:1. Group items under `### From WHY`, `### From WHAT (types and interfaces)`, `### From HOW (behaviour)` and `### From HOW (edge cases)` as applicable.

Every body requirement needs a matching DONE item; missing items leave requirements untested, orphan items add unsupported requirements. Write observable checks, for example `- [ ] Expired sessions return 401 with { error: "session_expired" }`; "works correctly" is invalid.

Put a check the running system cannot show (a repository test file passing, a symbol being exported) in its own DONE item, apart from any CLI or HTTP behaviour. `faff dod classify` sends such an item to the review/merge test floor, so behaviour stated in the same item is not judged by the holdout.

Tag a done-item only a person can check with `needs-human: <reason>`, after any `[ac-N]` id. Every other done-item must be machine-checkable.

**Eval coverage.** If the work introduces or changes an LLM-judgement seam, a DONE item registers its grader `KIND` + ≥1 eval case + the seam-registry row in this same ticket — all autonomous-doable. Recording/accepting the baseline value is a separate human-supervised step and is never required by this DONE item.

**Integration smoke test:** pseudocode for a single end-to-end path that exercises the happy case. This is not exhaustive — it's the "if this one thing works, the plumbing is connected" test.

### 9. APPENDICES (optional)

Lettered A, B, C. For essential content that would disrupt narrative flow in the body:
- Attribute catalogs
- Format references
- Error catalogs with codes and messages
- Usage examples

Only include appendices when the body would become unreadable without extracting the content. Most specs won't need them.

## Confidence self-rating

End the output with a confidence line on its own:

```
confidence: high | medium | low
```

- **high** — every decision is marked, no open questions remain, DONE mirrors body completely
- **medium** — a **blocking** open `**Punt:**` item remains (an unresolved decision the increment depends on), or the explore findings were ambiguous in places. Weigh only blocking Punts: an **eligible non-blocking** Punt — one `faff punt-scan` reports `eligible` (tagged `(non-blocking)` and cross-referenced under OUT OF SCOPE) — is excluded from the weighed count, so a spec whose only open items are eligible non-blocking Punts self-rates `high`. Excluding it is a mechanical read of the scanner, not a self-certification of the tag; tag honesty is the spec-review lens's call.
- **low** — significant unknowns, architectural uncertainty, or the issue may need splitting

Rate open decisions, not polish. A slip the builder can settle without making a new decision (a field missing from one example, an obvious unstated default) is fixed in the draft and does not lower the rating.

This line is consumed by faff-prep for its gate decision (autonomous mode: `high` → promote; `medium` → attach + flag for review; `low` → park) and is **retained on the attached spec** — downstream consumers (faff-graft, faff-beep-boop, and faff-tidy's spec-health pass) read it as durable provenance and a re-spec signal; a retained `confidence: medium` maps to the `needs-decision-first` routing verdict. It is both a signal to the caller and a lasting property of the spec.

## Quality bar — self-review before returning

This producer discharges the `spec` slot's quality bar by inheritance, not by defining a second one: before emitting the spec and confidence line, it runs the sibling `faffter-noon-spec/SKILL.md` → _Self-review before returning_ section in full, exactly as written there.

- **What's inherited.** The reviewer brief, the `blocker`/`major`/`minor` severities, the acting-on-findings rules, the return-the-review requirement, and the narrowing-only-refresh exemption all carry over unchanged — this section adds nothing to that checklist and drops nothing from it.
- **In-context clause.** This skill only ever runs as a dispatched producer subagent, never at the gateway's top level, so the inherited review always takes its in-context form here: a fresh-reasoning pass performed inside this same subagent against the drafted spec and the codebase, rather than a further clean-context subagent dispatch.
- Nesting therefore stays single-level by construction for this producer — the top-level case the inherited section also allows for simply never arises, so there is nothing to choose between at dispatch time; the review's purpose (every claim checked against the codebase before the spec is trusted) is unaffected by the different form.
- **Rating cap.** The inherited downgrade rule binds this producer exactly as written: landing on ≥1 `blocker` finding, or ≥3 `major` findings, forecloses a `high` self-rating regardless of how settled the draft felt going in.
- Cap the self-rating at `medium` when that threshold is hit, and read the confidence self-rating section immediately above as subject to this cap rather than as an independent judgement call.

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

- The spec contract markers (`**Chosen:**`, `**Punt:**`, `**Assumes:**`) are mandatory — this skill adds structure around them, not instead of them.
- The writing style rules from faff-prep (skimmable, no invented labelling schemes, restate subjects) apply fully.
- Pseudocode is language-agnostic. Do not write in a specific programming language — the build agent translates to the project's language.
- The spec must be buildable by a coding agent with only the spec as context. If a section requires external knowledge not in the explore findings, mark it `**Assumes:**`.
