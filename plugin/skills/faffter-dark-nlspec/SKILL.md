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

Opening paragraph naming the artifact, the issue it addresses, and the intended audience (the build agent, human reviewers).

### 1. WHY — Problem and Principles

**Open with the load-bearing model.** Before problem detail, WHY's first paragraph states in plain terms the mechanism the spec turns on. Write it deliberately; rendering hoists it if buried, but do not leave discovery to normalise.

**Problem statement:** status quo → pain → what this change does about it. Three sentences max.

**Design principles:** bold-lead paragraphs for any non-obvious constraints that should govern implementation decisions. Only include principles that would cause you to reject an otherwise-valid implementation. If there are none, omit the section.

**Reference context:** if the implementation touches or mirrors existing systems, a brief table:

| System | Language | Relevance |
|---|---|---|
| `src/auth/middleware.ts` | TypeScript | Existing auth layer this extends |

**Scope statement:** one sentence on where this fits in the broader system. Not a sales pitch — a locator.

### 2. OUT OF SCOPE

For each excluded item:

- **Name** — what's excluded
- **Why excluded** — one sentence
- **Extension point** — where a future issue would add this (file, module, interface)

Include every explore item surfaced as "related but not this issue" to bound this build and locate future extensions.

### 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:** if the spec introduces domain terms, define them before first use. A two-column table (term → definition) is sufficient.

**Type definitions:** use pseudocode RECORD/ENUM/INTERFACE notation. Group related fields, annotate constraints, mark mutability.

```
RECORD UserSession:
  id: UUID                    # assigned on creation, immutable
  user_id: UUID               # FK to users table
  expires_at: Timestamp       # must be > now at creation
  scopes: Set<Scope>          # non-empty; validated against user.allowed_scopes

  CONSTRAINT expires_at > created_at
```

**API surfaces / component props / data schemas:** whatever the build agent needs to know about the shape of things. Use the type notation above where precision matters, prose where it doesn't.

**Design decisions:** every tradeoff table, "X vs Y" comparison, or architecture pick must conclude with a canonical marker per the spec contract:
- `**Chosen:** X` / `**Decision:** X` — closed
- `**Punt:** X or Y — needs human` — open, in "Open Questions" section. When the punt's class is clear, emit the optional `(decides: <owner>)` suffix per the gateway (`product | architecture | qa | security | any`, or a free-form handle); omit when ambiguous, never guess. The `faff-contract:spec-readiness` block is unchanged — a tagged punt still emits `{ "marker": "punt" }`.
- `**Assumes:** X exists` — external dependency, in "Assumptions" section

### 4. HOW — Behavior

**Architecture and approach:** how the pieces connect. Prose for the overview, pseudocode for the mechanics.

**Pseudocode at ambiguity points:** anywhere prose alone could be interpreted two ways, provide a labeled-steps block:

```
PROCEDURE handle_expired_session(session):
  1. Check session.expires_at against current time
  2. IF expired:
     a. Revoke all active tokens for session.user_id
     b. Emit SessionExpired event with { session_id, user_id, expired_at }
     c. Return 401 with body { error: "session_expired", retry: false }
  3. IF not expired:
     a. Extend session.expires_at by SESSION_TTL
     b. Continue to next middleware
```

**Behavior summaries:** before complex procedures, a one-sentence plain-English summary of what the procedure accomplishes and why.

**Edge cases and error handling:**
- Fallback chains with explicit precedence
- Boundary conditions in pseudocode (not prose)
- Error categories: which are retryable, which are terminal, what the caller sees

**Failure modes — how the approach falls over, and how you'd notice.** Distinct from edge cases (inputs the code must handle): these are ways the chosen approach could be wrong, and the observable that reveals it. For each non-obvious risk in the design:

- **The failure** — what could be wrong about the approach, not the code: a confound that invalidates a measurement, an assumption that silently doesn't hold, a benefit that may not exist.
- **How you'd know** — the concrete signal: the metric that wouldn't move, the test that would fail, the number that comes back null.
- **What it means** — proceed / narrow / abandon. A null or negative result is a valid outcome to name here, not a gap to hide.

Emit only above the complexity bar (same judgement as Scenarios): a spike, a novel integration, or any design whose value rests on an unvalidated assumption. A mechanical CRUD change has none — forcing the section there is bloat.

**Anti-patterns:** near the section they affect, document what NOT to do and why. Format: `**Anti-pattern:** X. Why: Y.`

**Rule inventory:** a spec whose build deletes skill prose carries a `## Rule inventory` in the format at `docs/reference/skill-authoring.md#rule-inventory`, one row per deleted rule; `faff rule-inventory check` fails the PR otherwise.

### 5. SCENARIOS — born-verifiable main objectives

After HOW, a dedicated `## Scenarios` section makes the spec's **main objectives** directly verifiable.

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

Collect all decisions made throughout the spec. For each:

