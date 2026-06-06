---
name: faffidavit-rendering
description: "Default `rendering_adaptor` — the house output style (visual-vs-prose, canonical visual forms, table-vs-list, density caps) plus validation of draft output. The one slot with no internal contract. Runs as a configured slot, not the user `/` menu."
user-invocable: false
---

# faffidavit-rendering

The default **adaptor** for the `rendering_adaptor` slot — and the one slot with **no internal contract** behind it. It defines how faff sub-skills turn structure into output (when to draw a visual vs prose, the catalogue of canonical visual forms, the markdown-table-vs-definition-list rule, density caps), and **validates/normalises** draft output against those rules on demand. A `faffidavit-*` skill: it both *defines* the house rendering style and *checks* conformance, so it's invokable rather than a passive style guide.

Every sub-skill that emits user-facing output renders through it; it can be swapped wholesale for a different house style.

```yaml
slots:
  rendering_adaptor: faffidavit-rendering   # the default — explicit for clarity
```

## No internal contract — a pure adaptor

The other three adaptor slots (`review_adaptor`, `routing_adaptor`, `spec_adaptor`) each sit in front of a **fixed internal contract** in the gateway — verdict states, vocabularies, classifications the pipeline branches on. Rendering has none: no pipeline code branches on, counts, or gates on how output *looks*. It is purely human-facing. So there is nothing fixed in the gateway for this slot to translate *into* — the whole skill is the adaptor, swappable end to end. Swap it and house style changes wholesale, with no pipeline behaviour affected.

## Why an adaptor, not a producer

Unlike `spec` — which splits into a producer (`faffter-noon-spec`, issue → new spec) and an adaptor (`faffidavit-spec`, native spec → markers + pass/fail) — rendering has no separable generative act. There's no "render from nothing": every render is a transform of data some other skill already holds, and choosing the right form (cycle bracket vs cycle box) needs the domain understanding of what that structure *means*. So a standalone rendering *producer* would have no natural caller. What rendering genuinely is, is a standard **referenced by many skills** (every sub-skill renders "according to" it) plus a standalone normalise act — exactly the adaptor shape. The "produce" the producer-framing reaches for is already the validate/normalise face below. Don't re-split this into a `faffter-noon-rendering`.

## Two faces

- **Define** (reference): the visual-vs-prose split, the canonical visual forms, the table-vs-list rule, and the density caps below. Sub-skills read this and render accordingly.
- **Validate / normalise** (invokable): given draft output, flag (or rewrite) violations — markdown tables that should be definition lists, structure narrated as prose that should be a visual, visual walls that breach the density caps. Invoked as a final pass, or standalone: "normalise this output to house style."

## Visualisation over prose

When output describes **structure** (chain, partition, cycle, queue, workstream layout, fire/blocked gate map, dep graph), render it as a compact visual. Reserve prose for diagnosis, decision, and "do this next" recommendation.

Test: if a reader can point at the visual and ask "is this right?" without re-reading prose, it's the right form.

## Canonical visual forms

Callers pick from this catalogue. Inventing new visual forms inline is forbidden — if a skill needs a sixth form, this section gains it first.

**(a) Cycle bracket** (3+ items inline)

```
[ISSUE-AA → ISSUE-BB → ISSUE-CC → ISSUE-AA]
```

Used for any dep cycle, any collision-group serialisation, any "X depends on Y" chain rendered inline. 3+ items only — for a 2-item dep, use plain prose.

**(b) Cycle box** (4+ edges or branching)

```
ISSUE-AA ──► ISSUE-BB ──► ISSUE-CC
   ▲                          │
   └──────────────────────────┘
```

Used when the cycle has 4+ edges or when branching makes the bracket form unreadable.

**(c) Queue partition grid**

```
fire-and-forget (independents)        likely-fire (serialised)
  ISSUE-XX                              [ISSUE-A → ISSUE-B]   src/auth/
  ISSUE-YY                              [ISSUE-C → ISSUE-D]   db migrations
```

Used in queue/build-summary renders. Each cell has the ID + the synthesis gloss (one line per ID — see the synthesis contract).

**(d) Workstream lane**

```
Initiative — Audit-lite reliability

Now    Logging cleanup            [started]   ISSUE-XX, ISSUE-YY
Next   Audit log retention        [planned]   ISSUE-ZZ
Later  (no project planned)       ⚠ structural gap
```

**(e) Gate fire-status table**

```
| Gate                            | Currently fireable? | Notes                            |
|---------------------------------|---------------------|----------------------------------|
| Logging → Audit retention       | Yes                 | once SHF-217 ships               |
| Audit retention → Audit lite    | ⚠ Blocked           | downstream project doesn't exist |
```

