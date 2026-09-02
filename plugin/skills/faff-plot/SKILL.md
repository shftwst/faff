---
name: faff-plot
description: "Turn an application-scale idea into a planned, dependency-linked roadmap. Recurses a discovery brief top-down into initiatives → projects → first-slice epics. Use for 'plan this out', 'decompose this app', 'break this big thing into a roadmap', 'map out the whole project', 'plot the build'. Or `/faff-plot rehome` to run the whole-backlog rehoming pass — group loose Backlog work into human-confirmed outcome-led projects ('sort out the loose backlog', 'rehome the backlog')."
judgement_seam: decomposition
---

# faff-plot

The top-down planner. Where `/faff-jot` captures new work and shapes it one level deep, `/faff-plot` takes an **application-scale** discovery brief and recurses it into a roadmap *skeleton*: outcome → initiatives → projects → first-slice epics, with the dependency links between them. It is the **planning session** `/faff-map` points at when it finds the chain doesn't join up — and `/faff-map` is what audits the skeleton plot writes.

plot is jot's recursion applied to jot's discovery. They share the same `ticket-shaping` machinery; the difference is depth. jot does one breadth-first pass and chains to prep. plot descends level by level, writing containers as it goes, and stops at first-slice epics — never the leaves.

## Configuration

**Load the kernel first.** Entered directly or chained from `/faff-jot`; if `faff/references/kernel.md` isn't in context this turn, Read it now — it holds the shared rules + fixed contracts faff applies. Do **not** Read `faff/SKILL.md` (the bare-`/faff` routing gateway — a specific-skill entry never needs it). Then Read the lane references plot consumes: `faff/references/tracker.md`, `faff/references/autonomous.md`, `faff/references/methodology.md`, `faff/references/create.md`, `faff/references/park.md`. plot leans on **Agent Lanes**, the `methodology` `ticket-shaping` contract (the `shape-level` input), and the `appetite` dial; its `intake` / `methodology` slots inherit the gateway ambiently.

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
- **Standalone** (`/faff-plot` invoked directly): first **discover a committed PRD** to plan from; only when that finds no unambiguous PRD do you fall back to conversational discovery.
  - **Discover.** Resolve the `faff` executable (gateway → **Resolving the `faff` executable** — never hardcode a path), then run only the two mechanical PRD reads `/faff-beep-boop` §0a uses — its steps 1–2: `faff prd list --json`, then `faff prd path <container>`. Take just those reads, never §0a's downstream L4 lights-out machinery (interactive plot is L3 and human-gated). Parse the `faff prd list --json` array; if more than one element, keep only those whose `status` is `Active` or `Frozen`. *("Unambiguous" here mirrors §0a's Active/Frozen filter — keep both entry points in step if you touch either.)*
  - **Exactly one survivor (unambiguous)** → resolve its file via `faff prd path <container>` and **recurse the roadmap from that PRD file as the discovery brief; skip `intake` entirely.** If the path fails (exit 2) or the file is missing, treat it as the zero-PRD case below — never abort the entry.
  - **More than one survivor (ambiguous)** → ask the human which surviving PRD to plan from (list slug + status); on a clean pick, recurse from that PRD and skip `intake`; on a decline, fall to intake below.
  - **Zero (no committed PRD, `[]`, or fallen through from the above)** → run discovery exactly as jot does — invoke the configured `intake` skill via the Skill tool (resolve the slot value per gateway → **Sibling-skill invocation**: a bundled default is a canonical name, an explicitly-namespaced override is used verbatim), passing the human's description, and take back a discovery brief. A missing `intake` slot is never a blocker: run the default inline. **Unchanged from today.**

If the brief is too thin to plan a coherent roadmap (one vague capability, no stated dependencies), say so and offer to deepen discovery rather than inventing structure.

### 2. Recurse top-down

