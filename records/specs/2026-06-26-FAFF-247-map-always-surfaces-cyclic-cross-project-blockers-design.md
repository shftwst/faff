# Spec — Map always surfaces cyclic + cross-project blockers (FAFF-247)

> Spec: faffter-dark-nlspec · 2026-06-26 · autonomous · confidence: high. Full spec on Linear FAFF-247.

This is the buildable spec for FAFF-247, addressing a diagnostic gap in `/faff-map` (`plugin/skills/faff-map/SKILL.md`). Audience: the build agent editing the skill prose, and the human reviewer checking that the fix closes the "chain reported fine while a cycle exists" hole. This is a **skill-prose change only** — no CLI code, no new detection algorithm.

## 1. WHY — Problem and Principles

**The load-bearing model.** Dependency-graph cycle and ghost-project detection is **not** owned by `/faff-tidy`. It is a **mandatory floor of the `methodology` slot's `backlog-diagnostics` named output**, which *always fires* and which `/faff-map` is already a declared caller of (gateway → **The `methodology` slot**, named-output table: "`backlog-diagnostics` | faff-tidy, faff-wtf, faff-map | Always fires | … Mandatory floor: dependency-graph detection of cycles and ghost-project pointers"). The fix is therefore not "give map its own Tarjan walk" — it is "make map *request the detection it is already entitled to* instead of waiting for a tidy run to have happened."

**Problem statement.** Today map's Phase 7 only computes initiative-*description*-side ghost detection itself and otherwise **cross-references a tidy log if one exists this pass**; when no tidy ran it prints "No tidy this pass — issue-side ghost-pointer detection skipped" and surfaces **no** blocker-graph cycle findings at all. The pain: map's Phase 4 join-up summary can confidently say "Yes, the chain joins up" while a cyclic or cross-project blocker silently breaks it — a coherence report the human trusts is wrong. This change makes map source cycle + cross-project-blocker detection from the always-firing `backlog-diagnostics` output, so the risk is surfaced on every pass regardless of whether tidy ran.

**Design principles.**

- **Reuse the always-fires floor; never re-implement detection.** Map must obtain cycles + ghost pointers by requesting `backlog-diagnostics` from the configured `methodology` slot (which always resolves — the structural default supplies the graph floor when no slot is set), not by carrying a second copy of the Tarjan walk. The skill's own Phase 7 already states the intent "without re-implementing detection here" — this spec honours it by routing through the methodology contract rather than the tidy *run*.
- **No new fetch.** `backlog-diagnostics` operates on the active-issue graph map already pulls in Phase 1 (every initiative → project → issue → blocker link). Requesting it adds analysis over data already in hand, not a new tracker round-trip.
- **Orchestration may surface graph facts directly.** Detecting cycles and noting `blocks N` / `blocked by N` are **objective graph facts the orchestration layer may read and render** (gateway → **Ordering & judgement delegation**: "Objective graph facts are not opinions… detecting cycles… are facts the orchestration layer may read and render"). So map surfacing a cycle is in-contract; it is *ordering by* the graph that would require the methodology — and map does not order here.

**Reference context.**

| System | Role | Relevance |
|---|---|---|
| `plugin/skills/faff-map/SKILL.md` (Phase 7, Phase 4) | the file changed | Phase 7 holds the defer-to-tidy prose; Phase 4 holds the join-up summary that must stay consistent with detected cycles. |
| `plugin/skills/faff/SKILL.md` (gateway) | contract source | Defines `backlog-diagnostics` as always-fires with a mandatory cycle/ghost floor, and names map a caller. |
| `plugin/skills/faff-tidy/SKILL.md` (§5 Structural diagnostics) | sibling caller | The pattern to mirror: tidy already requests `backlog-diagnostics` from the methodology slot rather than owning detection. |
| `faffter-noon-methodology-structural` / `faffter-dark-methodology-agile-delivery` | detection owner | The slot that performs the Tarjan/DFS cycle walk; agile-delivery composes the structural floor additively. |

**Scope statement.** This sits in map's Phase 7 (Risks the structure surfaces) and the Phase 4 join-up summary line — the structural-risk surface of the roadmap synthesis, below the strategic horizons and above the per-issue view.

## 2. OUT OF SCOPE

