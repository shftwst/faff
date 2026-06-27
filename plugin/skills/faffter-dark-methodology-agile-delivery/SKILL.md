---
name: faffter-dark-methodology-agile-delivery
description: "Agile-delivery `methodology` lens — answers backlog/build named-outputs through seven delivery principles (right-sizing, value-by-risk sequencing, surfaced deps). Opinionated alternative to the structural default. Runs as a configured slot, not the user `/` menu."
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
| `pick-ordering` / `build-queue` | 2 (value × risk, sharpened to incremental end-user value), 7 (risk-aware) — override structural priority+unlock when materially different; **re-home a value stream's gating chain into that stream's order** (see **Re-homing gating chains into the stream they gate**) |
| `promotion-readiness` | 4 (right-sized), 6 (surfaced deps) |
| `backlog-diagnostics` | Composes the structural default for the mandatory graph floor (cycles + ghost-projects), then adds principle findings: 1 (outcome-named), 4, 5 (cohesive), 6 |
| `standup-digest` | 3 (WIP cap — humans only), plus top findings from 1, 5, 6, 7 |
| `horizon-assignment` | 2, 7 to re-sequence within horizons; 1, 5, 6 in the risk view |
| `issue-critique` | per-issue: 4 (right-sized / split / merge), 1 + 5 (workstream fit), 6 (surfaced deps), 7 (risk profile → de-risking spike) |
| `crank-up-set` | **Composes** `faffter-noon-methodology-structural`'s `crank-up-set` slice algorithm for the graph walk + frontiers, then **re-ranks** the returned sets by 2 (value × risk) and 7 (risk-aware), trimming to the thinnest coherent slice (MVP, principle 4). Does not re-implement the walk. Appetite per-level: low = solo safe roots; full = deepest runway. |
| `prdr-author` | **Composes** the structural baseline's `prdr-author` field derivation, then **scales the DoD by the agile lens**: 4 (right-sized — the thinnest coherent done-bar for the target, MVP cut over exhaustive coverage), 2 + 7 (value × risk — the DoD's done-criteria are the highest-value increment the target funds, de-risked first). Does not re-author from scratch — composes the structural fields and re-frames the `definition_of_done` ambition. |
| `yagni-judge` | Proposes the upper-gate Phase-1 `{serves_goal, within_scope, verdict, reason}` through the value lens: 2 + 7 (value × risk — does this PRDR earn its keep for the goal it cites?), 4 (right-sized — MVP cut, so *exceeding* the goal reads as `within_scope: false`). The agile lens is the natural YAGNI judge (it owns the MVP/bet call). It **proposes, never admits** — the adversarial skeptic challenges it (Phase 2) and `faff prdr yagni` arbitrates conservatively. |

The WIP cap (principle 3) applies to `standup-digest` only — never to `build-queue` (autonomous work is unbounded).

**Recursive `ticket-shaping` (`shape-level` supplied by `/faff-plot`).** When a request carries a `shape-level`, apply the same principle lens at the requested altitude, shaping only that node's children:

- `initiative` — outcome-named initiatives (principle 1), not activity buckets.
- `project` — shippable increments under one initiative, sequenced by value × risk (2 + 7); the thinnest viable slice is the first project.
- `epic` — right-sized first-slice epics (principle 4) for one project, hidden dependencies surfaced as explicit blocker links (6).

`/faff-plot` owns the stop rule (first-slice epics, never the leaves below); this skill shapes the level it's asked for. Absent a `shape-level`, the single-level brief→tickets behaviour is unchanged (what `/faff-jot` uses).

**Target-scaled `prdr-author`.** Composes the structural baseline's field derivation (gateway → **The `methodology` slot**; `faffter-noon-methodology-structural` → `prdr-author`), then scales the `definition_of_done` through the lens — the agile cut is the **thinnest coherent done-bar the target funds**, highest-value increment first, de-risked early (principles 4 + 2 + 7), not the structural "all children delivered" sum. A **thin-MVP** target ⇒ the minimal shippable outcome slice; a **finished** target ⇒ the full value the container promises. It **authors but never admits** (admission is the caller's level — gateway → **Authored-PRDR level-scaling**) and re-reads any human-set DoD first, never clobbering it (gateway → **Manual changes are authoritative (`prdr-author`)**). Low confidence ⇒ a thin DoD flagged needs-human, never a vacuous L4 self-define.

## Re-homing gating chains into the stream they gate

A **value stream** is a container (project / initiative) carrying a machine-readable **Definition of Done** — a deliverable, not just a bucket. Re-homing targets these deliverables. Two cases, kept distinct: when the grouping **surfaces** DoD presence, a bare container with *no* Definition of Done is not a value stream and is skipped; until the input envelope surfaces that marker, the lens can't tell deliverable from bucket, so it falls back to the project/initiative grouping as the stream unit and **names the container in every finding** so a human can discount a non-deliverable boundary (step 1).

The agile lens sequences a *set* of tickets, but a value stream is only **done** when work *outside* the set that blocks it also ships. `pick-ordering` and `build-queue` therefore **re-home** a stream's gating chain into the stream's own order, so a stream that looks sequenced but is silently stuck on a cross-container blocker surfaces that blocker as its next actionable pickup instead of leaving it stranded in its home container.

- **Gating blocker** — a ticket *outside* the stream that the stream's tickets are `blockedBy`, directly or transitively, and which must ship for the stream to complete.
- **Gating chain** — the transitive `blockedBy` chain outside the stream, from the stream's direct blocker down to the deepest unstarted prerequisite.
- **Re-home (verb)** — sequence that chain *within* the gated stream's order, deepest-first, rather than leaving it ordered only inside its home container.
- **Increment** — the thinnest set of work that lights up one observable unit of end-user value, possibly spanning multiple structural slices.

