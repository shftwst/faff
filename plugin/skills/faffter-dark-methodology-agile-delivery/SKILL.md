---
name: faffter-dark-methodology-agile-delivery
description: "Agile-delivery methodology slot: answer backlog/build requests using seven delivery principles, right-sizing, value/risk order and surfaced dependencies."
user-invocable: false
judgement_seam: grouping
---

# faffter-dark-methodology-agile-delivery

Agile delivery methodology lens. Fills the `methodology` slot and answers requests for backlog/build outputs through seven delivery principles — diagnosing problems, explaining them in plain English, and recommending fixes. Surface-only at low/medium appetite — no autonomous tracker mutations.

Configure in `.faff/config.yaml`:

```yaml
slots:
  methodology: faffter-dark-methodology-agile-delivery
```

## Outputs

Answer the gateway's fixed named-output set (gateway → **The `methodology` slot**) through the seven principles: `ticket-shaping`, `pick-ordering`, `promotion-readiness`, `backlog-diagnostics`, `standup-digest`, `horizon-assignment` and `build-queue`. The gateway fixes required outputs, caller mapping and standard envelope. Also answer optional `issue-critique` (per-issue lens for `/faff-prep`), `crank-up-set` (ranked not-eligible unlock batches for `/faff-wtf` + `/faff-tidy`), `prdr-author` (target-scaled project DoD for `/faff-plot` + `/faff-jot` + lights-out runner), `yagni-judge` (upper/YAGNI gate Phase 1) and `rehome-set` (outcome-led loose-Backlog grouping proposals for `/faff-plot`). Return the named answer plus principle-grounded findings; this skill neither knows nor describes its callers.

Every request supplies relevant issues, state, sequencing, workstream grouping and dependency graph. Return structured findings `(principle violated, diagnosis, recommended action)` and banner `Methodology: faffter-dark-methodology-agile-delivery` for the caller to display. The envelope's `Methodology: <name>` uses this skill's name, never a nickname.

How the principles map onto the outputs:

| Output | Principles applied |
|---|---|
| `ticket-shaping` | 1 (outcome-named workstreams, not the brief's literal capability names), 4 (right-sized — split a capability that's too big, merge always-together items), 6 (surface deps as explicit blocker links), 2 + 7 (sequence the proposed tickets by value × risk) |
| `pick-ordering` / `build-queue` | 2 (value × risk, sharpened to incremental end-user value), 7 (risk-aware) — override the thematic default's priority+unlock when materially different; **re-home a value stream's gating chain into that stream's order** (see **Re-homing gating chains into the stream they gate**) |
| `promotion-readiness` | 4 (right-sized), 6 (surfaced deps) |
| `backlog-diagnostics` | Composes the structural floor from gateway → **The `methodology` slot**, then adds principle findings: 1 (outcome-named), 4, 5 (cohesive), 6, plus the **thematic-project** structural-category finding (a project grouped by a capability / layer / theme, not an outcome — see **Converting a thematic project to outcome-led**), plus the **loose-accumulation** finding (project-less Backlog tickets forming a groupable cluster → recommend the rehoming pass — see **Proposing outcome-led groupings for loose work**) |
| `standup-digest` | 3 (WIP cap — humans only), plus top findings from 1, 5, 6, 7 |
| `horizon-assignment` | 2, 7 to re-sequence within horizons; 1, 5, 6 in the risk view |
| `issue-critique` | per-issue: 4 (right-sized / split / merge), 1 + 5 (workstream fit), 6 (surfaced deps), 7 (risk profile → de-risking spike) |
| `crank-up-set` | **Composes** `faffter-noon-methodology-thematic`'s `crank-up-set` slice algorithm for the graph walk + frontiers, then **re-ranks** the returned sets by 2 (value × risk) and 7 (risk-aware), trimming to the thinnest coherent slice (MVP, principle 4). Does not re-implement the walk. Appetite per-level: low = solo safe roots; full = deepest runway. |
| `prdr-author` | **Composes** the thematic baseline's `prdr-author` field derivation, then **scales the DoD by the agile lens**: 4 (right-sized — the thinnest coherent done-bar for the target, MVP cut over exhaustive coverage), 2 + 7 (value × risk — the DoD's done-criteria are the highest-value increment the target funds, de-risked first). Does not re-author from scratch — composes the thematic fields and re-frames the `definition_of_done` ambition. |
| `yagni-judge` | Proposes the upper-gate Phase-1 `{serves_goal, within_scope, verdict, reason}` through the value lens: 2 + 7 (value × risk — does this PRDR earn its keep for the goals it cites?), 4 (right-sized — MVP cut, so exceeding the **declared PRD goal set** reads as `within_scope: false`; covering *multiple* declared goals in one functional MVP does **not** — that is correct scope, not gold-plating). The agile lens is the natural YAGNI judge (it owns the MVP/bet call). It **proposes, never admits** — the adversarial skeptic challenges it (Phase 2) and `faff prdr yagni` arbitrates conservatively. |
| `rehome-set` | 1 + 5 (outcome-named containers, one outcome each — never a theme/capability/layer bucket), 4 (a cluster too thin to be a deliverable stays loose), 6 (coherence blocker edges proposed explicitly), 2 + 7 (proposals ordered by which grouping unlocks sequencable value first). **Read-only — proposes, never writes** (see **Proposing outcome-led groupings for loose work**). |

