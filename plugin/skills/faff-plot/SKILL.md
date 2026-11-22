---
name: faff-plot
description: "Plan an application-scale idea as initiatives, projects and first-slice epics. Use rehome to group loose Backlog work into human-confirmed outcome projects."
judgement_seam: decomposition
---

# faff-plot

The top-down planner: recurse an **application-scale** discovery brief into a roadmap *skeleton*, outcome → initiatives → projects → first-slice epics + dependencies. `/faff-jot` shapes one level; plot uses the same `ticket-shaping` machinery level by level, writes containers and stops before leaves. It is the **planning session** `/faff-map` requests when the chain does not join up; map audits the written skeleton.

## Configuration

**Load the kernel first.** Entered directly or chained from `/faff-jot`; if `faff/references/kernel.md` isn't in context this turn, Read it now — it holds the shared rules + fixed contracts faff applies. Do **not** Read `faff/SKILL.md` (the bare-`/faff` routing gateway — a specific-skill entry never needs it). Then Read the lane references plot consumes: `faff/references/tracker.md`, `faff/references/autonomous.md`, `faff/references/methodology.md`, `faff/references/create.md`, `faff/references/park.md`. plot leans on **Agent Lanes**, the `methodology` `ticket-shaping` contract (the `shape-level` input), and the `appetite` dial; its `intake` / `methodology` slots inherit the gateway ambiently.

**Methodology transport.** Request `ticket-shaping` per altitude and `prdr-author` per project. A later edit gets its own node-scoped dispatch. Follow **Transport (per-output dispatch grain)** in `faff/references/methodology.md`.

## Rendering

Pass all human-facing roadmap container/epic **descriptions** and terminal summaries through configured `rendering_adaptor` normalise **before it is printed or written** (gateway → **Rendering**, Universal-routing rule). Render enumerable sets as lists, never `·`/comma run-on paragraphs, including descriptions/comments. Skill source files and `.faff/` logs are exempt.

## Lane

`/faff-plot` is the **orchestrator lane** (gateway → Agent Lanes): talk to the human, read the tracker, drive `methodology`, and **write containers and tickets**. Do **not** write code or specs; `/faff-prep` specs each ticket later. Like `/faff-jot`, new structure is **human-gated**, except under Autonomous mode.

`/faff-map` is the **read-only twin**: map audits join-up, plot writes. Never give map plot's write authority.

## What it does (the flow)

Two entry modes, selected by argument: **bare `/faff-plot`** runs the default brief-recursion flow below; **`/faff-plot rehome`** runs the whole-backlog rehoming pass (**Rehoming pass** section). The `rehome` argument is the only trigger — no loose-count threshold, no cadence knob.

```
discovery brief → recurse top-down (ticket-shaping per level) → write skeleton → chain to map (audit) + prep (first slice)
                  outcome → initiatives → projects → first-slice epics
```

### 1. Entry — get a discovery brief

- **Chained from `/faff-jot`**: use its application-scale brief directly; do not re-run discovery.
- **Standalone:** run `faff prd select --json` (gateway → **Resolving the `faff` executable**).
  - `use`: read `path` as the brief.
  - `choose`: show slug and status for each candidate. Ask the human to pick, then read `faff prd path <container>` as the brief.
  - `intake`, decline or unreadable brief: invoke configured `intake` with the human's description (gateway → **Sibling-skill invocation**). If unavailable, run the default inline.

If the brief is too thin to plan a coherent roadmap (one vague capability, no stated dependencies), say so and offer to deepen discovery rather than inventing structure.

### 2. Recurse top-down

Descend **outcome → initiatives → projects → first-slice epics**, **one level at a time**. Batch every confirmed node at the current altitude into **one** configured `methodology` **`ticket-shaping`** dispatch (default `faffter-noon-methodology-thematic`; **Methodology transport** above). Shape nodes independently; confirmed children supply the next sequential level's sub-briefs. Pass:

- `shape-level` = the current altitude (`initiative` / `project` / `epic`), and
- each confirmed node's **node-scoped sub-brief** — the slice of the parent brief relevant to that node (the capability or project being decomposed), plus the live tracker graph.