- **A new `faff` CLI cycle/graph subcommand** — Why excluded: detection already lives in the methodology slot's `backlog-diagnostics` (prose-driven Tarjan/DFS today); this ticket reuses it, it does not move detection into the CLI. Extension point: if a deterministic graph primitive is later wanted, it would be a new `faff` subcommand consumed *by* the methodology, not by map directly.
- **Changing tidy's detection or the methodology's detection algorithm** — Why excluded: the floor already exists and is correct; this ticket only changes *who requests it and when*. Extension point: `faffter-noon-methodology-structural`'s `backlog-diagnostics` detection categories.
- **Project-as-deliverable container model (FAFF-245)** — Why excluded: FAFF-247 ships with "value stream = initiative" (the container map already reads in Phase 1); refining container granularity to project-as-deliverable is FAFF-245's job. Extension point: the cross-project-blocker definition in Phase 7 (see the temporal anchor in §6).
- **The routing verdict assignment (`circular-blocked` / `gap-blocked`)** — Why excluded: that is the `routing_adaptor` slot's job, fired from the same `backlog-diagnostics` findings; map is a read-only surfacer and assigns no verdict. Extension point: `faffidavit-routing`.
- **Removing the tidy-log enrichment entirely** — Why excluded: importing a tidy log's *issue-side* findings when one exists this pass is still useful added colour; it just stops being the *sole* source. Extension point: Phase 7's enrichment bullet.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| `backlog-diagnostics` | The methodology slot's always-fires named output; its mandatory floor is dependency-graph cycle detection + ghost-project-pointer detection over the full active-issue graph. |
| Cyclic blocker | A cycle of any length in the active-issue blocker graph (A→B→A; A→B→C→A; longer), as detected by the floor's Tarjan/DFS walk. |
| Cross-project blocker (within a value stream) | A blocker edge whose blocking and blocked issues sit in **different projects under the same value stream** — and, for FAFF-247, **value stream := the initiative** map already reads as its top-level outcome container (Phase 1). |
| Join-up summary | Phase 4's one-line verdict ("Yes, the chain joins up" / "with N discontinuities" / "No — …"). |

**The map ↔ methodology request (interface map already owns).** Map's Phase 1 pulls the active-issue graph; Phase 7 requests named outputs from the methodology slot. This spec adds one request:

```
REQUEST backlog-diagnostics(active_issue_graph)
  RETURNS {
    dependency_cycles: [ { members: [ISSUE-ID, ...] }, ... ],     # floor — always present
    ghost_project_pointers: [ { issue: ISSUE-ID, names: <container> }, ... ],  # floor — always present
    ...  # repeat-parks / splittable / chain-gaps — degradable remainder, rendered if present
  }
```

**Design decision — detection source.** Map sources cycles + ghost pointers from `backlog-diagnostics`, not from a tidy run. **Chosen:** request `backlog-diagnostics` from the configured `methodology` slot every pass (it always resolves to the structural default when unset), and surface its `dependency_cycles` and `ghost_project_pointers` directly in Phase 7. Rationale: the floor always fires and map is already a declared caller; this is the in-contract reuse path with no new fetch and no duplicated Tarjan.

**Design decision — tidy-log role.** **Chosen:** demote the tidy-log cross-reference from *the* source of cycle/issue-side findings to **optional enrichment** layered on top of map's own `backlog-diagnostics` call. If a `.faff/logs/YYYY-MM-DD/HHMMSS-tidy.md` with a `### Structural diagnostics` block exists this pass, import its findings as added colour (and de-duplicate against map's own); if not, map still has full cycle + ghost coverage from its own request. The "No tidy this pass — … detection skipped" degradation is **removed** for cycle detection (it may remain only as an informational note that *issue-side ghost enrichment* is thinner without a tidy log — never as a reason cycles are absent). Rationale: removes the silent-skip hole while keeping the useful cross-skill enrichment.

## 4. HOW — Behavior

**Architecture.** Two edits to `plugin/skills/faff-map/SKILL.md`:

1. **Phase 7 (Risks the structure surfaces)** — rewrite the "Cross-reference with `/faff-tidy`" bullet and delete the "If no tidy ran this pass … detection skipped" degradation, replacing them with: map requests `backlog-diagnostics` from the methodology slot and surfaces `dependency_cycles` + `ghost_project_pointers` (initiative-side *and* issue-side) as risk categories every pass; tidy-log import becomes optional enrichment. Add **cross-project blocker** as an explicit risk category.
2. **Phase 4 (Dependency chain join-up summary)** — make the summary line consistent with detected cycles: a detected cycle in the chain forbids a clean "Yes, the chain joins up".

**Phase 7 behaviour (after change):**

