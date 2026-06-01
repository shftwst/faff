---
name: faff-whereto
description: "Roadmap synthesis — outcome initiatives, the workstreams under them, the dependency chains between them, and whether the trigger gates can actually fire. The strategic view above /faff-wtf. Trigger for: 'roadmap', 'where are we going', 'explain the backlog', 'do these join up', 'workstream view', 'strategy view', 'what are the chains', 'big picture', 'walk me through the plan', 'is the plan coherent'."
---

# Faff — Whereto (Roadmap)

> **Next steps:** `/faff-wtf` to drop down to today's focus · `/faff-tidy` if structural gaps need cleanup · `/faff-prep ISSUE-XX` to prep a critical-path issue

Pull the live tracker state and the project's backlog-organisation methodology, synthesise an outcome → workstream → chain → gate roadmap, and tell the human whether the plan actually joins up.

`/faff-wtf` answers "what should I do this morning?" `/faff-whereto` answers "where is this whole project going, and is the path coherent end-to-end?" Different altitude.

## Configuration

See the gateway (`skills/faff/SKILL.md`) for the shared `.faffrc` configuration (`tracking` / `planning_skills`), the ignore-cancelled/archived rule, `.faff/` logging layout, the autonomous-mode contract, and the park protocol.

**Methodology doc.** This skill leans on the consuming project's backlog-organisation methodology (initiative shapes, workstream horizons, success-metric expectations). Default location: `docs/operations/backlog-organization.md`. If `.faffrc` names a different path under `tracking.backlog_methodology`, use that. If neither exists, fall back to inferring from tracker structure (initiatives + projects with status fields) and flag in the output that no methodology doc was found — the synthesis is then best-effort.

**Initiative shorthand.** Use the initiative's full name on first reference and as the heading (e.g. "Initiative — Audit-lite reliability"). A short tag like "Initiative A" / "Initiative B" is fine for cross-references in tables and ASCII diagrams, but **always restate the subject** on cross-reference in prose ("Initiative B (Platform readiness) has a hole" — never "Initiative B has a hole" alone). No ad-hoc grouping codes like "X2a" or "Wave 1.3" — those are invented label schemes, not real structure.

**Synthesis rendering.** Every issue rendered in any phase below uses the synthesis contract (gateway → **Synthesis contract**) — tracker ID + plain-English gloss + unlock-chain consequence when non-trivial. The existing ASCII chain diagram (Phase 4), workstream lane (Phase 3), and gate fire-status table (Phase 5) are canonical visual forms per the `language_adaptor` slot (default `faffidavit-language`) — preserved as-is.

**Methodology lens.** When a `methodology` skill is configured under `planning_skills`, the first line of output is `Methodology: [skill-name]`. Phase 1 (Now/Next/Later) re-sequences inside each horizon using the methodology skill's sequencing logic (e.g. value x risk x dep-aware order) instead of tracker priority + chainable-unlock-value alone. Phase 7 (Risks) gains methodology findings alongside existing structural risks. Skipped silently when no methodology is configured.

## What it does

**Always pull the whole roadmap picture fresh from the issue tracker. A roadmap with stale data cannot be trusted.**

Every phase pulls **live** state — never from a cached snapshot, never from a value written into `.faffrc`, never from a previous run's `.faff/logs/` output, never from a partial fetch carried over from earlier in the conversation. Every invocation re-fetches every initiative, every project under every initiative, every issue under every project, every blocker link, every status field. No incremental refreshes. No "I already pulled this 10 minutes ago." No reusing summaries.

The reason: a roadmap that mixes a fresh-now piece with a 30-minute-old piece is **silently wrong**. The reader trusts the document as a single coherent snapshot. If a project shipped in the last 10 minutes, or a status changed, or a blocker resolved, and the roadmap reflects pre-change state for some sections and post-change for others, the chain analysis (Phase 4) and gate analysis (Phase 5) produce confidently incorrect findings. Better to be slow and correct than fast and lying. If the fetch budget is too high, the answer is to scope the run to a single initiative — never to use partial freshness.

