# Spec — FAFF-246: Agile sequencing pulls blocking work into the value stream it gates

> Spec: faffter-dark-nlspec · 2026-06-27 · interactive · confidence: high. Full spec on Linear FAFF-246.

> **Revised 2026-06-27** — re-prepped after FAFF-245 (project-as-deliverable / PRDR mechanic) shipped. The three open Punts (Q1 pull-depth, Q2 FAFF-215 interaction, Q3 stream-definition) are now closed; see §6 and §7. No build-blocking open questions remain.

This is the build spec for **FAFF-246**, a tuning change to the agile-delivery methodology lens (`plugin/skills/faffter-dark-methodology-agile-delivery/SKILL.md`). Audience: the build agent editing that skill's prose. The change is **prose-only** — a methodology slot skill, no code.

## 1. WHY — Problem and Principles

**The load-bearing model.** A *value stream* is the set of tickets that together ship one user-facing outcome — concretely, a container (project/initiative) carrying a PRDR with a `## Definition of done` (the FAFF-245 deliverable primitive). The agile lens already sequences a *given set* of tickets by value × risk (principles 2 + 7), but it treats the set as fixed input. The mechanism this spec adds: when a ticket *outside* a stream **blocks** that stream's completion, the lens **pulls that blocker (and the transitive chain behind it) into the stream's ordering** — sequencing the deepest unstarted prerequisite as the stream's next actionable pickup — instead of leaving it stranded in its home project where stream-local ordering never reaches it.

**Problem statement.** Today `pick-ordering`/`build-queue` order within a set and surface deps as blocker links (principle 6), but a cross-project blocker on a stream stays in its own project's ordering — so the stream looks sequenced yet silently can't complete. This change re-homes the gating chain into the stream it gates, and sharpens ordering toward lighting up each *increment* of end-user value across whatever structural slices it needs.

**Why transitive, not direct-only.** Direct-blockers-only re-homing pushes the silent-stuck failure one hop deeper: if stream ticket `S1` is `blockedBy B` and `B` is itself `blockedBy C` (both outside the stream), pulling only `B` to the front leaves `C` stranded — `B` can't be picked up, so the stream still can't complete, while *looking* sequenced. Pulling the full transitive chain surfaces `C` (the deepest unstarted prerequisite) as the real next pickup. In-queue chains of any depth are already serialised without parking by FAFF-215 conflict-analysis; this change is specifically about **cross-boundary** gating that stream-local ordering never reaches.

**Design principles (governing constraints):**

- **Ordering opinion stays in the methodology slot.** Per the gateway *Ordering & judgement delegation*, orchestration skills (beep-boop/wtf/map) hold no ordering opinion. This change lives **entirely** in the agile methodology skill's `pick-ordering`/`build-queue` outputs — it must add no ordering logic to any orchestration skill. *An implementation that pushes re-homing into beep-boop is wrong by construction.*
- **Re-homing is a sequencing view, not a tracker mutation.** Pulling a chain into a stream's order changes how the lens *orders and presents* work; it must not reparent tickets, rewrite projects, or mutate blocker links at low/medium appetite (the skill is read-only there).
- **Don't double-serialise.** beep-boop conflict-analysis already serialises spec-referenced in-queue deps (FAFF-215). Re-homing changes the *presented order*; conflict-analysis consumes that order downstream and still owns concurrent-safety serialisation. They compose by construction (see HOW → Edge cases).

**Reference context:**

