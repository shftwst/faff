---
name: faffidavit-rendering
description: "Default rendering_adaptor: human-facing form, issue glosses, house voice and draft normalisation. No internal contract. Configured slot, not a user command."
user-invocable: false
judgement_seam: gloss, explanatory-order
---

# faffidavit-rendering

Defines rendering for every faff sub-skill and validates or normalises its drafts. Set `slots.rendering_adaptor` to replace the default form rules and validation.

## No internal contract

Rendering transforms supplied content for human readers. No pipeline code branches, counts or gates on its appearance. Unlike routing or producer contracts, it has no fixed internal contract. Changing its form rules cannot change workflow decisions.

## Two faces

- **Define:** callers read the form, synthesis and density rules and render accordingly.
- **Validate / normalise:** given a draft, report violations or rewrite its presentation. Preserve its facts and recommendations; do not make new delivery decisions. Rendering remains one adaptor, not a separate producer or voice slot.

## Scope

Applies to terminal output, tracker descriptions and tracker comments. Excludes skill source files (`skills/*/SKILL.md`) and internal `.faff/` logs. Each emitting skill runs the final normalise pass before printing or writing; there is no central emit point.

## Voice

The fixed voice source is repository-root `AGENTS.md`, section `# Writing style`. Follow it without copying its rules here. Gateway **Producer dispatch → Voice clause** owns the pointer injected into durable-prose dispatches, including the engine-lane carrier.

A project changes voice by editing that section, read fresh on the next dispatch without caching. Swapping `rendering_adaptor` changes form and validation, never the voice-source path: dispatch sites stamp that pointer without reading this adaptor first.

## Prose skimmability

Rewrite violations:

- Three or more enumerable items become a markdown list, never a comma- or middle-dot run-on. Two may stay inline.
- Use bold-lead bullets, `- **Label:** detail`, for scannable items.
- Keep a prose block within roughly three sentences or four lines, then split it into paragraphs or a list. Diagnosis, decisions and next actions may remain prose within that cap.

## Output token economy

Rewrite to remove preambles/postambles, echoes of the request, explanations of what a list/visual/diff already shows, and hedge or qualifier padding. Start with the substance and stop when it ends. A gloss of what shipped, diagnosis and a next action remain useful content; retain them where needed.

## Visualisation over prose

Render structure as a compact visual: chains, partitions, cycles, queues, workstreams, gate maps and dependency graphs. Use prose for diagnosis, decisions and next actions. A reader should be able to check the structure by pointing at the visual without rereading explanatory prose.

## Canonical visual forms

The catalogue is closed. Add any required new form here before a caller uses it; never invent one inline.

**(a) Cycle bracket:** inline cycles, collision-group serialisation or dependency chains with three or more items. Use prose for a two-item dependency.

```
[ISSUE-AA → ISSUE-BB → ISSUE-CC → ISSUE-AA]
```

**(b) Cycle box:** cycles with four or more edges, or branching that makes a bracket unreadable.

```
ISSUE-AA ──► ISSUE-BB ──► ISSUE-CC
   ▲                          │
   └──────────────────────────┘
```

**(c) Queue partition grid:** queues and build summaries. Each ID has a one-line synthesis gloss.

```
fire-and-forget (independents)        likely-fire (serialised)
  ISSUE-XX  Login form                  [ISSUE-A → ISSUE-B]   src/auth/
  ISSUE-YY  Session refresh             [ISSUE-C → ISSUE-D]   db migrations
```

In a dense diagram, ground each ID's gloss subject nearby and key consequence footnotes by ID.

**(d) Workstream lane:** initiative and Now/Next/Later stages, status, issue IDs and structural gaps.

```
Initiative: Audit reliability

Now    Logging cleanup            [started]   ISSUE-XX, ISSUE-YY
Next   Audit log retention        [planned]   ISSUE-ZZ
Later  (no project planned)        structural gap
```

**(e) Gate fire-status table:** gate, current fireability and reason. Apply the table-width rule below when notes are long.

```
| Gate                 | Fireable? | Notes           |
|----------------------|-----------|-----------------|
| Logging → Retention  | Yes       | Logging shipped |
| Retention → Audit    | Blocked   | Missing project |
```

Examples show schematic IDs; real output must use existing IDs with the grounding required below.

## When prose still wins

1. The synthesis gloss: a plain-English description of the work.
2. Diagnosis and recommendation lines: what to do with the structure.
3. TL;DR: a prose summary readable in ten seconds, before visuals.

## Lead with the load-bearing model

An explanation of a mechanism, decision or diagnosis begins with the source's governing idea in plain language. Then order the content as concrete mechanism, how it is measured/used, and what it means.

Hoist an existing statement; never invent a governing model. If none exists, flag `where → no load-bearing model to lead with` for the producer. This changes which prose leads, not the TL;DR's prose-first rule.

## Synthesis: the issue-gloss contract