Run through these phases in order:

### 1. Pull the live structure

- Read the methodology doc (path per Configuration above) so you know what shape the project's roadmap is supposed to take — what an "initiative" is, what horizons (Now / Next / Later) mean here, what the project considers a healthy success-metric statement.
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

For each initiative, render a Now / Next / Later breakdown. The methodology doc dictates the cap (typical: ≤3 projects per initiative, one per horizon). Include project status, and the issue ids that sit under it.

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

After the diagram, write one summary line: **"Yes, the chain joins up"** / **"Yes, with N visible discontinuities"** / **"No — Initiative X has no path to its outcome"**.

### 5. Trigger gates and whether they can fire

For every "X → Y" transition implied by the chain, table whether the gate can actually fire. A gate is **fireable** if (a) all upstream work is in flight or shipped and (b) the downstream project actually exists in the tracker.

| Gate | Who fires it | Currently fireable? | Notes |
|---|---|---|---|
| Now → Next within initiative | initiative-internal | Yes / ⚠ Blocked / Not yet | [one-line context] |
| Initiative X → Initiative Y | cross-initiative dependency | Yes / ⚠ Blocked structurally | [if blocked, name the missing project / spec / decision] |
| Specific parked-on-trigger issue | who unparks it | Yes / ⚠ Blocked on [thing] | [the upstream condition] |

A `⚠ Blocked structurally` gate means the downstream project doesn't exist — usually because a previous project got cancelled and never got replaced. These are the most important findings; surface them prominently.

### 6. Critical path

Render the work in priority order, bucketed by horizon. Lead with the next ~few weeks (concrete issue ids in flight), then the next 1-3 months (the next-horizon projects), then the longer arc. **Do not give time estimates** beyond named horizons — the methodology specifies horizons, not weeks-until-X.

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

Apply the same work-ordering rule used by `/faff-tidy` and `/faff-wtf`: priority (issue OR ancestor) → chainable unlock value. Issues that gate the most downstream work float up.

### 7. Risks the structure surfaces

The output of Phases 1-6 surfaces risks that aren't visible from any single initiative or issue. Call them out explicitly. Typical categories:

- **Ghost project**: an initiative description names a Next or Later project in prose, but no project actually exists in the tracker. The chain can't fire through a ghost. State the gap as "the description names X, no project exists" — do not name or reconstruct any cancelled/deleted predecessor (per Phase 1).
- **Cross-reference with `/faff-tidy` structural diagnostics.** If a `/faff-tidy` run produced a `### Structural diagnostics` block in this pass (read the most recent `.faff/logs/YYYY-MM-DD/HHMMSS-tidy.md`), import its ghost-project findings, dep cycle findings, and repeat-park findings into this phase's risk list. The two skills detect overlapping signals — tidy finds ghost pointers from *issue-side* references; whereto finds them from *initiative-side description* parsing. Combining both gives the full picture without re-implementing detection here.

If no tidy ran this pass, whereto computes its own ghost-project scan (initiative-description-side only) as it already does — but the tidy-found issue-side ghost pointers are absent. Flag this in the output: "No tidy this pass — issue-side ghost-pointer detection skipped. Run `/faff-tidy` for full structural coverage."

**Methodology findings (when a `methodology` skill is configured).** Request the `horizon-assignment` output from the methodology skill; alongside the horizon ordering it returns roadmap-level findings. Surface those here in addition to the structural risk categories. Each finding renders its full diagnosis (what's there / why it's a problem / what to do) as the methodology returns it. Findings interleave with the existing structural risks, ordered by severity (impact × scope).
- **Independence not verified**: a Now project has N issues that beep-boop is supposed to drain in parallel, but no one has confirmed they're actually independent. Recommend a `/faff-tidy` pass before queuing overnight runs.
- **Single-project Later (intentional vs accidental)**: Later horizons are often deliberately collapsed to one project (the methodology doc usually explains why — uncertainty about productised shape until Now ships). Flag whether each single-project Later is intentional (cite the methodology) or just under-planned.
- **Parked issue waiting on missing trigger**: a parked issue's unpark condition is "when [specific upstream] ships", but [specific upstream] doesn't exist as a planned project. The park is structurally permanent until the gap closes.
- **In-flight Now project with no recent commits**: a Now-horizon project has no commits in 14 days. Either the project is stalled or the status is stale.

