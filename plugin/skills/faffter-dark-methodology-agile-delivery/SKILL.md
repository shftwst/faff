---
name: faffter-dark-methodology-agile-delivery
description: "Agile-delivery `methodology` lens — answers backlog/build named-outputs through seven delivery principles (right-sizing, value-by-risk sequencing, surfaced deps). Opinionated alternative to the thematic default. Runs as a configured slot, not the user `/` menu."
user-invocable: false
---

# faffter-dark-methodology-agile-delivery

Agile delivery methodology lens. Fills the `methodology` slot and answers requests for backlog/build outputs through seven delivery principles — diagnosing problems, explaining them in plain English, and recommending fixes. Surface-only at low/medium appetite — no autonomous tracker mutations.

Configure in `.faffrc`:

```yaml
slots:
  methodology: faffter-dark-methodology-agile-delivery
```

## Outputs

This skill fills the `methodology` slot, so it answers the same named-output set — but through the seven-principle lens rather than pure graph structure. That set (the outputs, which are required, which caller requests each, the standard envelope) is fixed in the gateway → **The `methodology` slot**: `ticket-shaping`, `pick-ordering`, `promotion-readiness`, `backlog-diagnostics`, `standup-digest`, `horizon-assignment`, `build-queue`. It also answers the optional `issue-critique` (per-issue lens for `/faff-prep`), `crank-up-set` (ranked not-eligible unlock batches for `/faff-wtf` + `/faff-tidy`), `prdr-author` (a target-scaled project DoD for `/faff-plot` + `/faff-jot` + the lights-out runner), and `yagni-judge` (Phase-1 of the upper/YAGNI gate — FAFF-256) outputs. A caller requests an output by name and receives the answer plus principle-grounded findings; this skill does not know or describe its callers.

Inputs it expects with any request: the relevant issues, their state, sequencing, workstream grouping, dependency graph. Output of every request includes structured findings — `(principle violated, diagnosis, recommended action)` — and a banner line `Methodology: faffter-dark-methodology-agile-delivery` for the caller to display (the gateway envelope's `Methodology: <name>` line carries this skill's own name, not a nickname).

How the principles map onto the outputs:

| Output | Principles applied |
|---|---|
| `ticket-shaping` | 1 (outcome-named workstreams, not the brief's literal capability names), 4 (right-sized — split a capability that's too big, merge always-together items), 6 (surface deps as explicit blocker links), 2 + 7 (sequence the proposed tickets by value × risk) |
| `pick-ordering` / `build-queue` | 2 (value × risk, sharpened to incremental end-user value), 7 (risk-aware) — override the thematic default's priority+unlock when materially different; **re-home a value stream's gating chain into that stream's order** (see **Re-homing gating chains into the stream they gate**) |
| `promotion-readiness` | 4 (right-sized), 6 (surfaced deps) |
| `backlog-diagnostics` | Composes the shared structural/topology floor for the mandatory graph floor (cycles + ghost-projects), then adds principle findings: 1 (outcome-named), 4, 5 (cohesive), 6 |
| `standup-digest` | 3 (WIP cap — humans only), plus top findings from 1, 5, 6, 7 |
| `horizon-assignment` | 2, 7 to re-sequence within horizons; 1, 5, 6 in the risk view |
| `issue-critique` | per-issue: 4 (right-sized / split / merge), 1 + 5 (workstream fit), 6 (surfaced deps), 7 (risk profile → de-risking spike) |
| `crank-up-set` | **Composes** `faffter-noon-methodology-thematic`'s `crank-up-set` slice algorithm for the graph walk + frontiers, then **re-ranks** the returned sets by 2 (value × risk) and 7 (risk-aware), trimming to the thinnest coherent slice (MVP, principle 4). Does not re-implement the walk. Appetite per-level: low = solo safe roots; full = deepest runway. |
| `prdr-author` | **Composes** the thematic baseline's `prdr-author` field derivation, then **scales the DoD by the agile lens**: 4 (right-sized — the thinnest coherent done-bar for the target, MVP cut over exhaustive coverage), 2 + 7 (value × risk — the DoD's done-criteria are the highest-value increment the target funds, de-risked first). Does not re-author from scratch — composes the thematic fields and re-frames the `definition_of_done` ambition. |
| `yagni-judge` | Proposes the upper-gate Phase-1 `{serves_goal, within_scope, verdict, reason}` through the value lens: 2 + 7 (value × risk — does this PRDR earn its keep for the goal it cites?), 4 (right-sized — MVP cut, so *exceeding* the goal reads as `within_scope: false`). The agile lens is the natural YAGNI judge (it owns the MVP/bet call). It **proposes, never admits** — the adversarial skeptic challenges it (Phase 2) and `faff prdr yagni` arbitrates conservatively. |

