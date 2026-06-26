# Spec — FAFF-230: beep-boop isolation floor over-states "no inline prep"

> Spec: produced by `faffter-dark-nlspec` · 2026-06-26 · autonomous · confidence: high.

This spec is for the build agent (and human reviewers) implementing FAFF-230, a prose-accuracy chore on `plugin/skills/faff-beep-boop/SKILL.md`. It is a single-line correction with one supporting forward-note; the bulk of this document is rationale and the exact target text, not implementation complexity.

## 1. WHY — Problem and Principles

**The load-bearing model:** a faff "floor" clause is a *contract* — it is meant to bind every occupant of a slot (including third-party swap-ins), so it must describe an invariant that is actually enforced today, not an aspiration. A floor that asserts more than the code honours is a false contract.

**Problem statement.** FAFF-201 added the beep-boop "Isolation floor (orchestrator invariant)" paragraph, which opens *"Never run a build (or prep producer) inline in the orchestrator…"*. But prep-producer isolation was explicitly scoped **out** of FAFF-201 (deferred as an independent unit — see `docs/specs/2026-06-23-FAFF-201-…-design.md` OUT-OF-SCOPE + its Punt), so prep is still invoked inline. The clause therefore claims an invariant the orchestrator does not yet honour. This change narrows the assertion to "build" — the part that *is* enforced — and adds a one-line forward-note so the deferred prep-isolation intent is preserved, not silently lost.

**Design principles.**

- **State only enforced invariants in a floor clause.** A contract clause is honest exactly when an occupant that violated it would be wrong. Today an inline prep producer is *not* wrong (it is the shipped behaviour), so the floor must not forbid it yet.
- **Don't silently drop the deferred scope.** Removing "(or prep producer)" without a trace would make the omission read as an oversight. A brief forward-note keeps the design intent legible and tells a future reader the parenthetical's removal was deliberate.
- **Lean / single-source (skill-authoring charter).** The edit stays within the existing paragraph; it adds no new section and no duplicated prose. The forward-note is one sentence.

**Reference context.**

| System | Relevance |
|---|---|
| `plugin/skills/faff-beep-boop/SKILL.md` (the "Isolation floor" paragraph) | The sole file edited. Contains the over-stated clause. |
| `plugin/skills/faff/SKILL.md` ("Implementor (innermost lane)" paragraph) | Already build-only and accurate — describes the `concurrency` slot dispatching the *build* as an isolated subagent. **No change.** |
| `docs/specs/2026-06-23-FAFF-201-…-design.md` | FAFF-201's design spec; its OUT-OF-SCOPE names "Prep-queue subagent dispatch" as the deferred sibling. Confirms intent; not edited. |

**Scope statement.** A one-clause prose correction inside beep-boop's orchestrator-invariant paragraph; it changes documentation only, no runtime behaviour.

## 2. OUT OF SCOPE

- **Implementing prep-producer subagent isolation.** — The actual mechanism (dispatching the prep producer as an isolated subagent so the orchestrator doesn't re-absorb full spec bodies) is the deferred sibling FAFF-201 punted; this ticket only corrects the prose to stop claiming it exists. **Extension point:** the prep-queue drain in `faff-beep-boop/SKILL.md` + the prep producer return path (per FAFF-201's OUT-OF-SCOPE note). When that lands, restore the full "(or prep producer)" wording.
- **Editing the gateway Implementor paragraph.** — `plugin/skills/faff/SKILL.md:236` already describes only build-phase isolation and does not claim prep runs isolated; there is no echo to fix. **Extension point:** none — verify-only.
- **Filing the deferred-sibling ticket / assigning it an ID.** — FAFF-201 left prep-isolation as a Punt with no tracker ID; this ticket must not fabricate one. **Extension point:** a future `/faff-jot` or tidy pass may file it; the forward-note references it descriptively.

## 3. WHAT — Vocabulary, Types, and Interfaces

No types, schemas, or interfaces — this is a documentation edit. The only "interface" is the exact target/replacement prose, given in HOW.

**Vocabulary.**

| Term | Definition |
|---|---|
| Isolation floor | The beep-boop orchestrator-invariant clause stating builds run as isolated subagents, binding even swapped-in `concurrency` occupants. |
| Prep producer | The `spec` slot (default-resolved) that produces a spec body; currently invoked **inline** by the orchestrator during a prep-queue drain. |
| Deferred sibling | The prep-producer-isolation unit FAFF-201 scoped out (no tracker ID assigned). |

**Design decisions.**

- **Wording approach — narrow + forward-note (hybrid), vs narrow-only, vs note-only.** **Chosen:** narrow the assertion to "build" so it is true today, AND append one forward-note marking prep-producer isolation as the deferred sibling. Rationale: narrow-only silently drops the intent (reads as an oversight); note-only leaves the false assertion standing. The hybrid is honest *and* preserves the design trail. (Full rationale in §6.)
- **Gateway edit — none.** **Chosen:** leave `plugin/skills/faff/SKILL.md` unchanged; explore confirmed its Implementor paragraph is already build-only and accurate. (§6.)

## 4. HOW — Behavior

**Approach.** Edit the single sentence at the start of the "Isolation floor (orchestrator invariant)." paragraph in `plugin/skills/faff-beep-boop/SKILL.md` (currently line 394). Remove the inaccurate parenthetical and append a forward-note sentence at the end of the same paragraph. The rest of the paragraph already speaks only of builds and is left as-is.

