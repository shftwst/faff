---
name: faff-jot
description: "Start something new. Kick off an empty project, or capture a new feature, bug, or idea — and turn it into a sensible set of tickets. Use for 'new project', 'I've got an idea', 'add a feature', 'file a bug', 'scope this', 'kick off'. Or point it at an existing ticket (`/faff-jot ISSUE-XX`) to load and inspect it — its shaping verbs are deferred, so it displays the ticket and mutates nothing."
judgement_seam: shaping
---

# faff-jot

The front door for new projects, features, bugs and ideas: discover and shape them into tracker tickets for the pipeline. `/faff-jot ISSUE-XX` is the human entry to an existing ticket; its current inspection-only scope and deferred shaping verbs are defined below.

One skill, three entry points — **not** separate commands per item type:

- **Kick off an empty project** — greenfield. No tracker project yet, or an empty repo. Produces an initial structure: workstreams/containers and the first tickets to reach a usable v0.
- **Capture a new feature, bug, or ticket** — single-item. An existing project. Produces one well-formed ticket (or a small set, if it genuinely splits), landed wherever the `methodology` slot's `ticket-shaping` places it — a workstream/project home, or (the agile-lens default) project-less in Backlog.
- **Inspect an existing ticket** — `/faff-jot ISSUE-XX`. *Not* new work: loads and displays a ticket for inspection. Its shaping verbs (re-scope, re-home, split/merge) are **deferred** (see **Existing-ticket interactor** below); it never specs, grooms, or builds.

## Configuration

**Load the kernel first.** Read `faff/references/kernel.md` unless already in context this turn. Skip the bare routing gateway `faff/SKILL.md`. Read `faff/references/tracker.md`, `faff/references/autonomous.md` and `faff/references/methodology.md`. Also Read `faff/references/create.md` for every path except interactive inspection of an existing ticket through a resolved tracker. Load it before any new-work or git-only fallback. Follow **Agent Lanes** and the `intake` / `methodology` slot contracts.

## Rendering

Pass every human-facing output through the configured `rendering_adaptor` normalise pass before printing/writing (gateway → **Rendering**, Universal-routing rule): new-work tracker descriptions, existing-ticket reason comments and terminal summaries. Render enumerable sets as lists, never `·`/comma run-on paragraphs. Skill source files and `.faff/` logs are exempt.

## Lane

`/faff-jot` runs in the **orchestrator lane** (gateway → Agent Lanes): human conversation, discovery, tracker reads and ticket creation. It writes neither code nor specs; `/faff-prep` produces each ticket's build contract later.

## What it does (the flow)

```
no arg → new work:           discover (intake) → shape (methodology) → create → chain to /faff-prep
ISSUE-XX → existing ticket:  load → display summary → log
```

### 0. Dispatch on argument

**Check for an issue-id argument first** — its presence is the unambiguous switch, so no "new or existing?" gate is needed:

- **Issue-id argument present** (`/faff-jot ISSUE-XX`) → the **existing-ticket interactor** (see **Existing-ticket interactor** below). Skip discovery, shaping, and creation — those are for new work only.
- **No argument** (`/faff-jot`) → new-work intake: continue to mode detection below, unchanged.

### 1. Detect the mode (new work only)

- **greenfield** when: no tracker project/container exists for this work, or the user says "new project / starting from scratch / empty repo / kick off X".
- **single-item** when: a tracker project already exists and the user is describing one feature, bug, or change.

When it's genuinely ambiguous (existing project, but the user is describing something big and cross-cutting), ask once: "Is this a new workstream/project, or one ticket in [existing project]?" Don't guess on a fork this consequential.

### 2. Discover — delegate to the `intake` slot

**Dispatch the configured `intake` skill** (override with `superpowers:brainstorming`, `gstack:office-hours`, or any ideation skill) **as a producer subagent** (resolve the slot value + transport per gateway → **Sibling-skill invocation → Producer dispatch**, resolving the `intake` dispatch lane: a bundled default is a canonical name, an explicitly-namespaced override is used verbatim; an `engine:<name>` value forks the dispatch to `faff engine call` per that same gateway rule — a named non-zero exit surfaces loudly, never a session-model fallback). Pass it: the detected mode, the human's starting description, and — for single-item — the live workstream/container list + naming conventions + current-priority signal so it can place the item.

