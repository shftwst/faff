---
name: faffidavit-rendering
description: "Default `rendering_adaptor` — the house output style and prose voice (visual-vs-prose, canonical visual forms, table-vs-list, density caps, house voice) plus validation of draft output. The one slot with no internal contract. Runs as a configured slot, not the user `/` menu."
user-invocable: false
judgement_seam: gloss, explanatory-order
---

# faffidavit-rendering

The default **adaptor** for `rendering_adaptor` defines output form (visuals, tables/lists and density caps) and prose **Voice**, and validates/normalises drafts on demand. It has **no internal contract**. This `faffidavit-*` skill both defines style and checks conformance; it is invokable, not a passive guide.

Every sub-skill that emits user-facing output renders through it; it can be swapped wholesale for a different house style.

```yaml
slots:
  rendering_adaptor: faffidavit-rendering   # the default — explicit for clarity
```

## No internal contract — a pure adaptor

`routing_adaptor` translates into the gateway's fixed six-verdict contract. The `spec` / `review` / `ship` contracts are producer-emitted `faff-contract:<name>` blocks parsed by consumers; their adaptor slots were retired. Rendering has no such contract: pipeline code never branches, counts or gates on appearance. The whole human-facing adaptor can be swapped without affecting pipeline behaviour.

## Why an adaptor, not a producer

`faffter-noon-spec` produces a spec from an issue and self-declares `faff-contract:spec-readiness`. Rendering instead transforms data another skill holds; choosing forms (cycle bracket vs cycle box) requires understanding that structure. It has no separable generative act or natural standalone producer caller. Its shared standard plus invokable normalise pass is the adaptor; do not split out `faffter-noon-rendering`.

## Two faces

- **Define** (reference): the visual-vs-prose split, the canonical visual forms, the table-vs-list rule, and the density caps below. Sub-skills read this and render accordingly.
- **Validate / normalise** (invokable): given draft output, flag (or rewrite) violations — markdown tables that should be definition lists, structure narrated as prose that should be a visual, visual walls that breach the density caps. Invoked as a final pass, or standalone: "normalise this output to house style."

## Scope — all human-facing faff output

Apply all rules to **all human-facing faff output: terminal output, tracker descriptions and tracker comments** (gateway → **Rendering**, Universal-routing rule). Only skill source files (`skills/*/SKILL.md`) and internal `.faff/` logs are exempt. With no central emit point, each skill runs normalisation immediately before printing or writing.

## Voice

Voice (casual-but-credible, claims discipline, banned words) lives only in repo-root **`AGENTS.md`**, **`# Writing style`**. Reference it; never copy it. This fixed convention keeps one source; `faff validate-adapters` fails CI on blocks duplicated across skills.

**Injection.** Every durable-prose dispatch carries a one-line STYLE-source pointer for context-stripped executors. The gateway owns the envelope, carrier rule and engine-lane fork (gateway → **Producer dispatch → Voice clause**); this charter owns voice's purpose.

**Swapping the voice.** Edit `AGENTS.md`'s `# Writing style`; each dispatch reads it fresh, without caching. Dispatch sites stamp this fixed pointer without reading the adaptor. Swapping the adaptor changes form and validation, not the voice source path.

**Fold, not a sibling.** Voice and form share this human-facing, contract-free adaptor and one swap point. Do not split a sibling `voice` slot now; independent voice swapping remains a possible future extraction.

## Prose skimmability

Enumerable content must be skimmable. Validate/normalise **rewrites**, rather than merely flags, violations:

- **3+ items → a list.** Any enumerable set of three or more items renders as a markdown list, never a `·`- or comma-separated run-on paragraph — the same 3+ threshold the canonical visual forms use for inline chains. A 2-item set may stay inline prose.
- **Bold-lead bullets** for scannable items: `- **label** — detail`, so the eye lands on the label.
- **Prose density cap.** A prose block stays within ~3 sentences / ~4 lines before it must break into a list or separate paragraphs. Diagnosis, decision, and "do this next" prose (the visual-vs-prose carve-outs) still win where they apply, but stay within the cap.

This rule governs tracker descriptions and comments as much as terminal output (per Scope above). The canonical anti-example is a long "Open questions" set written as one `·`-delimited paragraph — it must render as a bulleted list.

## Output token economy

Token economy is part of *understandable-not-unapproachable*. Validate/normalise **rewrites**, rather than merely flags, ceremony that adds no information:

- **No preamble/postamble.** Drop the conversational frame — "Here is the…", "I've gone ahead and…", "Let me know if you'd like…", "Hope this helps". Open on the substance; end when it ends.
- **Don't restate the ticket/request.** The reader just asked; echoing their ask back is filler. *Use instead:* go straight to the answer (a one-line gloss of *what shipped* is the synthesis contract's job, not a restatement of the brief).
- **Don't narrate what the output already shows.** When a list, visual, or diff carries the result, prose re-explaining it is redundant. *Use instead:* let the artefact speak; add prose only for diagnosis or "do this next".
- **No hedge/qualifier padding.** Cut "it's worth noting that", "as you can see", "essentially", "in order to" and stacked hedges. *Use instead:* state it plainly once.

This does **not** sacrifice the **When prose still wins** carve-outs (synthesis gloss, diagnosis, "do this next") — those are substance, not ceremony, and still win where they apply.

**Scope:** same as **Scope — all human-facing faff output** above (terminal, tracker descriptions, tracker comments; carve-outs = skill source files and `.faff/` logs). No separate scope.

## Visualisation over prose

When output describes **structure** (chain, partition, cycle, queue, workstream layout, fire/blocked gate map, dep graph), render it as a compact visual. Reserve prose for diagnosis, decision, and "do this next" recommendation.

Test: if a reader can point at the visual and ask "is this right?" without re-reading prose, it's the right form.

## Canonical visual forms

Callers pick from this catalogue. Inventing new visual forms inline is forbidden — if a skill needs a new form, this section gains it first.

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

## Lead with the load-bearing model

When output explains a mechanism, decision, or diagnosis, its first line states the governing idea in plain terms before any mechanics — the one sentence a reader needs to make sense of everything after it ("caching is prefix-based, not content-based").

- **Hoist, don't write.** This rule reorders — moves a load-bearing statement the source already contains to the front. It does NOT author a model the source lacks. If there is none to hoist, that is a producer gap: flag it (`where → no load-bearing model to lead with`), never fabricate one.
- **Mechanism, then method, then so-what.** Past the lead, order runs concrete mechanism → how it's measured/used → what it means. Don't strand the model in a footnote slot.
- **Carve-out unchanged.** TL;DR still leads with prose, not a visual; this governs which prose leads, not whether.

## Synthesis — the issue-gloss contract

Every issue rendered in any faff output — wtf's "Do this", map's workstreams, tidy's findings, beep-boop's queues, routing's verdict display, anywhere — carries three elements:

1. **Tracker ID** — breadcrumb for traceability
2. **One-sentence plain-English gloss** — what the work actually is in human terms (not the tracker title verbatim; a generated sentence based on title + spec + description)
3. **Unlock-chain consequence** (only when non-trivial) — what becomes possible once this lands, in human terms

The contract governs how issues are described, alongside the visual-vs-prose rules.

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

### First-mention grounding

The **first** appearance of each issue ID carries its gloss (`ID + gloss`, per **Canonical rendering**). Later references in the same output may be bare. An ID never grounded anywhere in that output violates the rule.

