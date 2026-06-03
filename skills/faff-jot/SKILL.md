---
name: faff-jot
description: "Start something new. Kick off an empty project, or capture a new feature, bug, or idea — and turn it into a sensible set of tickets. Use for 'new project', 'I've got an idea', 'add a feature', 'file a bug', 'scope this', 'kick off'."
---

# faff-jot

The front door for new work. Everything else in faff acts on tickets that already exist — `/faff-jot` is how tickets come to exist in the first place. It takes a loose starting point (a whole new project, or a single feature/bug/idea) and turns it into a sensible, well-shaped set of tracker tickets that the rest of the pipeline can pick up.

One skill, two starting points — **not** separate commands per item type:

- **Kick off an empty project** — greenfield. No tracker project yet, or an empty repo. Produces an initial structure: workstreams/containers and the first tickets to reach a usable v0.
- **Capture a new feature, bug, or ticket** — single-item. An existing project. Produces one well-formed ticket (or a small set, if it genuinely splits), placed in the right workstream.

## Configuration

**Load the gateway first.** This skill is usually entered directly (slash command), so the gateway is **not** automatically in context. If `~/.claude/skills/faff/SKILL.md` isn't already loaded this turn, **Read it now** — it holds the shared `.faffrc` configuration, the Agent Lanes definition, the ignore-cancelled/archived rule, `.faff/` logging layout, and the slot contracts this skill applies. Loading it here means the `intake` and `methodology` slots jot delegates to inherit these ambiently.

## Lane

`/faff-jot` runs in the **orchestrator lane** (see gateway → Agent Lanes): it talks to the human, runs discovery, reads the tracker, and creates tickets. It does **not** write code and does **not** produce specs — speccing is `/faff-prep`'s job, per ticket, later. The division is deliberate: ideation and ticket-shaping are orchestration; the spec is the build contract.

## What it does (the flow)

```
starting point → discover (intake slot) → shape into tickets (methodology slot) → create → chain to /faff-prep
```

### 1. Detect the mode

- **greenfield** when: no tracker project/container exists for this work, or the user says "new project / starting from scratch / empty repo / kick off X".
- **single-item** when: a tracker project already exists and the user is describing one feature, bug, or change.

When it's genuinely ambiguous (existing project, but the user is describing something big and cross-cutting), ask once: "Is this a new workstream/project, or one ticket in [existing project]?" Don't guess on a fork this consequential.

### 2. Discover — delegate to the `intake` slot

Invoke the configured `intake` skill (default `faffter-noon-intake`; override with `superpowers:brainstorming`, `gstack:office-hours`, or any ideation skill) via the `Skill` tool. Pass it: the detected mode, the human's starting description, and — for single-item — the live workstream/container list + naming conventions + current-priority signal so it can place the item.

The intake skill runs the discovery conversation and returns a **discovery brief** (the `intake`-slot output contract — see `faffter-noon-intake`). **Whatever intake skill ran, its output comes back into this orchestrator lane** — `/faff-jot` owns everything from here. A third-party intake skill only has to emit the discovery-brief shape; it never touches the tracker.

If the configured intake skill returns something that isn't a conformant discovery brief (missing required sections), normalise what you can and fill gaps from the conversation — don't bounce it back to the human. A missing `intake` slot is **never** a blocker: run the default `faffter-noon-intake` inline.

### 3. Shape into tickets — apply the `methodology` slot

Hand the discovery brief to the configured `methodology` skill's **`ticket-shaping`** output (default `faffter-noon-methodology-structural`; see that skill). The methodology decides the structure — workstreams/containers, ticket boundaries, sequencing, dependency links — from the brief plus the live tracker graph. This is where "a sensible set of tickets" is actually formed, and it follows whatever methodology the project has configured: the structural default shapes purely from the brief + graph; an opinionated methodology (`faffter-dark-methodology-agile-delivery`) additionally right-sizes, outcome-names workstreams, and sequences by value × risk.

`/faff-jot` does not invent its own ticket structure — it asks the methodology for one. That's what keeps shaping consistent with how the same project's backlog is groomed and sequenced everywhere else.

### 4. Confirm and create