Descend the altitudes **outcome → initiatives → projects → first-slice epics**, **one level at a time**. At each level, collect every confirmed node at that altitude and invoke the configured `methodology` skill's **`ticket-shaping`** output (default `faffter-noon-methodology-thematic`) **once for the whole level** (the batch-per-altitude grain — **Methodology transport** above; a level's confirmed children feed the next level's sub-briefs, so levels are sequential but nodes within one level shape independently) with:

- `shape-level` = the current altitude (`initiative` / `project` / `epic`), and
- each confirmed node's **node-scoped sub-brief** — the slice of the parent brief relevant to that node (the capability or project being decomposed), plus the live tracker graph.

The methodology returns each node's children *at that altitude*, shaped through its lens (the recursion logic lives in `ticket-shaping`, not here — plot drives the descent; the methodology shapes each level). plot gates the returned shapes **node by node** (Step 4); an `edit` re-shapes that node via a **follow-up node-scoped dispatch**. plot owns the loop, the stop rule, the gating, and the writes.

**Between altitude batches (inside a live run only — `$FAFF_RUN_DIR` set, the `faff-beep-boop`-nested / lights-out `plan` case).** Each level's `ticket-shaping` dispatch is a long producer call (a whole-brief decompose can run many minutes) — before dispatching the **next** level, run `faff-beep-boop`'s between-units cooperative checkpoint (gateway → `faff-beep-boop` → **The interrupt**, the canonical procedure — referenced, never restated here). This is what lets a detached Sentry intervention be observed before more of the descent is dispatched, closing the exact gap `run-20260818-192940` hit (ticked once at run start, then a ~16-minute decompose ran to a clean terminal with the checkpoint never re-consulted). On an aborted/paused ledger, stop descending and surface per the checkpoint's own handling — never gate on an un-checked assumption that the run is still alive. **Fail safe on the checkpoint's own read failure:** an unreadable ledger or a faulting `sentry check` consult halts/surfaces here rather than proceeding to the next level unaware (never the fail-open "log and continue" a standalone-attended run's advisory posture allows — a producer that can't confirm the run is still alive must not dispatch more of it). Standalone/interactive plot (no live `$FAFF_RUN_DIR`) has nothing to check and skips this — the same no-op the checkpoint already is outside any run. **Each dispatched `ticket-shaping` batch itself follows the bounded milestone-tick contract** (gateway → **Sibling-skill invocation → Producer dispatch**) — the load-bearing per-dispatch defence; this between-level checkpoint is the backstop that observes a detached abort between dispatches, not a substitute for it.

### 3. The stop rule (critical — this is what stops a fantasy tree)

plot owns the skeleton **down to first-slice epics + their dependency links** — and no further. It deliberately does **not** enumerate every leaf ticket. Leaves grow later from specs (`/faff-prep`) and the two bottom-up tributaries (chain-gap fill + execution-reporting). Reuse chain-gap conservatism:

- Emit a node only when it has a **nameable deliverable**.
- **Stop a branch** when the next level down is not concretely derivable from the brief — surface "this branch needs more discovery" rather than manufacturing speculative children.

Drawing this line crisply is the whole game: it is what keeps plot from inventing 200 phantom tickets nobody asked for.

### 4. Per-level gating

Confirm **level by level** as the recursion descends, not as one giant dump at the end:

- **Containers (initiative / project) always confirm** — present the proposed children of the current node as a short tree and gate before writing ("Create these N initiatives? / these N projects under <initiative>? (yes / edit / no)"). Containers are expensive to undo. *One carve-out: within the L4 accepted-root envelope, a loop-authored container contained under the run's admitted root PRD is admitted — interactive plot is unchanged.*
- **First-slice epics** may be auto-created per the `appetite` dial (gateway → **Appetite for destruction**): `low` surfaces only; `medium`/`high` create the epics under a confirmed project; `full` may create a whole confirmed branch's epics at once. The hard floor still applies — no cancellation/deletion, ever.
- On `edit`, take the human's adjustments and re-shape that level before descending. On `no` for a branch, skip it (leave it un-planned) and continue with the rest.

### 5. Write the skeleton