`ticket-shaping` owns each node's children at the requested altitude. Plot owns descent, stop rule, node-by-node gates (Step 4) and writes. An `edit` uses a **follow-up node-scoped dispatch** before continuing.

**Between altitude batches (inside a live run only — `$FAFF_RUN_DIR` set, the `faff-beep-boop`-nested / lights-out `plan` case).** Before dispatching the **next** level, run `faff run checkpoint --run-dir "$FAFF_RUN_DIR" --phase prep` (`faff-beep-boop` → **The interrupt**, referenced rather than restated). Halt and surface on non-zero exit (3 or 2) or `faults` entry `sentry-consult-failed` / `budget-check-failed`; If run liveness is unconfirmed, the producer must not dispatch more; never fail-open "log and continue". With no live `$FAFF_RUN_DIR`, standalone/interactive plot skips this check. **Each dispatched `ticket-shaping` batch itself follows the bounded milestone-tick contract** (gateway → **Sibling-skill invocation → Producer dispatch**). This between-level checkpoint observes detached Sentry aborts between dispatches; it never replaces per-dispatch ticks.

### 3. The stop rule (critical — this is what stops a fantasy tree)

plot owns only the skeleton **down to first-slice epics + their dependency links**, never every leaf ticket. Leaves grow later from specs (`/faff-prep`) and bottom-up chain-gap fill + execution-reporting. Apply chain-gap conservatism:

- Emit a node only when it has a **nameable deliverable**.
- **Stop a branch** when the next level down is not concretely derivable from the brief — surface "this branch needs more discovery" rather than manufacturing speculative children.

### 4. Per-level gating

Confirm **level by level** as the recursion descends, not as one giant dump at the end:

- **Containers (initiative / project) always confirm** — present the proposed children of the current node as a short tree and gate before writing ("Create these N initiatives? / these N projects under <initiative>? (yes / edit / no)"). Containers are expensive to undo. *One carve-out: within the L4 accepted-root envelope, a loop-authored container contained under the run's admitted root PRD is admitted — interactive plot is unchanged.*
- **First-slice epics** may be auto-created per the `appetite` dial (gateway → **Appetite for destruction**): `low` surfaces only; `medium`/`high` create the epics under a confirmed project; `full` may create a whole confirmed branch's epics at once. The hard floor still applies — no cancellation/deletion, ever.
- On `edit`, take the human's adjustments and re-shape that level before descending. On `no` for a branch, skip it (leave it un-planned) and continue with the rest.

### 5. Write the skeleton

**Create-target team.** Each epic's team resolves via the SAME `route_create_target` procedure single-sourced in `faff-jot` → **Confirm and create** — `tracking.team_routing[type]`, else `tracking.default_team` — no duplicated routing prose here.

Create confirmed levels top-down: initiative containers, project containers under them, then first-slice epic issues under each project, with the methodology's **blocker / blocked-by links**. Each item has status `Backlog`, a **type-templated description** from the gateway **Ticket templates** fill step, and a `planned by /faff-plot` provenance line. Containers (initiatives/projects) use the `epic` template; buildable first-slice epics infer type per node. Fill from relevant brief prose, use `_To be determined during prep._` for unknowns, and carry brief questions into `Open questions`. Before `rendering_adaptor`, the fill step may read tracker `get_template` for a native-template mapping (gateway → **Ticket templates**, tier 1). A miss falls through. For each created epic run `faff intake-record <issue> --via jot --initiated interactive`, stamping `initiated: interactive` with **no containment check** because human confirmation sanctions this path (unlike autonomous chokepoints). Use configured MCP initiative/project types for containers and issues nested under projects for epics.

**Idempotent create + link authoring** — apply the create/relink discipline single-sourced in `faff-jot` → **Idempotent create + link authoring (the MCP-write seam)**: every create above re-queries by title + team before retrying an ambiguous `save_issue` result (never retry blind); a **node-scoped re-slice** (re-running this step against a node already sliced earlier) lists the node's existing children first and creates only the ones missing — never blind-recreates a full child set — and never issues a `removeBlocks` without re-confirming the live edge was drawn by this same pass; and any sibling reference authored into a description is a `[FAFF-N](url)` markdown link, never a hand-typed `<issue id="UUID">` embed.

