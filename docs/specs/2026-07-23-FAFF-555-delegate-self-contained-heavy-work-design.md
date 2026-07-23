# Delegate self-contained heavy work to bare-executor subagents at every level — the skill-prose policy slice

> Spec: faffter-dark-nlspec · 2026-07-23 · autonomous · confidence: high. Full spec on Linear FAFF-555.

This spec is for the build agent editing faff's skill prose, and for the human reviewers of that small PR. It delivers **one thing**: a stated, forward-facing **policy** in the faff skill prose that disposable-subagent delegation of self-contained heavy work is a *context-management primitive available at every level* (L1-assist / L2 / L3 / L4), decoupled from the L3/L4 `concurrency` slot — and that the executor it delegates to is a **bare-executor** which needs only the task, not faff-skill context. It is a **prose-only** change. The bare-executor *contract design* (task/result schema), *compaction cadence*, and *isolation mechanics* are explicitly **not** built here — they are FAFF-486.

## 1. WHY — Problem and Principles

**The load-bearing idea.** faff already delegates builds to disposable subagents — but only in the **autonomous** lane, and the prose says so in level-coupled words. The context-hygiene benefit of that delegation (keeping the orchestrator's context lean so it does not re-read accumulated work every turn) is **orthogonal to autonomy level and to parallelism**. This ticket states that orthogonality *as a policy* in the prose, so the principle is on the record and constrains where the mechanism (FAFF-486) later lands — without building the mechanism.

**Problem statement.** Today the gateway couples subagent build delegation to the L3/L4 `concurrency` executor (whose job is parallelism + worktree isolation), and the beep-boop isolation floor states it as an "orchestrator invariant" — both level-coupled. So the interactive L2 `/faff-graft` build (gateway → **Agent Lanes → Implementor**, and `faff-graft` Step 7 "Build directly from the spec") runs **inline in the main conversation**, growing the orchestrator context monotonically across increments. This change adds a level-independent policy statement that names inline heavy execution as a bloat class delegation addresses at *every* level.

**Design principles** (each would cause rejection of an otherwise-valid implementation):

- **One home, referenced not copied.** The policy is shared prose, so it gets exactly **one** canonical home (the gateway); the existing level-coupled sites reference it, they do not restate it (repo authoring standard — `docs/skill-authoring.md`; CLAUDE.md dedup rule).
- **Policy, not mechanism.** State the *direction and the bare-executor shape*; do **not** specify the task/result schema, the isolation mechanics, or the compaction cadence. Those are FAFF-486. A spec that pins the contract has left this ticket's scope.
- **Forward-stated, no changelog.** State the rule forward (authoring standard) — no war-story, no "we used to couple this to L3." The provenance is the run economics that surfaced it; that belongs in git history / the ticket, not the prose.
- **No behaviour change.** This is prose only. No `faff` CLI change, no slot change, no gate change. The `faff validate-adapters` lint must still pass.

**Reference context.**

| System | Kind | Relevance |
|---|---|---|
| `plugin/skills/faff/SKILL.md` → **Agent Lanes → Implementor** | skill prose | Holds the current *level-coupled* isolation framing ("Under autonomous orchestration the `concurrency` slot dispatches it as an isolated subagent … returns only a terminal token, never its working set"). The generalization lands here. |
| `plugin/skills/faff/SKILL.md` → **Sibling-skill invocation → Producer dispatch** | skill prose | Already the general home for "dispatch as an Agent-tool subagent, consume the tool result" transport, and the background-by-default *why*. The new tenet references it for transport, does not duplicate it. |
| `plugin/skills/faff-beep-boop/SKILL.md` → **Isolation floor** | skill prose | The L3 *instance* of the tenet ("Never run a build inline in the orchestrator … orchestrator invariant"), already carrying a "prep-producer isolation is a deferred sibling" note. Gets a one-line back-reference naming it as one instance of the general tenet. |
| `plugin/skills/faff-graft/SKILL.md` → **Step 7: Build** | skill prose | The L2/interactive inline-build seam ("Build directly from the spec") that assertion 1 targets. Gets a one-line forward-reference to the tenet + FAFF-486, **no** behaviour change. |
| FAFF-486 (related, open) | tracker epic | Owns the bare-executor **contract design, compaction cadence, isolation mechanics** — the mechanism this policy defers to. The scope boundary: prose here, CLI/infra there. |

**Scope statement.** This is a documentation/policy slice inside the faff skill prose — it records a governing tenet and names its extension points; it stands up no mechanism.

## 2. OUT OF SCOPE

- **The bare-executor task/result contract schema** — the concrete `{spec, worktree, DoD, gate}`-in / `{diff, gate-verdict}`-out shape as a typed, validated interface. *Why excluded:* it is the core architectural decision the human decision routed to FAFF-486 ("plumbing epic … contract design"). *Extension point:* FAFF-486; the prose here names the shape conceptually and points there.
- **Isolation mechanics and compaction cadence** — how the subagent's context is actually established, discarded, and how often the orchestrator compacts. *Why excluded:* FAFF-486 ("compaction cadence, isolation mechanics"). *Extension point:* FAFF-486.
- **Building the L2/interactive delegation seam** — actually re-shaping `faff-graft` Step 7 so the interactive build runs in a subagent. *Why excluded:* that is the mechanism; this ticket only states the policy that it *should*. *Extension point:* `faff-graft` Step 7, once FAFF-486's contract exists.
- **Interactive progress surfacing** — how a watching human sees progress when a build is delegated to an opaque subagent. *Why excluded:* a mechanism/UX question of the delegation seam, not the policy. *Extension point:* FAFF-486 / the graft Step 7 seam.
- **The delegation-boundary cut** (whole-build vs per-step). *Why excluded:* a mechanism-design decision; the policy names *candidate step-classes* (the build, deep exploration, large test runs), not the precise cut. *Extension point:* FAFF-486.
- **Token-accounting under subagent isolation** — measuring the saving. *Why excluded:* blocked on FAFF-488 and about validating the mechanism, not stating the policy. *Extension point:* FAFF-488.

## 3. WHAT — the prose to add

**Vocabulary:**

| Term | Definition |
|---|---|
| Bare-executor | A disposable subagent dispatched with **only the task** — the spec, the worktree path, the definition-of-done, and which gate to run — that returns a **compact result** (a diff / terminal token + gate verdict) and loads **no faff-skill context** (no gateway, no contracts, no `faff-graft` SKILL.md). The orchestrator retains the process, the gates, and all human interaction. |
| Context-hygiene delegation | Moving a self-contained heavy step out of the orchestrator's own context into a bare-executor so the orchestrator context stays lean across increments — a *cost/context* motivation, distinct from the `concurrency` slot's *parallelism/worktree-isolation* motivation. |
| Level-independence | The property that this delegation is worthwhile at L1-assist / L2 / L3 / L4 alike, because the context-hygiene benefit does not depend on autonomy level or on running builds in parallel. |

**The addition (the WHAT), stated as three prose edits:**

1. **Gateway — the canonical tenet (one home).** In `faff/SKILL.md` → **Agent Lanes** (at the Implementor-lane isolation prose), generalize the level-coupled framing into a stated tenet: context-hygiene delegation to a **bare-executor** is a primitive available at **every level** (L1-assist / L2 / L3 / L4), decoupled from the `concurrency` slot and from parallelism; the executor takes only the task and returns a compact result, holding no faff-skill context; candidate delegatable steps are self-contained heavy work — the build itself, deep repo exploration/grounding, large test runs. The tenet **names FAFF-486 as the owner** of the contract, compaction cadence, and isolation mechanics (the "documented, not built here" seam pattern the gateway already uses), and references **Producer dispatch** for the existing subagent transport rather than restating it.

2. **beep-boop — back-reference (no behaviour change).** In `faff-beep-boop/SKILL.md` → **Isolation floor**, add a one-line pointer naming the floor as the **L3 instance** of the gateway tenet — so the level-coupled "orchestrator invariant" reads as one realization of the general principle, not a contradiction of it. The existing "prep-producer isolation is a deferred sibling" note stays.

3. **graft — forward-reference (no behaviour change).** In `faff-graft/SKILL.md` → **Step 7: Build**, add a one-line note that delegating this build to a bare-executor is the level-independent context-hygiene policy (gateway → **Agent Lanes**) and that the executor contract is FAFF-486 — a pointer only; Step 7 still builds inline today.

**Design decisions:**

- **Home placement.** Options: (a) a new gateway *Governing-principles* tenet; (b) generalize the existing **Agent Lanes → Implementor** isolation prose. **Chosen:** (b) — the isolation framing already lives in Agent Lanes and is exactly the level-coupled prose being generalized; co-locating keeps one home and avoids a second place that says the same thing. Rationale: the dedup rule wants the shared prose in one home, and that home already exists.
- **Depth of the bare-executor statement.** Options: state only the *concept* (shape + no-faff-context), or also sketch the task/result fields. **Chosen:** concept only — the conceptual shape (task-in: spec + worktree + DoD + gate; result-out: diff + gate verdict; no faff context) exactly as the ticket and the human decision word it, deferring the typed schema to FAFF-486. Rationale: pinning fields is the mechanism, which is out of scope; the gateway already describes the terminal token `{ issue, outcome, pr }` conceptually in prose while its real contract lives in the CLI — same discipline here.
- **Touching graft/beep-boop at all.** Options: gateway-only; or gateway + one-line references at the two existing level-coupled sites. **Chosen:** gateway + two one-line references — a policy nobody links to is invisible at the sites it governs, and the references cost one line each with no behaviour change. Rationale: the references make the tenet discoverable from the exact prose it generalizes, and reconcile the level-coupled wording with it.
- **Any CLI/behaviour change.** **Chosen:** none — prose only. Rationale: the human decision drew the boundary at "skill-text here, CLI/infra there"; behaviour is FAFF-486.

## 4. HOW — Behaviour

There is no runtime behaviour. The "how" is the editing procedure and the invariants the edits must hold.

```
PROCEDURE add_delegation_policy:
  1. Edit faff/SKILL.md → Agent Lanes → Implementor:
     a. Generalize the "under autonomous orchestration … concurrency slot" isolation
        sentence into the level-independent tenet (names all four levels; decoupled
        from concurrency + parallelism).
     b. State the bare-executor concept: task-in (spec + worktree + DoD + gate),
        compact result-out (diff + gate verdict), no faff-skill context.
     c. Name candidate delegatable step-classes: build, deep exploration, large test runs.
     d. Name FAFF-486 as owner of the contract + compaction cadence + isolation mechanics
        (the "documented, not built here" seam), and reference Producer dispatch for transport.
  2. Edit faff-beep-boop/SKILL.md → Isolation floor: add the one-line "L3 instance of the
     gateway tenet" back-reference. No other change.
  3. Edit faff-graft/SKILL.md → Step 7: add the one-line forward-reference to the tenet +
     FAFF-486. No behaviour change; Step 7 still builds inline.
  4. Run `faff validate-adapters` — must pass (line caps, no duplicated blocks, no stray markers).
  5. Confirm `git diff` touches only the three SKILL.md files (prose), nothing under bin/.
```

**Anti-pattern:** copying the tenet's wording into beep-boop or graft. Why: it duplicates shared prose, which the dedup lint and the authoring standard forbid — those sites *reference* the one home.

**Anti-pattern:** specifying the task/result schema, progress-surfacing mechanism, or delegation-boundary cut in this prose. Why: that is FAFF-486's mechanism; stating it here re-entangles the slice with the epic the human decision explicitly separated.

**Failure mode — the policy reads as an unbuilt aspiration rather than a governing rule.** The risk: a reviewer holds that naming a "bare-executor" that no seam yet enacts is a design note that belongs in `design/`, not runtime SKILL.md prose. *How you'd know:* the spec-review methodology lens returns a scope objection (right-increment), or a human reviewer asks "where does this actually change what an agent does?". *What it means:* it is defensible to state a forward tenet in prose — the beep-boop isolation floor already states a floor whose prep-producer extension is explicitly deferred, and the gateway already carries "documented, not built here" seams (Ticket templates) — so the precedent holds; but if the review calls it a scope/increment error, that routes to `/faff-plot` (park), because it is a "is this the right increment?" question, not a design flaw. This spec proceeds on the human's explicit scope decision that it *is* the right increment.

## 5. Scenarios

```
Given faff's skill prose today couples subagent build delegation to the L3/L4 concurrency slot
When the policy edit lands in the gateway Agent Lanes section
Then the prose states that context-hygiene delegation to a bare-executor is available at
     L1-assist / L2 / L3 / L4, decoupled from the concurrency slot and from parallelism
```

```
Given the policy names a bare-executor
When a reader follows the tenet
Then it states the executor receives only the task (spec + worktree + DoD + gate) and returns a
     compact result (diff + gate verdict) with no faff-skill context, and it names FAFF-486 as
     the owner of the contract + compaction cadence + isolation mechanics
```

- The change is **prose only**: `git diff` touches `faff/SKILL.md`, `faff-beep-boop/SKILL.md`, `faff-graft/SKILL.md` and nothing under `plugin/skills/faff/bin/`.
- `faff validate-adapters` passes after the edit (no duplicated blocks, line caps respected).

## 6. Design decision rationale

**Where does the tenet live?** Considered a new Governing-principles entry vs. generalizing Agent Lanes. **Chosen:** generalize Agent Lanes → Implementor — the level-coupled prose being generalized already lives there, so one home, no second copy.

**How much of the bare-executor is stated?** Considered concept-only vs. a field sketch. **Chosen:** concept-only (shape + no-faff-context), matching the ticket/human wording, schema deferred to FAFF-486 — mirrors how the gateway states the terminal token conceptually while its contract lives in the CLI.

**Does anything but the gateway change?** Considered gateway-only vs. gateway + two one-line references. **Chosen:** add one-line references at the beep-boop isolation floor and graft Step 7 so the tenet is discoverable from the prose it generalizes, with no behaviour change.

**Is any CLI/behaviour touched?** **Chosen:** no — the human decision's boundary is "skill-text here, CLI/infra there"; the mechanism is FAFF-486.

## 7. Open questions and assumptions

**Open questions:** none blocking. The two questions the original ticket flagged — interactive progress surfacing and the delegation-boundary cut — are **mechanism** questions owned by FAFF-486 and listed in OUT OF SCOPE; the *policy* states direction, not the cut, so neither must be resolved to state it.

**Assumptions:**

- **Assumes:** FAFF-486 exists and remains the owner of the bare-executor contract, compaction cadence, and isolation mechanics. *Validation:* FAFF-486 is a live related ticket on FAFF-555 (confirmed: "Context lifetime reduction — subagent isolation, compaction cadence, tokens-not-transcripts"); the build agent confirms it is still open before naming it as the deferral target.
- **Assumes:** the gateway **Agent Lanes → Implementor** isolation prose and the beep-boop **Isolation floor** are still present and level-coupled as described. *Validation:* the build agent greps both sections before editing; if the prose has already been generalized by another change, this ticket narrows to the residual references.

## 8. DONE — Definition of Done

### From WHY
- [ ] The gateway prose states context-hygiene delegation as **level-independent**, naming all four levels (L1-assist / L2 / L3 / L4) and decoupling it from the `concurrency` slot and from parallelism.
- [ ] The policy is stated **forward** (no changelog/war-story prose) and lives in exactly **one** canonical home.

### From WHAT (the bare-executor concept)
- [ ] The prose states the bare-executor receives **only the task** (spec + worktree + DoD + gate) and returns a **compact result** (diff + gate verdict).
- [ ] The prose states the bare-executor loads **no faff-skill context** (no gateway, no contracts, no graft SKILL.md).
- [ ] The prose names **candidate delegatable step-classes**: the build, deep repo exploration/grounding, large test runs.
- [ ] The prose names **FAFF-486** as the owner of the contract design, compaction cadence, and isolation mechanics — the explicit scope boundary — and references **Producer dispatch** for the subagent transport rather than restating it.

### From WHAT (the references)
- [ ] The beep-boop **Isolation floor** carries a one-line back-reference naming it the **L3 instance** of the gateway tenet (no behaviour change; the "deferred sibling" note stays).
- [ ] The graft **Step 7** carries a one-line forward-reference to the tenet + FAFF-486 (no behaviour change; Step 7 still builds inline).

### From HOW (invariants)
- [ ] `faff validate-adapters` passes after the edit.
- [ ] `git diff` touches only skill-prose `SKILL.md` files — no change under `plugin/skills/faff/bin/`, no CLI/slot/gate change.
- [ ] No duplicated policy block exists (the tenet is referenced from the two existing sites, not copied).

**Integration smoke test:**
```
1. grep the gateway Agent Lanes section for the four level tokens + "bare-executor" + "FAFF-486" → all present.
2. grep faff-beep-boop and faff-graft for the one-line references to the tenet → present.
3. Run `faff validate-adapters` → exit 0.
```

confidence: high
spec-review: approve

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized? (principle 4).** Yes. One 1–3 day prose unit: three small `SKILL.md` edits plus a lint run, converging on a single policy. Not two independent concerns — no split; not a fragment — no merge.
- **Workstream fit? (principles 1, 5).** Fits. A docs/policy improvement to faff's own skill prose, one coherent outcome (state the level-independence tenet). Currently project-less Backlog, which is the correct landing for a self-contained improvement — no workstream mismatch to flag.
- **Deps surfaced? (principle 6).** Honest. FAFF-486 owns the mechanism, but this prose slice **does not consume FAFF-486's output** — it *names* FAFF-486 as the deferral target (a forward reference to an open ticket), so the correct relationship is `related` (already set), **not** `blocked-by`. The human decision made it independently shippable precisely on this boundary. No missing blocker link. FAFF-488 is a measurement dep of the *mechanism*, not of this prose.
- **Risk profile? (principle 7).** Low. Prose-only, reversible, no novel integration, no external dep. No de-risking spike warranted.

No principle violations. The slice is a clean, independent, right-sized delivery under the human's 2026-07-23 scope narrowing.

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
