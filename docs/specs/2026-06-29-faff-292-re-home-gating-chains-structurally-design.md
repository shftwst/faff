# Re-home gating chains structurally, not view-only — reparent the blocker chain into the gated MVP

> Spec: faffter-dark-nlspec · 2026-06-29 · autonomous · confidence: high. Full spec on Linear FAFF-292.

## Why

The agile lens's **"Re-homing gating chains into the stream they gate"** is today explicitly a *sequencing view only*. Its own prose (`faffter-dark-methodology-agile-delivery/SKILL.md`): *"Re-homing is a sequencing view, not a mutation… it never reparents a ticket, rewrites its container, or edits blocker links."* So the lens fixes the **order** a cross-container blocker shows up in, but never its **home**: the blocker stays parked in a thematic project while the gated MVP *reads* as sequenced but is silently stuck. That is the gap behind "I thought we fixed this" — the L4 "Down the pub" MVP was the right vertical-slice shape but real blockers lingered in their thematic homes because the lens could only reorder a presentation.

The shared authority model that makes a structural fix safe now exists: the gateway's **Appetite for destruction → Topology-write authority** dial (the third shared-contract modulation) defines per-appetite how much tracker-topology-writing authority the methodology holds, plus the anti-thrash + legibility guardrails and the reversibility-floor + DoD-ceiling invariants. The agile lens already **references** that dial (its `## Appetite integration` opens with *"Authority over tracker topology is the gateway's dial, not re-derived here"*). What is missing is the lens actually *using* that authority for re-homing: turning the view-only re-home into a real reparent governed by the dial.

## What

Make re-homing a **structural move**, not a presentation reorder. When a value stream (an MVP / outcome project) is `blockedBy` work outside it, **reparent that blocker — and its transitive unstarted `blockedBy` chain — INTO the gated stream as critical path, deepest-first**: a real `parentId` / project-membership move plus the preserved blocker edges, not just a reordered queue. This **supersedes** the view-only clause; it does not add a parallel mechanism.

The reparent authority is **governed by the gateway Topology-write-authority dial** — it is not a new, lens-local authority story. Per that dial: surface-only at `low`, **act on clear chains at `high`** (drag the chain in), `full` owns it end-to-end; bounded at every level by the dial's reversibility floor (reparent is reversible ⇒ allowed) and the human-curated-structure floor (faff-authored topology only — a human-curated boundary stays propose-and-confirm). The agile lens keeps only its own seven-principle *flavour* of the move (deepest-first, value × risk ordering across the combined set); it does not restate the dial's levels.

This change **unblocks** FAFF-294 (scope-reduction-by-rehome) and FAFF-295 (no-thematic-projects) — both consume this same reparent authority — so the prose must establish reparent as the lens's topology-write primitive cleanly enough for those siblings to build on it.

## How

A prose-only change to one file: `plugin/skills/faffter-dark-methodology-agile-delivery/SKILL.md`. No CLI, no contract block, no new eval seam (consistent with ADR-0035's "prose + ADR" shape). Three loci change; the dial-reference paragraph in `## Appetite integration` stays as-is (it already points at the gateway dial).

- **Re-homing becomes a structural reparent governed by the gateway dial, superseding the view-only clause.** Rewrite the paragraph currently headed *"Re-homing is a sequencing view, not a mutation."* The replacement states forward: re-homing **reparents** the gating chain into the gated stream (real container/`parentId` move + preserved blocker edges) as critical path, and that this authority is the gateway **Appetite for destruction → Topology-write authority** dial — surface-only at low, act at high, full owns it — never re-derived here. Keep the downstream-composition note that faff-beep-boop's conflict-analysis still owns concurrent-safety serialisation over whatever the lens presents.
- **The `## Re-homing gating chains into the stream they gate` body (steps 1–5) gains the reparent action.** At acting appetite, each chain member is **reparented** into the gated stream (deepest-first), with its `blockedBy` edges preserved, then the combined set is ordered by value × risk. The existing walk, cycle-deferral, and dead-end naming are unchanged — only the terminal action goes from "present in order" to "reparent + present in order."
- **A chain that gates two streams reparents once, into the earliest stream that needs it** — lifted from order-only to home-of-record. Never reparent the same blocker into two streams.
- **Cycles defer to the structural cycle-detector — never reparent through a cycle.** A member reachable only through a `circular-blocked` edge is *not* reparented; the cycle surfaces as the existing `circular-blocked` diagnostic.
- **Idempotent / anti-thrash convergence is load-bearing and stated in the prose.** Once a blocker's home is the gated stream, re-running the lens recognises it as already-homed and is a no-op.
- **The `high` and `full` appetite bullets drop "never reparents".** Reword so `high` re-homes by reparenting clear chains (per the dial), and the `full` "Reparent misplaced tickets" bullet reads coherently with gating-chain reparent now being a `high`-and-above capability.
- **Reference the dial by its gateway section name, never by a ticket id (self-contained-prose floor, `faff lint-refs`).** All new prose names **Appetite for destruction → Topology-write authority**; it introduces **no** `FAFF-NN` / `ADR-NNNN` reference.

**Assumes:** the gateway Topology-write-authority dial exists and is referenced by the lens (validated against `origin/main`; the build branches from post-291 `main` and only consumes the dial + reference paragraph).

## Done — acceptance

- The lens's gating-chain re-home is described as a **reparent into the gated stream** (real container/`parentId` move + preserved blocker edges), deepest-first — **not** a presented order. The superseded *"sequencing view, not a mutation … never reparents"* clause is gone, and no residual "never reparents" wording remains in the `## Re-homing …` section or the `high`/`full` appetite bullets.
- The reparent authority is **governed by the gateway Topology-write-authority dial** (named by section), not by a lens-local re-derivation of the appetite levels.
- **Idempotent across consecutive passes**: the prose states an already-homed chain is a no-op next pass (no bounce-back / thrash).
- A blocker gating two streams reparents **once** (earliest stream); cycles are **never** reparented through (defer to the `circular-blocked` detector).
- **`faff lint-refs` passes** on the file (no new external refs), and `faff validate-adapters` passes (lean/dedup lint).
- Note recorded that this establishes the reparent primitive FAFF-294 + FAFF-295 consume.