Create top-down as each level is confirmed: initiative containers → project containers under them → first-slice epic issues under each project, with the **blocker / blocked-by links** the methodology proposed between them. Each created item: status `Backlog`, a **type-templated description** produced by the gateway **Ticket templates** fill step (container nodes — initiatives/projects — resolve to the `epic` template; buildable first-slice epics infer their own type per node) — filled from the relevant brief prose, unknown fields placeholdered `_To be determined during prep._`, and the brief's open questions carried into the template's `Open questions` field; the fill step runs before the `rendering_adaptor` pass — the tag **`faff-jot-intake`** via `faff label add <issue> faff-jot-intake` and its descriptor's write (gateway → **Control-label provisioning**; reuses `/faff-prep`'s existing pickup path so the first slice gets specced next), and a `planned by /faff-plot` provenance line. For each created epic, after the label, run `faff intake-record <issue> --via jot --initiated interactive` — plot is a human-confirmed planning path, so it stamps `initiated: interactive` and runs **no containment check** (the human confirming the structure is the sanction; contrast the autonomous chokepoints). Containers via the configured MCP's initiative/project types; epics as issues nested under their project.

**Idempotent create + link authoring** — apply the create/relink discipline single-sourced in `faff-jot` → **Idempotent create + link authoring (the MCP-write seam)**: every create above re-queries by title + team before retrying an ambiguous `save_issue` result (never retry blind); a **node-scoped re-slice** (re-running this step against a node already sliced earlier) lists the node's existing children first and creates only the ones missing — never blind-recreates a full child set — and never issues a `removeBlocks` without re-confirming the live edge was drawn by this same pass; and any sibling reference authored into a description is a `[FAFF-N](url)` markdown link, never a hand-typed `<issue id="UUID">` embed.

### 5b. Propose a project DoD (`prdr-author`, L3 propose-for-approval)

For each **project** container just written (not initiatives, not epics), ask the configured `methodology` skill's **`prdr-author`** output for a target-scaled project DoD, then **surface it for human approval** — `/faff-plot` runs at L3, so the machine **proposes**, the human **ratifies**:

- Request `prdr-author` with the project's `{outcome, child_specs, target}` — `target` resolves `explicit > inherited > methodology-default` (gateway → **The `methodology` slot**, `prdr-author` row). The methodology writes the `AuthoredPrdr` via `faff prdr new --provenance loop --status Proposed`.
- **Surface, never auto-accept:** present the proposed `## Definition of done` + decision under the project and gate — "Proposed project DoD for <project> (target: <t>). Approve as-is / edit / skip? (approve / edit / skip)". On **approve**, have the human ratify by running **`faff prdr accept <n>`** — the sole writer of `Status: Accepted`, which commits the record to a `prdr/…` landing branch for a small PR (or rides a feature branch via `--no-branch`); the human gesture, `/faff-plot` never self-Accepts and never a hand-edit. On **edit**, take the human's DoD edit (that edit wins — human-set > methodology-default) and record it before approval; on **skip**, leave the PRDR `Proposed` for a later pass.
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

**Composition with the topology-write dial.** This pass inherits plot's **Containers always confirm** floor: every approved rehome creates a container, and no appetite level auto-creates a container outside the L4 accepted-root envelope, so the whole apply sits behind this gate at every appetite. The gateway topology-write-authority dial's rehome authority (gateway → **Appetite for destruction → Topology-write authority**) still governs the methodology's *other, narrower* call sites (gating-chain rehome, MVP scope-cut, thematic conversion) — the dial adds the topology axis to the hard floor, it never relaxes it.

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

**Stable item-keys.** For each first-slice **epic** line (a buildable leaf — never a container/initiative/project line), mint a gitkey via `faff queue-state new-key` and append it as a trailing marker: `- [ ] <epic title> <!-- gitkey:K -->`. This is the durable id `faff queue-state derive` diffs against the run-ledger to derive `queue_empty`/`all_parked` in git-only mode (gateway → Spec discovery location 4) — reference the CLI, never restate the key format here.

