---
name: faff-map
description: "Roadmap synthesis — outcome initiatives, the workstreams under them, the dependency chains between them, and whether the trigger gates can actually fire. The strategic view above /faff-wtf. Trigger for: 'roadmap', 'where are we going', 'explain the backlog', 'do these join up', 'workstream view', 'strategy view', 'what are the chains', 'big picture', 'walk me through the plan', 'is the plan coherent'."
judgement_seam: roadmap
---

# Faff — Map (Roadmap)

> **Next steps:** `/faff-wtf` to drop down to today's focus · `/faff-tidy` if structural gaps need cleanup · `/faff-prep ISSUE-XX` to prep a critical-path issue

Pull the live tracker state, synthesise an outcome → workstream → chain → gate roadmap, and tell the human whether the plan actually joins up. The tracker is the sole source of structure — initiatives, project nesting, status, dates, and blocker links are read live and the roadmap's shape is deduced from them.

`/faff-wtf` answers "what should I do this morning?" `/faff-map` answers "where is this whole project going, and is the path coherent end-to-end?" Different altitude.

## Configuration

**Load the gateway first.** If `faff/SKILL.md` isn't in context this turn, Read it now — it holds the shared rules + fixed contracts faff applies. The `methodology` slot map delegates to inherits the gateway ambiently.

**Roadmap shape is deduced from the tracker.** faff does not read a project "methodology doc" and no `.faffrc` key points at one — config holds values, not prose, and a doc would drift from live state. The roadmap's shape is inferred from what the tracker actually holds: the initiatives/epics and how projects nest under them (initiative shape), project status + cycle membership + target dates (the Now / Next / Later horizons), initiative and project descriptions plus success-metric fields (the outcomes), and blocker links (the chains). The *normative* half — whether a success metric is healthy, whether a chain is coherent — is the `methodology` **slot's** job (see **Methodology lens** below), not a doc's.

**Initiative shorthand.** Use the initiative's full name on first reference and as the heading (e.g. "Initiative — Audit-lite reliability"). A short tag like "Initiative A" / "Initiative B" is fine for cross-references in tables and ASCII diagrams, but **always restate the subject** on cross-reference in prose ("Initiative B (Platform readiness) has a hole" — never "Initiative B has a hole" alone). No ad-hoc grouping codes like "X2a" or "Wave 1.3" — those are invented label schemes, not real structure.

**Synthesis rendering.** Every issue rendered in any phase below uses the synthesis contract (gateway → **Rendering → `rendering_adaptor`**) — tracker ID + plain-English gloss + unlock-chain consequence when non-trivial. The existing ASCII chain diagram (Phase 4), workstream lane (Phase 3), and gate fire-status table (Phase 5) are canonical visual forms per the `rendering_adaptor` slot (default `faffidavit-rendering`) — preserved as-is.

**Methodology lens.** Phase 1 (Now/Next/Later) sequences inside each horizon via the configured `methodology` slot's `pick-ordering` (gateway → **Ordering & judgement delegation**) — map states no ordering of its own; the thematic default supplies priority + chainable unlock value, and an opinionated lens (e.g. `faffter-dark-methodology-agile-delivery`) supplies value × risk × dep-aware order. When an opinionated lens is configured (gateway → **The `methodology` slot**, display convention), Phase 7 (Risks) also gains its findings alongside the structural risks.

**Methodology transport.** Map's `methodology` requests (`pick-ordering`, `horizon-assignment`, `backlog-diagnostics`) go through **producer dispatch** (gateway → **Sibling-skill invocation → Producer dispatch**), resolving `models.methodology` and `effort.methodology` via `faff config get` (`inherit` omits the arg). They ride **one batched dispatch per map pass** per gateway → **The `methodology` slot → Transport**; a map running inside a subagent falls back **in-context** (single-level nesting).

## What it does

**Always pull the whole roadmap fresh** per the shared **Always pull fresh** rule (gateway): every invocation re-fetches every initiative, every project under it, every issue, every blocker link and status field. A roadmap that mixes fresh and stale pieces is silently wrong, and the chain analysis (Phase 4) and gate analysis (Phase 5) then produce confidently incorrect findings on a document the reader trusts as one coherent snapshot. If the fetch budget is too high, scope to a single initiative, never to partial freshness.