## When prose still wins

Three carve-outs where prose stays:

1. **The synthesis gloss itself** (see the synthesis contract) — the plain-English one-liner is the whole point; a glyph won't help.
2. **Diagnosis lines** — "Recommendation: strip the CC→AA edge (defensive-only)." A visual can't carry "what to do".
3. **TL;DR** — a skim-in-10-seconds summary stays prose. Visuals at the top invert that.

## Synthesis — the issue-gloss contract

Every issue rendered in any faff output — wtf's "Do this", map's workstreams, tidy's findings, beep-boop's queues, routing's verdict display, anywhere — carries three elements:

1. **Tracker ID** — breadcrumb for traceability
2. **One-sentence plain-English gloss** — what the work actually is in human terms (not the tracker title verbatim; a generated sentence based on title + spec + description)
3. **Unlock-chain consequence** (only when non-trivial) — what becomes possible once this lands, in human terms

This is part of the rendering contract because it governs *how an issue is described* in output — the content sibling of the visual-vs-prose split. References elsewhere to "gateway → Synthesis contract" resolve to the `rendering_adaptor` slot.

### Canonical rendering

```
ISSUE-XX — Pino instrumentation across the request path
  Wire structured logging into every API handler so request-scoped fields
  (user id, trace id, route) attach automatically. Once this lands, the
  three downstream alerting tickets can build on a real log schema.
```

In tight tabular contexts (queues, ready lists), compress the gloss to a clause:

```
ISSUE-XX   Pino instrumentation — wires structured logging into all handlers · unlocks 3 alerting tickets
```

In high-density visualisations (queue partition grids, chain diagrams), show only the gloss subject; the unlock consequence lives in a one-line footnote keyed by ID.

### Generation source order

In order of preference:

1. The spec's one-line summary if it has one
2. The issue title plus the first 2-3 sentences of the spec
3. The issue title plus the description if no spec exists

The skill **paraphrases** — does not just truncate. Tracker shorthand ("re: SHF-217 dep chain", "as discussed") is replaced with what was actually meant.

### Humanisation rule

The gloss is a delivery lead briefing a colleague, not a project manager filing a status report. A delivery lead bridges product, engineering, and business stakeholders by making work understandable, bite-sized, and transparent. Leaning on numbered references to internal documents — "principle 6", "ADR-0008", "trigger 4", "PRs 3-N" — is the opposite: project-management smoke-and-mirrors that makes the writer look indispensable while making the reader work to decode it.

**Banned in user-facing output:**

| Banned form | Why | Use instead |
|---|---|---|
| "principle 6", "principle 4", "principle N" | Reader doesn't have the methodology spec open; the number is a private convention | Say what the principle is *about* in the sentence — "the spec references work that isn't ticketed" not "this violates principle 6" |
| "ADR-0008", "ADR-N" | ADR ID is a stable identifier for traceability but can't replace explanation | Say what the ADR decides — "the audit pipeline ADR's wave-1 sign-off" not "ADR-0008" |
| "trigger 4", "criterion 3", "gate 2" | Numbered conditions inside a document the reader hasn't opened | Say what the condition tests — "a real end-to-end run on a real subject" not "trigger 4" |
| "PRs 3-N", "PR A..E", "step 5 of M" | Schematic counting where the reader can't tell what each PR does | Name each piece by what it ships — "the consumer wire-up PR, three per-stage lift PRs, and the default-flip PR" not "PRs 3-N" |
| "SHF-307a..e", "SHF-XX/YY/ZZ" used as live IDs | Made-up IDs that don't exist; reader can't click through | Either use real IDs once they exist, or describe the work — "five sub-tickets, one per remaining piece" not "SHF-307a..e" |
| "the parked-by-faff label was already cleared" (jargon as subject) | Reader doesn't know the label semantics | Say what happened in human terms — "the autonomous park was cleared two days ago when someone picked it up" |

**Allowed:**