The WIP cap (principle 3) applies to `standup-digest` only — never to `build-queue` (autonomous work is unbounded).

**Recursive `ticket-shaping` (`shape-level` supplied by `/faff-plot`).** When a request carries a `shape-level`, apply the same principle lens at the requested altitude, shaping only that node's children:

- `initiative` — outcome-named initiatives (principle 1), not activity buckets.
- `project` — shippable increments under one initiative, sequenced by value × risk (2 + 7); the thinnest viable slice is the first project.
- `epic` — right-sized first-slice epics (principle 4) for one project, hidden dependencies surfaced as explicit blocker links (6).

`/faff-plot` owns the stop rule (first-slice epics, never the leaves below); this skill shapes the level it's asked for. Absent a `shape-level`, the single-level brief→tickets behaviour is unchanged (what `/faff-jot` uses).

**Target-scaled `prdr-author`.** Compose the thematic field derivation (gateway → **The `methodology` slot**; `faffter-noon-methodology-thematic` → `prdr-author`), then scale `definition_of_done` to the **thinnest coherent done-bar the target funds**, highest-value first and de-risked early (4 + 2 + 7), rather than the thematic "all children delivered" sum. **thin-MVP** means minimal shippable outcome; **finished** means the container's full promised value. Cite **every declared PRD goal covered** in the plural `PRD-goals:` set, never just one ancestor goal: a functional MVP is not over-scope. **Author, never admit** (caller's level, gateway → **Authored-PRDR level-scaling**). Re-read human DoD edits first and never clobber them (gateway → **Manual changes are authoritative (`prdr-author`)**). Low confidence yields a thin DoD flagged needs-human, never a vacuous L4 self-definition.

## Re-homing gating chains into the stream they gate

A **value stream** is a project / initiative with a machine-readable **Definition of Done**, a deliverable rather than a bucket. When grouping **surfaces** DoD presence, skip bare containers without one. Until the envelope supplies that marker, fall back to project/initiative grouping and **name the container in every finding** so a human can discount a non-deliverable boundary (step 1).

A stream cannot finish until external blocking work ships. `pick-ordering` and `build-queue` therefore **re-home** its gating chain **into the stream itself** as owned critical-path work, rather than sequencing the stream while leaving cross-container blockers stranded.

- **Gating blocker** — a ticket *outside* the stream that the stream's tickets are `blockedBy`, directly or transitively, and which must ship for the stream to complete.
- **Gating chain** — the transitive `blockedBy` chain outside the stream, from the stream's direct blocker down to the deepest unstarted prerequisite.
- **Re-home (verb)** — **reparent** that chain *into* the gated stream (a real container / `parentId` move, `blockedBy` edges preserved), deepest-first, rather than leaving it parked in its home container — then order it within the stream. Governed by the gateway topology-write-authority dial (see **Appetite integration**).
- **Increment** — the thinnest set of work that lights up one observable unit of end-user value, possibly spanning multiple structural slices.

**How the lens re-homes when answering `pick-ordering` / `build-queue` for a stream:**

