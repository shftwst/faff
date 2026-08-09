# Design spec — FAFF-279: filter blocker edges by live target status (read-side)

> Spec: faffter-dark-nlspec · 2026-07-10 · autonomous · confidence: high. Full spec on Linear FAFF-279.

This is the buildable spec for **FAFF-279**. Audience: the build agent implementing the change, and the human reviewer gating it. The deliverable is almost entirely **skill-prose** edits (plus one fixture + one harness test) — there is no product-code decision function to add, because faff's blocker-graph reasoning lives in the LLM orchestration layer, not the CLI.

## 1. WHY — Problem and Principles

**The load-bearing model.** faff's consumers of the dependency graph read a ticket's raw `blockedBy` list to compute the live picture — who's blocked, how much a ticket unlocks, whether a gate can fire. But trackers never auto-remove a `blockedBy` edge when its target ships. So a raw read counts an edge to an already-**Done** blocker as a live blocker. The fix is one shared rule: **an edge to a terminal target is a satisfied edge — invisible to every read-side blocker computation.**

**Problem statement.** A ticket's `blockedBy` retains edges to blockers that have since shipped (e.g. FAFF-225 carried 6 Done blockers until manually stripped). Nothing enforces a status-filter, so an agent reading raw `blockedBy` over-reports dependency depth, mis-ranks unlock value, and can mis-call gate-fireability. This change makes faff's own synthesis treat a Done/terminal blocker edge as satisfied at read time.

**Design principles** (each would cause rejection of an otherwise-valid implementation):