For each risk: state the risk, name the load-bearing structural element, and recommend one concrete action (file an issue to close the gap, run `/faff-tidy`, surface for human re-prioritisation).

### 8. TL;DR

Three to five sentences max. Lead with how many outcomes are in flight, whether the chain joins up end-to-end, and the single biggest concrete risk. The reader who only reads the TL;DR should know whether to dig into the full output or carry on.

## Output Format

Tabular output follows the `language_adaptor` slot's _Tabular data: markdown tables vs definition lists_ rule (default `faffidavit-language`) — drop markdown tables for any cell over ~30 chars or any prose cell; use definition-list blocks with `─` × 40 separators instead.

```
## Roadmap — [date]

[1-2 sentence framing: how many initiatives, how many active, how many parked. Source-of-truth note if methodology doc was/wasn't found.]

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

- **Critical-path issue picked:** "Picking up ISSUE-XX. Prep now via `/faff-prep`? (y/n)" — on confirm, invoke `/faff-prep` via the Skill tool. If already prepped, the gate becomes "Start building now via `/faff-workit`? (y/n)".
- **Structural gap to act on (e.g. ghost project):** "Surface the [gap] gap to a human for re-planning? (y/n)" — on confirm, draft a one-paragraph summary of the gap and its downstream effect for the human to take into a planning session. Do **not** auto-create projects in the tracker; the call belongs to the human.
- **Independence concern in a Now project:** "Run `/faff-tidy` to verify independence before queuing overnight runs? (y/n)" — on confirm, invoke `/faff-tidy` via the Skill tool, scoped to the project in question.
- **Stalled Now project (no recent commits):** "Stalled or stale? Open the project for review (open) / leave (skip)?" On `open`, surface the project's issues for the human; do not change tracker status autonomously.
- **Drop down to today's focus:** "Want to shift to today's focus via `/faff-wtf`? (y/n)".

Keep the tracker as the source of truth. This skill **never** writes to the tracker — it reads, synthesises, and offers gates.

## Autonomous Mode

When invoked autonomously (rare — this is primarily a human-facing strategic artifact), follow the shared autonomous contract (see `skills/faff/SKILL.md`) and these specifics:

**Output:** the full roadmap as defined above, but with no chaining gates. Append a structured `findings:` block summarising structural gaps, ghost projects, and parked issues whose unpark conditions are unmet.

**Return to caller:** `{ initiatives: [...], workstreams: [...], chain_joins_up: bool, fireable_gates: [...], blocked_gates: [...], structural_risks: [...] }`.

**No tracker writes.** Even in autonomous mode, this skill never creates projects, never re-parents issues, never closes gaps. Findings go to the log; humans act on them.

Log the full pass to `.faff/logs/YYYY-MM-DD/HHMMSS-whereto.md`. The log must include every MCP call made (initiatives fetched, projects per initiative, issues per project, comments scanned for structural-gap context) so a follow-up agent can reconstruct the roadmap from the log alone.

## Notes

- This skill is **read-only**. It synthesises and recommends; it never mutates tracker state.
- Methodology docs vary across projects. Don't assume the consuming project uses the same horizon labels (Now/Next/Later) as this skill's defaults — read the methodology doc first and use whatever labels it defines.
- "Initiative" is the term used here; some trackers call them objectives, programs, or themes. Adapt to the tracker's vocabulary in the output, not this skill's defaults.
- The roadmap is a **synthesis**, not a plan. A plan tells you what to do; this tells you whether the plan you already have hangs together. If the chain doesn't join up, the answer is a planning session, not more execution.
- Don't invent grouping codes (`X2a`, `Wave 1.3`, `Phase II.b`). Use whatever labels the tracker and methodology already use, full names on first reference, short tags only where the tag was already established.