- Real tracker IDs (ISSUE-XX, #PR-N) — stable, clickable, identify a specific thing.
- Short self-explanatory category names that *describe* a finding kind ("sub-ticket gap", "upstream gap", "repeat-park", "chain gap") — they tell the reader what was found, not which internal rule was matched.
- Principle / ADR / criterion references **alongside** plain-English explanation as traceability — "the spec assumes a wave-1 run has happened (the gate from the audit pipeline ADR)" — never standing in for explanation.

**Test:** if a reader who has never opened the project's CLAUDE.md, methodology spec, or ADR archive can't follow the finding, the rule is broken. Rewrite.

**Why this matters:** faff is a delivery lead, not a project manager. A delivery lead humanises work; a project manager codifies it to look valuable. We do the first. Every finding, every brief, every diagnosis renders the *substance* of what's going on, not the index entry that catalogues it.

### Unlock-chain language

Reserved for issues with ≥2 direct dependents, or any dependent that itself gates ≥2 issues (chain-of-3). Written in **consequence not count** form:

- ✅ "Once this lands, the three downstream alerting tickets can build on a real log schema."
- ❌ "Unlocks 3 issues."

If the unlock chain is just 1 isolated dependent, skip the consequence line entirely — counting it is noise.

### Honesty escape hatch

If the spec is genuinely ambiguous, the gloss says so explicitly:

> _Spec ambiguous: extend the existing logger vs. swap for pino; gloss reflects the title only._

A reliable-but-thin gloss beats a confident-sounding-but-wrong one.

### Caching

Glosses generated for a given issue id during one invocation are reused within that invocation. **Not cached across invocations** — tracker state changes, and the "always pull fresh" rule wins.

### Consumption

Every faff sub-skill that names an issue in output applies this contract. Each sub-skill's `Output Format` section references it via `See the rendering_adaptor slot → Synthesis` (or the legacy `gateway → Synthesis contract`, which resolves here) rather than re-stating.

## Tabular data: markdown tables vs definition lists

Markdown tables break in narrow terminals when cells are long. They render as `Column 1: …` repeated per row, mid-word truncation, and rows crashing into each other — the data is technically present but unreadable.

**Scope:** this rule applies to **user-facing terminal output** emitted by faff sub-skills (diagnostics, morning briefs, roadmap renders, in-conversation summaries). It does **not** apply to skill source files (`skills/*/SKILL.md`) — those are documentation read in wider contexts (Claude Code editor panes, GitHub UI), where specification tables with prose cells are fine. It also does not apply to internal `.faff/runs/<run-id>/…` logs.

**Drop the markdown table when any of:**

1. Any cell exceeds ~30 characters.
2. Any cell contains multi-sentence prose.
3. Total table width (cells + separators) likely exceeds ~80–120 chars.

When none of these fire, markdown tables remain the right choice — they're compact and scannable for short-label tabular data (verdict counts, status counts, single-word rows).

**Use definition-list / key:value blocks instead.** Each conceptual table row becomes a block of `Key: value` lines separated by the unicode box-drawing rule `────────────────────────────────────────` (`─` × 40). The lead-in line names the row's primary identifier; subsequent lines carry the columns. Example — broken markdown table on the left, definition-list rewrite on the right:

```
| Ticket | Title                   | State | Scope                                   |
|--------|-------------------------|-------|-----------------------------------------|
| SHF-X  | Prompt substrate retar… | Done  | Different — moved prompts, not stage l… |
| SHF-Y  | HMAC envelope + BG wo…  | Done  | Different — wrapper layer, not stage l… |
```

Rewritten:

```
Ticket: SHF-X
Title: Prompt substrate retarget (move *.prompt.md + codegen)
State: Done
Scope: Different — moved prompts, not stage logic
────────────────────────────────────────
Ticket: SHF-Y
Title: HMAC envelope + BG worker relocation
State: Done
Scope: Different — wrapper layer, not stage logic
```

The separator is unicode `─` × 40, not markdown `---`. Markdown `---` renders as `<hr>` in some contexts and is often invisible in terminal chat panes — the unicode rule reads consistently across renderers.

## Density caps

A wall of small visuals is the same problem as a wall of text. Each rendered section caps:

- **Cycle visualisations:** at most 3 per output; if there are more cycles, list the rest as ID-only one-liners with "(see structural diagnostics log)"
- **Queue partition grid:** at most 10 rows visible; rest collapses to "(+ N more)" with the full list in the log
- **Workstream lane:** at most 7 initiatives in the live view; rest in log

## Validation / normalise

Run as a final pass over draft output, or on demand against any block.

**Checks:** markdown tables that breach the table-vs-list thresholds; structure narrated as prose where a canonical visual exists; inline-invented visual forms outside the catalogue; density-cap overflows.

**Output:** either a list of violations (`where → which rule → the fix`), or the normalised block with the fixes applied, depending on how the caller invokes it.

## Rules

- The catalogue is closed. A skill that needs a new visual form adds it here first, then uses it — never invents one inline.
- The visualisation/prose split is non-negotiable: structure is visual, judgement is prose. Don't narrate a graph; don't tabulate a recommendation.
- These rules govern user-facing output only. They do not constrain `.faff/` logs or skill documentation.
- Validation reports or normalises; it does not change what the output says, only how it's rendered.