- **A satisfied edge is not an invisible node.** This is *not* the existing "Ignore cancelled and archived" rule and must not be folded into it. That rule removes the *issue* from every query/count/output — correct for cancelled/archived, wrong for Done. A Done issue stays fully visible (it's surfaced in "Recently Completed", counted, glossed). What this rule removes is only the **edge's blocking force**, for read-side blocker math — the target issue itself is untouched. Conflating the two would make shipped work vanish from briefings.
- **Read-side only; the write-side stays put.** The rule changes how consumers *read* the graph. It must not add, remove, or rewrite any `blockedBy` relation in the tracker. faff-tidy's cancelled/archived auto-strip (write-side) and its "Unblocked" bucket (Done-target strip, deliberately human/log-only) are explicitly out of scope and unchanged.
- **One home, cited everywhere.** Per the skill-authoring standard (deduplicated — shared prose has one home), the rule is stated once in the gateway Shared Rules and *referenced* by each consumer, exactly as they already reference "Ignore cancelled and archived". No consumer restates the detection semantics.
- **Deterministic collapse where a seam already exists; prose where none does.** faff's pure CLI has no tracker access — it cannot read the graph. The single-issue routing case already has a deterministic collapse point: `faff next` consumes a pre-resolved `--blocked` boolean. The rule defines how the agent computes that boolean (and the analogous graph-walk math). It adds **no** graph-ingesting CLI command (see §6).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/SKILL.md` §Shared Rules ("Ignore cancelled and archived", ~L302-320) | Markdown prose | Canonical sibling site; the new rule lands here and its detection block mirrors the cancelled-detection block |
| `plugin/skills/faff/SKILL.md` `faff next` def (~L388-393) | Markdown prose | `--blocked` ← "any open external blocker"; gets a one-clause reference to the new rule |
| `plugin/skills/faff-map/SKILL.md` Phase 1/4/5 | Markdown prose | Fetches blocker links raw; Phase 5 *intends* "fireable if upstream shipped" but enforces nothing |
| `plugin/skills/faffter-noon-methodology-thematic/SKILL.md` `pick-ordering`/`crank-up-set`/`build-queue`/`standup-digest`/`horizon-assignment` | Markdown prose | Unlock-value count + outside-blocker test read blockers with no target-status filter |
| `plugin/skills/faff-wtf/SKILL.md` §5b (~L105) | Markdown prose | "blocked only by the head … versus still gated by other work" — a stale Done edge produces a wrong answer here |
| `plugin/skills/faff/bin/faff` `nextStep`/`cmdNext` (~L5206-5281) | JavaScript | Pure boolean function; consumes `--blocked` as-is. **No change** (confirmation, not edit) |
| `test/fixtures/tracker/sample.json` | JSON | Already carries ISS-A `blockedBy:[ISS-B]`, ISS-B `stateCategory:"completed"` — the exact shape |
| `test/faff-tidy.test.mjs` Scenario B | JavaScript (node:test) | Template for a read-side-consequence harness test at the `faff next` seam |

**Scope statement.** This is a read-side staleness-robustness hardening of faff's own graph-synthesis; it sits under the "Shared Rules" floor every sub-skill obeys, alongside "Ignore cancelled and archived".

## Already shipped against this surface

Autonomous premise-superseded scan (Done tickets in team Faff touching the blocker-graph / sequencing surface). **Premise still holds — proceed.** These are related but do **not** deliver the Done-target read-filter this ticket adds:

- **FAFF-247** (Done) *Map always surfaces cyclic + cross-project blockers* — makes map run cycle/cross-project blocker detection independently of tidy. Adjacent (map reads the blocker graph) but orthogonal: it surfaces *cyclic/cross-project* blockers, not the Done-target satisfied-edge filter. No overlap in the fix.
- **FAFF-246** (Done) *Agile sequencing pulls blocking work into the value stream it gates* — a write/topology re-home of blockers in the agile lens. Different lens, different action (structural re-home, not a read-side status filter).
- **FAFF-292** (Done) *Re-home gating chains structurally* — reparenting gating chains; write-side topology, not read-side edge-filtering.
- **FAFF-113 / FAFF-59** (Done) touch unlock-value / on-hold ranking rendering but neither adds a target-status filter on blocker edges.

None strips or filters a Done-target `blockedBy` edge at read time. The gap FAFF-279 names is real and unfilled.

## 2. OUT OF SCOPE

- **Write-side auto-strip of Done-target edges.** — Excluded: separating edge-hygiene from the "did the blocker deliver / is the dependent ready?" judgement is more design than the low harm warrants (the ticket says so explicitly). — Extension point: a future ticket would extend faff-tidy's "Unblocked" bucket (`faff-tidy/SKILL.md` L58) from log-only to an auto-action, gated on confirming the blocker produced what was needed.
- **faff-tidy's cancelled/archived auto-strip.** — Excluded: it's write-side and already correct for its (narrower) scope. — Extension point: `faff-tidy/SKILL.md` L56/L249.
- **A graph-ingesting CLI command** (`faff blocked-by --targets …` or similar). — Excluded: the pure CLI has no tracker access by deliberate architecture; feeding the whole graph in is disproportionate to a low-priority read-side hardening and duplicates the tracker read (see §6 rationale). — Extension point: if a future need makes a deterministic graph seam worthwhile, `plugin/skills/faff/bin/faff` alongside `nextStep`.
- **Changing `faff next`'s code.** — Excluded: it's already correct in intent (it counts only *open* blockers, and takes the boolean pre-resolved). — Extension point: none needed; the fix is the gateway prose that defines "open".
- **`promotion-readiness`'s "all declared blockers are Done" rule** (`methodology-thematic` L39-44). — Excluded: it already embodies the satisfied-Done semantics (promote *when* blockers are Done). It's cited as prior-art consistency, not edited. (Optional consistency: a build agent/reviewer may add a one-line cross-reference to the new shared rule; not load-bearing.)

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| **Terminal target** | The issue on the far end of a `blockedBy` edge, resolved to a **terminal-complete** state: Done (the tracker's completion category). Cancelled/Archived targets are *also* terminal but are already handled upstream (see below), so the novel scope of this rule is **Done**. |
| **Satisfied edge** | A `blockedBy` edge whose target is a terminal target. It exerts **zero blocking force** on read-side computations — treated as absent, never counted as a live/open blocker, never traversed as a live dependency edge. |
| **Read-side blocker computation** | Any synthesis that reads the blocker graph to derive a live picture: single-issue "is it blocked" (`--blocked`), unlock-value counts (direct + transitive dependents), crank-up-set outside-blocker tests, build-queue admission/serialisation, chain-fireability, "blocked only by the head" render. |
| **Terminal-complete detection** | The category-first, name-fallback resolution of "is this target Done", mirroring the existing cancelled-detection block. |

**The rule (authoritative statement — lands verbatim-ish in the gateway).**

```
RULE "Satisfied blockers (edges to terminal work)":
  FOR any read-side blocker computation over an active issue's blockedBy edges:
    An edge whose target is TERMINAL-COMPLETE (Done) is SATISFIED:
      - it is NOT counted as a live/open blocker,
      - it is NOT traversed as a live dependency edge in an unlock-value
        or crank-up-set walk,
      - the source issue is treated as unblocked BY THAT EDGE.
    (Cancelled/Archived targets are already invisible via "Ignore cancelled
     and archived" — the target node is absent from the active set, so its
     edge is absent too. This rule's novel scope is DONE targets, which stay
     visible as nodes but whose blocking force is spent.)
  NON-EFFECTS (hard boundary):
    - The target issue is NOT hidden, NOT decremented, NOT removed from any
      count/briefing/output. Only the EDGE's blocking force is nulled.
    - NO tracker write. No blockedBy relation is added/removed/rewritten.
```

**Terminal-complete detection (mirrors the cancelled-detection block; category-first, name-fallback).**

```
TERMINAL_COMPLETE(target):
  Linear   -> workflow state in the `completed` state category
              (state object's `type`/`stateCategory` == "completed");
              name-fallback: "Done"
  GitHub   -> issue closed with state_reason == "completed"
              (or the tracked PR merged); NOT `not_planned` (that's cancelled)
  Jira     -> resolved with a done-category resolution ("Done", "Fixed",
              "Complete", or team equivalents in the Done category)
  Other    -> name-fallback: "Done", "Complete", "Shipped", "Closed-as-done";
              prefer the category-driven check when the tracker exposes it
```

**Consumer citation surface (WHAT each edit is — the interface is "cite the shared rule").** Every edit is a *reference* to the gateway rule at the point the consumer reads blockers — never a restatement of detection semantics:

| Consumer | Location | Citation intent |
|---|---|---|
| gateway | `faff next` `--blocked` def | "open external blocker" explicitly excludes a satisfied (terminal-target) edge — points at the new rule |
| faff-map | Phase 1 fetch line; Phase 4 chain; Phase 5 gate-fireability | drop satisfied edges before chain-drawing and before computing gate-fireability |
| methodology-thematic | `pick-ordering` (unlock-value), `crank-up-set` step 2, `build-queue`, `standup-digest`, `horizon-assignment` | count direct+transitive dependents and test "outside blocker" only over **live** (unsatisfied) edges |
| faff-wtf | §5b chain render | "blocked only by the head vs still gated by other work" counts only live edges |

## 4. HOW — Behavior

**Architecture.** One rule added to the gateway Shared Rules; N reference clauses added at the consumer read-points. No control flow changes in `bin/faff`. The build agent edits Markdown, adds one JSON fixture (or reuses the existing shape), and adds one node:test.

**Where the rule lives — the gateway (`faff/SKILL.md` Shared Rules), as a new named subsection immediately after "Ignore cancelled and archived".** It carries: the one-paragraph rule statement, the non-effects boundary, and the terminal-complete detection block (parallel to the cancelled "What counts as cancelled" block).

**How each consumer applies it (behaviour summary): before any blocker read, resolve each `blockedBy` target's live status; drop satisfied edges; compute over what remains.**

```
PROCEDURE read_live_blockers(issue):
  1. Fetch issue.blockedBy edges (live, per Always-pull-fresh).
  2. FOR each edge -> resolve target's live state via the tracker MCP.
  3. Drop edge IF target is Cancelled/Archived   (already-absent node)
                  OR TERMINAL_COMPLETE(target)     (satisfied — this rule).
  4. RETURN the surviving (live) blocker edges.
```

```
PROCEDURE unlock_value(issue):                # pick-ordering / crank-up-set / wtf §5b
  # count direct + transitive dependents reachable by LIVE edges only
  1. Build the dependent graph over edges whose SOURCE is not a satisfied edge.
  2. Walk transitively; do NOT traverse an edge into/through a terminal target.
  3. RETURN the count.
```

```
PROCEDURE faff_next_blocked_flag(issue):       # the deterministic collapse point
  live = read_live_blockers(issue)             # step 3 drops satisfied edges
  pass `--blocked` = (live is non-empty AND at least one live edge is EXTERNAL
                      to the current run's queue)   # unchanged "external" semantics
  # `faff next` then routes on the boolean, byte-for-byte as today.
```

**crank-up-set outside-blocker test (the subtle one).** `methodology-thematic` `crank-up-set` step 2 admits a dependent `D` iff "all D's blockers are already in the slice (no outside blocker)". A **satisfied** blocker is neither in the slice nor an outside blocker — it is *absent*. So the test reads: `D` is admissible iff every **live** (unsatisfied) blocker of `D` is already in the slice. A Done blocker must never count as an "outside blocker" that wrongly excludes `D`.

**Edge cases and error handling.**

- **Target status unresolvable** (MCP omits the target, or returns no state) → treat the edge as **live** (fail-safe: do not silently drop a blocker you couldn't confirm shipped). Under-counting unlock value or a spurious "blocked" is the safe direction; a missed real blocker is not.
- **Mixed list** (some blockers Done, some open) → drop only the satisfied edges; the surviving open edges keep their full force. FAFF-225's "6 Done + 2 open" resolves to 2 live blockers, not 0 and not 8.
- **Transitive chain through a Done node** — `A blockedBy B(Done) blockedBy C(open)`: the `A→B` edge is satisfied, so C does **not** transitively block A through B (B shipped; whatever C gated is already delivered downstream of B). The walk stops at the satisfied edge — it does not "see through" B to C.
- **Cancelled target that tidy hasn't stripped yet** — a fresh read before a tidy pass may still see a cancelled-target edge; the node is absent from the active set (per "Ignore cancelled and archived"), so the edge is dropped by step 3's first clause. Belt-and-suspenders with the write-side strip; no double-effect.

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure: the rule is prose, so nothing mechanically forces a consumer to apply it** — a future consumer (or a live LLM pass) can still read raw `blockedBy`. **How you'd know:** a map/unlock-value pass over-reports depth off a stale Done edge (the exact FAFF-225 near-miss). **What it means:** proceed — this matches faff's existing model (the sibling "Ignore cancelled and archived" is likewise prose-enforced), and the same eval/live-driver harness is the only place LLM rule-application is truly asserted. The gateway single-home + per-consumer citations are the proportionate mitigation; a mechanical enforcement would be its own ticket.
- **The failure: the harness test asserts the CLI seam given a pre-resolved flag, not the agent's rule-application.** The scripted driver hard-resolves `--blocked=false` from the fixture, so the test proves "`faff next` routes an only-Done-blocker issue to graft" — a proof-of-mechanism, not a proof the LLM computed the flag correctly. **How you'd know:** it's true by construction — call it out. **What it means:** narrow the claim honestly (this is exactly the faff-tidy Scenario B stance: real CLI seam + fixture shape = proof-of-mechanism; LLM judgement is deferred to the live driver). Do not oversell the test as covering the judgement.

**Anti-pattern:** folding the new rule into "Ignore cancelled and archived". Why: that rule hides the *node*; Done nodes must stay visible. They are siblings, not the same rule.

**Anti-pattern:** adding a `faff <verb>` that reads the blocker graph. Why: the CLI is pure by architecture (no tracker access); the graph read stays in prose/MCP. The only deterministic seam is `faff next`'s existing pre-resolved `--blocked`.

**Anti-pattern:** editing `nextStep`/`cmdNext` in `bin/faff`. Why: it's already correct — it consumes a boolean and the gateway already scopes `--blocked` to *open* blockers. The change is the gateway's definition of "open", not the CLI.

## 5. SCENARIOS — born-verifiable main objectives

```
Given an active issue A whose only blockedBy target B is Done (terminal-complete)
When a read-side blocker computation runs (faff next's --blocked resolution)
Then A is treated as unblocked by that edge, and faff next routes A to graft
     (not "blocked")
```

```
Given A blockedBy [B(Done), C(Todo)]   (the FAFF-225 "mixed list" shape)
When live-blocker resolution runs
Then the satisfied B->edge is dropped and exactly one live blocker (C) remains
     — A is reported blocked-on-C, never blocked-on-2, never unblocked
```

```
Given a chain A blockedBy B(Done) blockedBy C(Todo)
When an unlock-value / dependency walk runs
Then the walk does not traverse through the satisfied A->B edge to C
     (C does not transitively block A; the count reflects live edges only)
```

Assertion (non-functional): **no tracker write occurs** during any read-side blocker computation added by this change — the graph is read, never mutated.

## 6. DESIGN DECISION RATIONALE

**Where does the filter live — one shared rule, or per-consumer?**
- *Per-consumer:* each of map / methodology / wtf states its own status-filter. Pros: locally self-contained. Cons: duplicates the detection semantics 4+ times, violates the skill-authoring dedup standard, and drifts (the FAFF-225 class of bug is precisely under-applied filters).
- *One shared rule in the gateway, cited by each consumer:* Pros: single home, mirrors the proven "Ignore cancelled and archived" pattern exactly, dedup-compliant, one place to fix. Cons: prose-enforced (no mechanical guarantee a consumer cites it) — accepted, same as its sibling.
- **Chosen:** one shared named rule in `faff/SKILL.md` Shared Rules, referenced by each consumer — the deduplication principle and the existing sibling pattern both point here decisively.

**Prose rule vs a deterministic CLI helper (the deterministic-tools tension).**
- faff's first governing tenet is "deterministic tools over prose" — a same-input-same-output computation *should* be a tool. The satisfied-edge decision *given resolved statuses* is mechanical.
- But the pure CLI has **no tracker access by deliberate architecture** (every decision function takes pre-resolved flags). The *status resolution* and the *graph walk* require a live tracker read, which is prose/MCP. The only mechanical collapse the CLI can host is the single-issue boolean — which it **already** hosts as `faff next --blocked`.
- Adding a graph-ingesting command (feed the CLI the whole blocker graph + each target's status) is a materially larger change than a low-priority read-side hardening warrants, and duplicates the tracker read the agent already did.
- **Chosen:** prose shared rule + reuse of `faff next`'s existing `--blocked` collapse point; **no new CLI command**. The deterministic tenet is served where it already can be (the `faff next` seam); the graph walk stays in prose because architecture puts it there.

**Is the new rule the same as "Ignore cancelled and archived"?**
- *Fold in:* one rule to rule them all. Cons: "Ignore cancelled and archived" hides the *node* from every count/output — catastrophic if applied to Done (shipped work would vanish from "Recently Completed").
- **Chosen:** a **separate** sibling rule that nulls only the *edge's* blocking force, leaving the Done node fully visible. Different semantics ⇒ different rule.

**Does `faff next` need changes?** (open question #2)
- Evidence: `nextStep`/`cmdNext` (`bin/faff` L5206-5281) is a pure function over booleans; `--blocked` is consumed as-is; the gateway already defines `--blocked` as "any **open** external blocker"; faff-beep-boop restates "no open external blockers".
- **Chosen:** **no code change** to `bin/faff`. `faff next` is already correct in intent. The only edit is the gateway prose that *defines "open"* — adding a clause that a satisfied (terminal-target) edge is not an open blocker, so the agent computing the `--blocked` boolean applies the rule.

**Scope of terminal-complete detection.** Category-first, name-fallback, per-tracker — deliberately mirroring the existing cancelled-detection block so the two read as a matched pair and a maintainer learns one pattern. At time of writing, Linear exposes `stateCategory: "completed"`; the fixture already uses it.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None blocking. Both ticket open-questions are resolved above: (#1) shared-rule — **Chosen**; (#2) `faff next` — **Chosen: no change**.

**Assumptions.**

- **Assumes:** the configured tracker exposes a completion category (or a resolvable "Done" state name) distinguishable from cancellation. *Validation:* confirm against `test/fixtures/tracker/sample.json` (`stateCategory: "completed"` present) and the mock's `STATE_CATEGORIES` enum (`backlog|unstarted|started|completed|cancelled`) in `test/helpers/mock-tracker.mjs` before writing the detection block; the Linear category model is documented in the gateway's existing cancelled-detection block.
- **Assumes:** the existing `test/fixtures/tracker/sample.json` ISS-A→ISS-B(Done) shape is reusable for the harness test, or a sibling fixture with a transitive chain (`A→B(Done)→C(open)`) can be added under `test/fixtures/tracker/`. *Validation:* read the fixture (already confirmed present) and `test/helpers/mock-tracker.mjs` `loadFixture`/`STATE_CATEGORIES` before authoring the test.

## 8. DONE — Definition of Done

### From WHY
- [ ] A read-side blocker computation over an issue whose only `blockedBy` target is Done treats that issue as unblocked-by-that-edge (the FAFF-225 pain point is addressed).
- [ ] The Done target issue remains fully visible (still counted/surfaced elsewhere) — the rule nulls the edge, not the node.

### From WHAT (the rule + detection)
- [ ] `faff/SKILL.md` Shared Rules gains a new named subsection (e.g. "Satisfied blockers — edges to terminal work") immediately after "Ignore cancelled and archived", stating: a `blockedBy` edge to a terminal-complete (Done) target is satisfied — not counted as a live/open blocker, not traversed as a live dependency edge — with an explicit non-effects boundary (no node hidden, no tracker write) and a note that cancelled/archived targets are already handled upstream.
- [ ] The subsection carries a terminal-complete detection block (Linear `completed` category; GitHub `state_reason=completed`/merged; Jira Done-category; name-fallback) mirroring the cancelled-detection block's shape.

### From WHAT (consumer citations)
- [ ] `faff/SKILL.md` `faff next` `--blocked` definition references the new rule: an "open external blocker" excludes a satisfied (terminal-target) edge.
- [ ] `faff-map/SKILL.md` Phase 1 (fetch), Phase 4 (chain), and Phase 5 (gate-fireability) reference the rule so satisfied edges are dropped before chain-drawing/fireability.
- [ ] `faffter-noon-methodology-thematic/SKILL.md` references the rule at `pick-ordering` (unlock-value count), `crank-up-set` step 2 (outside-blocker test), `build-queue`, `standup-digest`, and `horizon-assignment`.
- [ ] `faff-wtf/SKILL.md` §5b references the rule for the "blocked only by the head vs still gated" computation.

### From HOW (behaviour + boundaries)
- [ ] `bin/faff` `nextStep`/`cmdNext` are **unchanged** (verified: pure boolean, no tracker access) — the change is gateway prose only.
- [ ] faff-tidy's cancelled/archived auto-strip (L56/L249) and its "Unblocked" log-only path (L58) are **unchanged** (negative AC — scope guard).
- [ ] Unresolvable target status ⇒ edge treated as live (fail-safe), stated in the gateway rule or the map/methodology citation.
- [ ] A mixed list drops only satisfied edges; surviving open edges keep full force (FAFF-225 "6 Done + 2 open" → 2 live).

### From HOW (edge cases)
- [ ] A transitive walk stops at a satisfied edge (does not see through a Done node to its upstream blocker).

### Tests / fixtures
- [ ] A fixture with the Done-target blocker shape exists (reuse `sample.json` ISS-A/ISS-B, or add a transitive `A→B(Done)→C(open)` sibling fixture).
- [ ] A node:test analogous to `faff-tidy.test.mjs` Scenario B asserts the read-side consequence at the real `faff next` seam: an issue whose only blocker is Done resolves `--blocked=false` → `faff next` returns `graft` (exit 0, structured verdict token) — captured as proof-of-mechanism, with a comment that the LLM's rule-application itself is deferred to the live driver.
- [ ] `faff validate-adapters` passes (SKILL.md line-cap/dedup/marker lint) on every edited skill.

### Skill-authoring conformance
- [ ] Each consumer *references* the gateway rule; none restates the detection semantics (dedup standard).
- [ ] Executed prose (SKILL.md) states the rule intent self-containedly — no load-bearing `FAFF-279`/ADR reference in the prose (per the self-contained-prose rule).

**Integration smoke test.**
```
1. Load sample.json into the mock tracker (ISS-A blockedBy ISS-B, ISS-B Done).
2. Drive the scripted harness to resolve ISS-A's live blockers -> [] (B satisfied).
3. faff next --status todo --spec high  (blocked flag = false)
   => { next: "graft" }, exit 0.
4. Assert no mutation was recorded against the tracker (read-only).
```

confidence: high
spec-review: approve