**The edit (semantic target — match the build agent's current file, line numbers may drift).**

Current opening clause:

> **Isolation floor (orchestrator invariant).** Never run a build (or prep producer) inline in the orchestrator; the `concurrency` slot dispatches each build as an **isolated subagent** …

Becomes (parenthetical removed):

> **Isolation floor (orchestrator invariant).** Never run a build inline in the orchestrator; the `concurrency` slot dispatches each build as an **isolated subagent** …

Append at the **end** of the same paragraph (after "…before recording the ledger bucket."), one sentence:

> *Prep-producer isolation is a deferred sibling (the inline prep producer is the same bloat class but its subagent dispatch was scoped out of FAFF-201); the floor covers builds only until that lands, at which point the prep producer is folded into the same wording.*

**Anti-pattern:** rewriting the whole paragraph or restructuring it. Why: the only defect is the parenthetical; a broader rewrite risks regressing the (correct) build-isolation prose and inflates the diff for a one-clause fix.

**Anti-pattern:** citing a fabricated `FAFF-NN` for the deferred sibling. Why: FAFF-201 left it as an unticketed Punt; inventing an ID creates a dangling reference. Reference it descriptively ("a deferred sibling", citing FAFF-201's scope-out) only.

**Edge case — line number drift.** The clause is at line 394 at spec-time but the build agent must locate it by the unique anchor text **"Never run a build (or prep producer) inline"** (a single grep hit across the repo), not by line number.

## 5. SCENARIOS

The objectives here are below the behavioural-complexity bar (a prose edit with a deterministic lint gate), so no Given-When-Then scenarios are emitted — the DONE checklist + the `validate-adapters` gate fully express verifiability.

## 6. DESIGN DECISION RATIONALE

**How should the over-stated floor be corrected?**

- *Option A — narrow to "build" only (delete the parenthetical, no note).* Pro: minimal diff, restores honesty. Con: silently loses the deferred-isolation intent; a future reader sees no trace that prep isolation was ever in view, so it reads as an oversight and the dropped scope can be forgotten.
- *Option B — keep "(or prep producer)" but reword the verb to a "should" aspiration.* Pro: preserves the intent inline. Con: a floor is an *invariant contract*, not an aspiration; softening it to "should" weakens the whole clause's binding force on swapped-in occupants and muddies what's actually enforced.
- *Option C — hybrid: narrow to "build" + one forward-note sentence.* Pro: honest about today's enforcement AND preserves the design trail, with the deferred sibling explicitly named; smallest change that satisfies both the issue's options (a) and (b). Con: one extra sentence (well under the 200-word paragraph cap).

**Chosen:** Option C (hybrid). It is faithful to the issue's recommendation and keeps the floor an honest, binding invariant while not losing the deferred scope. Temporal anchor: when the prep-isolation sibling ships, restore the full "(or prep producer)" wording and drop the forward-note.

**Should the gateway Implementor paragraph change?**

- *Option A — edit it to mirror the narrowing.* Con: explore confirmed it already describes only build-phase isolation (`the concurrency slot dispatches it [the build] as an isolated subagent`); it never claims prep runs isolated. Editing it would be a no-op churn at best.

**Chosen:** No gateway change — verify-only. The gateway is already accurate.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none.

**Assumptions:**

- **Assumes:** the unique anchor text "Never run a build (or prep producer) inline" still exists verbatim in `plugin/skills/faff-beep-boop/SKILL.md` at build time. **Validation:** `grep -n "Never run a build (or prep producer) inline" plugin/skills/faff-beep-boop/SKILL.md` returns exactly one hit before editing; if zero or multiple, stop and re-prep.
- **Assumes:** no other file in `plugin/` repeats the over-stated wording. **Validation:** `grep -rn "or prep producer" plugin/` returns only the beep-boop line (explore confirmed this at spec-time).

## 8. DONE — Definition of Done

### From WHY
- [ ] The "Isolation floor" clause no longer asserts that prep runs isolated — the parenthetical "(or prep producer)" is removed from the opening sentence.

### From WHAT / HOW (the edit)
- [ ] The opening sentence reads "Never run a build inline in the orchestrator; …" (no parenthetical).
- [ ] A single forward-note sentence is appended to the end of the same paragraph, naming prep-producer isolation as a deferred sibling and citing FAFF-201's scope-out — with **no** fabricated `FAFF-NN` for the sibling.
- [ ] The rest of the "Isolation floor" paragraph (build-isolation mechanics, token reconciliation) is byte-unchanged apart from the appended sentence.

### From OUT OF SCOPE (negative checks)
- [ ] `plugin/skills/faff/SKILL.md` is unchanged (the gateway Implementor paragraph was already accurate).
- [ ] No new tracker ticket is filed and no `FAFF-NN` is invented for the deferred sibling.

### From principles (lint gate)
- [ ] `faff validate-adapters` passes (it passed pre-change; the edit must not regress line/paragraph caps or any lint rule).
- [ ] `grep -rn "or prep producer" plugin/` returns zero hits after the edit.

**Integration smoke test:**

```
1. grep -n "Never run a build inline in the orchestrator" plugin/skills/faff-beep-boop/SKILL.md   # exactly 1 hit
2. grep -rn "or prep producer" plugin/                                                            # 0 hits
3. faff validate-adapters                                                                          # exit 0
4. git diff --stat                                                                                 # only faff-beep-boop/SKILL.md changed
```

confidence: high
