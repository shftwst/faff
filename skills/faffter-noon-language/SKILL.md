# faffter-noon-language

The default rendering contract. Defines how faff sub-skills turn structure into output: when to draw a visual instead of prose, the catalogue of canonical visual forms, when prose still wins, the markdown-table-vs-definition-list rule, and density caps.

This is the implicit default for the `language` slot. Extracted here so the rendering rules are defined once and referenced everywhere, and so they can be swapped for a house style.

```yaml
planning_skills:
  language: faffter-noon-language   # the default — explicit for clarity
```

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

## Rules

- The catalogue is closed. A skill that needs a new visual form adds it here first, then uses it — never invents one inline.
- The visualisation/prose split is non-negotiable: structure is visual, judgement is prose. Don't narrate a graph; don't tabulate a recommendation.
- These rules govern user-facing output only. They do not constrain `.faff/` logs or skill documentation.
