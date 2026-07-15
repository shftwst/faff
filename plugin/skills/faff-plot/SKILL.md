---
name: faff-plot
description: "Turn an application-scale idea into a planned, dependency-linked roadmap. Recurses a discovery brief top-down into initiatives → projects → first-slice epics. Use for 'plan this out', 'decompose this app', 'break this big thing into a roadmap', 'map out the whole project', 'plot the build'. Or `/faff-plot rehome` to run the whole-backlog rehoming pass — group loose Backlog work into human-confirmed outcome-led projects ('sort out the loose backlog', 'rehome the backlog')."
judgement_seam: decomposition
---

# faff-plot

The top-down planner. Where `/faff-jot` captures new work and shapes it one level deep, `/faff-plot` takes an **application-scale** discovery brief and recurses it into a roadmap *skeleton*: outcome → initiatives → projects → first-slice epics, with the dependency links between them. It is the **planning session** `/faff-map` points at when it finds the chain doesn't join up — and `/faff-map` is what audits the skeleton plot writes.

plot is jot's recursion applied to jot's discovery. They share the same `ticket-shaping` machinery; the difference is depth. jot does one breadth-first pass and chains to prep. plot descends level by level, writing containers as it goes, and stops at first-slice epics — never the leaves.

## Configuration

**Load the gateway first.** Entered directly or chained from `/faff-jot`; if `faff/SKILL.md` isn't in context this turn, Read it now — it holds the shared rules + fixed contracts faff applies. plot leans on **Agent Lanes**, the `methodology` `ticket-shaping` contract (the `shape-level` input), and the `appetite` dial; its `intake` / `methodology` slots inherit the gateway ambiently.

**Methodology transport.** plot's `methodology` calls — `ticket-shaping` down the altitudes and `prdr-author` per project — are **producer dispatches** (gateway → **Sibling-skill invocation → Producer dispatch**) with `models.methodology` and `effort.methodology` resolved via `faff config get` (`inherit` omits the arg). Grain per gateway → **The `methodology` slot → Transport**: `ticket-shaping` batches **per altitude** (all confirmed nodes of a level in one dispatch; an `edit` → a follow-up node-scoped dispatch), `prdr-author` dispatches **per project**; a plot run nested in a subagent falls back **in-context** (single-level nesting).

## Rendering

All human-facing output this skill emits — roadmap container and epic **descriptions**, plus any terminal summaries — passes through the configured `rendering_adaptor` normalise pass **before it is printed or written** (gateway → **Rendering**, Universal-routing rule). In particular, enumerable sets render as lists, never `·`/comma run-on paragraphs (the prose-skimmability rule), so descriptions and comments are as skimmable as terminal output. Carve-outs (skill source files, `.faff/` logs) are exempt.

## Lane

`/faff-plot` runs in the **orchestrator lane** (see gateway → Agent Lanes): it talks to the human, reads the tracker, drives the `methodology` slot, and **writes containers and tickets**. It does **not** write code and does **not** produce specs — speccing is `/faff-prep`'s job, per ticket, later. Like `/faff-jot`, it is **human-gated**: new structure entering the system is a human-confirmed event, not an autonomous one (see Autonomous mode).

`/faff-map` is plot's **read-only twin** at the same altitude — it audits whether a roadmap joins up but never writes. plot writes; map audits. Keep them distinct: never fold plot's write power into map.

## What it does (the flow)

Two entry modes, selected by argument: **bare `/faff-plot`** runs the default brief-recursion flow below; **`/faff-plot rehome`** runs the whole-backlog rehoming pass (**Rehoming pass** section). The `rehome` argument is the only trigger — no loose-count threshold, no cadence knob.

```
discovery brief → recurse top-down (ticket-shaping per level) → write skeleton → chain to map (audit) + prep (first slice)
                  outcome → initiatives → projects → first-slice epics
```

### 1. Entry — get a discovery brief

- **Chained from `/faff-jot`** (the common path): jot hands over the brief it already gathered when it judged the work application-scale. Use it directly — do not re-run discovery.
- **Standalone** (`/faff-plot` invoked directly): run discovery first, exactly as jot does — invoke the configured `intake` skill via the Skill tool (resolve the slot value per gateway → **Sibling-skill invocation**: a bundled default is a canonical name, an explicitly-namespaced override is used verbatim), passing the human's description, and take back a discovery brief. A missing `intake` slot is never a blocker: run the default inline.

If the brief is too thin to plan a coherent roadmap (one vague capability, no stated dependencies), say so and offer to deepen discovery rather than inventing structure.