Run through these phases in order:

### 1. Pull the live structure

- Establish the roadmap's shape from the tracker itself (per **Roadmap shape is deduced from the tracker** above): what the top-level outcome containers are, how projects nest under them, and how the status / cycle / target-date fields map onto Now / Next / Later horizons. There is no methodology doc to read — don't look for one.
- Re-fetch the tracker's top-level outcome containers (Linear: initiatives; GitHub Projects: projects; Jira: epics or initiatives — autodetect from the available MCP, don't hardcode). For each: name, status, success metric / description.
- For each initiative, fetch its child projects with their status (started/planned/backlog or the tracker's equivalent), description, and target dates.
- For each project, fetch its issues with status, priority, and blocker links (both directions — what blocks me, what I block).
- Read `CLAUDE.md` for any consuming-project context that should weight initiatives (current workstream flag, paused initiatives, externally-imposed deadlines).
- Pull recent git activity (last 7-14 days of commits on `main` and active branches, recent merged PRs) to ground "Now" projects against actual movement — a project marked "started" with no recent commits is a finding.

**Exclude cancelled and archived per the shared rule — at every level, especially initiative and project containers.** A cancelled or deleted initiative does not exist for this skill. A cancelled or deleted project does not exist for this skill. Do not fetch their issues, do not name them in the chain, do not reference them as "previously was here", do not reconstruct them from the tracker history. They are invisible.

This matters most when an initiative description mentions a Next or Later project that no longer exists in the tracker. The correct framing of the finding is **"the initiative description names a Next, no project exists"** — not **"the previous project was cancelled and not replaced"**. The cancelled thing is gone; the gap is the only fact. Phase 3 surfaces the gap, Phase 7 surfaces the structural risk — neither resurrects the cancelled container by name.

### 2. Outcome initiatives table

Render one table summarising every active and planned initiative. Include cancelled-but-not-replaced gaps as a separate row only if Phase 4 finds the gap to be load-bearing.

| # | Initiative | Status | Success metric |
|---|---|---|---|
| A | [name] | Active / Planned | [the single sentence success criterion from the tracker] |

Use single-letter tags (A, B, C, …) for shorthand cross-reference in later phases. The full initiative name is always shown in the table and on first reference.

### 3. Workstreams (projects by initiative)

For each initiative, render a Now / Next / Later breakdown. A healthy initiative typically holds ≤3 projects (about one per horizon); treat a materially larger count as a bloat signal for Phase 7, not a hard cap. Include project status, and the issue ids that sit under it.

```
Initiative — [name]

Now    [project name]            [started]   ISSUE-XX, ISSUE-YY, ...
Next   [project name]            [planned]   ISSUE-AA, ISSUE-BB, ...
Later  [project name]            [backlog]   ISSUE-MM, ISSUE-NN, ...
```

Below each initiative's block, add one line of recent grounding: "ISSUE-XX (just merged) belongs here — [one-sentence why]" or "SHF-YY (just parked) sits here". This anchors the roadmap in this week's actual movement so the reader can see the structure is alive, not a frozen document.

If an initiative is missing a horizon (no Next, no Later) — call it out as **⚠ Structural gap**: `Next: (no project planned)`. Do not silently render an empty row; the gap is the finding. **Do not reference cancelled or deleted predecessor containers** — they don't exist for this skill (see Phase 1). The gap is "no project here", not "previous project was cancelled". (Phase 4 explores whether the gap is load-bearing.)

**Methodology re-sequencing (when a `methodology` skill is configured).** Within each horizon, invoke the methodology skill for sequencing guidance. The horizon assignment itself is unchanged — only the order inside each horizon shifts. The synthesis gloss for each item carries the sequencing reasoning when the new order differs materially from the default structural order.

### 4. Dependency chain — does everything join up?

Draw an ASCII chain showing how initiatives feed each other. The chain answers: **if every Now project ships, do the Next gates fire? If every Next project ships, do the Later initiatives unblock?**

```
          ┌─────────────────────────────────────────┐
          │ Initiative A: [name]                    │
          │ (Now: [project])                        │
          └───────────────┬─────────────────────────┘
                          │ once [success metric] met
                          ▼
          ┌──────────────────────────────────────────┐
          │   Next:  [project]                       │
          │   Later: [project]                       │
          └──────────────────────────────────────────┘
```

Where two initiatives feed a third, draw both inputs converging. Where an initiative has a structural gap (Phase 3), mark the gap inline so the chain visibly breaks at that point. The visual goal: a reader should be able to trace any leaf initiative back to the active work that gates it.

After the diagram, write one summary line. It must stay consistent with the dependency cycles Phase 7 detects — read the **same** `dependency_cycles` result (the `backlog-diagnostics` call in Phase 7), never a separately-derived chain: if a detected cycle touches any issue on the rendered chain, the line is **"No — a dependency cycle breaks the chain: <member IDs>"** and **never** "joins up". Otherwise: **"Yes, the chain joins up"** / **"Yes, with N visible discontinuities"** / **"No — Initiative X has no path to its outcome"**.

### 5. Trigger gates and whether they can fire

For every "X → Y" transition implied by the chain, table whether the gate can actually fire. A gate is **fireable** if (a) all upstream work is in flight or shipped and (b) the downstream project actually exists in the tracker.

| Gate | Who fires it | Currently fireable? | Notes |
|---|---|---|---|
| Now → Next within initiative | initiative-internal | Yes / ⚠ Blocked / Not yet | [one-line context] |
| Initiative X → Initiative Y | cross-initiative dependency | Yes / ⚠ Blocked structurally | [if blocked, name the missing project / spec / decision] |
| Specific parked-on-trigger issue | who unparks it | Yes / ⚠ Blocked on [thing] | [the upstream condition] |

A `⚠ Blocked structurally` gate means the downstream project doesn't exist — usually because a previous project got cancelled and never got replaced. These are the most important findings; surface them prominently.

### 6. Critical path

Render the work in the configured methodology's `pick-ordering` (gateway → **Ordering & judgement delegation**), bucketed by horizon. Lead with the next ~few weeks (concrete issue ids in flight), then the next 1-3 months (the next-horizon projects), then the longer arc. **Do not give time estimates** beyond named horizons — report named horizons (deduced from tracker status / cycles), not weeks-until-X.

```
Now (in flight):
1. Finish [Now project] (Initiative — [name]). Remaining: ISSUE-XX, ISSUE-YY, …
2. Land [Now project] cleanup (Initiative — [name]).
3. [Parallel-OK Now project] runs alongside (Initiative — [name]).

Next horizon:
4. [Initiative] flips to [Next project] when [trigger condition].
5. …

Later horizon:
6. [Initiative] unpacks the collapsed Later project once [precondition].
```

Order via the configured methodology's `pick-ordering` (gateway → **Ordering & judgement delegation**), the same as `/faff-tidy` and `/faff-wtf` — map states no ordering of its own. The thematic default ranks by priority (issue OR ancestor) → chainable unlock value, so issues gating the most downstream work float up.

### 7. Risks the structure surfaces

The output of Phases 1-6 surfaces risks that aren't visible from any single initiative or issue. Call them out explicitly.

**Structural-graph risks come from `backlog-diagnostics`, every pass — never from whether tidy ran.** Request the `backlog-diagnostics` output from the configured `methodology` slot (default `faffter-noon-methodology-thematic`; it always resolves and its mandatory floor is dependency-graph cycle + ghost-project detection — gateway → **The `methodology` slot**). It operates on the active-issue graph already pulled in Phase 1 — **no new fetch**. Map is a declared caller of this always-fires output, so cycle + ghost coverage is present on every map pass whether or not `/faff-tidy` ran. Do **not** re-implement detection here, and do **not** gate it on a tidy log existing. Surface these categories:

- **Dependency cycle**: a cycle of any length in the active-issue blocker graph (A→B→A; A→B→C→A; longer), from `diag.dependency_cycles`. Name the member issue IDs in cycle order and recommend the concrete break action (which blocker edge to cut or re-sequence). A cycle is a real backlog defect even when it sits entirely off the rendered chain — surface it regardless; Phase 4 additionally forces its join-up line to "No" only when a cycle touches the chain it drew.
- **Cross-project blocker within a value stream**: a blocker edge (A blocks B) whose endpoints sit in **different projects under the same initiative** — **value stream := the initiative** map reads as its top-level container in Phase 1. Name A, B, their projects, and the gate it threatens. *(Temporal anchor: project-as-deliverable (FAFF-245, related) has not landed; when it does, revisit whether the value-stream container should be the deliverable rather than the initiative — a forward refinement, not a blocker.)* An edge whose two projects sit under *different* initiatives is a cross-initiative gate, already handled by Phase 5 — not double-reported here.
- **Ghost project**: an initiative description names a Next or Later project in prose, but no project actually exists in the tracker. The chain can't fire through a ghost. Combine map's own initiative-*description*-side scan with the *issue-side* `ghost_project_pointers` from `diag`, de-duplicated. State the gap as "the description names X, no project exists" — do not name or reconstruct any cancelled/deleted predecessor (per Phase 1).

**Optional tidy-log enrichment (never the source).** If a `/faff-tidy` run produced a `### Structural diagnostics` block this pass (read the most recent `.faff/logs/YYYY-MM-DD/HHMMSS-tidy.md`), import its findings as added colour and de-duplicate against map's own. This is enrichment only — map already has full cycle + ghost coverage from `backlog-diagnostics` above. With no tidy this pass, do **not** print "detection skipped"; at most note that issue-side ghost *enrichment* is thinner without a tidy run.

**Methodology findings (when a `methodology` skill is configured).** Request the `horizon-assignment` output from the methodology skill; alongside the horizon ordering it returns roadmap-level findings. Surface those here in addition to the structural risk categories. Each finding renders its full diagnosis (what's there / why it's a problem / what to do) as the methodology returns it. Findings interleave with the existing structural risks, ordered by severity (impact × scope).
- **Independence not verified**: a Now project has N issues that beep-boop is supposed to drain in parallel, but no one has confirmed they're actually independent. Recommend a `/faff-tidy` pass before queuing overnight runs.
- **Single-project Later (intentional vs accidental)**: Later horizons are often deliberately collapsed to one project — productised shape stays uncertain until Now ships. Use the tracker's own signals (the initiative/project description's stated rationale, status) to flag whether each single-project Later looks intentional or just under-planned.
- **Parked issue waiting on missing trigger**: a parked issue's unpark condition is "when [specific upstream] ships", but [specific upstream] doesn't exist as a planned project. The park is structurally permanent until the gap closes.
- **In-flight Now project with no recent commits**: a Now-horizon project has no commits in 14 days. Either the project is stalled or the status is stale.

