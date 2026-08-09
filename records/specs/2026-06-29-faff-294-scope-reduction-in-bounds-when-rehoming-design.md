# Spec — FAFF-294: Scope reduction in-bounds when rehoming, not deleting

> Spec: faffter-dark-nlspec · 2026-06-29 · autonomous · confidence: high. Full spec on Linear FAFF-294.

This is the design spec for the build agent and human reviewers. It is a **prose-only** change to one file — the agile-delivery methodology lens (`plugin/skills/faffter-dark-methodology-agile-delivery/SKILL.md`). It splits the lens's flat "no scope reduction" rule into two distinct acts and permits the reversible one under a gate. No code, no CLI, no schema.

## 1. WHY — Problem and Principles

**The load-bearing model.** "Reduce scope" is not one act — it is two. **Cutting** a non-critical issue *out of an MVP and into another deliverable* (a reparent) loses nothing: the work still has a home and the move reverses with one more reparent. **Cancelling/deleting** an issue *destroys* it. The agile lens currently bans both under one line, which forbids the core agile move — converge value early by shedding non-spine scope — alongside the genuinely irreversible one.

**Problem statement.** The lens's `## Appetite integration` → *"What no appetite level does"* block reads *"Cancel, delete, or reduce scope (irreversible)."* That conflates lost scope (cancel/delete) with rehomed scope (reparent out of the MVP) and so forbids the value-by-risk converge-early move the lens otherwise champions (principle 2). The change splits the line so rehoming is permitted under a gate while cancel/delete stays forbidden at every level.

**Design principles** (reject an implementation that violates these):

- **Reuse the dial; do not re-derive levels.** The gateway already owns the per-level topology-write authority (gateway → **Appetite for destruction** → **Topology-write authority**) and its reversibility-floor + DoD-ceiling invariants. This change adds the lens's seven-principle *flavour* of one specific topology write (cutting non-spine scope out of an MVP); it must **not** restate the level table or invent a parallel dial.
- **Reuse the reparent capability already shipped.** The lens already reparents a gating chain *into* the gated stream (`## Re-homing gating chains into the stream they gate`). This change is the **complementary outward direction** — reparent a non-critical issue *out* of the MVP — and reuses the same `parentId`-move mechanism, reversibility floor, and anti-thrash convergence, not a new one.
- **The cut is gated, never silent.** A scope cut is a judgement (does the MVP DoD still hold without this issue?). It is **surfaced at `low`/`medium`, proposed-for-human-confirm at `high`, acted at `full`** — never an autonomous cut at an acting level without the DoD-still-satisfied gate clearing.
- **Self-contained prose.** The new prose carries **no** ticket / ADR references — it references the dial and the reparent capability by section/capability name. (Inline meaning; the executed-prose ref ban.)

**Reference context.**

| System | Form | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-methodology-agile-delivery/SKILL.md` | skill prose | The only file edited. The `## Appetite integration` block + the `## Re-homing gating chains into the stream they gate` section are the touch points. |
| gateway `plugin/skills/faff/SKILL.md` → **Topology-write authority** dial | skill prose | The per-level authority table + reversibility-floor + DoD-ceiling invariants this change defers to. Read-only — not edited. |
| `faff prdr` / `prdr-author` DoD machinery | CLI + methodology output | The MVP's machine-readable Definition of Done that the "DoD still satisfied" gate reads. Read-only — not edited. |

**Scope statement.** This sits inside the agile lens's appetite-integration prose, beneath the gateway dial it defers to; it changes what the lens *does* with topology authority it already holds, not the authority itself.

## 2. OUT OF SCOPE

- **The gateway dial itself.** The level table, reversibility floor, and DoD ceiling already exist in the gateway. This change consumes them; it does not author them.
- **Inward gating-chain re-homing.** The existing `## Re-homing gating chains into the stream they gate` (drag a blocker *into* the MVP) is the opposite direction and already shipped. Untouched except for a one-line cross-reference noting the two directions are disjoint.
- **Cancel / delete plumbing.** No new forbidding mechanism; cancel/delete is already a hard-floor never. This change only re-labels the existing ban as "lost scope".
- **The pre-existing FAFF-256 ref on line ~20.** A pre-existing non-self-contained ref outside this change's prose; not introduced by FAFF-294.
- **The sibling edits FAFF-293 / FAFF-295.** Same file, different rules; the orchestrator serialises the builds.

## 3. WHAT — Vocabulary and the rule split

**Vocabulary.**