Every rendered issue carries its real tracker ID, a one-sentence plain-English gloss of the work, and a consequence only when the unlock chain is non-trivial. This applies everywhere issues are named: findings, briefs, diagnoses, queues, workstreams and verdicts. For a plain issue gloss, put one sentence beside the ID; do not repeat it as both a title and a body. Briefly explain an unfamiliar work term within that sentence: memoising reuses a computed result, for example. Tight queue clauses and dense-diagram subjects remain the exceptions below.

### Canonical rendering

```
ISSUE-XX: Structured logging across the request path
  Wire logging into every API handler so user ID, trace ID and route attach
  automatically. The downstream alerting work can then use a real log schema.
```

In a tight queue or ready list, compress the gloss to a clause. In dense grids or diagrams, show the gloss subject and put any consequence in a one-line footnote keyed by ID. Keep the consequence about what becomes possible, not a bare count.

### First-mention grounding

Put the gloss at an ID's first appearance. Later references in the same whole output may use the bare ID. An ID that is only ever bare violates the mechanical floor: insert its gloss at first mention when derivable, otherwise flag it.

Grounding once does not waive the reader test. Re-ground a later reference when its new section would otherwise be unintelligible.

### Generation source order

1. The spec's one-line summary, if present.
2. The issue title plus the spec's first two or three sentences.
3. The issue title plus description when no spec exists.

Paraphrase rather than truncating the title. Replace shorthand such as "as discussed" with its meaning. Preserve the work's own terms, such as rate limiting, cold start or memoising, and explain around them so the reader can match the gloss to the ticket.

### Humanisation rule

A reader without the project's CLAUDE.md, methodology spec or ADR archive must understand the finding. Rewrite when they cannot.

- Explain what a principle, ADR, trigger, criterion or gate says; its number cannot substitute for that explanation. A reference alongside the explanation is allowed for traceability.
- Name what each PR or step ships; avoid schematic ranges that hide the work.
- Use real tracker/PR IDs. Never present invented sub-ticket IDs or placeholder ranges as live identifiers; describe the planned work until real IDs exist.
- Explain what happened in human terms instead of making an internal label the subject.
- Short, descriptive finding categories such as "sub-ticket gap" and "repeat-park" are allowed.
- Surface checkable nouns already in the source: actual fields, files and subsystems. Preserve `cache_read_input_tokens` when that is the field involved. Never invent a precise field, file or number when the source supplies only an abstraction.

### Unlock-chain language

Include a consequence only for at least two direct dependents, or a dependent that itself gates at least two more issues. One isolated dependent gets no consequence line.

Say what becomes possible, for example "The downstream alerting work can use a real log schema." A bare "Unlocks 3 issues" is insufficient.

### Honesty escape hatch

State source ambiguity explicitly rather than resolving it without evidence: "Spec ambiguous: extend the logger or replace it; gloss reflects the title only."

### Caching

Reuse an issue's gloss within one invocation. Never cache it across invocations; fetch current tracker state each time.

### Consumption

Every sub-skill naming an issue applies this contract. Its `Output Format` points to `rendering_adaptor → Synthesis` instead of copying these rules.

## Tabular data: markdown tables vs definition lists

Replace a markdown table when any cell exceeds roughly 30 characters, contains multiple sentences, or the whole table including separators likely exceeds roughly 80–120 characters. Short labels and counts stay in a markdown table when none of those conditions apply.

For a replacement, make each row a block of `Key: value` lines. Lead with the primary identifier, then carry every remaining column. Separate rows with `─` repeated 40 times, never markdown `---`, which can disappear as a horizontal rule in terminal chat panes.

```
Ticket: ISSUE-X
Title: Move the prompt files and their code generation
State: Done
Scope: Prompt location changed; stage logic retained
────────────────────────────────────────
Ticket: ISSUE-Y
Title: Relocate the envelope wrapper and worker
State: Done
Scope: Wrapper location changed; stage logic retained
```

The scope exclusions above apply: skill documentation may keep wide specification tables, and internal logs are unconstrained.

## Density caps

- **Cycles:** at most three visualisations per output. Remaining cycles are ID-only one-liners with `(see structural diagnostics log)`; ground those IDs elsewhere in the output.
- **Queue grid:** at most ten visible rows; show `(+ N more)` and put the full list in the log.
- **Workstream lane:** at most seven initiatives in the live view; put the remainder in the log.

## Validation / normalise

Before emission, or when explicitly invoked, check the draft against all rules above: voice, scope, skimmability, ceremony, visual form, table thresholds, density, issue grounding, explanation order and concrete source nouns.

Return either `where → which rule → the fix` violations or the corrected block, as requested. Skimmability and token-economy violations are rewritten. Hoist a supplied governing statement, insert derivable glosses, and surface source nouns; flag missing source information rather than fabricating it. Preserve meaning and recommendations throughout.