```
PROCEDURE phase_7_risks(active_issue_graph, methodology_slot):
  1. diag := REQUEST backlog-diagnostics(active_issue_graph) from methodology_slot   # always fires
  2. FOR each cycle in diag.dependency_cycles:
       emit risk "Dependency cycle" naming the member issue IDs in order,
         recommend the concrete break action (which blocker edge to cut / re-sequence)
  3. FOR each blocker edge (A blocks B) in active_issue_graph:
       IF project(A) != project(B) AND initiative(A) == initiative(B):
         emit risk "Cross-project blocker within value stream <initiative>"
           naming A, B, their projects, and the gate it threatens
  4. emit ghost-project risks from diag.ghost_project_pointers (issue-side)
       AND map's own initiative-description-side ghost scan (unchanged), de-duplicated
  5. IF a tidy log with a Structural diagnostics block exists this pass:
       import + de-duplicate its findings as enrichment (optional)
     ELSE:
       (no cycle/ghost gap — map already has full coverage from step 1;
        at most note that issue-side ghost *enrichment* is thinner without a tidy run)
  6. emit the existing methodology horizon-assignment findings + remaining structural categories
```

**Phase 4 consistency (after change):**

```
PROCEDURE phase_4_summary(chain, dependency_cycles):
  IF any cycle in dependency_cycles touches issues on the rendered chain:
    summary := "No — a dependency cycle breaks the chain: <member IDs>"   # never "joins up"
  ELSE IF discontinuities > 0:
    summary := "Yes, with N visible discontinuities"
  ELSE:
    summary := "Yes, the chain joins up"
```

**Edge cases.**

- **No methodology slot configured** — the slot resolves to `faffter-noon-methodology-structural`, whose `backlog-diagnostics` supplies the cycle/ghost floor; coverage is unchanged from configured. Map never degrades to "skipped".
- **No cycles, no cross-project blockers, no ghosts** — Phase 7 surfaces none in those categories; per the existing skill rule this is a noteworthy clean state and is called out in the TL;DR ("no structural risks surfaced this pass"). Not an error.
- **Cycle entirely outside the rendered chain** — still surfaced as a Phase 7 risk (it is a real backlog defect), but the Phase 4 join-up line is only forced to "No" when a cycle touches issues *on the chain it drew*.
- **Cross-project blocker where the two projects are under different initiatives** — that is a *cross-initiative* edge, already handled by Phase 5's gate analysis (`Initiative X → Initiative Y`); the new category is specifically *within one* value stream, so it does not double-report.

**Failure modes.**

- **The failure:** the methodology returns `dependency_cycles` but map renders Phase 4 from a stale or separately-derived chain, so a cycle is listed in Phase 7 yet Phase 4 still says "joins up" — the exact inconsistency this ticket exists to kill, reintroduced. **How you'd know:** a run where Phase 7 lists a cycle and Phase 4 says "Yes, the chain joins up" in the same output. **What it means:** Phase 4 must read the *same* `dependency_cycles` list (step 1's `diag`), not re-derive — wire the consistency check to the single diagnostics result.
- **The failure:** "value stream = initiative" under-reports once project-as-deliverable (FAFF-245) lands and the real value-stream container is finer/coarser than an initiative. **How you'd know:** after FAFF-245, a cross-project blocker within a deliverable-container but across initiatives (or vice-versa) is mis-bucketed. **What it means:** narrow — revisit the cross-project definition per the §6 temporal anchor; non-blocking for this ticket.

**Anti-pattern:** giving map its own second Tarjan implementation. Why: detection is the methodology floor's job; a duplicate walk drifts from tidy's and re-creates the "two sources, inconsistent answers" class of bug this fix removes.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a backlog with a blocker cycle (A→B→A) and no /faff-tidy run this pass
When /faff-map runs
Then Phase 7 surfaces the cycle naming A and B as a risk
 And Phase 4's join-up summary does not say "the chain joins up"
```

```
Given two issues in different projects under the same initiative where one blocks the other
When /faff-map runs
Then Phase 7 surfaces a "cross-project blocker within value stream <initiative>" risk
     naming both issues, their projects, and the gate it threatens
```

```
Given a backlog with no cycles, no cross-project blockers, and no ghost pointers
When /faff-map runs without a tidy run this pass
Then map does NOT print "No tidy this pass — … detection skipped" as a reason cycles are absent
 And the clean state is noted in the TL;DR
