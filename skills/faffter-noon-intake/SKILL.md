# faffter-noon-intake

The default intake / discovery producer. Turns a loose starting point — "I want to build X", a bug report, a half-formed feature idea, or an empty repo — into a structured **discovery brief** that the orchestrator hands to the `methodology` slot for shaping into tickets.

This is the implicit default for the `intake` slot when none is configured. It is the light, conversational counterpart to heavier ideation skills (`superpowers:brainstorming`, `gstack:office-hours`): same slot, same output contract, less ceremony. Extracted here so it can be invoked standalone, tested, and swapped.

```yaml
planning_skills:
  intake: faffter-noon-intake   # the default — explicit for clarity
```

## When it runs

Invoked by `/faff-noodle` as the configured `intake` skill (the default when the slot is unset). `/faff-noodle` decides the mode and passes it in; this skill runs the discovery conversation and returns the brief. It does **not** create tickets, touch the tracker, or write code — that is the orchestrator's job (`/faff-noodle`), which applies the `methodology` slot to the brief this skill produces.

Can also be invoked standalone: "help me scope a new feature" produces a discovery brief for review without the tracker lifecycle.

## Input

The caller (`/faff-noodle`) provides:

- **Mode** — `greenfield` (kick off an empty/new project) or `single-item` (a new feature, bug, or ticket inside an existing project).
- The human's starting description (whatever they said — a sentence, a paragraph, a pasted bug report).
- For `single-item`: context on the existing project — the live workstream/container list, naming conventions, and any current-priority signal (from the tracker + the consuming project's `CLAUDE.md`), so discovery can place the item correctly.
- For `greenfield`: any existing repo signal (language, framework, README) if the directory isn't truly empty.

## How it runs — discovery, not interrogation

A short, focused conversation. The goal is to extract just enough to shape tickets, not to write a spec (that's `/faff-prep`'s job, later, per ticket). Pull on the threads that change how the work breaks down; leave implementation detail for prep.

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

Stop pulling threads once the brief below can be filled. Unresolved questions are captured, not chased — they go into the brief as open questions for prep to resolve, not as blockers here.

## Output — the discovery brief (the `intake` slot contract)

A single markdown document in the shape below. This is the **intake-slot output contract**: the orchestrator and the `methodology` slot's `ticket-shaping` output both consume it, so any skill placed in the `intake` slot (including `superpowers:brainstorming` or `gstack:office-hours`) must emit this shape. Producers may add sections; they must not omit the required ones.

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

Rules for the brief:

- **Required sections:** `Goal`, exactly one of `Capabilities` (greenfield) or `Item` (single-item), `Constraints`, `Out of scope`. The rest are included when they have content; an empty section is omitted, not left blank.
- **No tickets here.** The brief describes the shape of the work; turning it into tickets (titles, relationships, sequencing, container placement) is the `methodology` slot's `ticket-shaping` output, applied by the orchestrator. Do not pre-write ticket titles or pick a structure — that is a methodology decision, and hard-coding it here defeats the point of the swappable `methodology` slot.
- **Names over invented codes.** Capabilities and dependencies are named in plain English, not labelled `C1`/`D2`. (Same skimmable writing-style rules the rest of faff follows.)
- **Greenfield ≠ a spec.** The brief is the input to ticket creation, not a build spec. Per-ticket specs are produced later by `/faff-prep`.

## Appetite

This skill reads the suite-wide `appetite` setting but has little to modulate — discovery is inherently a conversation with the human, so it runs the same at every level. The one effect: at `low`/`medium` appetite it asks more clarifying questions before closing the brief; at `high`/`full` it makes reasonable assumptions on minor ambiguities and records them under `Open questions` rather than stopping to ask. It never invents goals the human didn't express.

## Rules

- Discovery extracts what changes how work breaks down — no more. Resist drifting into implementation detail; that belongs to `/faff-prep`.
- This skill produces the brief; it does **not** create tickets, mutate the tracker, or write code. The orchestrator (`/faff-noodle`) owns those, applying the `methodology` slot to the brief.
- The discovery-brief shape is the slot contract. A third-party `intake` skill conforms by emitting the same required sections; the orchestrator then shapes and creates tickets identically regardless of which intake skill ran.
- Unresolved questions are captured in the brief, never used as a reason to refuse to produce one. A thin brief with open questions is valid output — prep resolves the rest.