Intake returns a **discovery brief** (contract in `faffter-noon-intake`) to this orchestrator. `/faff-jot` owns the remaining flow. Third-party intake skills emit that shape and never touch the tracker.

If the configured intake skill returns something that isn't a conformant discovery brief (missing required sections), normalise what you can and fill gaps from the conversation — don't bounce it back to the human. A missing `intake` override is never a blocker: `faff config get slots.intake` always resolves (the registry supplies the default); run the resolved skill inline.

### 3. Shape into tickets — apply the `methodology` slot

**Methodology transport.** jot's `methodology` calls — `ticket-shaping` for the brief and `prdr-author` for a new project — are **producer dispatches** (gateway → **Sibling-skill invocation → Producer dispatch**), resolving the `methodology` dispatch lane. Per gateway → **The `methodology` slot → Transport**, `ticket-shaping` is a **single dispatch per pass** and `prdr-author` dispatches **per project**; jot running inside a subagent falls back **in-context** (single-level nesting).

Hand the discovery brief to the configured `methodology` skill's **`ticket-shaping`** output (resolve `faff config get slots.methodology`). The methodology decides workstreams/containers, ticket boundaries, sequencing and dependency links from the brief and live tracker graph. Follow the configured methodology: the thematic default shapes purely from the brief + graph; an opinionated methodology (`faffter-dark-methodology-agile-delivery`) additionally right-sizes, outcome-names workstreams, and sequences by value × risk.

`/faff-jot` owns no ticket-structure judgement; use the methodology's shape consistently with the rest of the backlog.

### 4. Confirm and create

**Fork first — is this application-scale?** Before any create, check for multiple capabilities that themselves decompose into projects/sub-work, the same signal behind a methodology-proposed top-level container. If so, offer the top-down route:

> "This looks application-scale — decompose into a full roadmap (initiatives → projects → first-slice epics) via `/faff-plot` first? (y/n)"

On confirm, invoke `faff-plot` via the Skill tool with the **discovery brief**, then stop; never also create the flat set (plot creates the skeleton and first-slice epics). On deny, or for a single-item/small greenfield brief, use the flat create below. Offer this fork once at the shape boundary; it is not another mode.

**Default landing — act on the shaped container, never the methodology name.** Read `ticket-shaping`'s returned shape (gateway → **The `methodology` slot**, Default landing). Proposed container: confirm/create it below. None: create project-less Backlog tickets and skip `prdr-author` because no container DoD exists. Under agile, no-container is normal; a new project is opt-in by the human or `/faff-plot`. Greenfield kickoff already explicitly creates a project. Never branch on the configured methodology name.

Show the proposed structure (containers + tickets + relationships) and gate before writing:

