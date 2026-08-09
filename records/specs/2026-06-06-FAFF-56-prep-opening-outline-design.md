# FAFF-56 — faff-prep should open with a plain-English outline of the issue being prepped

## WHY — Problem and scope
`/faff-prep`'s opening assumes the reader already holds the ticket in their head. Fresh prep (Scenario A) goes straight to "Step 1: Explore", producing openings like *"Fresh prep for FAFF-47 (its only comment is the earlier park verdict…). Let me explore…"* — unintelligible to anyone who doesn't already know the ticket. Resume prep (Scenario B) does brief the user, but only at Step 3, after freshness checks. This adds a short orienting **issue outline** at the very start of every prep run, before exploration narration.

Design principles:
- **Additive, not a rewrite.** Add an opening-outline instruction; leave Scenario A Step 1 and Scenario B Step 3 intact.
- **Reuse, don't redefine.** The outline uses the existing synthesis gloss; it does not define a new format.
- **Renders for free.** prep already routes all human-facing output through the `rendering_adaptor` (its `## Rendering` section, from FAFF-53), so the outline is skimmable automatically — no new routing.

### Out of scope
- Changing Scenario B's Step 3 "Brief the user" (the fuller post-freshness brief stays — the new outline is the quick opener that precedes it).
- Re-specifying output routing (already covered by the `## Rendering` section).

## WHAT — content and placement
One new instruction in `skills/faff-prep/SKILL.md`.

**Placement. Chosen:** a short subsection at the TOP of `## Scenarios`, before `### Scenario A`, applying to both scenarios. Both A and B run through `## Scenarios`; placing it once there covers both and reads before either Step 1.

**Outline fields. Chosen:** the synthesis gloss (plain-English one-liner) + current status + a one-line "what it's about", capped at ~3 lines. Do **not** require an AC count — fresh prep hasn't explored yet, so ACs are unknown at the opening.

**Autonomous mode. Chosen:** autonomous prep never prints to a human, so the outline opens the prep log (`.faff/.../prep.md`) instead of a chat message. Interactive: it's the first thing shown to the user.

## HOW — behaviour
Pure docs edit.
1. In `skills/faff-prep/SKILL.md`, locate `## Scenarios` (by heading), insert a subsection immediately after it and before `### Scenario A`.
2. Content: instruct prep to emit the issue outline (synthesis gloss + status + one-line what-it's-about, ≤3 lines) as the first output of any prep run, before Step 1 — interactive: first user message; autonomous: opening lines of the prep log.
3. Reference the synthesis gloss by name — it lives in the **sibling gateway** (`faff/SKILL.md` → Synthesis contract / `rendering_adaptor`), not in faff-prep — and note the outline routes through the `rendering_adaptor` per prep's existing `## Rendering` section.
4. Leave Scenario A Step 1 and Scenario B Step 3 unchanged.

Locate anchors by heading content, not line number.

**Risks/edges.** Duplicating Scenario B's Step 3 brief — mitigated by framing the opener as a 1–3 line orient, with Step 3 staying the fuller brief. Over-editing — additive only.

## DONE — Definition of Done
- [ ] `skills/faff-prep/SKILL.md` has a new opening-outline instruction at the top of `## Scenarios`, before `### Scenario A`.
- [ ] The instruction specifies the outline = synthesis gloss + status + one-line "what it's about", ≤~3 lines, and does NOT require an AC count.
- [ ] The instruction states it runs before Step 1 in BOTH scenarios.
- [ ] The instruction covers autonomous mode: outline opens the prep log, not a chat message.
- [ ] It references the existing synthesis gloss (sibling gateway) + `## Rendering` routing rather than redefining either.
- [ ] Scenario A Step 1 and Scenario B Step 3 are unchanged; diff is additive.

confidence: high