For each risk: state the risk, name the load-bearing structural element, and recommend one concrete action (file an issue to close the gap, run `/faff-tidy`, surface for human re-prioritisation).

### 8. TL;DR

Three to five sentences max. Lead with how many outcomes are in flight, whether the chain joins up end-to-end, and the single biggest concrete risk. The reader who only reads the TL;DR should know whether to dig into the full output or carry on.

## Output Format

Tabular output follows the `rendering_adaptor` slot's table-vs-definition-list rule (gateway → **Rendering → `rendering_adaptor`**; default `faffidavit-rendering`).

```
## Roadmap — [date]

[1-2 sentence framing: how many initiatives, how many active, how many parked.]

### Outcome initiatives

[Table per Phase 2]

### Workstreams

[One block per initiative per Phase 3, with the recent-grounding line under each]

### Dependency chain

[ASCII diagram per Phase 4, then the join-up summary line]

### Trigger gates

[Table per Phase 5]

### Critical path

[Bulleted list per Phase 6, bucketed by horizon]

### Risks the structure surfaces

[Bulleted list per Phase 7, with one concrete action each]

### TL;DR

[3-5 sentences per Phase 8]
```

Skip Phase 7 only if there are genuinely no findings — that itself is a noteworthy state and should be called out in the TL;DR ("no structural risks surfaced this pass").