### 2. Recurse top-down

Descend the altitudes **outcome → initiatives → projects → first-slice epics**, **one level at a time**. At each level, collect every confirmed node at that altitude and invoke the configured `methodology` skill's **`ticket-shaping`** output (default `faffter-noon-methodology-thematic`) **once for the whole level** (the batch-per-altitude grain — **Methodology transport** above; a level's confirmed children feed the next level's sub-briefs, so levels are sequential but nodes within one level shape independently) with:

- `shape-level` = the current altitude (`initiative` / `project` / `epic`), and
- each confirmed node's **node-scoped sub-brief** — the slice of the parent brief relevant to that node (the capability or project being decomposed), plus the live tracker graph.

The methodology returns each node's children *at that altitude*, shaped through its lens (the recursion logic lives in `ticket-shaping`, not here — plot drives the descent; the methodology shapes each level). plot gates the returned shapes **node by node** (Step 4); an `edit` re-shapes that node via a **follow-up node-scoped dispatch**. plot owns the loop, the stop rule, the gating, and the writes.

### 3. The stop rule (critical — this is what stops a fantasy tree)

plot owns the skeleton **down to first-slice epics + their dependency links** — and no further. It deliberately does **not** enumerate every leaf ticket. Leaves grow later from specs (`/faff-prep`) and the two bottom-up tributaries (chain-gap fill + execution-reporting). Reuse chain-gap conservatism:

- Emit a node only when it has a **nameable deliverable**.
- **Stop a branch** when the next level down is not concretely derivable from the brief — surface "this branch needs more discovery" rather than manufacturing speculative children.

Drawing this line crisply is the whole game: it is what keeps plot from inventing 200 phantom tickets nobody asked for.

### 4. Per-level gating

Confirm **level by level** as the recursion descends, not as one giant dump at the end:

- **Containers (initiative / project) always confirm** — present the proposed children of the current node as a short tree and gate before writing ("Create these N initiatives? / these N projects under <initiative>? (yes / edit / no)"). Containers are expensive to undo. *One carve-out (ADR-0072): within the L4 accepted-root envelope, a loop-authored container contained under the run's admitted root PRD is admitted — interactive plot is unchanged.*
- **First-slice epics** may be auto-created per the `appetite` dial (gateway → **Appetite for destruction**): `low` surfaces only; `medium`/`high` create the epics under a confirmed project; `full` may create a whole confirmed branch's epics at once. The hard floor still applies — no cancellation/deletion, ever.
- On `edit`, take the human's adjustments and re-shape that level before descending. On `no` for a branch, skip it (leave it un-planned) and continue with the rest.

### 5. Write the skeleton

Create top-down as each level is confirmed: initiative containers → project containers under them → first-slice epic issues under each project, with the **blocker / blocked-by links** the methodology proposed between them. Each created item: status `Backlog`, a **type-templated description** produced by the gateway **Ticket templates** fill step (container nodes — initiatives/projects — resolve to the `epic` template; buildable first-slice epics infer their own type per node) — filled from the relevant brief prose, unknown fields placeholdered `_To be determined during prep._`, and the brief's open questions carried into the template's `Open questions` field; the fill step runs before the `rendering_adaptor` pass — the tag **`faff-jot-intake`** via `faff label add <issue> faff-jot-intake` and its descriptor's write (gateway → **Control-label provisioning**; reuses `/faff-prep`'s existing pickup path so the first slice gets specced next), and a `planned by /faff-plot` provenance line. For each created epic, after the label, run `faff intake-record <issue> --via jot --initiated interactive` (FAFF-212/220) — plot is a human-confirmed planning path, so it stamps `initiated: interactive` and runs **no containment check** (the human confirming the structure is the sanction; contrast the autonomous chokepoints). Containers via the configured MCP's initiative/project types; epics as issues nested under their project.

**Idempotent create + link authoring** — apply the create/relink discipline single-sourced in `faff-jot` → **Idempotent create + link authoring (the MCP-write seam)**: every create above re-queries by title + team before retrying an ambiguous `save_issue` result (never retry blind); a **node-scoped re-slice** (re-running this step against a node already sliced earlier) lists the node's existing children first and creates only the ones missing — never blind-recreates a full child set — and never issues a `removeBlocks` without re-confirming the live edge was drawn by this same pass; and any sibling reference authored into a description is a `[FAFF-N](url)` markdown link, never a hand-typed `<issue id="UUID">` embed.

### 5b. Propose a project DoD (`prdr-author`, L3 propose-for-approval)