- **Interactive (default):** present the shaped tickets as a short tree and ask "Create these N tickets [under new project '<name>']? (yes / edit / no)". On `edit`, take the human's adjustments and re-shape or tweak directly. On `yes`, create them in the tracker via the configured MCP. On `no`, stop — the brief is logged so nothing is lost.
- **Fill each ticket's description from its type template** (gateway → **Ticket templates**), after Step 3 shaping and before rendering/writing. Use the supplied `ticket-shaping` type, otherwise infer from title + description; resolve the template and fill from the brief. Unknown fields use `_To be determined during prep._`; never fabricate content or block creation for under-filled templates. A native mapping may require `get_template` at create time (tier 1); a miss falls through silently without blocking.
- **Resolve the create-target team.** After type determination, before `save_issue`, read `faff config get --json tracking.team_routing` keyed by the determined type. A match wins; otherwise use `faff config get tracking.default_team`. Unknown-taxonomy routing keys never match. With `tracking.teams` unset, use the one resolved legacy team unconditionally, with no routing branch. `/faff-plot` references this same procedure.
- Create containers first (initiative/project), then tickets — each into its resolved create-target team — then the blocker/blocked-by links the methodology proposed. (Each ticket's open questions land in its template's `Open questions` field.)
- **Idempotent create + link authoring** — apply the create/relink discipline in **Idempotent create + link authoring (the MCP-write seam)** below: re-query before retrying an ambiguous create, and author sibling references as markdown links, never raw-UUID embeds.
- **Record genuine intake provenance** for every created ticket: `faff intake-record <issue> --via jot --initiated interactive` (gateway → **Resolving the `faff` executable**). This writes CLI-owned `.faff/provenance/<issue>.json`, required by graft's `block`-mode intake precondition. Human-present jot always stamps `interactive` and performs no containment check; the human sanctions creation. Autonomous filing chokepoints instead stamp `autonomous` and gate on `faff contain`. The marker comes from running jot, not a claim of prior intake.
- **Propose a project DoD (`prdr-author`, L3 propose-for-approval)** only when creating a project container, never for a flat ticket set. Ask the configured methodology's `prdr-author` for a target-scaled project DoD with `{outcome, child_specs, target}`, resolving `target` as `explicit > inherited > methodology-default`. It writes `AuthoredPrdr` via `faff prdr new --provenance loop --status Proposed`. Surface the proposed `## Definition of done` + decision and gate: "Proposed project DoD for <project> (target: <t>). Approve / edit / skip?". **Approve:** the human runs **`faff prdr accept <n>`**, sole writer of `Status: Accepted`, committing a `prdr/…` landing branch; push that printed branch and open its small PR. Jot never self-Accepts or hand-edits status. **Edit:** human DoD wins over methodology defaults. **Skip:** leave `Proposed`. Never clobber a human-set DoD: re-read/fill only unset parts (gateway → **Manual changes are authoritative (`prdr-author`)**). Unanswered / `--no-prdr`: no proposal; human authors directly.

### 5. Chain to prep

After creating, offer the next step via the standard chaining gate: "Tickets created. Prep the first one for build now? (`/faff-prep <first-ticket>`) (y/n)". On confirm, invoke the `faff-prep` skill via the Skill tool on the highest-sequenced ticket. On deny, stop cleanly. (For greenfield, the "first one" is the first ticket of the first-slice workstream.)

## Idempotent create + link authoring (the MCP-write seam)

`/faff-jot` and `/faff-plot` create tracker issues through Linear MCP `save_issue`. These three create/relink rules are canonical here; plot references them.

- **Re-query before retry, never retry blind.** A `save_issue` create whose result is ambiguous (timeout, 5xx, `upstream_unavailable`) may have written anyway. Before retrying, `list_issues` filtered by the resolved team-set (every team in `tracking.teams`, or the one legacy `tracking.team_key` team) + title-match against the intended title: a match → treat it as the already-created ticket, do **not** create again (if it is a confirmed unwanted duplicate, dedupe via `save_issue(id: <surplus>, duplicateOf: <kept>)` **without** also setting `state: "Duplicate"` in the same call — the combined write is rejected, "Missing duplicate relation"); no match → the prior attempt genuinely didn't land, proceed to create. A first attempt (no prior ambiguous result) creates directly — no re-query overhead.
- **Search before create, on every `/faff-plot` re-slice.** Before a node-scoped re-slice creates a node's children, list the issues already parented under that node and match each proposed child against them by title; skip a match, create only the gap. Never issue a `removeBlocks` in the same pass without re-confirming the live edge was drawn by *this* pass — don't strip an edge on unchecked provenance.
- **Link by identifier, not by opaque id.** A sibling reference authored into a ticket's own description prose is a `[FAFF-N](url)` markdown link — never a hand-typed `<issue id="UUID">` embed (a wrong UUID mis-links silently; a broken markdown link fails visibly). This governs prose the skills author; it does not touch `save_issue`'s structured `blockedBy`/`blocks`/`relatedTo`/`duplicateOf` fields, which already resolve by identifier.