| System | Form | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-methodology-agile-delivery/SKILL.md` | Skill prose | The sole change surface — `pick-ordering`/`build-queue` rows + principles 2/6/7 |
| `faffter-noon-methodology-structural` | Skill prose | Composed baseline; provides graph facts (dependents, cycles) this builds on |
| FAFF-245 (Done) | Shipped primitive | The PRDR / project-as-deliverable record (`faff prdr`) carrying a machine-readable `## Definition of done`. Defines what a "value stream" concretely is |
| FAFF-215 (Done) | Shipped behaviour | beep-boop conflict-analysis in-queue dep serialisation this composes with (downstream of the lens's ordering) |

**Scope statement.** This sits in the `methodology` slot's ordering outputs — it changes *how the agile lens orders work it is handed*, nothing upstream of that.

## 2. OUT OF SCOPE

- **Building the value-stream / deliverable primitive** — *Why excluded:* FAFF-245 already shipped it (the PRDR record + per-container `## Definition of done`). This ticket *consumes* that definition; it does not extend the PRDR mechanic. *Extension point:* the `faff prdr` CLI and its record schema.
- **Enriching the methodology input envelope to carry per-container DoD/PRDR presence** — *Why excluded:* the lens identifies streams from the workstream grouping it already receives; surfacing explicit DoD/PRDR presence into that grouping is a separate envelope change (see the Assumes in §7). *Extension point:* the caller-supplied "workstream grouping" input documented in the gateway → *The `methodology` slot* envelope.
- **Changes to beep-boop conflict-analysis serialisation** — *Why excluded:* FAFF-215 owns that mechanism; this change feeds it a re-homed *order* but never alters its serialisation. *Extension point:* the conflict-analysis partition step in `faffter-noon-concurrency-*` / beep-boop.
- **Tracker mutation of blocker links / reparenting** — *Why excluded:* re-homing is an ordering view; structural link edits are principle-6 territory at high+ appetite already. *Extension point:* existing principle-6 high-appetite "file prerequisite ticket" behaviour.
- **Orchestration-skill ordering logic** — *Why excluded:* gateway tenet keeps ordering in the methodology. *Extension point:* none — deliberately forbidden.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Value stream | The set of tickets that together ship one user-facing outcome — concretely, a container (project/initiative) carrying a PRDR with a `## Definition of done` (FAFF-245). The lens identifies a stream from the workstream grouping it is handed; a bare structural container with no deliverable identity is **not** a value stream. |
| Gating blocker | A ticket, *outside* a stream, that the stream's tickets are `blockedBy` (directly or transitively) and which must complete for the stream to ship. |
| Gating chain | The transitive `blockedBy` chain, outside the stream, that must complete before the stream can ship — from the stream's direct blocker down to the deepest unstarted prerequisite. |
| Re-home (verb) | Sequence a gating blocker (and the chain behind it) *within* the gated stream's pick-order — deepest-first, so the next actionable prerequisite is the stream's next pickup — rather than leaving it ordered only inside its home project. |
| Increment | The thinnest set of work that lights up one observable unit of end-user value, possibly spanning multiple structural slices. |

**The ordering outputs affected.** `pick-ordering` (the general "order this set" answer) and `build-queue` (beep-boop's build order). Both gain the re-homing rule and the sharper incremental-value rule. The named-output envelope and signature are unchanged — same inputs (issues, state, sequencing, workstream grouping, dependency graph), same structured-findings shape.

**Design decision — what defines "the stream" for re-homing? `Chosen:`** a value stream is a container (project/initiative) carrying a PRDR with a `## Definition of done` (the FAFF-245 deliverable primitive) — *rationale:* FAFF-245 shipped the concrete deliverable record, so "stream" is no longer undefined; gating re-homing on a real deliverable identity (rather than any project boundary) is what kills the "arbitrary activity-named boundary" failure mode below. The lens reads stream membership from the workstream grouping it already receives; where that grouping does not yet surface DoD/PRDR presence, it falls back to the project/initiative as the stream unit and names the container in its finding (see §7 Assumes). Was Q3.

**Design decision — pull depth. `Chosen:`** transitive — walk the full gating chain and surface the deepest unstarted prerequisite as the stream's next pickup — *rationale:* direct-only reintroduces the silent-stuck failure one hop deeper (a blocked direct blocker masks its own blocker). Stop conditions: defer cycles to the composed structural baseline's existing cycle detection (never order through a cycle), and stop following a link that is externally blocked / not-actionable, **naming that dead-end in the finding** so a human sees where the chain stalls. Was Q1.

## 4. HOW — Behavior

**Overview.** The edit augments the `pick-ordering`/`build-queue` rows of the outputs table and the principle-2/6/7 prose so the lens, when ordering a stream, first identifies that stream's transitive gating chain and folds it into the stream's order ahead of the work it gates (deepest-first); and orders the remainder to maximise incremental end-user value.

**Re-homing procedure (conceptual — the lens applies this when answering `pick-ordering`/`build-queue` for a stream):**

```
PROCEDURE order_stream(stream, all_issues, dep_graph):
  1. Identify stream membership from the workstream grouping (see §3 stream-definition):
     a value stream is a container carrying a PRDR/DoD; fall back to the
     project/initiative unit where DoD presence isn't surfaced.
  2. Build the gating chain: walk blockedBy transitively from stream tickets
     OUTWARD (tickets NOT in `stream`), to the deepest unstarted prerequisite.
     - Defer cycles to the structural baseline's cycle detection — never walk
       through a cycle; surface it as the existing `circular-blocked` diagnostic.
     - Stop following a link that is externally blocked / not-actionable;
       record it as a named dead-end in the finding.
  3. For each chain member not already sequenced ahead in another stream:
     a. Fold it into `stream`'s order, deepest-first (the next actionable
        prerequisite ordered before the work it gates).
     b. Emit a principle-6 finding: "ISSUE-X gates stream '[name]' via
        [chain]; sequenced as part of the stream so the stream can complete
        (deepest actionable: ISSUE-Z[; dead-ends at ISSUE-W: <reason>])."
  4. Order the combined set by incremental end-user value (principle 2),
     risk-aware (principle 7) — sequence to light up each increment, crossing
     structural slices as needed.
  5. Return the ordered list + findings.
```

**Behaviour summary.** A stream that was "sequenced but stuck" (its gating chain stranded elsewhere) now surfaces the deepest actionable prerequisite as the stream's next pickup, with a finding naming the chain and any dead-end.

**Edge cases:**

- **A blocker gates two streams. `Chosen:`** sequence it once, at the earliest position any gated stream needs it; do not duplicate it into both orders — *rationale:* a blocker shipped once unblocks all its streams; duplicating it would misreport WIP and double-count.
- **Interaction with FAFF-215 conflict-analysis. `Chosen:`** re-homing changes the *presented* pick-order/build-queue the lens returns; beep-boop conflict-analysis consumes that order downstream and continues to own concurrent-safety serialisation (collision groups) at dispatch — *rationale:* conflict-analysis is methodology-agnostic and "never an ordering opinion" (it only *adds* serialisation constraints, never reorders by value), so it cannot disagree with the lens's order — it serialises *within* it. Re-homing feeds the order; conflict-analysis serialises that order. FAFF-215 gets no new contract or knob. Was Q2.
- **Cyclic blockers.** Defer to the composed structural baseline's existing cycle detection — re-homing never creates an order through a cycle; a cycle surfaces as the existing `circular-blocked` diagnostic, unchanged.
- **Dead-ended chain link.** A chain link that is itself externally blocked / not-actionable stops the walk at that link; the finding names it so a human sees where the chain stalls rather than the lens silently presenting an unpickable order.
- **Appetite floor.** At low/medium the re-homing is surfaced as a finding + reordered view only (read-only, consistent with the skill's existing appetite ladder). Only high/full may act on it (reorder the actual build queue) — and even then no reparenting.

**Failure modes:**

- **The failure:** re-homing into a container that isn't a real deliverable produces orders that look authoritative but aren't outcome-cohesive. **How you'd know:** findings cite "stream '[project name]'" where the project is activity-named (principle-1 smell) rather than an outcome. **What it means / mitigation:** narrowed by the §3 stream-definition — re-homing targets deliverable-bearing containers (PRDR/DoD); a bare structural container is not a stream. Where DoD presence isn't yet surfaced in the grouping, the principle-6 finding names the container so the non-cohesive case is visible, not silent.
- **The failure:** re-homing and conflict-analysis serialisation dispatch in different orders. **How you'd know:** the build-queue order shown differs from dispatch order in a run log. **What it means / mitigation:** resolved by the §4 edge-case contract — conflict-analysis consumes the lens's order and only adds serialisation, never reorders; so the dispatch order is the re-homed order plus safety constraints, never a contradiction.

**Anti-pattern:** putting re-homing logic in beep-boop or `faff next`. Why: violates the gateway ordering-delegation tenet; ordering opinion must stay in the methodology slot.

## 5. SCENARIOS

```
Given a value stream S whose ticket S1 is blockedBy ticket B in another project,
  and B is blockedBy C, and neither B nor C is sequenced within any stream's pick-order
When the agile lens answers pick-ordering / build-queue for S
Then C (the deepest actionable prerequisite) appears first, then B, then S1,
  with a principle-6 finding naming the chain C -> B as S's gating chain
```

```
Given a blocker B that gates two streams S and T
When the lens orders both
Then B appears exactly once, at the earliest position either stream requires it
```

```
Given a stream S gated by chain B -> C where C is externally blocked / not-actionable
When the lens orders S
Then the walk stops at C and the finding names C as the dead-end with its reason,
  rather than presenting an unpickable order as if it were ready
```

Non-functional assertion: *the re-homing change adds no ordering logic to any orchestration skill (beep-boop/wtf/map/`faff next`) — those files are untouched by this ticket.*

## 6. DESIGN DECISION RATIONALE

**Where does re-homing live?** Options: methodology slot vs orchestration. **Chosen:** methodology slot only — *rationale:* gateway *Ordering & judgement delegation* makes ordering opinion the methodology's exclusively; orchestration renders what it returns.

**How is a multi-stream blocker sequenced?** Options: duplicate per stream / sequence once at earliest need. **Chosen:** once, at earliest need — *rationale:* avoids double-counting and WIP misreporting.

**Re-homing as view vs mutation?** Options: reparent the ticket / order-only view. **Chosen:** order-only view (no reparent) — *rationale:* keeps low/medium appetite read-only per the skill's existing contract; structural link edits remain principle-6's high-appetite job.

**Stream definition source (was Q3).** Options: (a) block on a deliverable primitive / (b) tracker project proxy. **Chosen:** the FAFF-245 PRDR/DoD deliverable primitive defines a stream; the lens reads membership from the workstream grouping it receives, falling back to the project/initiative unit where DoD presence isn't surfaced — *rationale:* FAFF-245 shipped the concrete record, so the definition is real, not a proxy guess; gating on a deliverable identity kills the arbitrary-boundary failure mode.

**Pull depth (was Q1).** Options: direct only / transitive. **Chosen:** transitive to the deepest actionable prerequisite, cycles deferred to structural detection, dead-ends named — *rationale:* direct-only reintroduces the silent-stuck failure one hop deeper.

**FAFF-215 interaction (was Q2).** Options: re-homing feeds the conflict-analysis partition / re-homing only changes presented order with conflict-analysis owning serialisation. **Chosen:** the latter — re-homing changes the presented order, conflict-analysis consumes it downstream and owns concurrent-safety serialisation — *rationale:* conflict-analysis is methodology-agnostic and never reorders by value, so it composes with any order the lens hands it without a contradiction or a new knob.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none remaining — Q1 (pull depth), Q2 (conflict-analysis interaction), and Q3 (stream definition) are resolved above. (The deferral disposition's trigger — "re-prep once FAFF-245 ships" — is met: FAFF-245 is Done.)

**Assumptions:**

- **Assumes:** the agile lens has access to the full dependency graph (blockedBy edges) and workstream grouping when answering `pick-ordering`/`build-queue`. *Validate:* confirmed — the gateway → *The `methodology` slot* standard envelope supplies "issues, their state, sequencing, workstream grouping, and the dependency graph."
- **Assumes:** the composed structural baseline's cycle + dependent-count facts remain available to re-home against. *Validate:* confirmed — `faffter-dark-methodology-agile-delivery` composes `faffter-noon-methodology-structural` for the mandatory graph floor (cycles + ghost-projects), per the skill's composition rule.
- **Assumes:** per-container DoD/PRDR presence is *not yet* surfaced in the methodology input envelope, so strict "only DoD-bearing deliverables are streams" gating degrades gracefully to the project/initiative unit (named in the finding) until that envelope enrichment lands. *Validate:* the gateway envelope today lists "workstream grouping" without explicit DoD/PRDR presence; enriching it is out of scope (§2) and tracked as a future extension. The FAFF-245 definition still backs the concept and the principle-6 finding keeps the fallback case visible.

## 8. DONE — Definition of Done

### From WHY
- [ ] `pick-ordering`/`build-queue` prose states that a stream's gating chain is folded into the stream's order ahead of the work it gates (deepest-first), no longer left stranded.
- [ ] Prose adds the sharper incremental-end-user-value ordering rule (order to light up each increment across structural slices).

### From WHAT
- [ ] The `pick-ordering` / `build-queue` rows of the outputs table reference the re-homing + incremental-value rule.
- [ ] Vocabulary for "value stream" (as a PRDR/DoD-bearing deliverable), "gating blocker", "gating chain", "re-home", "increment" is introduced (or expressed inline) before first use, skimmably.

### From HOW (behaviour)
- [ ] A gating chain outside a stream is ordered before the ticket it gates, deepest-first, when the lens orders that stream.
- [ ] A principle-6 finding is emitted naming the chain, the gated stream, the deepest actionable prerequisite, and any dead-end.
- [ ] A multi-stream blocker is sequenced once at earliest need.
- [ ] Re-homing is surface-only at low/medium appetite; acts (reorders the queue) only at high/full; never reparents.

### From HOW (edge cases / constraints)
- [ ] Pull depth is transitive to the deepest actionable prerequisite; cycles defer to existing structural cycle detection (no order through a cycle); a non-actionable link stops the walk and is named as a dead-end.
- [ ] Re-homing changes only the presented order; no logic is added to conflict-analysis, and FAFF-215 gets no new contract/knob (verified beep-boop / concurrency skills untouched).
- [ ] No ordering logic is added to any orchestration skill (beep-boop/wtf/map/`faff next`) — verified those files are untouched.
- [ ] `faff validate-adapters` passes (line caps, dedup, skimmable per docs/reference/skill-authoring.md); no new `FAFF-NN`/`ADR` refs introduced into the edited `SKILL.md` (the spec's ref to FAFF-215/245 belongs in rationale/commit, not the executed prose — `faff lint-refs` must still pass).

### From OPEN QUESTIONS
- [x] Q1 (pull depth), Q2 (conflict-analysis interaction), Q3 (stream definition) resolved during this re-prep — each resolution reflected in the edited rule.

**Integration smoke test:**

```
GIVEN the agile lens is the configured methodology
  AND a stream S with S1 blockedBy out-of-stream B, B blockedBy C
WHEN pick-ordering is requested for S
THEN C precedes B precedes S1 in the returned order, with a gating-chain finding
```

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