### 5b. Propose a project DoD (`prdr-author`, L3 propose-for-approval)

For each newly written **project** (not initiative or epic), request a target-scaled DoD from configured `methodology` **`prdr-author`** and **surface it for human approval**: L3 proposes; the human ratifies.

- Request `prdr-author` with the project's `{outcome, child_specs, target}` — `target` resolves `explicit > inherited > methodology-default` (gateway → **The `methodology` slot**, `prdr-author` row). The methodology writes the `AuthoredPrdr` via `faff prdr new --provenance loop --status Proposed`.
- **Surface, never auto-accept:** present the project's proposed `## Definition of done` + decision and gate: "Proposed project DoD for <project> (target: <t>). Approve as-is / edit / skip? (approve / edit / skip)". On **approve**, the human runs **`faff prdr accept <n>`**, sole writer of `Status: Accepted`, committing to a `prdr/…` landing branch for a small PR (or a feature branch via `--no-branch`). `/faff-plot` never self-Accepts or hand-edits acceptance. On **edit**, record the human's DoD edit before approval (human-set > methodology-default). On **skip**, leave the PRDR `Proposed` for later.
- **Manual-authoritative:** if the project already carries a human-set DoD, `prdr-author` re-reads it and **never clobbers** it — it fills only the unset parts (gateway → **Manual changes are authoritative (`prdr-author`)**).
- **Appetite / unanswered:** a methodology that doesn't answer `prdr-author` (or `--no-prdr`) ⇒ no proposal; the human authors the DoD directly. Low-confidence ⇒ a thin DoD flagged needs-human, surfaced as such.

Admission stays human at L3; `/faff-plot` only **authors + surfaces**. L4 lights-out instead routes the same `Proposed` PRDR through `faff prdr admit` (gateway → **Authored-PRDR level-scaling**).

### 6. Hand-off

After the skeleton is written, offer two gates in order:

- **Audit:** "Roadmap created — audit whether it joins up via `/faff-map`? (y/n)". On confirm, invoke the `faff-map` skill via the Skill tool. Check chain join-up, gate fireability and ghost projects.
- **Start:** "Prep the first slice for build via `/faff-prep <first-epic>`? (y/n)". On confirm, invoke the `faff-prep` skill via the Skill tool on the highest-sequenced first-slice epic. On deny, stop cleanly.

## Rehoming pass (`/faff-plot rehome`)

The **write half** of backlog convergence: drain agile's project-less Backlog work (Default-landing rule) into outcome-led projects. `methodology` supplies `rehome-set` grouping *judgement*; plot owns loop, human gate and writes, as for `ticket-shaping`. **Rehoming, never deleting.**

**Entry.** Only explicit `rehome` selects this mode; bare `/faff-plot` stays unchanged, with no loose-count/cadence trigger. If bare plot has no brief and clear rehoming intent ("sort out the loose backlog"), plot may offer the mode conversationally. It requires tracker projects; git-only is a no-op.

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

Use **Methodology transport** for one `rehome-set` request with the full loose set. Apply each proposed grouping only after its own confirmation.

The proposal shape is the gateway `rehome-set` row (**The `methodology` slot**): proposed outcome-led containers (each `{container_name, outcome}`), a membership map, proposed coherence blocker edges (`{blocker, blocked}` — explicit, never written by the methodology), an explicit leave-loose set (each loose ticket with a one-line reason), and principle-keyed findings, ordered by which grouping unlocks sequencable value first. Every input loose ticket must appear exactly once across membership ∪ leave-loose; surface violations, never drop tickets. (If the shipped contract differs from this, the shipped row wins.)

### R3. Render the proposal — zero writes pre-confirm

Render through the configured `rendering_adaptor` (**Rendering** above — enumerable sets as lists): per proposed project its name, outcome, members, and proposed edges; then the leave-loose set with reasons and the principle-keyed findings. **Nothing is written to the tracker before the gate.**