The WIP cap (principle 3) applies to `standup-digest` only — never to `build-queue` (autonomous work is unbounded).

**Recursive `ticket-shaping` (`shape-level` supplied by `/faff-plot`).** When a request carries a `shape-level`, apply the same principle lens at the requested altitude, shaping only that node's children:

- `initiative` — outcome-named initiatives (principle 1), not activity buckets.
- `project` — shippable increments under one initiative, sequenced by value × risk (2 + 7); the thinnest viable slice is the first project.
- `epic` — right-sized first-slice epics (principle 4) for one project, hidden dependencies surfaced as explicit blocker links (6).

`/faff-plot` owns the stop rule (first-slice epics, never the leaves below); this skill shapes the level it's asked for. Absent a `shape-level`, the single-level brief→tickets behaviour is unchanged (what `/faff-jot` uses).

**Target-scaled `prdr-author`.** Composes the thematic baseline's field derivation (gateway → **The `methodology` slot**; `faffter-noon-methodology-thematic` → `prdr-author`), then scales the `definition_of_done` through the lens — the agile cut is the **thinnest coherent done-bar the target funds**, highest-value increment first, de-risked early (principles 4 + 2 + 7), not the thematic "all children delivered" sum. A **thin-MVP** target ⇒ the minimal shippable outcome slice; a **finished** target ⇒ the full value the container promises. It **authors but never admits** (admission is the caller's level — gateway → **Authored-PRDR level-scaling**) and re-reads any human-set DoD first, never clobbering it (gateway → **Manual changes are authoritative (`prdr-author`)**). Low confidence ⇒ a thin DoD flagged needs-human, never a vacuous L4 self-define.

## Re-homing gating chains into the stream they gate

A **value stream** is a container (project / initiative) carrying a machine-readable **Definition of Done** — a deliverable, not just a bucket. Re-homing targets these deliverables. Two cases, kept distinct: when the grouping **surfaces** DoD presence, a bare container with *no* Definition of Done is not a value stream and is skipped; until the input envelope surfaces that marker, the lens can't tell deliverable from bucket, so it falls back to the project/initiative grouping as the stream unit and **names the container in every finding** so a human can discount a non-deliverable boundary (step 1).

The agile lens sequences a *set* of tickets, but a value stream is only **done** when work *outside* the set that blocks it also ships. `pick-ordering` and `build-queue` therefore **re-home** a stream's gating chain *into the stream itself* — reparenting it as critical path — so a stream that looks sequenced but is silently stuck on a cross-container blocker pulls that blocker in as owned critical-path work instead of leaving it stranded in its home container.

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

**Why transitive, not direct-only.** Pulling only the *direct* blocker leaves its own blocker stranded — the direct blocker can't be picked up, so the stream still can't complete while *looking* sequenced. Walking to the deepest unstarted prerequisite surfaces the real next pickup.

**A blocker that gates two streams** is reparented **once**, into the earliest stream that needs it — never double-homed into both (double-homing misreports membership and WIP just as duplicate sequencing did).

**Re-homing reparents — governed by the gateway dial.** Re-homing is a **structural move**: it reparents the gating chain into the gated stream (a real container / `parentId` move with the `blockedBy` edges preserved), not just a reordered view. How much of that authority the lens holds per level is the gateway **Appetite for destruction → Topology-write authority** dial — surface-only at `low`, act on clear chains at `high`, `full` owns it end-to-end — bounded by that dial's reversibility floor (reparent is reversible ⇒ allowed; the move never cancels or deletes scope) and its human-curated-structure floor (faff-authored topology only — a human-curated boundary stays propose-and-confirm). The levels are not re-derived here. **Idempotent / anti-thrash:** the lens reads the tracker fresh each pass, so a reparent **converges** — once a blocker's home is the gated stream, the next pass recognises it as already-homed and is a no-op (it is neither re-evaluated as an "outside" blocker to drag in again, nor rehomed back to its origin). faff-beep-boop's conflict-analysis still consumes whatever the lens presents and owns concurrent-safety serialisation downstream — it only adds serialisation constraints, it does not itself reparent or reorder — so the two compose without contradiction.

