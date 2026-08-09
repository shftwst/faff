# FAFF-55 — Establish faff's governing principles (the four tenets)

## WHY — Problem and scope
faff has four guiding instincts that already shape its design, but they live implicitly — scattered across the levels table, the slots model, the CLI, and the rendering contract. Nothing names them, so they can't be pointed to as a tie-breaker when a spec or build needs one, and a contributor must infer the philosophy from the code. This adds a first-class **Governing principles** section to the gateway (`skills/faff/SKILL.md`) stating the four tenets as the north-star every spec/build/slot/ticket is checked against, each anchored to the mechanism that already embodies it.

Design principles for this change:
- **Additive, not a rewrite.** State the tenets and point at existing sections; do not rewrite the levels table, slots section, CLI docs, or rendering contract.
- **Concrete, not abstract.** Each tenet names the existing **mechanism / gateway section** that embodies it, so it reads as description-of-reality, not aspiration.
- **Eat our own dog food.** The section is itself skimmable — the "understandable" tenet applied to its own prose.

### Out of scope
- **Active enforcement.** Making spec/review mechanically check a change against the tenets. **Chosen: this section is declarative only.** Enforcement is a genuine future direction call and a separate ticket — extension point: add a tenet-conformance check to the review slot later.
- **Backlog ticket IDs in the shipped doc.** The gateway prose references *mechanisms and sections*, not backlog ids (see WHAT → cross-reference style). The id mapping lives in this spec as build provenance only.
- **Rewording/relocating the embodying sections**, and **enumerating other cross-cutting constraints** (FAFF-21 mentions a "constraint ②"; cataloguing them is not this ticket).

## WHAT — content and placement
No code/types/API. One new markdown section in `skills/faff/SKILL.md`.

**Placement. Chosen:** insert `## Governing principles` immediately after `## What faff is` and before `## Routing`. Foundational framing, and "What faff is" already gestures at the tenets (levels = adoptable, slots/appetite = configurable). Alternative (an appendix near Core contracts) buries the philosophy below mechanics.

**The four tenets. Chosen: these exact four, prescriptive** (user-specified). Each rendered as: a bold "X, not Y" lead · 1–2 sentence meaning · an "Embodied by:" line naming the stable mechanism/section.
- **Deterministic tools over prose** — mechanical/contractual work lives in testable, reproducible tools; the LLM is for discovery, judgement, insight, not executing contracts. *Embodied by:* the `faff` CLI (`config` / `runcheck` / `validate-adapters`, see Configuration).
- **Configurable, not opinionated** — every behaviour is a swappable slot over a fixed contract; defaults you can override, not opinions you must accept. *Embodied by:* the slots/adaptor model + `.faffrc` + the appetite dial (see Configuration / Core contracts).
- **Adoptable, not all-encompassing** — faff integrates rather than owns: any tracker via MCP, git-only fallback, your own agents; adopt as much of L1→L4 as you want. *Embodied by:* the levels table (What faff is), git-only mode, tracker autodetect, slot delegation.
- **Understandable, not unapproachable** — skimmable, low-cognitive-load output; the human can always follow what faff did and why, and trust it. *Embodied by:* the `rendering_adaptor` / synthesis gloss (Core contracts) and human-readable `.faff/` logs.

**Cross-reference style. Chosen:** the gateway prose references **mechanisms + gateway section names only** — no backlog ticket IDs (they go stale and don't belong in product docs). *Build provenance (for the implementer, not the shipped doc):* the tenets drive FAFF-21/FAFF-11 (deterministic), FAFF-18/FAFF-15 (configurable), FAFF-52/FAFF-53/FAFF-56 (understandable).

## HOW — behaviour
Pure documentation edit.
1. Open `skills/faff/SKILL.md`; locate the insertion point **by heading content** (`## What faff is` → `## Routing`), not line number.
2. Insert a new `## Governing principles` section between them.
3. Write the four tenets in the shape above (bold "X, not Y" lead · 1–2 sentence meaning · "Embodied by:" mechanism/section line).
4. Match the gateway's existing cross-reference style (section names in prose); **no invented labelling scheme; no backlog ticket IDs** in the section.
5. Leave every referenced section unchanged.

**Risks/edges.** Over-editing referenced sections (avoid; additive only). Aspirational tone (mitigate by leading each "Embodied by" with the real mechanism). Staleness (mitigated by referencing stable section names, not ids).

## DONE — Definition of Done
- [ ] `skills/faff/SKILL.md` has a new `## Governing principles` section located between `## What faff is` and `## Routing`.
- [ ] The section states **exactly these four** tenets, each with a bold "X, not Y" lead + 1–2 sentence meaning: deterministic-tools-over-prose, configurable-not-opinionated, adoptable-not-all-encompassing, understandable-not-unapproachable.
- [ ] Each tenet has an "Embodied by:" line naming ≥1 existing mechanism/gateway section.
- [ ] The section contains **no backlog ticket IDs** and no invented labelling scheme.
- [ ] No content in the referenced sections is modified — the diff is additive and limited to the new section.
- [ ] The section is skimmable: bold-lead bullets, no run-on paragraph.
- [ ] Enforcement is left out (declarative-only); the section does not imply spec/review actively checks against the tenets.

---
**Self-review audit trail:** clean-context Explore reviewer verified the insertion point, all three CLI subcommands, the levels table, slots model, `.faffrc`, appetite dial, and the synthesis gloss — all real; confirmed no cross-cutting constraints are enumerated in the gateway. Findings: #1 "fabricated ticket IDs" — dismissed (reviewer has no tracker visibility; the IDs are real Linear tickets). #2 ticket-ID coupling (major) — applied (gateway references mechanisms/sections only; IDs kept as spec-level provenance). #3 prescriptive-vs-example (minor) — applied. Net: 0 blockers, 1 major + 1 minor, both applied.

confidence: high
