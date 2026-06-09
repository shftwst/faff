---
name: faff-plot
description: "Turn an application-scale idea into a planned, dependency-linked roadmap. Recurses a discovery brief top-down into initiatives → projects → first-slice epics. Use for 'plan this out', 'decompose this app', 'break this big thing into a roadmap', 'map out the whole project', 'plot the build'."
---

# faff-plot

The top-down planner. Where `/faff-jot` captures new work and shapes it one level deep, `/faff-plot` takes an **application-scale** discovery brief and recurses it into a roadmap *skeleton*: outcome → initiatives → projects → first-slice epics, with the dependency links between them. It is the **planning session** `/faff-map` points at when it finds the chain doesn't join up — and `/faff-map` is what audits the skeleton plot writes.

plot is jot's recursion applied to jot's discovery. They share the same `ticket-shaping` machinery; the difference is depth. jot does one breadth-first pass and chains to prep. plot descends level by level, writing containers as it goes, and stops at first-slice epics — never the leaves.

## Configuration

**Load the gateway first.** This skill is usually entered directly (slash command) or chained from `/faff-jot`, so the gateway is **not** automatically in context. If the sibling `faff/SKILL.md` isn't already loaded this turn, **Read it now** — it holds the shared `.faffrc` configuration, the Agent Lanes definition, the `methodology` slot's `ticket-shaping` contract (including the `shape-level` input plot uses), the `appetite` dial, the ignore-cancelled/archived rule, the Untrusted-input no-execute rule, and the `.faff/` logging layout. Loading it here means the `intake` and `methodology` slots plot delegates to inherit these ambiently.

## Rendering

All human-facing output this skill emits — roadmap container and epic **descriptions**, plus any terminal summaries — passes through the configured `rendering_adaptor` normalise pass **before it is printed or written** (gateway → **Rendering**, Universal-routing rule). In particular, enumerable sets render as lists, never `·`/comma run-on paragraphs (the prose-skimmability rule), so descriptions and comments are as skimmable as terminal output. Carve-outs (skill source files, `.faff/` logs) are exempt.

## Lane

`/faff-plot` runs in the **orchestrator lane** (see gateway → Agent Lanes): it talks to the human, reads the tracker, drives the `methodology` slot, and **writes containers and tickets**. It does **not** write code and does **not** produce specs — speccing is `/faff-prep`'s job, per ticket, later. Like `/faff-jot`, it is **human-gated**: new structure entering the system is a human-confirmed event, not an autonomous one (see Autonomous mode).

`/faff-map` is plot's **read-only twin** at the same altitude — it audits whether a roadmap joins up but never writes. plot writes; map audits. Keep them distinct: never fold plot's write power into map.

## What it does (the flow)

```
discovery brief → recurse top-down (ticket-shaping per level) → write skeleton → chain to map (audit) + prep (first slice)
                  outcome → initiatives → projects → first-slice epics
```

### 1. Entry — get a discovery brief

- **Chained from `/faff-jot`** (the common path): jot hands over the brief it already gathered when it judged the work application-scale. Use it directly — do not re-run discovery.
- **Standalone** (`/faff-plot` invoked directly): run discovery first, exactly as jot does — invoke the configured `intake` skill (default `faffter-noon-intake`) via the `Skill` tool, passing the human's description, and take back a discovery brief. A missing `intake` slot is never a blocker: run the default inline.

If the brief is too thin to plan a coherent roadmap (one vague capability, no stated dependencies), say so and offer to deepen discovery rather than inventing structure.

### 2. Recurse top-down

Descend the altitudes **outcome → initiatives → projects → first-slice epics**. At each node, invoke the configured `methodology` skill's **`ticket-shaping`** output (default `faffter-noon-methodology-structural`) with:

- `shape-level` = the current altitude (`initiative` / `project` / `epic`), and
- a **node-scoped sub-brief** — the slice of the parent brief relevant to this node (the capability or project being decomposed), plus the live tracker graph.

The methodology returns that node's children *at that altitude*, shaped through its lens (the recursion logic lives in `ticket-shaping`, not here — plot drives the descent; the methodology shapes each level). plot owns the loop, the stop rule, the gating, and the writes.

### 3. The stop rule (critical — this is what stops a fantasy tree)

plot owns the skeleton **down to first-slice epics + their dependency links** — and no further. It deliberately does **not** enumerate every leaf ticket. Leaves grow later from specs (`/faff-prep`) and the two bottom-up tributaries (chain-gap fill + execution-reporting). Reuse chain-gap conservatism:

- Emit a node only when it has a **nameable deliverable**.
- **Stop a branch** when the next level down is not concretely derivable from the brief — surface "this branch needs more discovery" rather than manufacturing speculative children.

Drawing this line crisply is the whole game: it is what keeps plot from inventing 200 phantom tickets nobody asked for.

### 4. Per-level gating

Confirm **level by level** as the recursion descends, not as one giant dump at the end:

- **Containers (initiative / project) always confirm** — present the proposed children of the current node as a short tree and gate before writing ("Create these N initiatives? / these N projects under <initiative>? (yes / edit / no)"). Containers are expensive to undo.
- **First-slice epics** may be auto-created per the `appetite` dial (gateway → **Appetite for destruction**): `low` surfaces only; `medium`/`high` create the epics under a confirmed project; `full` may create a whole confirmed branch's epics at once. The hard floor still applies — no cancellation/deletion, ever.
- On `edit`, take the human's adjustments and re-shape that level before descending. On `no` for a branch, skip it (leave it un-planned) and continue with the rest.

### 5. Write the skeleton

Create top-down as each level is confirmed: initiative containers → project containers under them → first-slice epic issues under each project, with the **blocker / blocked-by links** the methodology proposed between them. Each created item: status `Backlog`, a description seeded from the relevant brief prose + the brief's `Open questions`, the tag **`faff-jot-intake`** (reuses `/faff-prep`'s existing pickup path so the first slice gets specced next), and a `planned by /faff-plot` provenance line. Containers via the configured MCP's initiative/project types; epics as issues nested under their project.

### 6. Hand-off

After the skeleton is written, offer two gates in order:

- **Audit:** "Roadmap created — audit whether it joins up via `/faff-map`? (y/n)". On confirm, invoke `/faff-map` via the Skill tool. This is the coherence check on what plot just wrote — chain join-up, gate fireability, ghost projects.
- **Start:** "Prep the first slice for build via `/faff-prep <first-epic>`? (y/n)". On confirm, invoke `/faff-prep` on the highest-sequenced first-slice epic. On deny, stop cleanly.

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

## Rules

- **Discovery lives in jot, not here.** plot consumes a brief; it only runs `intake` itself when invoked standalone with no brief. It never re-does discovery on a brief jot already gathered.
- **Recurse, don't enumerate.** The stop rule is non-negotiable: skeleton down to first-slice epics + deps, never the leaves. Leaves grow from specs and the bottom-up tributaries.
- **Containers always confirm.** No appetite level auto-creates an initiative or project container. Only first-slice epics are appetite-creatable, and only under a confirmed parent.
- **plot writes; map audits.** Keep the write/read split with map absolute — plot never just "synthesises", map never writes.
- **Shaping opinions are the methodology's.** plot owns descent, stop rule, gating, and writes — never the per-level shaping (naming, right-sizing, sequencing). That is `ticket-shaping`'s job at each `shape-level`.
- Chaining uses the standard explicit yes/no gate (gateway → Chaining pattern). No passive "you should run /faff-map next".
