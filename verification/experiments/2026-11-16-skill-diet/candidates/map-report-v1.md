---
name: faff-map
description: "Explain the strategic roadmap: outcome initiatives, workstreams, dependency chains and trigger gates. Use for big-picture plans, strategy or roadmap coherence."
judgement_seam: roadmap
---

# Faff — Map (Roadmap)

> **Next steps:** `/faff-wtf` to drop down to today's focus · `/faff-tidy` if structural gaps need cleanup · `/faff-prep ISSUE-XX` to prep a critical-path issue

Pull the live tracker state, synthesise an outcome → workstream → chain → gate roadmap, and tell the human whether the plan actually joins up. The tracker is the sole source of structure — initiatives, project nesting, status, dates, and blocker links are read live and the roadmap's shape is deduced from them.

`/faff-wtf` answers "what should I do this morning?" `/faff-map` answers "where is this whole project going, and is the path coherent end-to-end?" Different altitude.

## Configuration

**Load the kernel first.** If `faff/references/kernel.md` isn't in context this turn, Read it now — it holds the shared rules + fixed contracts faff applies. Do **not** Read `faff/SKILL.md` (the bare-`/faff` routing gateway — a specific-skill entry never needs it). Then Read the lane references map consumes: `faff/references/tracker.md`, `faff/references/methodology.md` — map is interactive-only and never Reads `faff/references/autonomous.md`. The `methodology` slot map delegates to inherits the gateway ambiently.

**Resolve tracker availability first (gateway → Tracker availability resolution).** map reads the whole roadmap from the tracker, so before treating the tracker as absent it honours a `tracking.tracker` pin and discovers the connector — never inferring git-only from an immediately-invisible tool list under a deferred-tool harness — resolving the mode once for the pass.

**Roadmap shape is deduced from the tracker.** faff does not read a project "methodology doc" and no `.faff/config.yaml` key points at one — config holds values, not prose, and a doc would drift from live state. The roadmap's shape is inferred from what the tracker actually holds: the initiatives/epics and how projects nest under them (initiative shape), project status + cycle membership + target dates (the Now / Next / Later horizons), initiative and project descriptions plus success-metric fields (the outcomes), and blocker links (the chains). The *normative* half — whether a success metric is healthy, whether a chain is coherent — is the `methodology` **slot's** job (see **Methodology lens** below), not a doc's.

**Initiative shorthand.** Use the initiative's full name on first reference and as the heading (e.g. "Initiative — Audit-lite reliability"). A short tag like "Initiative A" / "Initiative B" is fine for cross-references in tables and ASCII diagrams, but **always restate the subject** on cross-reference in prose ("Initiative B (Platform readiness) has a hole" — never "Initiative B has a hole" alone). No ad-hoc grouping codes like "X2a" or "Wave 1.3" — those are invented label schemes, not real structure.

**Synthesis rendering.** Every issue rendered in any phase below uses the synthesis contract (gateway → **Rendering → `rendering_adaptor`**) — tracker ID + plain-English gloss + unlock-chain consequence when non-trivial. The existing ASCII chain diagram (Phase 4), workstream lane (Phase 3), and gate fire-status table (Phase 5) are canonical visual forms per the `rendering_adaptor` slot (default `faffidavit-rendering`) — preserved as-is.

**Methodology lens.** Phase 1 (Now/Next/Later) sequences inside each horizon via the configured `methodology` slot's `pick-ordering` (gateway → **Ordering & judgement delegation**) — map states no ordering of its own; the thematic default supplies priority + chainable unlock value, and an opinionated lens (e.g. `faffter-dark-methodology-agile-delivery`) supplies value × risk × dep-aware order. When an opinionated lens is configured (gateway → **The `methodology` slot**, display convention), Phase 7 (Risks) also gains its findings alongside the structural risks.

**Methodology transport.** Map's `methodology` requests (`pick-ordering`, `horizon-assignment`, `backlog-diagnostics`) go through **producer dispatch** (gateway → **Sibling-skill invocation → Producer dispatch**), resolving the `methodology` dispatch lane. They ride **one batched dispatch per map pass** per gateway → **The `methodology` slot → Transport**; a map running inside a subagent falls back **in-context** (single-level nesting).

## What it does