```

Non-functional assertion: map's cycle/ghost coverage is identical whether or not `/faff-tidy` ran in the same pass (tidy-log import only adds enrichment, never the only source).

## 6. DESIGN DECISION RATIONALE

**Should map own the Tarjan walk, or always trigger tidy's diagnostic?** (the ticket's first open question)
- *Option A — map owns its own Tarjan walk.* Cons: duplicates detection, drifts from tidy/methodology, contradicts the skill's own "without re-implementing detection here".
- *Option B — map force-triggers a tidy run.* Cons: heavyweight side-effect, couples a read-only strategic view to a grooming pass, still indirect.
- *Option C — map requests `backlog-diagnostics` from the methodology slot directly.* Pros: the output always fires, map is already a declared caller, no new fetch, no duplicate walk, no tidy coupling.
- **Chosen:** Option C — request `backlog-diagnostics` from the configured methodology slot every pass and surface its cycle + ghost findings directly. It is the in-contract path the gateway already sanctions.

**What is the tidy log's role now?**
- **Chosen:** optional enrichment only — import a tidy `### Structural diagnostics` block when present this pass and de-duplicate, but never depend on it for cycle/ghost coverage. The "no tidy this pass → skipped" degradation is removed for cycle detection.

**Definition of "cross-project blocker within a value stream"** (the ticket's second open question)
- **Chosen:** a blocker edge whose endpoints are in different projects under the **same initiative**, with **value stream := initiative** — the top-level outcome container map already reads in Phase 1. Rationale: it is concrete and buildable today against structure map already holds; it does not wait on FAFF-245. *Temporal anchor:* at the time of writing, project-as-deliverable (FAFF-245, related) has not landed; when it does, revisit whether the value-stream container should be the deliverable rather than the initiative (see §2 OUT OF SCOPE and the §4 failure mode). This is a forward refinement, not a blocker.

**Phase 4 / Phase 7 consistency.**
- **Chosen:** Phase 4's join-up summary reads the same `dependency_cycles` result Phase 7 surfaced; a cycle touching the rendered chain forbids "joins up". Rationale: the whole point of FAFF-247 is that the chain can no longer be reported "fine" while a cycle exists.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none blocking. (Both open questions the ticket raised are resolved above as Chosen decisions; the FAFF-245 container-granularity refinement is a documented forward note, not a punt that blocks this build.)

**Assumptions:** none load-bearing beyond the methodology contract the gateway already fixes (`backlog-diagnostics` always fires with the cycle/ghost floor). Validation: the build agent confirms the gateway's named-output table still lists `backlog-diagnostics` as always-fires with the mandatory cycle/ghost floor, and that `faffter-noon-methodology-structural` answers it, before editing the skill.

## 8. DONE — Definition of Done

### From WHY
- [ ] Running `/faff-map` without `/faff-tidy` in the same pass surfaces a cyclic blocker (a cycle in the active-issue blocker graph) as a Phase 7 risk.
- [ ] Map no longer omits cycle detection when no tidy ran; the "No tidy this pass — … detection skipped" text no longer gates cycle/ghost coverage.

### From WHAT (detection source)
- [ ] Map's Phase 7 obtains cycles + ghost pointers by requesting `backlog-diagnostics` from the configured `methodology` slot (always-resolves), not from a tidy run.
- [ ] The tidy-log cross-reference is present only as optional, de-duplicated enrichment.

### From HOW (cross-project blocker)
- [ ] A blocker edge whose endpoints are in different projects under the same initiative is surfaced as a "cross-project blocker within value stream <initiative>" risk, naming both issues and their projects.
- [ ] The cross-project definition carries the FAFF-245 temporal-anchor note.

### From HOW (Phase 4 consistency)
- [ ] When a detected cycle touches issues on the rendered chain, Phase 4's join-up summary does not say "the chain joins up".
- [ ] Phase 4 reads the same `dependency_cycles` result Phase 7 surfaced (no re-derivation).

### From HOW (edge cases)
- [ ] With no cycles / cross-project blockers / ghosts, Phase 7 surfaces none in those categories and the clean state is noted in the TL;DR.
- [ ] Coverage is identical with or without a tidy run in the same pass.

**Integration smoke test:**

```
GIVEN a fixture backlog with one A→B→A cycle and one cross-initiative-same-value-stream blocker
WHEN /faff-map runs with no tidy this pass
THEN Phase 7 lists both the cycle and the cross-project blocker
 AND Phase 4 does not report "the chain joins up"
```

confidence: high