For each **project** container just written (not initiatives, not epics), ask the configured `methodology` skill's **`prdr-author`** output for a target-scaled project DoD, then **surface it for human approval** — `/faff-plot` runs at L3, so the machine **proposes**, the human **ratifies**:

- Request `prdr-author` with the project's `{outcome, child_specs, target}` — `target` resolves `explicit > inherited > methodology-default` (gateway → **The `methodology` slot**, `prdr-author` row). The methodology writes the `AuthoredPrdr` via `faff prdr new --provenance loop --status Proposed`.
- **Surface, never auto-accept:** present the proposed `## Definition of done` + decision under the project and gate — "Proposed project DoD for <project> (target: <t>). Approve as-is / edit / skip? (approve / edit / skip)". On **approve**, point the human at the tracker to flip the PRDR `Status: Accepted` (FAFF-255's human gesture — `/faff-plot` never self-Accepts); on **edit**, take the human's DoD edit (that edit wins — human-set > methodology-default) and record it before approval; on **skip**, leave the PRDR `Proposed` for a later pass.
- **Manual-authoritative:** if the project already carries a human-set DoD, `prdr-author` re-reads it and **never clobbers** it — it fills only the unset parts (gateway → **Manual changes are authoritative (`prdr-author`)**).
- **Appetite / unanswered:** a methodology that doesn't answer `prdr-author` (or `--no-prdr`) ⇒ no proposal; the human authors the DoD directly. Low-confidence ⇒ a thin DoD flagged needs-human, surfaced as such.

The act of admission stays human (L3); `/faff-plot` only **authors + surfaces**. (The L4 lights-out runner routes the same `Proposed` PRDR through `faff prdr admit` instead — gateway → **Authored-PRDR level-scaling**.)

### 6. Hand-off

After the skeleton is written, offer two gates in order:

- **Audit:** "Roadmap created — audit whether it joins up via `/faff-map`? (y/n)". On confirm, invoke the `faff-map` skill via the Skill tool. This is the coherence check on what plot just wrote — chain join-up, gate fireability, ghost projects.
- **Start:** "Prep the first slice for build via `/faff-prep <first-epic>`? (y/n)". On confirm, invoke the `faff-prep` skill via the Skill tool on the highest-sequenced first-slice epic. On deny, stop cleanly.

## Rehoming pass (`/faff-plot rehome`)

The **write half** of backlog convergence. Under the agile lens new work lands project-less in Backlog by design (its Default-landing rule); this pass drains the accumulated loose set into outcome-led projects. The `methodology` slot's `rehome-set` output supplies the grouping *judgement*; plot owns the loop, the human gate, and the writes — the same division as `ticket-shaping`. **Rehoming, never deleting.**

**Entry.** The explicit `rehome` argument selects this mode; bare `/faff-plot` is unchanged. Deterministic entry — no loose-count trigger, no cadence config. When bare `/faff-plot` is invoked with no brief and the human's intent is clearly rehoming ("sort out the loose backlog"), plot may offer this mode conversationally. The pass needs a tracker (it reads and writes tracker projects); in git-only mode there is no project-less-Backlog concept, so the mode is a no-op.

**The flow:**

```
/faff-plot rehome
  → pull the loose backlog fresh (project-less + Backlog + non-terminal + not cancelled/archived)
  → dispatch rehome-set (producer dispatch; one batched request/response)
  → render the proposal (per project: name, outcome, members, proposed edges; + leave-loose set + findings)
  → per proposed project: approve / edit (strike-out) / decline   [unconditional gate, every appetite]
  → per approved project: create container → reparent members → draw edges → prdr-author (Step 5b)
  → log everything; offer the /faff-map audit hand-off
```

### R1. Pull the loose backlog

Fetch fresh (gateway → **Always-pull-fresh**): every issue that is **project-less AND in Backlog AND non-terminal AND not cancelled/archived** (gateway → **Ignore cancelled and archived**). Terminal and already-homed tickets are structurally outside the input set. Assemble the dependency graph and the existing projects alongside — `rehome-set`'s full input.

### R2. Dispatch `rehome-set`

Dispatch per gateway → **Sibling-skill invocation → Producer dispatch**: resolve `slots.methodology` at dispatch (never hardcode), an Agent-tool subagent with `run_in_background: false`, `models.methodology` / `effort.methodology` via `faff config get` (`inherit` omits the arg), in-context fallback when plot is itself a subagent. Transport grain: **one batched dispatch per pass** (gateway → **The `methodology` slot → Transport**) — the whole loose set in, one proposal out; the per-grouping gate is at apply, not here.

The proposal shape is the gateway `rehome-set` row (**The `methodology` slot**): proposed outcome-led containers (each `{container_name, outcome}`), a membership map, proposed coherence blocker edges (`{blocker, blocked}` — explicit, never written by the methodology), an explicit leave-loose set (each loose ticket with a one-line reason), and principle-keyed findings, ordered by which grouping unlocks sequencable value first. Completeness: every input loose ticket appears exactly once across membership ∪ leave-loose — surface a violation, never silently drop a ticket. (If the shipped contract differs from this, the shipped row wins.)

### R3. Render the proposal — zero writes pre-confirm

Render through the configured `rendering_adaptor` (**Rendering** above — enumerable sets as lists): per proposed project its name, outcome, members, and proposed edges; then the leave-loose set with reasons and the principle-keyed findings. **Nothing is written to the tracker before the gate.**

### R4. Confirm gate (unconditional — every appetite level)

Gate **per proposed project** — plot's yes/edit/no shape (Step 4) extended with strike-outs:

- **approve** — apply the group as proposed.
- **edit** = **strike-out only** — the human names members to remove; struck members become leave-loose; proposed edges touching a struck member are dropped; the trimmed group is re-presented for approve/decline. **Never re-dispatch `rehome-set` on an edit** — the strike is authoritative and subtractive, which avoids re-proposing the struck member (anti-thrash). Adding a member is a tracker action the human takes directly, not an edit path.
- **decline** — the whole group's members become leave-loose; nothing is written for it.

The prompt states the manual-undo path explicitly: *un-homing is manual — Linear UI/API only; the MCP's `save_issue.project` is reassign-only and cannot null a project* — so approval is high-consequence.

**Composition with the topology-write dial.** This pass inherits plot's **Containers always confirm** floor: every approved rehome creates a container, and no appetite level auto-creates a container outside the L4 accepted-root envelope (ADR-0072), so the whole apply sits behind this gate at every appetite. The gateway topology-write-authority dial's rehome authority (gateway → **Appetite for destruction → Topology-write authority**) still governs the methodology's *other, narrower* call sites (gating-chain rehome, MVP scope-cut, thematic conversion) — the dial adds the topology axis to the hard floor, it never relaxes it.

### R5. Apply approved projects

Per approved project, **finish-forward — never roll back** (rollback would delete a container or un-home members; the first breaks the never-delete floor, the second is impossible via the MCP):

1. **Create the container** — plot's container machinery, with a `planned by /faff-plot (rehome pass)` provenance line (gateway provenance rule). No `faff-jot-intake` label and no `faff intake-record` — those are issue-creation conventions and this pass creates no issues. On failure: report, skip this project's remaining writes, continue to the next approved project.
2. **Reparent each approved member** via `save_issue` project assignment. **Re-check fresh first** (gateway gate-freshness): a member homed or progressed mid-conversation is skipped with a logged note, never force-moved — human curation wins. On a member failure: log, continue with the rest.
3. **Draw the approved blocker edges** among the approved tickets (blocker / blocked-by links, tracker-agnostic). Append-only — an edge that already exists is skipped. On an edge failure: log, continue.
4. **Step 5b — `prdr-author`** for the new project, inputs adapted for reparented members: `outcome` = the proposal's outcome statement; `child_specs` = the approved members' titles + descriptions (+ attached specs where present); `target` resolves `explicit > inherited > methodology-default`. Same approve/edit/skip gate and manual-authoritative rule as **Step 5b** — a `skip` leaves the PRDR `Proposed`. A DoD-less outcome project is the "bare bucket" the agile lens itself refuses.

Report each project's landed state exactly — container id, members moved / skipped / failed, edges drawn / missing — with manual completion steps for anything missing. No per-member tracker comment: the new membership is already legible, and the gateway forbids duplicating legible state; the apply log is the write record.

**Idempotence.** Re-running converges: already-homed members drop out of the input set, and existing projects are part of `rehome-set`'s input, so a re-run proposes homing the remainder into an existing container rather than duplicating it.

### Zero-write endings

All three write nothing to the tracker and are logged:

- **Unanswered** (e.g. the thematic default declines with an empty set) — report "the configured methodology (`<name>`) offers no grouping opinion for a backlog rehoming pass" and how to switch lenses (`slots.methodology` in `.faffrc`). Exit cleanly.
- **Answered but empty** — render the leave-loose set with the lens's findings; "nothing to rehome yet" is information, not an error.
- **All declined** — acknowledge, log the declines, exit cleanly.

### Autonomous invocation

Mirrors plot's brief-recursion fallback (**Autonomous mode** below): if the rehome mode is somehow invoked autonomously, dispatch `rehome-set`, write the rendered proposal to `.faff/intake/<date>-rehome-proposal.md`, surface it for human review, and write **nothing** to the tracker. `/faff-beep-boop` never invokes the pass — the gate stays human-shaped even when no human is present.

## Methodology influence

The shape of the tree is the methodology's call, per level (`ticket-shaping` with `shape-level`):

- **structural (default)** — a shallow, literal tree. Renders the brief's stated structure at each altitude, no right-sizing or value opinion.
- **agile-delivery** — an MVP-shaped tree: outcome-named initiatives, projects as shippable increments sequenced by value × risk (thinnest viable slice first), right-sized first-slice epics, hidden dependencies surfaced as explicit links. This is the lens you want for "wake up to an iterative roadmap."
- **waterfall — does not exist.** No shipped methodology plans every leaf up front. If exhaustive up-front decomposition is ever wanted, it's a new `ticket-shaping` that recurses past the first-slice stop rule — a nameable gap, not a default.

## Tracker-less (git-only) mode

When no tracker MCP is available (gateway → Configuration), there are no containers to create. plot still recurses and writes the full skeleton to `.faff/intake/<date>-<slug>-roadmap.md` as a nested checklist (initiatives → projects → first-slice epics + deps), notes that creation was skipped, and offers the same prep/map hand-off against the written file. Nothing is lost.

## Autonomous mode

`/faff-plot` is **primarily interactive**, for the same reason `/faff-jot` is: deciding the shape of a whole application is direction-setting that belongs to the human, not the unattended loop. `/faff-beep-boop` does **not** invoke `/faff-plot` — beep-boop drains the existing backlog; it does not plan new applications. (Autonomous, lights-out planning — "describe an app at night, wake up to a built first slice" — is a documented future L4 capability; see `design/planning-loop.md`. It is not this skill's job yet.)

If `/faff-plot` is somehow invoked autonomously, it recurses and writes the skeleton to `.faff/intake/…` and surfaces it for human review rather than creating containers unattended.

## Appetite

Reads the suite-wide `appetite` dial, lightly modulated since container creation is human-gated:

- `low` / `medium` — confirm every level; surface first-slice epics rather than auto-creating at `low`.
- `high` (default) — confirm containers; auto-create first-slice epics under a confirmed project; resolve minor shaping ambiguities itself (recorded in the brief's open questions) rather than asking mid-recursion.
- `full` — may create a whole confirmed branch (its projects' first-slice epics) in one step. Still **never** creates an initiative/project container without confirmation, and the hard floor applies — no cancellation/deletion, ever.

## Logging

Write a log per the gateway `.faff/logging` rule: the brief, each level's `ticket-shaping` request (`shape-level` + sub-brief) and the methodology's proposed children, every stop-rule decision (which branches were stopped and why), what was created (ids + relationships per level), and any chain to `/faff-map` or `/faff-prep`. Enough that a follow-up agent can see how the roadmap came to exist and where it was deliberately left shallow.

For a **rehoming pass** (`/faff-plot rehome`), log instead: the pulled loose-backlog set, the `rehome-set` dispatch (slot / model / effort resolved), the full proposal, every gate decision (approve / edit / decline with the strike-outs), every write with its outcome, and every skip with its reason — enough to resume or audit the rehome in a fresh conversation.

## Rules

- **Discovery lives in jot, not here.** plot consumes a brief; it only runs `intake` itself when invoked standalone with no brief. It never re-does discovery on a brief jot already gathered.
- **Recurse, don't enumerate.** The stop rule is non-negotiable: skeleton down to first-slice epics + deps, never the leaves. Leaves grow from specs and the bottom-up tributaries.
- **Containers always confirm.** No appetite level auto-creates an initiative or project container — except within the L4 accepted-root envelope (ADR-0072): a loop-authored container contained under the run's admitted root PRD is admitted. Only first-slice epics are otherwise appetite-creatable, and only under a confirmed parent.
- **plot writes; map audits.** Keep the write/read split with map absolute — plot never just "synthesises", map never writes.
- **Shaping opinions are the methodology's.** plot owns descent, stop rule, gating, and writes — never the per-level shaping (naming, right-sizing, sequencing). That is `ticket-shaping`'s job at each `shape-level`.
- Chaining uses the standard explicit yes/no gate (gateway → Chaining pattern). No passive "you should run /faff-map next".