**How the lens re-homes when answering `pick-ordering` / `build-queue` for a stream:**

1. Identify stream membership from the workstream grouping it is handed. When the grouping surfaces DoD presence, a stream is a Definition-of-Done-bearing deliverable and a bare container is skipped; until it does, fall back to the project/initiative unit as the stream and name the container in the finding (so a non-cohesive, activity-named boundary is visible, not silently trusted).
2. Walk `blockedBy` transitively *outward* from the stream's tickets toward the deepest unstarted prerequisite, stopping at the **deepest actionable** one. Defer cycles to the composed structural baseline's cycle detection — never order through a cycle (it surfaces as the existing `circular-blocked` diagnostic). A link that is externally blocked or otherwise not actionable stops the walk and is named as a dead-end (the deepest actionable prerequisite is the last reachable one before it).
3. Fold each chain member not already sequenced ahead for another stream into this stream's order, deepest-first — the deepest actionable prerequisite before the work it gates.
4. Emit a **principle-6** finding naming the chain, the gated stream, the deepest actionable prerequisite, and any dead-end.
5. Order the combined set by **incremental end-user value** (principle 2), risk-aware (principle 7) — sequence to light up each increment, crossing structural slices as needed.

**Why transitive, not direct-only.** Pulling only the *direct* blocker leaves its own blocker stranded — the direct blocker can't be picked up, so the stream still can't complete while *looking* sequenced. Walking to the deepest unstarted prerequisite surfaces the real next pickup.

**A blocker that gates two streams** is sequenced **once**, at the earliest position any gated stream needs it — never duplicated into both orders (duplicating misreports WIP and double-counts).

**Re-homing is a sequencing view, not a mutation.** It changes only the order the lens *presents*; it never reparents a ticket, rewrites its container, or edits blocker links. faff-beep-boop's conflict-analysis consumes the presented order downstream and still owns concurrent-safety serialisation — it only adds serialisation constraints, never reorders — so the two compose without contradiction and re-homing adds no ordering logic to any orchestration skill. Appetite floor: at low/medium, re-homing is surfaced as a finding and a reordered *view* only; only high/full reorders the actual build queue, and even then never reparents.

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

This skill reads the suite-wide `appetite` setting from `.faffrc`. Appetite governs how much this skill acts vs. surfaces:

**low — surface only.**
- All findings are informational. No tracker mutations. No reordering.
- The human reads, decides, acts.
- Equivalent to "show me what you'd recommend but don't touch anything."

**medium — surface + limited action.**
- Findings are surfaced with recommended actions.
- Chain-gap tickets auto-created (when the gap is unambiguous).
- Build-queue ordering informed by methodology but doesn't override explicit priority.
- No auto-splits, no reprioritisation, no demotions.

**high (default) — surface + act.**
- **Auto-split** oversized tickets (principle 4) — creates the sub-tickets, links them, logs the action. Never deletes the parent.
- **Reorder** build queues by value x risk x deps (principles 2 + 7) — overrides structural ordering when materially different, including **re-homing** a value stream's gating chain into its order (see **Re-homing gating chains into the stream they gate**). Re-homing reorders the presented queue only; it never reparents.
- **File prerequisite/follow-up tickets** for surfaced dependencies (principle 6) — Backlog, tagged `faff-methodology-fill`.
- **Flag stalled work for demotion** — issues stuck In Progress with no commits for N days get surfaced with a demotion recommendation. At high appetite, the demotion executes (In Progress → Backlog) with a tracker comment explaining why.
- Every action is documented: tracker comment on the affected issue, log entry in `.faff/logs/`.

**full — complete autonomy.**
Everything `high` does, plus:
- **Auto-merge** always-ship-together tickets (principle 4) — combines them into one, links the originals as "merged into", logs the action.
- **Reparent** misplaced tickets — moves tickets to the workstream where they belong based on outcome alignment (principle 5).
- **Demote without flagging first** — stalled work demotes immediately (In Progress → Backlog) rather than flagging then waiting a cycle.
- **Methodology owns sequencing entirely** — explicit priority is an input signal, not a veto. Value x risk x deps determines the order.
- **Resolve all methodology findings in a single pass** — no "surface now, act next run" cycle. Findings are acted on in the same invocation they're detected.
- Still logs every action. Still never cancels or deletes.

**What no appetite level does:**
- Cancel, delete, or reduce scope (irreversible).
- Override user-explicit "ask first" rules.
- Skip adversarial review.
- Act without evidence (every action traces to a principle + observable tracker state).

## Rules

- Findings must be grounded in observable tracker state — not speculation about intent or future plans.
- Each finding must name the specific issues/workstreams involved (by tracker ID + descriptive gloss).
- Findings that repeat across runs without human action are surfaced at most once per `/faff-wtf` invocation — don't nag.
- This skill is **additive over the structural baseline, not a from-scratch replacement of it.** For `backlog-diagnostics` it composes `faffter-noon-methodology-structural` for the mandatory graph floor (cycle + ghost-project detection that feeds the `circular-blocked` / `gap-blocked` routing verdicts — see the gateway → **The `methodology` slot** swap-floor clause), then layers its seven-principle findings on top. It does not re-implement or override structural's graph detection, chain gaps, stale blockers, or dupes.
- At `low` and `medium` appetite, this skill is **read-only** — it never mutates tracker state.
- At `high` appetite, mutations are limited to: creating tickets, moving status (never to Done/Cancelled), reordering queues. All mutations logged.