- **Bold question:** the decision that was faced
- **Options considered** with brief pros/cons
- **Marker:** `**Chosen:** X — rationale`

Rejected alternatives are documented here so the build agent doesn't re-propose them and future readers understand why.

Temporal anchors where relevant: "At the time of writing, library X does not support Y" — so the decision can be revisited when the landscape changes.

### 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** all `**Punt:**` items collected in one place. Each with enough context that a human reviewer can make the call without re-reading the full spec.

**Assumptions:** all `**Assumes:**` items collected in one place. Each with a validation instruction (how the build agent checks whether the assumption holds before starting).

### 8. DONE — Definition of Done

A testable checklist that **mirrors the body sections 1:1**. The closed-loop rule:

- Every WHY/WHAT/HOW section that introduces a requirement gets a matching DONE item
- Missing DONE items reveal untestable requirements — the spec has a gap
- Orphaned DONE items reveal ungrounded requirements — the body has a gap

Format:

```markdown
### From WHY
- [ ] Problem statement's pain point is addressed (specific observable behaviour)

### From WHAT (types and interfaces)
- [ ] UserSession record matches the defined schema
- [ ] scopes validated against user.allowed_scopes on creation

### From HOW (behaviour)
- [ ] Expired sessions return 401 with { error: "session_expired", retry: false }
- [ ] SessionExpired event emitted with correct payload
- [ ] Non-expired sessions extended by SESSION_TTL

### From HOW (edge cases)
- [ ] Concurrent expiry + renewal race condition handled per pseudocode
```

Each item must be concrete enough to write a test against. "Works correctly" is not a DONE item. "Returns 401 with body `{ error: "session_expired" }`" is.

Put a check the running system cannot show (a repository test file passing, a symbol being exported) in its own DONE item, apart from any CLI or HTTP behaviour. `faff dod classify` sends such an item to the review/merge test floor, so behaviour stated in the same item is not judged by the holdout.

Tag a done-item only a person can check with `needs-human: <reason>`, after any `[ac-N]` id. Every other done-item must be machine-checkable.

**Eval coverage.** If the work introduces or changes an LLM-judgement seam, a DONE item registers its grader `KIND` + ≥1 eval case + the seam-registry row in this same ticket — all autonomous-doable. Recording/accepting the baseline value is a separate human-supervised step and is never required by this DONE item.

**Integration smoke test:** pseudocode for one end-to-end happy path, checking connectivity rather than exhaustive coverage.

### 9. APPENDICES (optional)

Lettered A, B, C. For essential content that would disrupt narrative flow in the body:
- Attribute catalogs
- Format references
- Error catalogs with codes and messages
- Usage examples

Only include appendices when the body would become unreadable without extracting the content. Most specs won't need them.

## Confidence self-rating

End the spec with its confidence line:

```
confidence: high | medium | low
```

- **high** — every decision is marked, no open questions remain, DONE mirrors body completely
- **medium** — an open `**Punt:**` that `faff punt-scan "$spec_file"` does not report `eligible`, or the explore findings were ambiguous in places. A Punt is eligible only when it is tagged `(non-blocking)` **and** cross-referenced under OUT OF SCOPE; an unsupported tag leaves it blocking. A spec whose only open items are eligible Punts self-rates `high`. This is a mechanical read of the scanner, not a self-certification of the tag; tag honesty is the spec-review lens's call.
- **low** — significant unknowns, architectural uncertainty, or the issue may need splitting

Rate open decisions, not polish. A slip the builder can settle without making a new decision (a field missing from one example, an obvious unstated default) is fixed in the draft and does not lower the rating.

Faff-prep consumes the line for its gate (autonomous: `high` → promote; `medium` → attach + flag for review; `low` → park). **Retain it on the attached spec** as durable provenance and a re-spec signal for faff-graft, faff-beep-boop and faff-tidy's spec-health pass. Retained `confidence: medium` routes `needs-decision-first`.

## Quality bar — self-review before returning

Follow sibling `faffter-noon-spec/SKILL.md` → _Self-review before returning_ **in full**, including the narrowing-only refresh exemption. This producer always runs as a dispatched subagent, so verify every claim against the codebase in a fresh-reasoning pass in context. Return the findings and resolutions, and copy the severities to `self_review` as specified there.

## Contract artifact

Emit the gateway's **Spec readiness (fixed)** JSON shape, including `decisions` as marker objects in an array and `self_review` as severity strings in an array.

## Rules

- The spec contract markers (`**Chosen:**`, `**Punt:**`, `**Assumes:**`) are mandatory — this skill adds structure around them, not instead of them.
- The writing style rules from faff-prep (skimmable, no invented labelling schemes, restate subjects) apply fully.
- Pseudocode is language-agnostic. Do not write in a specific programming language — the build agent translates to the project's language.
- The spec must be buildable by a coding agent with only the spec as context. If a section requires external knowledge not in the explore findings, mark it `**Assumes:**`.