| Term | Definition |
|---|---|
| **Lost scope** | Cancelling or deleting an issue/workstream — the work ceases to exist. Irreversible. Forbidden at every appetite level. |
| **Rehomed scope** | Reparenting a non-critical issue *out of an MVP container into another outcome-led, DoD-bearing project* (a `parentId` move, `blockedBy` edges preserved). Reversible. Permitted under the two-part gate below. |
| **Non-critical issue** | An MVP-member issue that is **not** load-bearing on the MVP's Definition of Done — its removal leaves the DoD still satisfiable. |
| **Real deliverable home** | A target container that is itself an outcome-led project carrying a machine-readable DoD — never the void (no parent) and never a thematic/activity bucket. |
| **DoD-still-satisfied gate** | The check that, after the cut, the MVP container's DoD remains satisfiable by its remaining members. |

**The rule split.** The lens's *"What no appetite level does"* block currently lists one item conflating two acts. It becomes two items: **lost scope** (cancel/delete — forbidden at every level incl. `full`) and **rehomed scope** (reparent a non-critical MVP issue out into another DoD-bearing outcome project — permitted, gated on (1) MVP DoD still satisfied after removal, and (2) target is a real home; reversible).

**Design decision — split the rule vs. add a carve-out clause.** Chosen: split into two named items — it makes the two acts independently legible and mirrors the gateway dial's reversibility-floor framing at the lens's altitude.

**Design decision — where the gate prose lives.** Chosen: a compact subsection (working title *Cutting non-spine scope out of an MVP (rehome, never delete)*) mirroring the inward re-homing section, plus a one-line behaviour echo in each of the `low` / `high` / `full` appetite bullets.

## 4. HOW — the behaviour the prose must encode

Per-level behaviour echoes the gateway dial, does not re-derive it: `low`/`medium` surface the cut candidate + proposed home, zero topology writes; `high` (default) proposes the cut + home and the human confirms "DoD still satisfied", then reparents into the real home; `full` acts (evaluates the DoD gate, reparents in one pass, logged). Never cancel/delete; never leave the issue parentless; never land it in a thematic bucket.

Idempotency / anti-thrash: a rehomed-out issue is no longer an MVP member (not re-cut), and a non-critical issue is never dragged back in by the inward gating-chain walk (that walk pulls only `blockedBy` prerequisites) — outward- and inward-rehome operate on disjoint sets.

Reversibility floor (reused, not restated): reparent reversible ⇒ permitted; cancel/delete ⇒ forbidden always — the lens's reading of the gateway dial's floor.

## 5. SCENARIOS — born-verifiable objectives

- At `high`, MVP DoD satisfiable without non-critical X → lens PROPOSES reparenting X into a real DoD-bearing home and asks the human to confirm; does not cut autonomously.
- At any appetite (incl. `full`): a scope reduction that cancels/deletes, or reparents to no home / a thematic bucket → refused.
- A non-critical issue already rehomed out → not re-cut and not dragged back in next pass (converges).
- The new prose contains no ticket / ADR references — dial and reparent capability named by section/capability.

## 8. DONE — Definition of Done

### From WHY
- [ ] The agile SKILL.md no longer forbids "reduce scope" flatly; the conflated line is split into **lost scope** (forbidden) vs **rehomed scope** (permitted under the gate).

### From WHAT (the rule split)
- [ ] *"What no appetite level does"* lists cancel/delete as **lost scope** — forbidden at every level incl. `full`.
- [ ] A permitted **rehomed scope** path is documented: reparent a non-critical MVP issue out into another outcome-led, DoD-bearing project.
- [ ] The rehome is gated on **both** (1) MVP DoD still satisfied after the cut, and (2) it lands in a real deliverable home — never void, never a thematic bucket.

### From HOW (behaviour)
- [ ] Per-level behaviour matches the gateway dial: `low`/`medium` surface only, `high` proposes for human confirm, `full` acts (cut + rehome, logged).
- [ ] No path can reduce scope to no home (parentless or thematic bucket is refused).
- [ ] Idempotency is stated: rehomed-out issue not re-cut, not dragged back in; outward/inward operate on disjoint sets.
- [ ] The reversibility floor is named as the lens's reading of the gateway dial, not a new invariant.

### From the self-containment principle
- [ ] The new prose contains no ticket / ADR references; dial and reparent capability named by section/capability name.
- [ ] `node plugin/skills/faff/bin/faff validate-adapters` passes for the edited skill (line caps, no stray markers, no duplicated blocks).

confidence: high
