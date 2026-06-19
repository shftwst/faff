---
name: faff-jot
description: "Start something new. Kick off an empty project, or capture a new feature, bug, or idea — and turn it into a sensible set of tickets. Use for 'new project', 'I've got an idea', 'add a feature', 'file a bug', 'scope this', 'kick off'. Or point it at an existing ticket (`/faff-jot ISSUE-XX`) to shape/gate it — v1 promote/demote its automation eligibility."
---

# faff-jot

The front door for new work — and the human's entry point to shape or gate a ticket that already exists. `/faff-jot` is how tickets come to exist in the first place; pointed at an existing ticket (`/faff-jot ISSUE-XX`) it's also where you decide that ticket's shape and whether it enters the pipeline. For new work it takes a loose starting point (a whole new project, or a single feature/bug/idea) and turns it into a sensible, well-shaped set of tracker tickets the rest of the pipeline can pick up.

One skill, three entry points — **not** separate commands per item type:

- **Kick off an empty project** — greenfield. No tracker project yet, or an empty repo. Produces an initial structure: workstreams/containers and the first tickets to reach a usable v0.
- **Capture a new feature, bug, or ticket** — single-item. An existing project. Produces one well-formed ticket (or a small set, if it genuinely splits), placed in the right workstream.
- **Shape or gate an existing ticket** — `/faff-jot ISSUE-XX`. *Not* new work: the human's conversational entry point to decide an existing ticket's **shape and eligibility** — v1 ships **promote/demote of automation eligibility** (`faff-automate`), plus the `faff-automation-hold` hard stop. Narrow remit (see **Existing-ticket interactor** below); never speccing, grooming, or building.

## Configuration

**Load the gateway first.** If `faff/SKILL.md` isn't in context this turn, Read it now — it holds the shared rules + fixed contracts faff applies. jot leans on **Agent Lanes** and the `intake` / `methodology` slot contracts it delegates to.

## Rendering

All human-facing output this skill emits — new-work tracker **descriptions** (the create step) and the existing-ticket interactor's reason comments, plus any terminal summaries — passes through the configured `rendering_adaptor` normalise pass **before it is printed or written** (gateway → **Rendering**, Universal-routing rule). In particular, enumerable sets render as lists, never `·`/comma run-on paragraphs (the prose-skimmability rule), so descriptions and comments are as skimmable as terminal output. Carve-outs (skill source files, `.faff/` logs) are exempt.

## Lane

`/faff-jot` runs in the **orchestrator lane** (see gateway → Agent Lanes): it talks to the human, runs discovery, reads the tracker, and creates tickets. It does **not** write code and does **not** produce specs — speccing is `/faff-prep`'s job, per ticket, later. The division is deliberate: ideation and ticket-shaping are orchestration; the spec is the build contract.

## What it does (the flow)

```
no arg → new work:           discover (intake) → shape (methodology) → create → chain to /faff-prep
ISSUE-XX → existing ticket:  load → shaping/gating menu → promote/demote (or hold/unhold) → log
```

### 0. Dispatch on argument

**Check for an issue-id argument first** — its presence is the unambiguous switch, so no "new or existing?" gate is needed:

- **Issue-id argument present** (`/faff-jot FAFF-23`) → the **existing-ticket interactor** (see **Existing-ticket interactor** below). Skip discovery, shaping, and creation — those are for new work only.
- **No argument** (`/faff-jot`) → new-work intake: continue to mode detection below, unchanged.

### 1. Detect the mode (new work only)

- **greenfield** when: no tracker project/container exists for this work, or the user says "new project / starting from scratch / empty repo / kick off X".
- **single-item** when: a tracker project already exists and the user is describing one feature, bug, or change.

When it's genuinely ambiguous (existing project, but the user is describing something big and cross-cutting), ask once: "Is this a new workstream/project, or one ticket in [existing project]?" Don't guess on a fork this consequential.

### 2. Discover — delegate to the `intake` slot