Title-matching is imperfect (Linear search isn't exact-string) — scope it to title **and** team to keep it tight, and route a confirmed duplicate through `duplicateOf` rather than a silent skip, so an imperfect match still leaves an audit trail rather than a silent drop.

## Existing-ticket interactor (`/faff-jot ISSUE-XX`)

An issue-id opens interactive inspection. Never invoke this interactor autonomously.

**Remit.** Load and display the ticket. Route other operations to their owners:

- speccing → `/faff-prep`
- grooming / diagnostics → `/faff-tidy`
- building → `/faff-graft`

### The flow

1. **Load the ticket**: title, description, labels, status and spec comments. Missing → error and stop. Cancelled or archived → refuse (shared **Ignore cancelled and archived** rule). Never re-interview the human.
2. **Display a short summary** with title, status and whether a spec is attached. No prompt or mutation.
3. **Log** per the gateway `.faff/logging` rule.

### Out of scope (v1)

- **Re-scope / re-home (re-parent) / split-merge intent** are the named direction but **deferred** — each later reuses the `methodology` slot's `ticket-shaping` output.
- No in-place edit of title / description / status.
- The interactor is **interactive-only** — no autonomous invocation (consistent with new-work intake being human-gated).

## Tracker-less (git-only) mode

Resolve absence through gateway → Tracker availability resolution: honour `tracking.tracker`, discover before concluding absence, never infer from hidden tools. With no connector, run discovery/shaping and save the shaped checklist to `.faff/intake/<date>-<slug>.md` for the human. Note ticket creation was skipped; preserve the brief and structure.

**Stable item-keys.** For each shaped-ticket line, mint a gitkey via `faff queue-state new-key` and append it as a trailing marker: `- [ ] <ticket title> <!-- gitkey:K -->`. This is the durable id `faff queue-state derive` diffs against the run-ledger to derive `queue_empty`/`all_parked` in git-only mode (gateway → Spec discovery location 4) — reference the CLI, never restate the key format here.

## Autonomous mode

`/faff-jot` is **primarily interactive**: discovery and admitting new scope belong to the human. `/faff-beep-boop` never invokes it; beep-boop drains existing work rather than inventing new intake.

If `/faff-jot` is somehow invoked in autonomous mode, it produces the discovery brief and shaped-ticket proposal, writes them to `.faff/intake/…`, and surfaces them for human review rather than creating tickets unattended. It never auto-creates a project or backlog without a human confirming the shape.

The **existing-ticket interactor** (`/faff-jot ISSUE-XX`) is likewise **interactive-only** — inspecting a human-named ticket is a human-present action, so there is no autonomous path to it.

## Appetite

Reads the suite-wide `appetite` dial but is lightly modulated, since creation is human-gated by default:

- `low` / `medium` — always show the full proposed structure and wait for explicit confirmation before creating anything.
- `high` (default) — same confirmation gate for creation, but resolve minor shaping ambiguities itself (recorded in the brief's open questions) rather than asking mid-discovery.
- `full` — may create the shaped tickets directly when the brief is unambiguous and a tracker is configured, posting the shaped structure as the audit trail. Still never creates a top-level **project/initiative container** without confirmation (containers are expensive to undo; the one carve-out is the L4 accepted-root envelope — a loop-authored container contained under the run's admitted root PRD), and the hard floor applies — no cancellation/deletion, ever.

## Logging

Per gateway `.faff/logging`, record detected mode, intake skill, discovery brief, methodology proposal, created ids/relationships and any `/faff-prep` chain, enough to reconstruct backlog origin. Existing-ticket inspection logs its id and that it was loaded. Skip this narrative `HHMMSS-jot.md` when `logging: essential`.

## Rules

- One skill for all new-work intake — never spawn per-type variants (`faff-new-bug`, `faff-new-feature`). Mode is a parameter, not a separate command. The existing-ticket interactor follows the same principle: it's selected by the issue-id **argument**, not a separate command.
- `/faff-jot ISSUE-XX` follows the interactive-only **Existing-ticket interactor** above.
- Discovery is delegated (`intake` slot), shaping is delegated (`methodology` slot). `/faff-jot` orchestrates: detect mode, route the brief, confirm, create, chain. It owns no ideation opinions and no structural opinions of its own.
- Never write a spec here. A created ticket is a `Backlog` item with a seeded description and open questions — `/faff-prep` turns it into a buildable spec. (A description is never a spec — gateway shared rule.)
- Ticket creation is gated on human confirmation except at `full` appetite for non-container tickets. Containers always confirm (except within the L4 accepted-root envelope).
- Chaining uses the standard explicit yes/no gate (gateway → Chaining pattern). No passive "you should run /faff-prep next".