## Chaining

All hand-offs are yes/no gates (or short-choice where a real branch exists). No passive "run /faff-*" language.

After presenting the output:

- **Critical-path issue picked:** "Picking up ISSUE-XX. Prep now via `/faff-prep`? (y/n)" — on confirm, invoke the `faff-prep` skill via the Skill tool (resolve per gateway → **Sibling-skill invocation**). If already prepped, the gate becomes "Start building now via `/faff-graft`? (y/n)".
- **Structural gap to act on (e.g. ghost project), or the chain doesn't join up:** "Plan the missing structure via `/faff-plot`? (y/n)" — on confirm, draft a one-paragraph brief of the gap and its downstream effect (which initiative has no path, which project is missing) and hand it to the `faff-plot` skill via the Skill tool to plan the missing initiatives/projects/first-slice epics. This is the **planning session** this skill points at when the roadmap doesn't hang together. map stays read-only — it *routes* to plot, which does the writing; map then re-audits plot's output. (If the human prefers to handle it themselves, the same summary is theirs to take away.)
- **Independence concern in a Now project:** "Run `/faff-tidy` to verify independence before queuing overnight runs? (y/n)" — on confirm, invoke the `faff-tidy` skill via the Skill tool, scoped to the project in question.
- **Stalled Now project (no recent commits):** "Stalled or stale? Open the project for review (open) / leave (skip)?" On `open`, surface the project's issues for the human. **map never writes tracker status** — but this is map's read-only-lane stance, **not** a blanket "project status is untouchable" rule: the mechanical, forward-only, child-derived state-coherence rollup (a project whose first child started → In Progress, etc.) lives in map's **write counterpart, `/faff-tidy`** (bucket 8, the `faff project-next` predicate). A *judgement* write — "is this stalled project actually worth force-stalling?" — stays read-only + human-gated here.
- **Drop down to today's focus:** "Want to shift to today's focus via `/faff-wtf`? (y/n)".