## Autonomous mode (`--autonomous`) — the gate-answering harness

`/faff-plot` is **primarily interactive**, for the same reason `/faff-jot` is: deciding the shape of a whole application is direction-setting. `/faff-beep-boop` does **not** invoke `/faff-plot` (unchanged) — beep-boop drains the backlog; it does not plan new applications.

The **`--autonomous` argument** adds the one exception: a *manually-ignited* pass that answers its own per-level gates within the L4 topology-write envelope, recursing top-down to first-slice epics with no interactive prompt. It is purely **additive** — bare `/faff-plot` and `/faff-plot rehome` are byte-unchanged, and an accidental autonomous invocation **without** `--autonomous` still uses the surface-only fallback (writes the skeleton to `.faff/intake/…` and surfaces it, creating nothing). The whole ticket is the **gate→verdict seam** below; everything else is the driver, the logging, and the parking around it.

### Ignition (`/faff-plot --autonomous`) + the outward-only guard

Replaces the former stub guard (a minted-ledger-only assert) with the real run-start OUTWARD-only predicate, sequenced before any write:

- **Resolve the target** — `TargetRef {container, repo, source}` — **explicit > inherited > methodology-default**, from live reads only (never hard-coded `true` — the `contain.js` honesty rule). This is the same container the §gate→verdict seam below records as the run ledger's `prd_root_container`.
- **Resolve `SelfRef`** via the repo-slug oracle (no `tracking.self` knob): `self.repo := faff config get tracking.repo`; `self.container := faff config get tracking.container` (null by construction); `self.is_self := target.repo != null AND target.repo == self.repo`.
- **Compute the signal** — `faff run-outward --target <TargetRef> --self <SelfRef> --json` → `OutwardSignal {target, outward, reason}`. A non-zero exit (malformed input) is treated as **refuse**, fail-safe, never an implicit proceed.
- **Nested reuse vs standalone mint.** Classify the inherited handoff — `faff run-record-prd --classify --json` (defaults `--run-dir` to `$FAFF_RUN_DIR`; report-only, exit 0 regardless of verdict) — before deciding whether to mint at all:
  - **`fault`** — `FAFF_RUN_DIR` is set but names no readable ledger, an unparseable one, or an L4 ledger that isn't a lights-out mint. **REFUSE ignition loudly: zero writes, surface the payload's `reason`, STOP.** Distinct from the run-start refuse below — this is a foreign/invalid handoff, not a policy refusal, and it is checked first.
  - **`inherited-l4`** — a nested invocation (e.g. `/faff-plot --autonomous` called from `faff-beep-boop` §0a's `plan` branch): `runDir := $FAFF_RUN_DIR`. **Self-mint nothing.** When `TargetRef.container` is resolved, record it onto the ONE ledger — `faff run-record-prd --run-dir "$runDir" --prd-creative-licence <licence> --prd-root-container <TargetRef.container>`, where `<licence>` is whichever is already known (the inherited ledger's `prd_creative_licence` if set, else the value `faff-beep-boop` §0a's own run-start pass already resolved) — `prdRootContainerFromFlags` rejects a container without a licence flag. **No licence available:** skip the record (leave `prd_root_container` as-is; the gate→verdict seam below still resolves the target from live reads) rather than fail; this skip is **born-verifiable, not silent** — emit exactly one line, `plot: prd_root_container record skipped — no creative-licence resolved yet`, to both the plot Ignition log (`.faff/runs/<runDir>/plot-decompose.log.md`) and stderr, so a reviewer can tell "deliberately skipped" from "wrote nothing by mistake."
  - **`not-l4`** — the standalone case (a bare `/faff-plot --autonomous`, no inherited L4 handoff): **self-mint an L4 run-ledger** via the existing lights-out preflight (the same one `faff lights-out` runs — reused, not reimplemented), capturing `target_resolved` + the resolved target. `runDir := ` the freshly-minted dir. Unchanged from today.
- **Assert via `faff run-start`** — `faff run-start --signals { target_resolved, outward: <sig.outward>, prd_present, prd_ambiguous, prd_admissible, coverage_measurable, coverage_covered }` (each sibling signal from its own producer; this ticket supplies only `outward` — run-start owns the `{verdict, reason}` taxonomy and the refusal ladder, unchanged and re-derived nowhere else). **The refuse verdict (any reason, including self-directed) → REFUSE ignition: zero tracker/structure writes, outcome `needs-human`, surface for `/faff-wtf`, STOP — never park-and-retry** (a self-directed target is a policy boundary, not a transient condition a retry could clear; canonical semantics: `faff contract run-trigger --describe`). A nested pass that refuses touches no ledger — the **shared** `runDir` is left untouched (no mint, no close; §0a owns its lifecycle).
- Only on the other two verdicts does the pass proceed to the §gate→verdict seam below, using `runDir` (nested-inherited or standalone-minted) as the ledger `prd_root_container` records onto.

### The gate→verdict seam (the core seam)

For each per-level gate the interactive flow presents to a human, build an **op** `{kind, level:"L4", provenance, parent_confirmed, contained_under_accepted_prd}`, pipe `{op, verdict}` to **`faff contract l4-topology-envelope`**, and act on the **CLI-validated disposition** — never a harness-computed one. The contract re-derives the expected disposition from `op` via `l4TopologyDecision` and rejects a non-conforming claim (Pattern-B validator); the harness re-implements **none** of that table. Write only on a validated `admit`.

| Interactive gate | Op (`kind` / key fields) | Disposition | Autonomous action |
|---|---|---|---|
| Container under the accepted root | `container-create`, faff-authored, `contained_under_accepted_prd=true` | **admit** | create idempotently, stamp `initiated: autonomous`, log; descend |
| Container outside the accepted root | `container-create`, `contained_under_accepted_prd=false` | **propose-only** | create nothing; surface; HALT descent; park |
| Epic under a confirmed project | `epic-create`, faff-authored, `parent_confirmed=true` | **admit** | create idempotently, stamp, `intake-record --initiated autonomous`, log |
| Epic under an unconfirmed parent | `epic-create`, `parent_confirmed=false` | **propose-only** | surface; HALT descent; park |
| Reparent/convert/rehome of a loop node | `reparent`\|`convert`\|`rehome`, faff-authored | **admit** | do idempotently (reversible), stamp, log |
| Any op on human-curated structure | any kind, `provenance=human-curated` | **propose-only** | never restructure; surface + park |
| Cancel/delete | `cancel`\|`delete` | **reject** | never taken — a reject halts + logs a refusal |
| Step-5b project DoD | *(not an envelope op — see below)* | n/a | author a `Proposed` PRDR; never admit |

- **Anti-pattern:** re-checking reversibility/containment in the harness before calling the contract — the contract *is* that check.
- **Fail-safe:** a contract fail-loud (malformed op / disposition mismatch) is treated as a **park**, never an implicit admit. Absence of a clean `admit` is never a write.

### Honest op construction (write-time, not agent-asserted)

The three admit-gating booleans are **derived from live reads at construction time**, never hard-coded and never carried from a cached read (a literal `true` at the op-build site is the anti-pattern this rule forbids):

- **`contained_under_accepted_prd`** *is* the verdict of `faff contain <node> --parent <resolved-parent> --ancestry <live-ancestry> --record <run-id> --phase plot`, where `<live-ancestry>` is read fresh from the tracker (the node's parent chain up to the run ledger's `prd_root_container`): `contained` (exit 0) → `true`; `outward` (exit 3) → `false`. The boolean is the *recorded* contain verdict — so the audit trail exists by construction.
- **`parent_confirmed`** is `true` **only** for a parent created/confirmed earlier in *this* pass (the pass's created-set) or the admitted root itself — never inferred for a pre-existing node.
- **`provenance`** is `faff-authored` **only** for a node this pass created (or a prior loop node carrying `initiated: autonomous`); anything else is `human-curated`. **When in doubt → `human-curated`** (fail-safe to propose-only).

**Write-time containment gate.** Every autonomous container/epic create is **immediately preceded by its recorded `faff contain --record … --phase plot` containment-check**. A create with no matching recorded `contained` verdict is an integrity violation `faff audit` flags (recompute-and-compare over the recorded ancestry — the detective control) — turning the backstop from advisory into a mechanical, born-verifiable gate. (Residual, out of scope: a *falsified* live ancestry read is the custody/write-authority axis — not this harness.)

### Decompose-only HALT

Two triggers stop descent while the pass **finishes forward** on its siblings (never a rollback — that would itself be a destructive write):

1. **Branch not concretely derivable** — park `plot-halt: branch needs discovery`; continue siblings; create nothing. (The interactive stop rule, turned into a HALT-and-park — new-scope conjuring stays human-owned.)
2. **Would need a new root (outward)** — the `faff contain … --record … --phase plot` above returned `outward`: create nothing, record `containment: outward-new-root`, surface for `/faff-jot`, park.

### Logging, reversibility, parking

- **Logging** — every gate answer writes one durable `.faff/` log entry `{op, disposition, reason, outcome}` (outcome ∈ created / proposed-only / refused / skipped-idempotent), per the gateway `.faff/logging` rule.
- **Reversibility (structural)** — every created node is stamped `initiated: autonomous` (the marker a human greps to undo the pass, one query); the envelope `reject`s `cancel`/`delete`, so the harness *cannot* take an irreversible answer. Idempotent create reuses the single-homed MCP-write seam (`faff-jot` → **Idempotent create + link authoring**) — re-query before retry; create only the gap on re-slice.
- **Parking** — any `propose-only` / `reject` / fail-loud parks via the shared **Park protocol** (gateway); the pass finishes forward and surfaces the park set for `/faff-wtf`.

### Step 5b — author the Proposed PRDR

For each created project: request the methodology's `prdr-author` DoD, then `faff prdr new --provenance loop --status Proposed`. This writes the loop-authored `Proposed` PRDR; **Step 5c** is what admits-or-parks it. (Interactive plot is unchanged — L3 surfaces the `Proposed` PRDR for a human `faff prdr accept`; only the `--autonomous` L4 harness runs 5c.)

### Step 5c — admit or park the loop-PRDR

The `--autonomous` harness always ends up against an L4 run-ledger (Ignition, above — self-minted when standalone, reused when nested inside an inherited handoff), so it **is** an L4 runner either way — and the gateway already documents what an L4 runner does with a `Proposed` loop-PRDR (gateway → **Authored-PRDR level-scaling**, the L4 bullet, + **Upper-gate (YAGNI) two-phase arbitration**). 5c **composes that existing gateway contract** for each Step-5b PRDR — it introduces **no parallel admission path** and changes only the *actor*; every gate CLI (`faff prdr yagni` / `admit` / `accept`) is invoked byte-unchanged. Per project's `Proposed` loop-PRDR `authored`:

1. **Upper-gate two-phase arbitration** (gateway → **Upper-gate (YAGNI) two-phase arbitration**): (1) deterministic **trace-to-goal** — `authored.prd_goals` must all be real PRD goals (`faff prdr yagni --prd-goal <g1,g2,…> --prd-goals <PRD goals JSON>`), else reject at the door before any model spend; (2) **Phase 1** — the `methodology` slot's `yagni-judge` proposes `{serves_goal, within_scope, verdict, reason}`; (3) **Phase 2** — invoke the `review` slot as a subagent (a different model, the Phase-2 pattern — see adversarial-review → **PRDR YAGNI Phase-2 challenge**; never the diff-shaped `refutation-code` transport) with `{ AuthoredPrdr, PRD goals, Phase-1 proposal }` → `survived` | `overturned` + `ground`, classifying its overturn ground (an inconclusive Phase 2 — provider down after its fallback chain — is **not** a survival: omit `--challenge` → park `phase2-inconclusive`). Then `faff prdr yagni --proposal <admit|reject> [--serves-goal] [--within-scope] [--challenge survived|overturned] [--challenge-ground over-scope|unserved|other] --prd-goal … --prd-goals … --dod-covers <goals the DoD covers, JSON>` arbitrates → the `{admit, reason}` upper verdict. Passing `--dod-covers` (V) and `--challenge-ground` lets the arbitration distinguish under-citation (`V⊆D`) from genuine over-scope (`V⊄D`) — a narrowly-cited functional MVP admits instead of dead-ending, gold-plating still rejects.
2. **Admit** (content authority): feed the upper verdict (and the `--lower` coverage verdict, when in scope) to `faff prdr admit --actor loop --upper '<json>' [--lower '<json>'] --supersedes-provenance none` → the closed disposition (`faff contract prdr-admission --describe`). This composes **with**, not through, the L4 topology envelope — the container's create was already admitted at Step 4 (`container-create`); this is the DoD-content gate, no double-gate.
3. **On the admitting disposition** → land via `faff prdr accept --actor loop --admit-verdict '<the admit verdict JSON>'` (sole-writer; loop may only accept an `admit`-disposition verdict) — commits the record to a `prdr/…` branch and opens its small PR. `Accepted ⟺ committed`, no drift.
4. **On any refusal → PARK, never drop** (the load-bearing invariant — lost scope is forbidden at every appetite). Park via the shared **Park protocol** (gateway), the park comment carrying the **refusing phase's reason**:
   - yagni trace-reject or Phase-1 `reject` → `yagni-reject`
   - Phase-2 `overturned` → `yagni-overturned`
   - Phase-2 inconclusive (challenge omitted; skeptic unreachable) → `phase2-inconclusive`
   - `faff prdr admit` returns a non-admitting disposition (anything but the admit disposition — `faff contract prdr-admission --describe`) → `admit-refused`
   - any gate fail-loud (malformed verdict / contract mismatch) → park, never an implicit admit
   The `Proposed` PRDR is left in place (not superseded, not deleted) so the parked scope is recoverable; the pass finishes forward and surfaces the park set for `/faff-wtf`.

**Every 5c PRDR terminates in exactly one of: admit-and-land, or a labelled park — no PRDR is silently dropped.**

### Integration smoke (acceptance)

Ignite one `--autonomous` pass over a two-node brief (child container `C` under an admitted root PRD `R`, one epic `E` under `C`) and assert: `container-create` for `C` → admit → `C` created + stamped `initiated: autonomous`; `epic-create` for `E` (`parent_confirmed=true`) → admit → `E` created + stamped; exactly one `Proposed` PRDR authored for `C`'s project tier (Step 5b), then **Step 5c admits-and-lands it** (yagni survived + admit → `faff prdr accept --actor loop` → `Accepted`) **or parks it with the refusing phase's reason** — never left silently unadmitted; one log entry per gate; zero cancel/delete ops; `faff audit` clean (no `containment_mismatches`, no unrecorded creates). The mechanical legs (yagni arbitration, admit verdict, accept landing, the park-on-refusal branch) are covered by `test/prdr-loop-admit.test.mjs`; the real end-to-end loop-authored admit is a human-supervised holdout-shaped criterion (out of scope here, per the eval-coverage decomposition).

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
- **Containers always confirm.** No appetite level auto-creates an initiative or project container — except within the L4 accepted-root envelope: a loop-authored container contained under the run's admitted root PRD is admitted. Only first-slice epics are otherwise appetite-creatable, and only under a confirmed parent.
- **plot writes; map audits.** Keep the write/read split with map absolute — plot never just "synthesises", map never writes.
- **Shaping opinions are the methodology's.** plot owns descent, stop rule, gating, and writes — never the per-level shaping (naming, right-sizing, sequencing). That is `ticket-shaping`'s job at each `shape-level`.
- Chaining uses the standard explicit yes/no gate (gateway → Chaining pattern). No passive "you should run /faff-map next".