**Always pull the whole roadmap fresh** per the shared **Always pull fresh** rule (gateway): every invocation re-fetches every initiative, every project under it, every issue, every blocker link and status field. A roadmap that mixes fresh and stale pieces is silently wrong, and the chain analysis (Phase 4) and gate analysis (Phase 5) then produce confidently incorrect findings on a document the reader trusts as one coherent snapshot. If the fetch budget is too high, scope to a single initiative, never to partial freshness.

Run through these phases in order:

### 1. Pull the live structure

- Establish the roadmap's shape from the tracker itself (per **Roadmap shape is deduced from the tracker** above): what the top-level outcome containers are, how projects nest under them, and how the status / cycle / target-date fields map onto Now / Next / Later horizons. There is no methodology doc to read — don't look for one.
- Re-fetch the tracker's top-level outcome containers (Linear: initiatives; GitHub Projects: projects; Jira: epics or initiatives — autodetect from the available MCP, don't hardcode). For each: name, status, success metric / description.
- For each initiative, fetch its child projects with their status (started/planned/backlog or the tracker's equivalent), description, and target dates.
- For each project, fetch its issues with status, priority, and blocker links (both directions — what blocks me, what I block). Drop satisfied edges before any downstream use (gateway → **Satisfied blockers — edges to terminal work**) — a blocker whose target has shipped is not live.
- Read `CLAUDE.md` for any consuming-project context that should weight initiatives (current workstream flag, paused initiatives, externally-imposed deadlines).
- Pull recent git activity (last 7-14 days of commits on `main` and active branches, recent merged PRs) to ground "Now" projects against actual movement — a project marked "started" with no recent commits is a finding.

**Exclude cancelled and archived per the shared rule — at every level, especially initiative and project containers.** A cancelled or deleted initiative does not exist for this skill. A cancelled or deleted project does not exist for this skill. Do not fetch their issues, do not name them in the chain, do not reference them as "previously was here", do not reconstruct them from the tracker history. They are invisible.

This matters most when an initiative description mentions a Next or Later project that no longer exists in the tracker. The correct framing of the finding is **"the initiative description names a Next, no project exists"** — not **"the previous project was cancelled and not replaced"**. The cancelled thing is gone; the gap is the only fact. Phase 3 surfaces the gap, Phase 7 surfaces the structural risk — neither resurrects the cancelled container by name.

### 2. Outcome initiatives table

Summarise every active and planned initiative using its tracker success criterion. Show an absent-project gap as a separate row only when Phase 4 finds it prevents the outcome; never name cancelled/deleted predecessors.

| # | Initiative | Status | Success metric |
|---|---|---|---|
| A | [name] | Active / Planned | [the single sentence success criterion from the tracker] |

Use single-letter tags for later cross-references, with full initiative names in this table and on first reference.

### 3. Workstreams (projects by initiative)

Render each initiative's projects by Now / Next / Later, with status and issue IDs/glosses. About one project per horizon (typically at most three total) is healthy; materially more is a Phase-7 bloat signal, not a cap.

```
Initiative — [name]

Now    [project name]            [started]   ISSUE-XX, ISSUE-YY, ...
Next   [project name]            [planned]   ISSUE-AA, ISSUE-BB, ...
Later  [project name]            [backlog]   ISSUE-MM, ISSUE-NN, ...
```

- Under each block, ground it in recent movement: a just-merged or parked issue and why it belongs there.
- Mark missing horizons explicitly as a **Structural gap**, for example `Next: (no project planned)`. Phase 4 assesses whether the gap prevents the outcome. Do not mention cancelled/deleted predecessors.
- Use the configured methodology's sequencing within each horizon, leaving horizon assignment unchanged. Include the ordering reason in item glosses when it differs materially from the default structural order.

### 4. Dependency chain — does everything join up?

Draw the ASCII chain over live blocker edges only. Show whether shipping every Now project fires the Next gates, and whether shipping Next unblocks Later. Satisfied edges neither appear nor break join-up. Draw converging inputs when two initiatives feed a third, and mark gaps inline so the reader can trace each leaf to its active upstream work.

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

After the diagram,write one summary line. It must stay consistent with the dependency cycles Phase 7 detects — read the **same** `dependency_cycles` result (the `backlog-diagnostics` call in Phase 7), never a separately-derived chain: if a detected cycle touches any issue on the rendered chain, the line is **"No — a dependency cycle breaks the chain: <member IDs>"** and **never** "joins up". Otherwise: **"Yes, the chain joins up"** / **"Yes, with N visible discontinuities"** / **"No — Initiative X has no path to its outcome"**.

### 5. Trigger gates and whether they can fire

For every transition in the chain, show whether its gate can fire: all upstream work must be in flight or shipped, and the downstream project must exist. Ignore satisfied blocker edges.

| Gate | Who fires it | Currently fireable? | Notes |
|---|---|---|---|
| Now → Next within initiative | initiative-internal | Yes / ⚠ Blocked / Not yet | [one-line context] |
| Initiative X → Initiative Y | cross-initiative dependency | Yes / ⚠ Blocked structurally | [if blocked, name the missing project / spec / decision] |
| Specific parked-on-trigger issue | who unparks it | Yes / ⚠ Blocked on [thing] | [the upstream condition] |

Surface structurally blocked gates prominently: their downstream project is missing. Describe the gap without reconstructing cancelled/deleted containers.

### 6. Critical path

Use the configured methodology's `pick-ordering`, as tidy and wtf do; map invents no ordering. Bucket by the tracker's named horizons: Now's in-flight projects and remaining issue IDs, Next projects and their triggers, then Later and its preconditions. Show parallel work where supported. Report horizons, never invented time estimates or weeks-until-X.

### 7. Risks the structure surfaces

Request `backlog-diagnostics` from the configured methodology every pass, using Phase 1's active-issue graph. The slot always resolves and supplies cycle/ghost detection. No extra fetch, local detection algorithm or dependency on a tidy log. Use the same cycle result for Phase 4's join-up claim.

| Risk | Required evidence and response |
|---|---|
| Dependency cycle | From `diag.dependency_cycles`, show member IDs in cycle order and the concrete blocker edge to cut or re-sequence. Report cycles of any length, including those entirely off the rendered chain. Only a cycle touching that chain forces Phase 4's join-up line to No. |
| Cross-project blocker within a value stream | A blocks B in different projects of the same initiative (the value stream). Name both issues, both projects and the threatened gate. Cross-initiative edges belong in Phase 5; do not duplicate them here. |
| Ghost project | Combine initiative-description Next/Later names with `diag.ghost_project_pointers`, deduplicated. Say the description names a project that does not exist; do not reconstruct cancelled/deleted predecessors. |
| Independence not verified | When a Now project is expected to drain issues in parallel without confirmed independence, recommend a scoped `/faff-tidy` pass before overnight work. |
| Single-project Later | Use the tracker description's rationale and status to distinguish deliberate deferral of uncertain product shape from under-planning. A single Later project is not automatically a defect. |
| Parked on missing trigger | Name the missing planned upstream project whose shipping is required to unpark the issue. The park cannot clear until the gap closes. |
| Now without recent commits | No commits in 14 days means the project may be stalled or its status stale; surface it for review. |

- **Methodology findings:** request `horizon-assignment`; include its roadmap findings with their full diagnosis (situation, consequence, action). Interleave them with structural risks by severity (impact × scope).
- **Optional tidy enrichment:** if tidy produced a `### Structural diagnostics` block this pass, read the most recent `.faff/logs/YYYY-MM-DD/HHMMSS-tidy.md` and deduplicate its added detail. It is never the coverage source. Without it, never claim detection was skipped; at most note thinner issue-side ghost enrichment.
- For every risk, name the affected structural element and recommend one concrete action, such as closing a gap with an issue, running tidy or asking for human reprioritisation. Include project bloat from Phase 3 when present.

### 8. TL;DR

Use three to five sentences: outcomes in flight, end-to-end join-up, and the biggest concrete risk. Make clear whether the reader needs to inspect the detail.

## Output Format

Use the `rendering_adaptor` table-vs-definition-list rule (gateway → **Rendering → `rendering_adaptor`**). Begin with `## Roadmap` and the date, followed by one or two sentences counting initiatives, active and parked.

| Section, in order | Content |
|---|---|
| Outcome initiatives | Phase-2 table |
| Workstreams | Phase-3 blocks and recent grounding |
| Dependency chain | Phase-4 diagram and join-up line |
| Trigger gates | Phase-5 table |
| Critical path | Phase-6 list by horizon |
| Risks the structure surfaces | Phase-7 findings and actions |
| TL;DR | Phase-8 summary |

Omit the risks section only when there are no findings, and explicitly state in the TL;DR that no structural risks surfaced this pass.

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

When invoked autonomously (rare — this is primarily a human-facing strategic artifact), follow the shared autonomous contract (see the sibling `faff/references/autonomous.md`) and these specifics:

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