Invoke the configured `intake` skill (default `faffter-noon-intake`; override with `superpowers:brainstorming`, `gstack:office-hours`, or any ideation skill) via the Skill tool (resolve the slot value per gateway → **Sibling-skill invocation**: a bundled default like `faffter-noon-intake` is a canonical name, an explicitly-namespaced override is used verbatim). Pass it: the detected mode, the human's starting description, and — for single-item — the live workstream/container list + naming conventions + current-priority signal so it can place the item.

The intake skill runs the discovery conversation and returns a **discovery brief** (the `intake`-slot output contract — see `faffter-noon-intake`). **Whatever intake skill ran, its output comes back into this orchestrator lane** — `/faff-jot` owns everything from here. A third-party intake skill only has to emit the discovery-brief shape; it never touches the tracker.

If the configured intake skill returns something that isn't a conformant discovery brief (missing required sections), normalise what you can and fill gaps from the conversation — don't bounce it back to the human. A missing `intake` slot is **never** a blocker: run the default `faffter-noon-intake` inline.

### 3. Shape into tickets — apply the `methodology` slot

Hand the discovery brief to the configured `methodology` skill's **`ticket-shaping`** output (default `faffter-noon-methodology-structural`; see that skill). The methodology decides the structure — workstreams/containers, ticket boundaries, sequencing, dependency links — from the brief plus the live tracker graph. This is where "a sensible set of tickets" is actually formed, and it follows whatever methodology the project has configured: the structural default shapes purely from the brief + graph; an opinionated methodology (`faffter-dark-methodology-agile-delivery`) additionally right-sizes, outcome-names workstreams, and sequences by value × risk.

`/faff-jot` does not invent its own ticket structure — it asks the methodology for one. That's what keeps shaping consistent with how the same project's backlog is groomed and sequenced everywhere else.

### 4. Confirm and create

**Fork first — is this application-scale?** Before creating anything, check whether the brief is bigger than a flat set of first-slice tickets: it spans **multiple capabilities that themselves decompose** into projects/sub-work (the same multi-capability signal that makes the methodology propose a top-level container). If so, offer the top-down route instead of creating flat:

> "This looks application-scale — decompose into a full roadmap (initiatives → projects → first-slice epics) via `/faff-plot` first? (y/n)"

On confirm, hand the **discovery brief** to the `faff-plot` skill via the Skill tool and stop here — do **not** also create the flat set (plot writes the skeleton, including the first-slice epics). On deny, or for a single-item / small greenfield brief, proceed with the flat create below exactly as before. The fork is a one-time offer at the shape boundary, not a new mode.

Show the proposed structure (containers + tickets + relationships) and gate before writing:

- **Interactive (default):** present the shaped tickets as a short tree and ask "Create these N tickets [under new project '<name>']? (yes / edit / no)". On `edit`, take the human's adjustments and re-shape or tweak directly. On `yes`, create them in the tracker via the configured MCP. On `no`, stop — the brief is logged so nothing is lost.
- **Fill each ticket's description from its type template** (gateway → **Ticket templates**) before writing it: determine the type (honouring any per-ticket `type` the methodology's `ticket-shaping` supplied, else inferring from the title + description), resolve the template, and fill its fields from the brief — placeholdering unknown fields with `_To be determined during prep._`, never fabricating content. This runs after shaping (Step 3) and before the `rendering_adaptor` pass, so issues are **born structured**. Seed-not-constrain: a thin brief still creates a thin-but-structured ticket — creation is **never** blocked for an under-filled template.
- Create containers first (initiative/project), then tickets, then the blocker/blocked-by links the methodology proposed. Apply the `faff-jot-intake` tag (ensuring the label exists first, gateway → **Control-label provisioning**) so the next `/faff-prep` pass recognises freshly-shaped work. (Each ticket's open questions land in its template's `Open questions` field.)

### 5. Chain to prep

After creating, offer the next step via the standard chaining gate: "Tickets created. Prep the first one for build now? (`/faff-prep <first-ticket>`) (y/n)". On confirm, invoke the `faff-prep` skill via the Skill tool on the highest-sequenced ticket. On deny, stop cleanly. (For greenfield, the "first one" is the first ticket of the first-slice workstream.)