**Fork first — is this application-scale?** Before creating anything, check whether the brief is bigger than a flat set of first-slice tickets: it spans **multiple capabilities that themselves decompose** into projects/sub-work (the same multi-capability signal that makes the methodology propose a top-level container). If so, offer the top-down route instead of creating flat:

> "This looks application-scale — decompose into a full roadmap (initiatives → projects → first-slice epics) via `/faff-plot` first? (y/n)"

On confirm, hand the **discovery brief** to `/faff-plot` via the Skill tool and stop here — do **not** also create the flat set (plot writes the skeleton, including the first-slice epics). On deny, or for a single-item / small greenfield brief, proceed with the flat create below exactly as before. The fork is a one-time offer at the shape boundary, not a new mode.

Show the proposed structure (containers + tickets + relationships) and gate before writing:

- **Interactive (default):** present the shaped tickets as a short tree and ask "Create these N tickets [under new project '<name>']? (yes / edit / no)". On `edit`, take the human's adjustments and re-shape or tweak directly. On `yes`, create them in the tracker via the configured MCP. On `no`, stop — the brief is logged so nothing is lost.
- Create containers first (initiative/project), then tickets, then the blocker/blocked-by links the methodology proposed. Apply the `faff-jot-intake` tag so the next `/faff-prep` pass recognises freshly-shaped work. Carry each ticket's open questions into its description.

### 5. Chain to prep

After creating, offer the next step via the standard chaining gate: "Tickets created. Prep the first one for build now? (`/faff-prep <first-ticket>`) (y/n)". On confirm, invoke `/faff-prep` on the highest-sequenced ticket. On deny, stop cleanly. (For greenfield, the "first one" is the first ticket of the first-slice workstream.)

## Tracker-less (git-only) mode

When no tracker MCP is available (gateway → Configuration), there are no tickets to create. `/faff-jot` still runs discovery and shaping, then writes the shaped set to `.faff/intake/<date>-<slug>.md` as a checklist the human can act on, and notes that ticket creation was skipped (no tracker). The discovery brief and shaped structure are never lost.

## Autonomous mode

`/faff-jot` is **primarily interactive** — discovery is a conversation, and inventing new scope is exactly the kind of direction-setting that belongs to the human, not the autonomous pipeline. `/faff-beep-boop` does **not** invoke `/faff-jot`: beep-boop drains the *existing* backlog, it does not conjure new work. (This is why intake sits outside the unattended loop — new work entering the system is a human-gated event.)

If `/faff-jot` is somehow invoked in autonomous mode, it produces the discovery brief and shaped-ticket proposal, writes them to `.faff/intake/…`, and surfaces them for human review rather than creating tickets unattended. It never auto-creates a project or backlog without a human confirming the shape.

## Appetite

Reads the suite-wide `appetite` dial but is lightly modulated, since creation is human-gated by default:

- `low` / `medium` — always show the full proposed structure and wait for explicit confirmation before creating anything.
- `high` (default) — same confirmation gate for creation, but resolve minor shaping ambiguities itself (recorded in the brief's open questions) rather than asking mid-discovery.
- `full` — may create the shaped tickets directly when the brief is unambiguous and a tracker is configured, posting the shaped structure as the audit trail. Still never creates a top-level **project/initiative container** without confirmation (containers are expensive to undo), and the hard floor applies — no cancellation/deletion, ever.

## Logging

Write a log per the gateway `.faff/logging` rule: the detected mode, which intake skill ran, the discovery brief, the methodology's proposed structure, what was created (ids + relationships), and any chain to `/faff-prep`. Enough that a follow-up agent can see how this backlog came to exist.

## Rules

- One skill for all new-work intake — never spawn per-type variants (`faff-new-bug`, `faff-new-feature`). Mode is a parameter, not a separate command.
- Discovery is delegated (`intake` slot), shaping is delegated (`methodology` slot). `/faff-jot` orchestrates: detect mode, route the brief, confirm, create, chain. It owns no ideation opinions and no structural opinions of its own.
- Never write a spec here. A created ticket is a `Backlog` item with a seeded description and open questions — `/faff-prep` turns it into a buildable spec. (A description is never a spec — gateway shared rule.)
- Ticket creation is gated on human confirmation except at `full` appetite for non-container tickets. Containers always confirm.
- Chaining uses the standard explicit yes/no gate (gateway → Chaining pattern). No passive "you should run /faff-prep next".