### R4. Confirm gate (unconditional — every appetite level)

Gate **per proposed project** — plot's yes/edit/no shape (Step 4) extended with strike-outs:

- **approve** — apply the group as proposed.
- **edit** = **strike-out only** — the human names members to remove; struck members become leave-loose; proposed edges touching a struck member are dropped; the trimmed group is re-presented for approve/decline. **Never re-dispatch `rehome-set` on an edit** — the strike is authoritative and subtractive, which avoids re-proposing the struck member (anti-thrash). Adding a member is a tracker action the human takes directly, not an edit path.
- **decline** — the whole group's members become leave-loose; nothing is written for it.

The prompt states the manual-undo path explicitly: *un-homing is manual — Linear UI/API only; the MCP's `save_issue.project` is reassign-only and cannot null a project* — so approval is high-consequence.

**Composition with the topology-write dial.** Every approved rehome creates a container. No appetite level auto-creates one outside the L4 accepted-root envelope; plot's **Containers always confirm** floor gates the whole apply at every appetite. The gateway dial (gateway → **Appetite for destruction → Topology-write authority**) still governs other, narrower methodology calls: gating-chain rehome, MVP scope-cut and thematic conversion. Its topology axis never relaxes the hard floor.

### R5. Apply approved projects

Per approved project, **finish-forward — never roll back** (rollback would delete a container or un-home members; the first breaks the never-delete floor, the second is impossible via the MCP):

1. **Create the container** — plot's container machinery, with a `planned by /faff-plot (rehome pass)` provenance line (gateway provenance rule). No `faff intake-record` — that is an issue-creation convention and this pass creates no issues. On failure: report, skip this project's remaining writes, continue to the next approved project.
2. **Reparent each approved member** via `save_issue` project assignment. **Re-check fresh first** (gateway gate-freshness): a member homed or progressed mid-conversation is skipped with a logged note, never force-moved — human curation wins. On a member failure: log, continue with the rest.
3. **Draw the approved blocker edges** among the approved tickets (blocker / blocked-by links, tracker-agnostic). Append-only — an edge that already exists is skipped. On an edge failure: log, continue.
4. **Step 5b — `prdr-author`** for the new project, inputs adapted for reparented members: `outcome` = the proposal's outcome statement; `child_specs` = the approved members' titles + descriptions (+ attached specs where present); `target` resolves `explicit > inherited > methodology-default`. Same approve/edit/skip gate and manual-authoritative rule as **Step 5b** — a `skip` leaves the PRDR `Proposed`. A DoD-less outcome project is the "bare bucket" the agile lens itself refuses.

Report landed state exactly: container id, members moved / skipped / failed, edges drawn / missing, and manual completion steps for gaps. No per-member tracker comments duplicating legible membership; the apply log records writes.

**Idempotence.** Re-running converges: already-homed members drop out of the input set, and existing projects are part of `rehome-set`'s input, so re-runs propose existing containers for remaining tickets without duplication.

### Zero-write endings

All three write nothing to the tracker and are logged:

- **Unanswered** (e.g. the thematic default declines with an empty set) — report "the configured methodology (`<name>`) offers no grouping opinion for a backlog rehoming pass" and how to switch lenses (`slots.methodology` in `.faff/config.yaml`). Exit cleanly.
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

The **`--autonomous` argument** is the sole exception: a *manually-ignited* pass answers its per-level gates within the L4 topology-write envelope, down to first-slice epics without prompts. Bare `/faff-plot` and `/faff-plot rehome` stay unchanged. An accidental autonomous invocation **without** `--autonomous` still writes only `.faff/intake/…`, surfaces the skeleton and creates nothing. The **gate→verdict seam** below supplies this exception's authority; other sections drive, log and park it.

### Ignition (`/faff-plot --autonomous`) + the outward-only guard

Replaces the former stub guard (a minted-ledger-only assert) with the real run-start OUTWARD-only predicate, sequenced before any write:

- **Resolve the target** — `TargetRef {container, repo, source}` — **explicit > inherited > methodology-default**, from live reads only (never hard-coded `true` — the `contain.js` honesty rule). This is the same container the §gate→verdict seam below records as the run ledger's `prd_root_container`.
- **Resolve `SelfRef`** via the repo-slug oracle (no `tracking.self` knob): `self.repo := faff config get tracking.repo`; `self.container := faff config get tracking.container` (null by construction); `self.is_self := target.repo != null AND target.repo == self.repo`.
- **Compute the signal** — `faff run-outward --target <TargetRef> --self <SelfRef> --json` → `OutwardSignal {target, outward, reason}`. A non-zero exit (malformed input) is treated as **refuse**, fail-safe, never an implicit proceed.
- **Nested reuse vs standalone mint.** Classify the inherited handoff — `faff run-record-prd --classify --json` (defaults `--run-dir` to `$FAFF_RUN_DIR`; report-only, exit 0 regardless of verdict) — before deciding whether to mint at all:
  - **`fault`** — `FAFF_RUN_DIR` is set but names no readable ledger, an unparseable one, or an L4 ledger that isn't a lights-out mint. **REFUSE ignition loudly: zero writes, surface the payload's `reason`, STOP.** Distinct from the run-start refuse below — this is a foreign/invalid handoff, not a policy refusal, and it is checked first.
  - **`inherited-l4`** — a nested invocation (e.g. `/faff-plot --autonomous` called from `faff-beep-boop` §0a's `plan` branch): `runDir := $FAFF_RUN_DIR`. **Self-mint nothing.** When `TargetRef.container` is resolved, record it onto the ONE ledger — `faff run-record-prd --run-dir "$runDir" --prd-creative-licence <licence> --prd-root-container <TargetRef.container>`, where `<licence>` is whichever is already known (the inherited ledger's `prd_creative_licence` if set, else the value `faff-beep-boop` §0a's own run-start pass already resolved) — `prdRootContainerFromFlags` rejects a container without a licence flag. **No licence available:** skip the record (leave `prd_root_container` as-is; the gate→verdict seam below still resolves the target from live reads) rather than fail; this skip is **born-verifiable, not silent** — emit exactly one line, `plot: prd_root_container record skipped — no creative-licence resolved yet`, to both the plot Ignition log (`.faff/runs/<runDir>/plot-decompose.log.md`) and stderr, so a reviewer can tell "deliberately skipped" from "wrote nothing by mistake."
  - **`not-l4`** — the standalone case (a bare `/faff-plot --autonomous`, no inherited L4 handoff): this **selects** the standalone self-mint path but **mints nothing yet** — the L4 self-mint is **deferred until the `run-start` assert below returns non-refuse**, so a refused standalone ignition leaves no orphaned run-dir. The mint mechanics are unchanged; only their sequencing moves after the guard (performed in the closing bullet).
- **Assert via `faff run-start`** — `faff run-start --signals { target_resolved, outward: <sig.outward>, prd_present, prd_ambiguous, prd_admissible, coverage_measurable, coverage_covered }` (each sibling signal from its own producer; this ticket supplies only `outward` — run-start owns the `{verdict, reason}` taxonomy and the refusal ladder, unchanged and re-derived nowhere else). **The refuse verdict (any reason, including self-directed) → REFUSE ignition: zero tracker/structure writes, outcome `needs-human`, surface for `/faff-wtf`, STOP — never park-and-retry** (a self-directed target is a policy boundary, not a transient condition a retry could clear; canonical semantics: `faff contract run-trigger --describe`). A standalone pass that refuses has **not yet self-minted** (the mint is deferred to the closing bullet), so its zero-write guarantee holds by construction; a nested pass that refuses touches no ledger — the **shared** `runDir` is left untouched (no mint, no close; §0a owns its lifecycle).
- Only on a **non-refuse** verdict does the pass proceed. For the standalone (`not-l4`) case it **now** performs the deferred self-mint — the lights-out preflight (the same one `faff lights-out` runs, reused not reimplemented), capturing `target_resolved` + the resolved target — and sets `runDir := ` the freshly-minted dir; the nested-inherited case already has `runDir := $FAFF_RUN_DIR`. The pass then descends to the §gate→verdict seam below, using `runDir` (nested-inherited or standalone-minted) as the ledger `prd_root_container` records onto.

### The gate→verdict seam (the core seam)

For each interactive per-level gate, build **op** `{kind, level:"L4", provenance, parent_confirmed, contained_under_accepted_prd}` and pipe `{op, verdict}` to **`faff contract l4-topology-envelope`**. Act only on its **CLI-validated disposition**, never a harness-computed one. This Pattern-B validator re-derives expected disposition through `l4TopologyDecision` from `op`; the harness re-implements **none** of the table. Write only on validated `admit`.

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

**Write-time containment gate.** Immediately precede every autonomous container/epic create with its recorded `faff contain --record … --phase plot` containment-check. Without a matching recorded `contained` verdict, `faff audit` flags an integrity violation by recomputing/comparing recorded ancestry: a detective, mechanically verifiable check. Falsified live ancestry remains the separate custody/write-authority residual, out of scope here.

### Decompose-only HALT

Two triggers stop descent while the pass **finishes forward** on its siblings (never a rollback — that would itself be a destructive write):

1. **Branch not concretely derivable** — park `plot-halt: branch needs discovery`; continue siblings; create nothing. (The interactive stop rule, turned into a HALT-and-park — new-scope conjuring stays human-owned.)
2. **Would need a new root (outward)** — the `faff contain … --record … --phase plot` above returned `outward`: create nothing, record `containment: outward-new-root`, surface for `/faff-jot`, park.

### Logging, reversibility, parking

- **Logging** — every gate answer writes one durable `.faff/` log entry `{op, disposition, reason, outcome}` (outcome ∈ created / proposed-only / refused / skipped-idempotent), per the gateway `.faff/logging` rule.
- **Reversibility (structural)** — every created node is stamped `initiated: autonomous` (the marker a human greps to undo the pass, one query); the envelope `reject`s `cancel`/`delete`, so the harness *cannot* take an irreversible answer. Idempotent create reuses the single-homed MCP-write seam (`faff-jot` → **Idempotent create + link authoring**) — re-query before retry; create only the gap on re-slice.
- **Parking** — any `propose-only` / `reject` / fail-loud parks via the shared **Park protocol** (gateway); the pass finishes forward and surfaces the park set for `/faff-wtf`.

### Step 5b — author the Proposed PRDR

Request `prdr-author` once for each created project. It writes the loop's `Proposed` PRDR. Interactive L3 surfaces it for human acceptance. Autonomous L4 continues to Step 5c.

### Step 5c — admit or park the loop-PRDR

Use the L4 run ledger (standalone or inherited). Adjudicate every proposed record, even when arbitration is unscored or coverage is already satisfied. Step 4 settled container creation. There is no parallel admission path for its DoD.

1. Run the gateway's **Upper-gate (YAGNI) two-phase arbitration**. Use the validated `faff prdr yagni` result for the upper verdict. Read its `admit` field even when the independent review overturned the proposal.
2. Run `faff prdr admit --actor loop --supersedes-provenance none --upper '<json>'`, passing the lower coverage verdict via `--lower` when applicable. Read `disposition` from stdout. Exit 0 alone permits no write.
3. On `admit`, run `faff prdr accept <n> --actor loop --admit-verdict '<full verdict JSON>'` to land the record, then push the printed `prdr/…` branch and open its PR.
4. On refusal, keep the record `Proposed` and follow the **Park protocol**. Cite the actual reason: a failed trace, missing/rejected proposal or other upper rejection (`yagni-reject`), a rejecting upper verdict that upheld an overturn (`yagni-overturned`), an inconclusive skeptic (`phase2-inconclusive`), or a non-admitting admission verdict after the upper passed (`admit-refused`). A malformed or nonconformant gate result parks with the command or contract error.

Finish the pass and surface parks for `/faff-wtf`. No PRDR is silently dropped or deferred.

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