Keep the tracker as the source of truth. This skill **never** writes to the tracker — it reads, synthesises, and offers gates (the mechanical state-coherence rollup it might surface is applied by `/faff-tidy`, not here).

## Autonomous Mode

When invoked autonomously (rare — this is primarily a human-facing strategic artifact), follow the shared autonomous contract (see the sibling `faff/SKILL.md`) and these specifics:

**Output:** the full roadmap as defined above, but with no chaining gates. Append a structured `findings:` block summarising structural gaps, ghost projects, and parked issues whose unpark conditions are unmet.

**Return to caller:** `{ initiatives: [...], workstreams: [...], chain_joins_up: bool, fireable_gates: [...], blocked_gates: [...], structural_risks: [...] }`.

**No tracker writes.** Even in autonomous mode, this skill never creates projects, never re-parents issues, never closes gaps. Findings go to the log; humans act on them.

Log the full pass to `.faff/logs/YYYY-MM-DD/HHMMSS-map.md`. The log must include every MCP call made (initiatives fetched, projects per initiative, issues per project, comments scanned for structural-gap context) so a follow-up agent can reconstruct the roadmap from the log alone. This narrative `HHMMSS-map.md` write is subject to the gateway logging gate (skip the narrative write when `logging: essential`).

## Notes

- This skill is **read-only** *because it is a reporting lane* — it synthesises and recommends; it never mutates tracker state. The read-only stance is map's, not a global ban on autonomous status writes: the mechanical, reversible, child-derived state-coherence rollup is owned by the write counterpart `/faff-tidy` (bucket 8).
- Horizon labels vary across trackers. Don't assume the consuming project uses Now/Next/Later — adopt whatever status/cycle vocabulary the tracker already uses (Phase 1), falling back to Now/Next/Later only as this skill's default labels.
- "Initiative" is the term used here; some trackers call them objectives, programs, or themes. Adapt to the tracker's vocabulary in the output, not this skill's defaults.
- The roadmap is a **synthesis**, not a plan. A plan tells you what to do; this tells you whether the plan you already have hangs together. If the chain doesn't join up, the answer is a planning session, not more execution.
- Don't invent grouping codes (`X2a`, `Wave 1.3`, `Phase II.b`). Use whatever labels the tracker already uses, full names on first reference, short tags only where the tag was already established.
