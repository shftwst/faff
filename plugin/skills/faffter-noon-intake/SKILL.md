---
name: faffter-noon-intake
description: "Default intake/discovery producer: turn an idea, bug or empty repository into a discovery brief for faff-jot or faff-plot through a light conversation."
user-invocable: false
judgement_seam: modedetect
---

# faffter-noon-intake

Default `intake` slot: a light discovery conversation that turns an idea, bug or new repository into a discovery brief. Faff-jot supplies the mode and context, then applies the methodology's `ticket-shaping` output to the brief. Heavier intake skills can replace this producer if they emit the same required sections.

Standalone invocation returns a brief for review. This producer never creates tickets, mutates the tracker or writes code. The orchestrator owns that lifecycle; methodology owns ticket titles, relationships, sequencing and container placement.

## Input

The caller (`/faff-jot`) provides:

- **Mode** — `greenfield` (kick off an empty/new project) or `single-item` (a new feature, bug, or ticket inside an existing project).
- The human's starting description (whatever they said — a sentence, a paragraph, a pasted bug report).
- For `single-item`: context on the existing project — the live workstream/container list, naming conventions, and any current-priority signal (from the tracker + the consuming project's `CLAUDE.md`), so discovery can place the item correctly.
- For `greenfield`: any existing repo signal (language, framework, README) if the directory isn't truly empty.

## How it runs — discovery, not interrogation

Keep discovery short: gather enough to shape tickets, leaving specs and implementation detail to `/faff-prep` later, per ticket. Ask about facts that change how work breaks down.

### `greenfield` mode

Establish the shape of the whole thing:

1. **What is it / who is it for** — the product or system in one or two sentences, and the user it serves.
2. **The major capabilities** — the handful of distinct things it must do. These become candidate workstreams.
3. **The first slice** — what "v0" or "the first useful version" looks like. This is what sequences to the front.
4. **Hard constraints** — language, framework, platform, deadline, anything non-negotiable that governs how work is grouped.
5. **Explicit non-goals** — what this is deliberately not, so the methodology doesn't manufacture tickets for it.

### `single-item` mode

Establish enough to write one well-formed ticket (or a small set if it splits):

1. **Intent** — what the user wants to happen that doesn't today (feature), or what's broken (bug).
2. **Done signal** — how you'd know it works. Rough acceptance signals, not full criteria.
3. **Affected area** — which part of the existing system / which workstream this belongs to.
4. **Known dependencies** — anything that must ship first, or that this enables.
5. **Size sense** — is this one ticket, or does it obviously span two independent concerns? (Don't force a split — just flag it for the methodology to decide.)

Stop once the brief below can be filled. Capture unresolved questions for prep under open questions; do not chase them or block the brief.

## Output: the discovery brief

Emit one Markdown document in this intake-slot contract, consumed by the orchestrator and methodology. Additional sections are allowed; required sections cannot be omitted.

```markdown
# Discovery brief: <short name>

mode: greenfield | single-item

## Goal
<1–3 sentences: what we're building / fixing and who it's for.>

## Capabilities          # greenfield: the major distinct areas (workstream candidates)
- <capability> — <one line on what it covers>
...

## Item                  # single-item: the one feature/bug, replaces Capabilities
intent: <what should happen / what's broken>
done-signal: <how you'd know it works>
area: <which existing workstream / part of the system>
split-sense: unitary | possibly-splittable (<the two concerns, if so>)

## First slice           # greenfield only: what v0 is — sequences to the front
<the smallest useful version>

## Constraints
- <hard constraint: language / framework / platform / deadline / convention>
...

## Dependencies
- <known prerequisite or enabled-by relationship, named as concretely as possible>
...

## Out of scope
- <explicit non-goal> — <one line>
...

## Open questions
- <thing the human didn't resolve — carried forward for /faff-prep, not blocking>
...
```

Brief rules:

- Always include `Goal`, `Constraints`, `Out of scope` and exactly one of `Capabilities` (greenfield) or `Item` (single-item). Include other sections only when populated; omit empty optional sections.
- Describe the work without pre-writing ticket titles or choosing its ticket structure. Flag possible splits for methodology to decide.
- Name capabilities and dependencies in plain English, never invented `C1`/`D2` codes.
- A thin brief with open questions is valid. Capture unresolved questions for prep; never refuse the brief because of them. Discovery stops once the shape is clear; implementation detail and per-ticket specs belong to `/faff-prep`.

## Appetite

This skill reads the suite-wide `appetite` setting but has little to modulate — discovery is inherently a conversation with the human, so it runs the same at every level. The one effect: at `low`/`medium` appetite it asks more clarifying questions before closing the brief; at `high`/`full` it makes reasonable assumptions on minor ambiguities and records them under `Open questions` rather than stopping to ask. It never invents goals the human didn't express.