**Complementary outward direction.** The reverse move — reparenting a *non-critical* issue *out* of an MVP to converge scope early — is **Cutting non-spine scope out of an MVP (rehome, never delete)** below. It operates on a **disjoint** set (non-critical, non-blocking issues) from this inward walk (which pulls only `blockedBy` prerequisites), so the two directions never thrash.

## Cutting non-spine scope out of an MVP (rehome, never delete)

The lens champions converging value early by shedding non-spine scope (principle 2). That cut is the **complementary outward direction** of the inward re-home above: where **Re-homing gating chains into the stream they gate** drags a blocker *into* the MVP, this **reparents a non-critical issue *out* of the MVP** into another deliverable — reusing the same `parentId`-move mechanism, reversibility floor, and anti-thrash convergence, not a new one. Cutting scope is **not** deleting it; the two are distinct acts:

- **Lost scope** — cancel or delete an issue/workstream (irreversible; the work ceases to exist). Forbidden at every level, including `full` — the hard floor's existing never.
- **Rehomed scope** — reparent a **non-critical** MVP issue (one *not* load-bearing on the MVP's Definition of Done) *out* into another **outcome-led, DoD-bearing project** (a `parentId` move, `blockedBy` edges preserved). Reversible ⇒ **permitted** under the gate below.

**The gate — both must hold before any cut:**

1. **DoD still satisfied** — after removing the issue, the MVP container's Definition of Done remains satisfiable by its remaining members (read against the `prdr-author` / `faff prdr` DoD machinery). If the MVP has no machine-readable DoD to read, the gate cannot clear ⇒ surface only.
2. **Real deliverable home** — the target is itself an outcome-led project carrying a DoD (an existing one, or a proposed follow-up such as *harden / enhance / simplify the MVP*) — **never** the void (parentless / backlog) and **never** a thematic / activity bucket.

**Per level** (the lens's flavour of the gateway **Appetite for destruction → Topology-write authority** dial — the levels are not re-derived here): `low` / `medium` **surface** the cut candidate + its proposed home as a finding, zero topology writes; `high` (default) **proposes** the cut + home and the human confirms the DoD-still-satisfied judgement, then the issue is reparented out, logged; `full` **acts** — evaluates the DoD gate and reparents in one pass, logged (cut + rehome together). A cut is a judgement, so it is never an autonomous reparent without the DoD gate clearing.

**Reversibility floor (reused, not a new invariant).** Reparent is reversible ⇒ allowed; cancel/delete is lost scope ⇒ forbidden always — the lens's reading of the gateway dial's reversibility floor, named for this cut, not a second rule. The cut stays *beneath* the human-owned DoD (the dial's DoD ceiling): it rearranges which container holds the work, it never redefines the ends.

**Idempotent / disjoint from the inward walk.** The lens reads the tracker fresh each pass, so a rehomed-out issue is **no longer an MVP member** and is not re-evaluated as a cut candidate (the cut converges). A non-critical issue is **never** dragged back *in* by the inward gating-chain walk — that walk pulls only `blockedBy` prerequisites, which a non-critical issue is not. Outward- and inward-rehome therefore operate on **disjoint** sets and cannot thrash (no A→B→A).

**Anti-pattern.** A cut to "no home" (parentless / backlog-void) or into a thematic bucket is **lost scope wearing a reparent's clothes** — the work loses its deliverable and its DoD. The real-home requirement forbids it.

## Default landing — new work to project-less Backlog

This lens owns where newly captured or unsequenced work lands — a `ticket-shaping` opinion, not the orchestrator's. The default is **project-less Backlog**: shape the ticket(s), but propose **no container** unless the brief names one coherent, currently-actionable outcome that can be sequenced now — in which case an outcome-named project is proposed (principle 1). Sequencing unsequenced work into an outcome-led project is a deliberate later step (tidy / plot / a later methodology pass), never a capture-time default. The explicit "under new project" path stays available as a human/`/faff-plot` choice; greenfield project kickoff is exempt — it is itself an explicit project creation. Execution-discovered and methodology-fill tickets default the same way: project-less in Backlog, not auto-filed into a standing project.

**Why.** New work auto-filed at capture time inflates whichever project is handy and buries real blockers; a plain, human-owned Backlog inflow keeps the control plane legible while the lens reorganises what is already there. This is the inflow counterweight to the lens's growing topology-write power — see the gateway's **Appetite for destruction → Topology-write authority** dial (the matched-pair legibility-preserver), which this rule realises in the capture path.

**Appetite.** `low` — surface the recommendation only; the human places the ticket (zero topology writes). `medium` and up — apply the default: new captured work is shaped project-less in Backlog (the dial's named low-judgement default-landing op). This composes with the **Appetite integration** below and never reparents an existing ticket.

## The seven principles

Each principle has: the rule, why it matters, what the violation looks like in tracker shape, and a diagnosis template sub-skills use when surfacing it. Bracketed `[placeholder]` values are filled by the rendering sub-skill.

### Principle 1: Outcome-named workstreams, not activity-named

**Rule.** Workstreams (initiatives, projects, milestones, epics — whatever the tracker calls them) are named by the user-facing or business outcome they produce. "Alerting overhaul." "Auth hardening." "Onboarding speed-up." Not by activity type — "Bugs", "Refactors", "Tech debt", "Q2 sprint 3".

**Why.** Activity-named workstreams hide priority (every bug is in "Bugs", so which matters?), conflate unrelated work (a critical auth bug and a typo fix in the same bucket), and break sequencing (you can't sequence "Refactors" — there's no shared outcome to optimise toward).

**Violation shape.** A workstream's name is a category, a sprint, a quarter, a team, or a technology layer rather than a deliverable.

**Diagnosis template.** _"Workstream '[name]' is activity-named. This makes sequencing inside it meaningless — there's no shared outcome these tickets share. Consider regrouping them by outcome: which user-facing change does each one belong to?"_

### Principle 2: Sequence by value x risk, not by ticket order

**Rule.** Build order is determined by value created per unit of work, weighted by risk and dependency chains. Not by ticket creation order, not by who shouted loudest, not by priority alone. Sharpen this to **incremental end-user value**: sequence to light up each observable increment of user-facing value as early as possible, crossing structural slices *within* an increment rather than finishing one slice at a time. When a value stream's completion is gated by work outside it, that gating chain is part of the increment — re-home it into the stream's order (see **Re-homing gating chains into the stream they gate**).

**Why.** Tracker priority is noisy and stakeholder-influenced. Optimising for value-per-week shipped is the actual goal of a delivery practice. Risk-aware sequencing means de-risking earlier so unknown work doesn't surface at the worst moment.

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

**Why.** A workstream is a sequencing and grouping unit — if it has two outcomes, you can't sequence inside it (the right order for outcome A is different from outcome B), and the workstream's "done" is meaningless.

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

**Why.** Risk piled at the end means schedule estimates are lies. Early-de-risking gives the team time to course-correct before commitment.

**Violation shape.** The work most likely to surprise (large new integration, unfamiliar territory, external dep) is sequenced near the end of an initiative. Or no risk de-risking work exists — everything assumes the plan holds.

**Diagnosis template.** _"Initiative '[name]' sequences ISSUE-Z (a new [integration / approach / external dep]) last. If ISSUE-Z surprises, the surprise lands at the worst time. Consider pulling it forward, or splitting a small de-risking spike before committing to the full ISSUE-Z scope."_

When a stream's gating chain is re-homed (see **Re-homing gating chains into the stream they gate**), keep this risk-aware ordering across the combined set — a novel prerequisite pulled in deepest-first is exactly the early de-risking this principle wants.

## Tone discipline

Diagnoses are **educational, not preachy**. The user opted in because they want to learn what good delivery looks like. Every diagnosis follows:

1. **What's there.** Describe the situation factually.
2. **Why it's a problem.** Name the concrete consequence.
3. **What to do about it.** Recommend a specific action.

Never: "You're doing this wrong." / "Best practice is..." / "You should...". Describe the situation and its consequence; the user decides. The methodology is opinionated; the voice is not.

## Appetite integration

This skill reads the suite-wide `appetite` setting from `.faffrc`. Appetite governs how much this skill acts vs. surfaces.

**Authority over tracker topology is the gateway's dial, not re-derived here.** How much this lens may write tracker topology per appetite level — reparent, convert, rehome a gating chain, default where new work lands — is the shared **topology-write-authority** dial: gateway → **Appetite for destruction** → **Topology-write authority** (the table, the anti-thrash + legibility-preserver guardrails, and the reversibility-floor + DoD-ceiling invariants, all of which compose with the existing hard floor and the human-curated-structure floor). This section keeps only the lens's own seven-principle flavour of what each level *does* with that authority; it does not restate the levels.

**low — surface only.**
- All findings are informational. No tracker mutations. No reordering.
- The human reads, decides, acts.
- **Scope cuts** surface as a finding only — name the non-spine cut candidate + its proposed real home, zero topology writes (see **Cutting non-spine scope out of an MVP (rehome, never delete)**).
- Equivalent to "show me what you'd recommend but don't touch anything."

**medium — surface + limited action.**
- Findings are surfaced with recommended actions.
- Chain-gap tickets auto-created (when the gap is unambiguous).
- Build-queue ordering informed by methodology but doesn't override explicit priority.
- No auto-splits, no reprioritisation, no demotions.

**high (default) — surface + act.**
- **Auto-split** oversized tickets (principle 4) — creates the sub-tickets, links them, logs the action. Never deletes the parent.
- **Reorder** build queues by value x risk x deps (principles 2 + 7) — overrides the thematic ordering when materially different — and **re-home** a value stream's gating chain by **reparenting the clear chain into the gated stream** (real container / `parentId` move, `blockedBy` edges preserved), per the gateway topology-write-authority dial (see **Re-homing gating chains into the stream they gate**).
- **Propose a scope cut** (principle 2) — surface a non-critical MVP issue to rehome *out* + its proposed real DoD-bearing home, for the human to confirm the *DoD-still-satisfied* judgement; on confirm, **reparent it out** (never cancel/delete), logged. See **Cutting non-spine scope out of an MVP (rehome, never delete)**.
- **File prerequisite/follow-up tickets** for surfaced dependencies (principle 6) — Backlog, tagged `faff-methodology-fill`.
- **Flag stalled work for demotion** — issues stuck In Progress with no commits for N days get surfaced with a demotion recommendation. At high appetite, the demotion executes (In Progress → Backlog) with a tracker comment explaining why.
- Every action is documented: tracker comment on the affected issue, log entry in `.faff/logs/`.

**full — complete autonomy.**
Everything `high` does, plus:
- **Auto-merge** always-ship-together tickets (principle 4) — combines them into one, links the originals as "merged into", logs the action.
- **Reparent** misplaced tickets — moves outcome-misplaced tickets to the workstream where they belong based on outcome alignment (principle 5). (Gating-chain reparent is already a `high`-and-above capability above; `full` extends reparent to outcome-misplacement and owns project formation end-to-end.)
- **Demote without flagging first** — stalled work demotes immediately (In Progress → Backlog) rather than flagging then waiting a cycle.
- **Act on a cleared scope cut** (principle 2) — when the MVP DoD still holds without a non-critical issue and a real DoD-bearing home exists, reparent it *out* in one pass, logged (cut + rehome together); never cancel/delete — lost scope stays forbidden. See **Cutting non-spine scope out of an MVP (rehome, never delete)**.
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
- At `high` appetite, mutations are limited to: creating tickets, moving status (never to Done/Cancelled), reordering queues, reparenting a gating chain into the gated stream, and — on a human-confirmed DoD-still-satisfied judgement — reparenting a non-critical issue *out* of an MVP into a real DoD-bearing home (never cancel/delete) (all per the gateway topology-write-authority dial). All mutations logged.