1. Identify stream membership from the workstream grouping it is handed. When the grouping surfaces DoD presence, a stream is a Definition-of-Done-bearing deliverable and a bare container is skipped; until it does, fall back to the project/initiative unit as the stream and name the container in the finding (so a non-cohesive, activity-named boundary is visible, not silently trusted).
2. Walk `blockedBy` transitively *outward* from the stream's tickets toward the deepest unstarted prerequisite, stopping at the **deepest actionable** one. Defer cycles to the composed structural/topology floor's cycle detection — never order **or reparent** through a cycle (a member reachable only via a `circular-blocked` edge is left where it is and surfaces as the existing `circular-blocked` diagnostic for a human). A link that is externally blocked or otherwise not actionable stops the walk and is named as a dead-end (the deepest actionable prerequisite is the last reachable one before it).
3. At acting appetite (per the gateway topology-write-authority dial — see **Appetite integration**), **reparent** each chain member not already homed for another stream **into the gated stream as critical path**, deepest-first — the deepest actionable prerequisite reparented ahead of the work it gates — with its `blockedBy` edges preserved. At surface-only appetite, present the same fold as a reordered view without writing the move.
4. Emit a **principle-6** finding naming the chain, the gated stream, the deepest actionable prerequisite, and any dead-end.
5. Order the combined set by **incremental end-user value** (principle 2), risk-aware (principle 7) — sequence to light up each increment, crossing structural slices as needed.

**Why transitive, not direct-only.** A direct blocker may itself be blocked; walk to the deepest unstarted prerequisite for the next actionable pickup.

**A blocker that gates two streams** is reparented **once**, into the earliest stream needing it, never double-homed: duplicate membership/WIP would misreport the work.

**Re-homing reparents — governed by the gateway dial.** This is a real container / `parentId` move into the gated stream with `blockedBy` edges preserved, not just a reordered view. Gateway **Appetite for destruction → Topology-write authority** governs it: surface at `low`, act on clear chains at `high`, end-to-end at `full`; levels are not re-derived here. Its reversibility floor allows reparenting, never cancellation/deletion; its human-curated-structure floor limits writes to faff-authored topology, with human boundaries always propose-and-confirm. **Idempotent / anti-thrash:** re-read tracker state each pass. An already-homed blocker is no longer outside, so leave it there; never drag it in again or return it to its origin. Faff-beep-boop conflict analysis adds concurrent-safety serialisation downstream, never reparents or reorders.

**Complementary outward direction.** **Cutting non-spine scope out of an MVP (rehome, never delete)** moves non-critical, non-blocking issues out. This inward walk pulls only `blockedBy` prerequisites; the sets are **disjoint**, so the directions never thrash.

## Cutting non-spine scope out of an MVP (rehome, never delete)

Converge value early by shedding non-spine scope (principle 2). This complements **Re-homing gating chains into the stream they gate**: pull blockers in, **reparent non-critical issues out** into another deliverable. Reuse the same `parentId` move, reversibility floor and anti-thrash rules. Cutting scope and deleting it remain distinct:

- **Lost scope** — cancel or delete an issue/workstream (irreversible; the work ceases to exist). Forbidden at every level, including `full` — the hard floor's existing never.
- **Rehomed scope** — reparent a **non-critical** MVP issue (one *not* load-bearing on the MVP's Definition of Done) *out* into another **outcome-led, DoD-bearing project** (a `parentId` move, `blockedBy` edges preserved). Reversible ⇒ **permitted** under the gate below.

**The gate — both must hold before any cut:**

1. **DoD still satisfied** — after removing the issue, the MVP container's Definition of Done remains satisfiable by its remaining members (read against the `prdr-author` / `faff prdr` DoD machinery). If the MVP has no machine-readable DoD to read, the gate cannot clear ⇒ surface only.
2. **Real deliverable home** — the target is itself an outcome-led project carrying a DoD (an existing one, or a proposed follow-up such as *harden / enhance / simplify the MVP*) — **never** the void (parentless / backlog) and **never** a thematic / activity bucket.

**Per level** (the lens's flavour of the gateway **Appetite for destruction → Topology-write authority** dial — the levels are not re-derived here): `low` / `medium` **surface** the cut candidate + its proposed home as a finding, zero topology writes; `high` (default) **proposes** the cut + home and the human confirms the DoD-still-satisfied judgement, then the issue is reparented out, logged; `full` **acts** — evaluates the DoD gate and reparents in one pass, logged (cut + rehome together). A cut is a judgement, so it is never an autonomous reparent without the DoD gate clearing.

**Reversibility floor (reused, not a new invariant).** Reparenting is reversible and allowed; cancellation/deletion loses scope and is always forbidden. This applies the gateway floor to cuts. The human-owned DoD remains the ceiling: move work between containers, never redefine the ends.

**Idempotent / disjoint from the inward walk.** Re-read tracker state each pass: an issue moved out is no longer an MVP member or cut candidate. The inward walk pulls only `blockedBy` prerequisites, never these non-critical issues. The disjoint directions converge without A→B→A thrash.

**Anti-pattern.** A cut to "no home" (parentless / backlog-void) or into a thematic bucket is **lost scope wearing a reparent's clothes** — the work loses its deliverable and its DoD. The real-home requirement forbids it.

## Default landing — new work to project-less Backlog

This lens owns `ticket-shaping` landing, not the orchestrator. Newly captured or unsequenced work defaults to **project-less Backlog**. If the brief names one coherent, currently-actionable outcome that can be sequenced now, propose an outcome-named project (principle 1). Otherwise propose no container; sequencing into a project is a later tidy / plot / methodology step. Explicit "under new project" remains a human/`/faff-plot` choice; greenfield kickoff is exempt as explicit project creation. Execution-discovered and methodology-fill tickets use the same project-less Backlog default, never automatic filing into a standing project.

**Why.** Capture-time project filing inflates convenient projects and hides blockers. Human-owned Backlog inflow preserves legibility as topology-write power grows: gateway **Appetite for destruction → Topology-write authority**, matched-pair legibility-preserver.

**Appetite.** `low` — surface the recommendation only; the human places the ticket (zero topology writes). `medium` and up — apply the default: new captured work is shaped project-less in Backlog (the dial's named low-judgement default-landing op). This composes with the **Appetite integration** below and never reparents an existing ticket.

## Converting a thematic project to outcome-led

Agile projects must be **outcome-led**. Grouping by capability, layer, technology or theme belongs to **structural** topology, not an agile shippable outcome. Diagnose that grouping error as `backlog-diagnostics` **thematic-project** and use the convert path below.

**Sharper than Principle 1.** Principle 1 fixes activity names by renaming. This tests the grouping itself: even "Verifiable delivery" is invalid if thematic. Convert its homes to outcomes; renaming alone cannot fix it.

**Detection.** Flag grouping by capability / system layer / technology area / theme rather than a user-facing or business outcome. Unlike Principle 1's name test, use the name + member-outcome spread as observable evidence, and **name the project in every finding** for human correction. A surfaced real outcome DoD exempts the project; absent that signal, use name + spread and name the project, as in **Re-homing gating chains into the stream they gate**. This is additive; never change structural cycle / ghost-project detection.

**Diagnosis template** (the three-part educational shape):
> _"Project '[name]' groups by [capability / layer / theme], not by a shippable outcome. Under the agile lens you can't sequence inside it — there's no single outcome these tickets converge on, so 'done' for the project is undefined. Convert it: rehome each live ticket into the outcome project it serves (the MVP, or a follow-up harden / enhance / simplify outcome project), land the rest in plain backlog until it's sequencable, then retire the drained shell."_

**The convert path** (governed by the gateway dial; runs only under the agile lens):

1. **Identify the live work** — the project's non-terminal tickets. Terminal tickets (Done / Cancelled) stay put as historical record; conversion never reopens them.
2. **Rehome each live ticket into the outcome project it serves** via the **reparent primitive** (**Re-homing gating chains into the stream they gate** — the structural `parentId` / project-membership move, `blockedBy` edges preserved). The outcome home is the MVP it belongs to, or a follow-up outcome project (*harden / enhance / simplify the MVP*). A reparent into another *real* outcome home is **rehomed** scope, not **lost** scope, so it stays on the permitted side of the **Cutting non-spine scope out of an MVP (rehome, never delete)** line.
3. **Land the remainder in plain backlog** — any live ticket with no outcome home yet is reparented to **no project, plain Backlog** via the **Default landing — new work to project-less Backlog** rule, never into another thematic bucket and never into the void. It waits there until a later tidy / plot / methodology pass can sequence it into an outcome.
4. **Retire the drained shell** — once the project holds no live work, retire / close the now-empty project (a reversible state move — a drained shell moves to a completed/closed state, the de-inflating retirement, not a delete). The shell and its terminal history survive; only its role as a live grouping unit ends.

**No scope is ever lost.** Place every live ticket in an outcome project or plain backlog before retiring the shell. Never retire a shell that still holds live work.

**Per level** (the lens's flavour of the gateway **Appetite for destruction → Topology-write authority** dial — the levels are not re-derived here): `low` **diagnoses only** — surface the thematic-project finding + the offered conversion, zero writes; `medium` surfaces the finding with the recommended conversion, no reparent / retire (conversion is a high-judgement op); `high` (default) **proposes the conversion** — the per-ticket rehome plan + remainder-to-backlog + shell retirement, acting on the clear rehomes and proposing the judgement where the outcome home is ambiguous; `full` **converts in one pass** — rehome all live work, land the remainder, retire the drained shell, fully logged.

**Invariants, inherited from the dial (named, not restated):** reversibility (retire / close, never cancel / delete — at every level including `full`); idempotent / anti-thrash (a converted project stays converted — a retired drained shell is recognised as already-converted next pass, a rehomed ticket does not bounce back into a thematic home); the human-curated-structure floor (a project a human curated as a deliberate grouping stays propose-and-confirm at every level).

## Proposing outcome-led groupings for loose work

**Default landing** deliberately accumulates project-less Backlog work. Given those tickets, their dependency graph and existing projects, `rehome-set` **proposes** outcome-led homes. It is **read-only — proposes, never writes**; application is the caller's human-gated act.

**The proposal procedure:**

1. **Cluster the loose set by shared outcome.** A cluster is a subset of loose tickets that converge on one user-facing or business outcome — the same outcome test **Converting a thematic project to outcome-led** uses, applied forward to un-grouped work.
2. **Name each high-confidence cluster's container by its outcome** (principles 1 + 5) — an outcome statement, never a capability / layer / theme. A thematic bucket in a proposal is the lens's own structural-category error; never propose one. One outcome per container.
3. **Drop clusters too thin to be a deliverable** (principle 4 applied to containers) — a pair of tickets with no sequencable value together stays loose, not a manufactured project.
4. **Propose the coherence blocker edges** that make each grouping sequencable (principle 6): the `blockedBy` edges internal to the cluster, emitted as proposals, never written. An edge that would create a cycle against the live graph is omitted and noted in findings.
5. **Order the proposals** by which grouping unlocks sequencable value first (principles 2 + 7).
6. **Name every remaining loose ticket in the leave-loose set** with a one-line reason. A ticket may also be proposed for membership in an *existing* project whose outcome it matches (existing projects are an input for exactly this) — still a proposal, never a write.

**Completeness — nothing silently omitted.** Every input loose ticket appears **exactly once** across proposal memberships and the leave-loose set.

**Conservative bias.** Prefer loose tickets to wrong groups: application is cheap but reversal needs manual reassignment (project assignment cannot be nulled, only moved). A genuinely independent ticket with no outcome home belongs in leave-loose. Propose **only high-confidence groupings**; when uncertain, leave loose and explain.

**Loose-accumulation diagnostic** (a `backlog-diagnostics` finding). When `backlog-diagnostics` runs and the lens detects ≥1 groupable cluster among the project-less Backlog tickets (a judgement call — no count threshold), surface a finding that names the cluster members (tracker id + gloss) and the candidate outcome, and recommends running the rehoming pass. The don't-nag rule applies (a repeat finding surfaces at most once). Additive over the structural/topology floor. Diagnosis template (the three-part educational shape):
> _"[N] project-less Backlog tickets include a groupable cluster — [id: gloss, …] converge on the outcome '[candidate outcome]'. Loose work doesn't get sequenced, so this value sits un-orderable. Run the rehoming pass to propose an outcome-led home for it (and confirm the rest is deliberately loose)."_

**Appetite** changes proposal **breadth and confidence threshold only, never write authority**. `low`: clearest single grouping, tightest bar. `full`: widest defensible set, looser but still high confidence. **Every** level makes zero tracker writes. No qualifying cluster is valid: empty proposals, all tickets in leave-loose; caller reports no grouping opinion and writes nothing.

## The seven principles

Each principle gives its rule, rationale, tracker violation shape and a diagnosis template. Rendering sub-skills fill bracketed `[placeholder]` values.

### Principle 1: Outcome-named workstreams, not activity-named

**Rule.** Workstreams (initiatives, projects, milestones, epics — whatever the tracker calls them) are named by the user-facing or business outcome they produce. "Alerting overhaul." "Auth hardening." "Onboarding speed-up." Not by activity type — "Bugs", "Refactors", "Tech debt", "Q2 sprint 3".

**Why.** Activity-named workstreams hide priority (every bug is in "Bugs", so which matters?), conflate unrelated work (a critical auth bug and a typo fix in the same bucket), and break sequencing (you can't sequence "Refactors" — there's no shared outcome to optimise toward).

**Violation shape.** A workstream's name is a category, a sprint, a quarter, a team, or a technology layer rather than a deliverable.

**Diagnosis template.** _"Workstream '[name]' is activity-named. This makes sequencing inside it meaningless — there's no shared outcome these tickets share. Consider regrouping them by outcome: which user-facing change does each one belong to?"_

### Principle 2: Sequence by value x risk, not by ticket order

**Rule.** Build order is determined by value created per unit of work, weighted by risk and dependency chains. Not by ticket creation order, not by who shouted loudest, not by priority alone. Sharpen this to **incremental end-user value**: sequence to light up each observable increment of user-facing value as early as possible, crossing structural slices *within* an increment rather than finishing one slice at a time. When a value stream's completion is gated by work outside it, that gating chain is part of the increment — re-home it into the stream's order (see **Re-homing gating chains into the stream they gate**).

**Why.** Tracker priority is noisy and stakeholder-influenced; optimise value shipped per week and de-risk unknown work early.

**PRD-distance composition (`pick-ordering` / `build-queue`).** When the caller supplies the optional `prd-distance` map (an L4 drain under a resolved target PRD — gateway → **Standard envelope → Optional input `prd-distance`**), the agile lens folds PRD-completion distance into this value×risk sequencing as a **within-band** signal: among same-priority-band independents, weight `class_rank` (nearer the parent PRD = sooner) *alongside* value×risk×unlock, so a drain heads for the sibling PRDR closest to a `met` DoD rather than taking queue order. An issue whose container slug-matches no entry, or matches only `met` (rank 0), is neutral — its value×risk position stands. **Two floor rules bind (never negotiable):** distance never reorders across a human-priority band, and **input absent ⇒ ordering byte-identical** to the map-unaware lens (no PRD in scope → nothing to fold). Distance composes with the re-home fold (**Re-homing gating chains into the stream they gate**), never replaces it.

**Violation shape.** Current sequencing order is materially different from a value x risk x dep-aware order. Specifically: an issue that unlocks N value-shipping tickets is sitting behind an isolated cleanup; or a high-risk integration is sequenced last; or a quick value win is buried below months of prep work.

**Diagnosis template.** _"Current sequencing would ship value at week N. Value-aware sequencing (ISSUE-A -> ISSUE-B -> ISSUE-C first) would ship value at week M. The blocker is that ISSUE-X (currently first) creates no shipped value on its own — it unlocks the same downstream as ISSUE-A, but ISSUE-A also ships standalone value."_

### Principle 3: WIP cap (humans only — autonomous work is unbounded)

**Rule.** Human in-flight work (issues a person is actively building) is capped at 3. Autonomous work (e.g. `/faff-beep-boop` runs) is **not WIP-capped** — the whole point of automating is to remove human-flow constraints from machine throughput.

**Why.** Too much human in-flight breaks flow — context-switching eats throughput, a finished item ships value, a half-finished one doesn't. None of that applies to autonomous runs: each task runs in an isolated context with no cognitive cost. A PR awaiting human review is queued for human attention but does not count against the human's in-flight WIP.

**Violation shape.** Human-driven in-flight count > 3 — or any new pull recommendation surfaced to a human when their count is already at 3.

**Diagnosis template.** _"WIP at N (cap 3). Flow > throughput. Finish ISSUE-X or ISSUE-Y before pulling new work. Recommending [next item] only after one in-flight item ships."_

Surfaced by `/faff-wtf`. Never surfaced by `/faff-beep-boop`.

### Principle 4: Right-sized tickets

**Rule.** A ticket is a 1-3 day unit of work. Larger units split. Smaller units merge if they always ship together.

**Why.** Tickets that fit a day or three give honest sequencing and accurate burn-down. Ticket-as-epic hides progress (it sits "In Progress" for two weeks signalling nothing); ticket-as-micro fragments the picture.

**Violation shape.** A ticket whose spec covers two structurally independent concerns (each a valid 1-3 day unit) — split candidate. A ticket whose spec is one sentence with no clear deliverable — vague candidate. A pair of always-ship-together tickets — merge candidate.

**Diagnosis template.** _"ISSUE-X looks too big — its spec covers [concern A] and [concern B], which are independent. Splitting into two tickets gives honest sequencing and lets [concern A] ship without waiting on [concern B]."_

### Principle 5: Cohesive workstreams

**Rule.** A workstream encodes one outcome. Mixed-purpose workstreams (multiple outcomes bundled, or one outcome plus a catch-all) are smell.

**Why.** Two outcomes give a workstream competing sequencing orders and no single definition of done.

**Violation shape.** Tickets within a single workstream describe two or more distinct outcomes; or a single workstream has a clear primary outcome plus several "while we're at it" tickets.

**Diagnosis template.** _"Workstream '[name]' contains [outcome A] and [outcome B]. These have different sequencing inside the workstream and different completion criteria. Consider splitting."_

### Principle 6: Surface dependencies

**Rule.** Every load-bearing dependency between tickets is named explicitly via the tracker's blocker/blockedBy relationship. Implicit deps (assumed by humans, not encoded in the tracker) are unfinished thinking.

**Why.** Implicit deps cause silent regression — a ticket gets pulled "ready" when it actually needs another ticket's output. Automation routing relies on the blocker graph being honest.

**Violation shape.** A spec references work in another ticket (by ID or by clear paraphrase) without that other ticket being a declared blocker. Or a workstream's tickets clearly depend on a non-workstream ticket without a link.

**Diagnosis template.** _"ISSUE-X's spec references ISSUE-Y's output but there's no blocker link. If the dep is real, link it (so automation can sequence honestly); if not, the reference in the spec should go away."_

**Gating-chain finding (re-homing).** When a value stream is `blockedBy` work outside it, name the chain as part of re-homing it into the stream's order: _"ISSUE-X gates stream '[name]' via [chain]; sequenced as part of the stream so it can complete (deepest actionable: ISSUE-Z[; dead-ends at ISSUE-W: [reason]])."_ See **Re-homing gating chains into the stream they gate**.

### Principle 7: Risk-aware sequencing

**Rule.** Higher-risk work — novel integrations, unproven approaches, dependencies on external teams — is sequenced early or de-risked separately. The unknown does not all land at the end.

**Why.** Late risk undermines estimates; early de-risking allows correction before commitment.

**Violation shape.** The work most likely to surprise (large new integration, unfamiliar territory, external dep) is sequenced near the end of an initiative. Or no risk de-risking work exists — everything assumes the plan holds.

**Diagnosis template.** _"Initiative '[name]' sequences ISSUE-Z (a new [integration / approach / external dep]) last. If ISSUE-Z surprises, the surprise lands at the worst time. Consider pulling it forward, or splitting a small de-risking spike before committing to the full ISSUE-Z scope."_

When a stream's gating chain is re-homed (see **Re-homing gating chains into the stream they gate**), keep this risk-aware ordering across the combined set — a novel prerequisite pulled in deepest-first is exactly the early de-risking this principle wants.

## Tone discipline

Diagnoses are **educational, not preachy**; the user opted in to learn delivery. Every diagnosis follows:

1. **What's there.** Describe the situation factually.
2. **Why it's a problem.** Name the concrete consequence.
3. **What to do about it.** Recommend a specific action.

Never: "You're doing this wrong." / "Best practice is..." / "You should...". Describe the situation and its consequence; the user decides. The methodology is opinionated; the voice is not.

## Appetite integration

This skill reads the suite-wide `appetite` setting from `.faff/config.yaml`. Appetite governs how much this skill acts vs. surfaces.

**Authority over tracker topology is the gateway's dial, not re-derived here.** Reparenting, conversion, gating-chain rehome and default landing use gateway **Appetite for destruction** → **Topology-write authority**. Its table, anti-thrash, legibility-preserver, reversibility floor and DoD ceiling compose with the hard floor and human-curated-structure floor. This section describes the seven-principle use of that authority, without redefining levels.

**low — surface only.**
- All findings are informational. No tracker mutations. No reordering.
- The human reads, decides, acts.
- For a scope cut, name the non-spine issue and its proposed home. For conversion, name the thematic project and proposed conversion.
- Equivalent to "show me what you'd recommend but don't touch anything."

**medium — surface + limited action.**
- Findings are surfaced with recommended actions.
- Chain-gap tickets auto-created (when the gap is unambiguous).
- Build-queue ordering informed by methodology but doesn't override explicit priority.
- No auto-splits, no reprioritisation, no demotions.

**high (default) — surface + act.**
- **Auto-split** oversized tickets (principle 4) — drives the sub-ticket creation and links (the orchestrator lane performs the writes), and logs the action. Never deletes the parent.
- Reorder build queues by value × risk × dependencies when the order differs materially from the thematic baseline. For a thematic conversion, rehome tickets with clear destinations and ask the human to confirm ambiguous homes. Apply the high-appetite rules in **Re-homing gating chains into the stream they gate**, **Cutting non-spine scope out of an MVP (rehome, never delete)** and **Converting a thematic project to outcome-led**.
- **File prerequisite/follow-up tickets** for surfaced dependencies (principle 6) — Backlog.
- **Flag stalled work for demotion** — issues stuck In Progress with no commits for N days get surfaced with a demotion recommendation. At high appetite, the demotion executes (In Progress → Backlog) with a tracker comment explaining why.
- Every action is documented: tracker comment on the affected issue, log entry in `.faff/logs/`.

**full — complete autonomy.**
Everything `high` does, plus:
- **Auto-merge** always-ship-together tickets (principle 4) — combines them into one, links the originals as "merged into", logs the action.
- **Reparent** misplaced tickets — drives the reparent of outcome-misplaced tickets to the workstream where they belong based on outcome alignment (the orchestrator performs the move) (principle 5). (Gating-chain reparent is already a `high`-and-above capability above; `full` extends reparent to outcome-misplacement and owns project formation end-to-end.)
- **Demote without flagging first** — stalled work demotes immediately (In Progress → Backlog) rather than flagging then waiting a cycle.
- Apply the full-appetite scope-cut and thematic-conversion procedures above in one pass.
- **Methodology owns sequencing entirely** — explicit priority is an input signal, not a veto. Value x risk x deps determines the order.
- **Resolve all methodology findings in a single pass** — no "surface now, act next run" cycle. Findings are acted on in the same invocation they're detected.
- Still logs every action. Still never cancels or deletes.

**What no appetite level does:**
- **Lost scope** — cancel or delete an issue/workstream (irreversible; the work ceases to exist). Forbidden at every level, including `full`. This is *not* the same as **rehomed scope** — reparenting a non-critical issue *out* of an MVP into another DoD-bearing home — which **is** permitted under the gate in **Cutting non-spine scope out of an MVP (rehome, never delete)**; cutting scope by rehoming is reversible, deleting it is not.
- Override user-explicit "ask first" rules.
- Skip adversarial review.
- Act without evidence (every action traces to a principle + observable tracker state).

## Rules

- Findings must be grounded in observable tracker state — not speculation about intent or future plans.
- Each finding must name the specific issues/workstreams involved (by tracker ID + descriptive gloss).
- Findings that repeat across runs without human action are surfaced at most once per `/faff-wtf` invocation — don't nag.
- This skill is **additive over the thematic baseline, not a from-scratch replacement of it.** For `backlog-diagnostics` it composes the shared **structural/topology floor** for the mandatory graph floor (cycle + ghost-project detection that feeds the `circular-blocked` / `gap-blocked` routing verdicts — see the gateway → **The `methodology` slot** swap-floor clause), then layers its seven-principle findings on top. It does not re-implement or override the topology floor's graph detection, chain gaps, stale blockers, or dupes.
- At `low` and `medium` appetite, this skill is **read-only** — it never mutates tracker state.
- At `high`, the orchestrator executes and logs the decisions in **Appetite integration**, including ticket creation and status moves. Never move a ticket to Done or Cancelled. Only `full` can retire a drained project shell.