- **Granularity is per-whole-output** — one grounding anywhere in the output satisfies the rule. (A skill *may* re-ground in a later section when a bare ID there would read unintelligibly, but that's the Humanisation test below talking, not this mechanical rule.)
- **This does not supersede the Humanisation rule.** First-mention grounding is the mechanical floor; a bare later reference must still pass the Humanisation reader-test in its context. Where it wouldn't, re-ground it there.

Grounding once is the mechanical minimum enforced by **Validation / normalise**.

### Generation source order

In order of preference:

1. The spec's one-line summary if it has one
2. The issue title plus the first 2-3 sentences of the spec
3. The issue title plus the description if no spec exists

The skill **paraphrases** — does not just truncate. Tracker shorthand ("re: SHF-217 dep chain", "as discussed") is replaced with what was actually meant. Paraphrase the framing, not the subject: keep the work's own terms for what it changes and how (rate limiting, cold start, memoising) so the reader can match the gloss to the ticket, and explain around them.

### Humanisation rule

Write the gloss as a delivery lead briefing a colleague: make work understandable, bite-sized and transparent across product, engineering and business. Internal document references such as "principle 6", "ADR-N", "trigger 4", "PRs 3-N" make the reader decode the report instead.

**Banned in user-facing output:**

| Banned form | Why | Use instead |
|---|---|---|
| "principle 6", "principle 4", "principle N" | Reader doesn't have the methodology spec open; the number is a private convention | Say what the principle is *about* in the sentence — "the spec references work that isn't ticketed" not "this violates principle 6" |
| "ADR-N" | ADR ID is a stable identifier for traceability but can't replace explanation | Say what the ADR decides — "the audit pipeline ADR's wave-1 sign-off" not "ADR-N" |
| "trigger 4", "criterion 3", "gate 2" | Numbered conditions inside a document the reader hasn't opened | Say what the condition tests — "a real end-to-end run on a real subject" not "trigger 4" |
| "PRs 3-N", "PR A..E", "step 5 of M" | Schematic counting where the reader can't tell what each PR does | Name each piece by what it ships — "the consumer wire-up PR, three per-stage lift PRs, and the default-flip PR" not "PRs 3-N" |
| "SHF-307a..e", "SHF-XX/YY/ZZ" used as live IDs | Made-up IDs that don't exist; reader can't click through | Either use real IDs once they exist, or describe the work — "five sub-tickets, one per remaining piece" not "SHF-307a..e" |
| "the faff-parked label was already cleared" (jargon as subject) | Reader doesn't know the label semantics | Say what happened in human terms — "the autonomous park was cleared two days ago when someone picked it up" |

**Allowed:**

- Real tracker IDs (ISSUE-XX, #PR-N) — stable, clickable, identify a specific thing.
- Short self-explanatory category names that *describe* a finding kind ("sub-ticket gap", "upstream gap", "repeat-park", "chain gap") — they tell the reader what was found, not which internal rule was matched.
- Principle / ADR / criterion references **alongside** plain-English explanation as traceability — "the spec assumes a wave-1 run has happened (the gate from the audit pipeline ADR)" — never standing in for explanation.

**Surface the concrete** (the positive twin of the ban). When the source provides a checkable noun, render it instead of an abstract category: the actual field (`cache_read_input_tokens`), named file or specific subsystem. Name what the source holds, not "principle 6".

- **Surface, don't invent.** Promote only concretes present in the source. If the only available form is the abstraction, keep it — never manufacture a precise-sounding field/file/number that isn't there.

**Test:** if a reader who has never opened the project's CLAUDE.md, methodology spec, or ADR archive can't follow the finding, the rule is broken. Rewrite.

**Why this matters:** every finding, brief and diagnosis must render the substance, not the document's index entry. Humanise work rather than codifying it to look valuable.

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

Every faff sub-skill that names an issue in output applies this contract. Each sub-skill's `Output Format` section references it via `See the rendering_adaptor slot → Synthesis` rather than re-stating.

## Tabular data: markdown tables vs definition lists

Long-cell markdown tables break in narrow terminals: repeated `Column 1: …`, mid-word truncation and colliding rows make data unreadable.

**Scope:** all human-facing terminal output (diagnostics, morning briefs, roadmap renders, in-conversation summaries), tracker descriptions and comments, per **Scope — all human-facing faff output**. Exempt: skill sources (`skills/*/SKILL.md`), where prose-cell specification tables are fine in wider editor/GitHub views, and internal `.faff/runs/<run-id>/…` logs.

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

Use unicode `─` × 40, not markdown `---`: the latter may become `<hr>` and disappear in terminal chat; the unicode rule renders consistently.

## Density caps

A wall of small visuals is the same problem as a wall of text. Each rendered section caps:

- **Cycle visualisations:** at most 3 per output; if there are more cycles, list the rest as ID-only one-liners with "(see structural diagnostics log)"
- **Queue partition grid:** at most 10 rows visible; rest collapses to "(+ N more)" with the full list in the log
- **Workstream lane:** at most 7 initiatives in the live view; rest in log

## Validation / normalise

Run as a final pass over draft output, or on demand against any block.

**Checks:** markdown tables that breach the table-vs-list thresholds; structure narrated as prose where a canonical visual exists; inline-invented visual forms outside the catalogue; density-cap overflows; response ceremony that breaches **Output token economy** (preamble/postamble, ticket/request restatement, narration of what the output already shows, hedge padding — rewrite to drop it); an issue ID that is never grounded by its gloss anywhere in the output (bare-ID-only — see **First-mention grounding**; rewrite by injecting the gloss at first mention when derivable, else flag); an explanation whose load-bearing model is buried below the mechanics (see **Lead with the load-bearing model**; hoist the source's governing statement to the first line, or flag `no load-bearing model to lead with` — never fabricate one); a category label standing in where the source holds a concrete checkable noun (see **Surface the concrete**; surface the real field/file/subsystem, or keep the generality when no concrete is present — never invent one).

**Output:** either a list of violations (`where → which rule → the fix`), or the normalised block with the fixes applied, depending on how the caller invokes it.

## Rules

- The catalogue is closed. A skill that needs a new visual form adds it here first, then uses it — never invents one inline.
- The visualisation/prose split is non-negotiable: structure is visual, judgement is prose. Don't narrate a graph; don't tabulate a recommendation.
- These rules govern user-facing output only. They do not constrain `.faff/` logs or skill documentation.
- Validation reports or normalises; it does not change what the output says, only how it's rendered.