## Existing-ticket interactor (`/faff-jot ISSUE-XX`)

When invoked with an issue-id argument, `/faff-jot` is **not** doing new-work intake — it's the human's conversational entry point to **shape or gate an existing ticket**. It is **interactive-only** (never autonomous) and runs in the orchestrator lane, which already has tracker write (it creates tickets for new work), so mutating a label on an existing ticket is within-lane.

**Remit — shaping & eligibility only.** Promote/demote (add/remove `faff-automate`) + hold/unhold (the `faff-automation-hold` hard stop), and (deferred — see **Out of scope**) re-scope, re-home (re-parent), split/merge *intent*: "the human deciding a ticket's shape and whether it enters the pipeline." It deliberately does **not** absorb operations that already have homes:

- speccing → `/faff-prep`
- grooming / diagnostics → `/faff-tidy`
- building → `/faff-graft`

Framed narrowly it extends jot's intake identity (jot already owns the human↔pipeline-entry boundary); framed loosely it would duplicate three skills. Keep it narrow.

### The flow

1. **Load the ticket** — title, description, labels, status, spec comments. If the issue doesn't exist → error and stop. If it's **cancelled or archived** → refuse (shared **Ignore cancelled and archived** rule). This is a **load**, not a re-run of discovery — never re-interview the human about a ticket that already exists.
2. **Present a shaping/gating menu** keyed to the ticket's **automation eligibility** (gateway → **Automation eligibility**), not its hold-state. Resolve eligibility first — `faff eligible --label <each of the ticket's labels> --default <automation_default>` (the CLI's pure precedence function: `faff-automation-hold` > `faff-automate` > the `automation_default` knob). Then offer the matching control:
   - ticket **held** (carries `faff-automation-hold`) → the hard stop dominates, so promoting is a silent no-op; offer **unhold**: "FAFF-XX is hard-held out of automation — lift the hold? (y/n)" (note: the hold overrides any `faff-automate`).
   - ticket **eligible** (carries `faff-automate`, not held) → offer **demote**: "FAFF-XX is automation-eligible — demote it (hands-off)? (y/n)", and offer **hold** as the hard stop: "…or hard-hold it out entirely? (y/n)".
   - ticket **not eligible, not held** (unlabelled under the opt-in default) → offer **promote**: "FAFF-XX isn't automation-eligible — promote it (make it automatable)? (y/n)", and offer **hold** as a pre-emptive hard stop.
3. **Act on the choice** — the interactive choice **is** the confirm (immediate, no second gate). Ensure the target label exists first (gateway → **Control-label provisioning**):
   - **promote** → add the `faff-automate` label. The ticket becomes automation-eligible and rejoins normal eligibility on the next pass; **promote does not move it to Todo**.
   - **demote** → remove the `faff-automate` label. The ticket falls back to the `automation_default` (hands-off under opt-in).
   - **hold** → add the `faff-automation-hold` label (the hard stop — excludes even if `faff-automate` is present), optionally with a one-line reason comment.
   - **unhold** → remove the `faff-automation-hold` label. The ticket returns to whatever its `faff-automate`/default eligibility would otherwise be.
   - **Edge cases (no-op + inform):** promote of an already-eligible ticket → no-op, say so; demote of a ticket with no `faff-automate` → no-op, say so; hold of an already-held ticket → no-op; unhold of a never-held ticket → no-op.
4. **Log** the action per the gateway `.faff/logging` rule. No spec, no build, no re-discovery.

### Relationship to `/faff-tidy`

Promote/demote here and `/faff-tidy`'s §4a **bless** are **complementary entry points to the same `faff-automate` eligibility primitive**, distinguished by context, not owner:

- **jot is ticket-centric** — "promote/demote *this ticket I named*."
- **tidy is grooming-batch** — "bless across the On-hold items I'm reviewing."

Same add/remove of the `faff-automate` label, both human-gated, no canonical-owner conflict. (Terminology: tidy says "bless", jot says "promote" — both add the label.) The hold/unhold of `faff-automation-hold` is the shared **hard-stop** control, available from either entry point.

### Out of scope (v1)

- **Re-scope / re-home (re-parent) / split-merge intent** are the named direction but **deferred** — each later reuses the `methodology` slot's `ticket-shaping` output.
- No in-place edit of title / description / status.
- The interactor is **interactive-only** — no autonomous invocation (consistent with new-work intake being human-gated).

## Tracker-less (git-only) mode

When no tracker MCP is available (gateway → Configuration), there are no tickets to create. `/faff-jot` still runs discovery and shaping, then writes the shaped set to `.faff/intake/<date>-<slug>.md` as a checklist the human can act on, and notes that ticket creation was skipped (no tracker). The discovery brief and shaped structure are never lost.

## Autonomous mode

`/faff-jot` is **primarily interactive** — discovery is a conversation, and inventing new scope is exactly the kind of direction-setting that belongs to the human, not the autonomous pipeline. `/faff-beep-boop` does **not** invoke `/faff-jot`: beep-boop drains the *existing* backlog, it does not conjure new work. (This is why intake sits outside the unattended loop — new work entering the system is a human-gated event.)

If `/faff-jot` is somehow invoked in autonomous mode, it produces the discovery brief and shaped-ticket proposal, writes them to `.faff/intake/…`, and surfaces them for human review rather than creating tickets unattended. It never auto-creates a project or backlog without a human confirming the shape.

The **existing-ticket interactor** (`/faff-jot ISSUE-XX`) is likewise **interactive-only** — promote/demote (and the hold/unhold hard stop) is a human steering decision, and changing a ticket's automation eligibility is always human-gated (gateway → **Automation eligibility**), so there is no autonomous path to it.

## Appetite

Reads the suite-wide `appetite` dial but is lightly modulated, since creation is human-gated by default:

- `low` / `medium` — always show the full proposed structure and wait for explicit confirmation before creating anything.
- `high` (default) — same confirmation gate for creation, but resolve minor shaping ambiguities itself (recorded in the brief's open questions) rather than asking mid-discovery.
- `full` — may create the shaped tickets directly when the brief is unambiguous and a tracker is configured, posting the shaped structure as the audit trail. Still never creates a top-level **project/initiative container** without confirmation (containers are expensive to undo), and the hard floor applies — no cancellation/deletion, ever.

## Logging

Write a log per the gateway `.faff/logging` rule: the detected mode, which intake skill ran, the discovery brief, the methodology's proposed structure, what was created (ids + relationships), and any chain to `/faff-prep`. Enough that a follow-up agent can see how this backlog came to exist. For the **existing-ticket interactor**, log the ticket id, its prior eligibility state, the promote/demote/hold/unhold action taken (or the no-op), and any reason comment. This narrative `HHMMSS-jot.md` write is subject to the gateway logging gate (skip the narrative write when `logging: essential`).

## Rules

- One skill for all new-work intake — never spawn per-type variants (`faff-new-bug`, `faff-new-feature`). Mode is a parameter, not a separate command. The existing-ticket interactor follows the same principle: it's selected by the issue-id **argument**, not a separate command.
- The existing-ticket interactor (`/faff-jot ISSUE-XX`) is **shaping/eligibility only** (promote/demote + hold/unhold in v1) and **interactive-only**. It never specs (→ `/faff-prep`), grooms (→ `/faff-tidy`), or builds (→ `/faff-graft`), never re-runs discovery on a ticket that already exists, and never edits the ticket's title/description/status in place.
- Discovery is delegated (`intake` slot), shaping is delegated (`methodology` slot). `/faff-jot` orchestrates: detect mode, route the brief, confirm, create, chain. It owns no ideation opinions and no structural opinions of its own.
- Never write a spec here. A created ticket is a `Backlog` item with a seeded description and open questions — `/faff-prep` turns it into a buildable spec. (A description is never a spec — gateway shared rule.)
- Ticket creation is gated on human confirmation except at `full` appetite for non-container tickets. Containers always confirm.
- Chaining uses the standard explicit yes/no gate (gateway → Chaining pattern). No passive "you should run /faff-prep next".
