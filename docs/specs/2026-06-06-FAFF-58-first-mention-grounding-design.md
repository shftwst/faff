# FAFF-58 — Synthesis contract: ground every ticket ID with its gloss on first mention

## WHY — Problem and scope
The synthesis contract (`faffidavit-rendering` → **Synthesis — the issue-gloss contract**) says every surfaced issue is `tracker ID + plain-English gloss`, and the **Humanisation rule** carries a reader-understanding *test*. But that test is **soft and unmechanical** — it didn't stop a real `/faff-tidy` run from referencing FAFF-21 ~5 times without ever glossing it, forcing a tracker lookup. This ticket **operationalizes** that intent: a crisp, checkable first-mention grounding rule + a validate-pass entry, so ungrounded-ID output is mechanically caught and fixed.

Design principles:
- **Operationalize, don't duplicate.** This makes the existing Humanisation reader-test *enforceable* as a concrete first-mention rule + a Checks-list entry. It is **subordinate to** the Humanisation rule, never a replacement.
- **No loophole.** First-mention grounding is the mechanical floor. A bare *later* reference must still satisfy the Humanisation reader-test in its context — if a section reads unintelligibly with a bare ID, re-ground it there.
- **Additive + one enforcement home.** New subsection + one Checks bullet; all skills already route through the `rendering_adaptor` normalise pass, so it covers every skill.

### Out of scope
- Per-skill edits — the normalise pass covers them.
- Reworking the Humanisation rule, gloss format, or generation-source-order (unchanged).
- Skill source files / `.faff/` logs — already rendering-scope carve-outs.

## WHAT — content
Two additive edits to `skills/faffidavit-rendering/SKILL.md`.

1. **New `### First-mention grounding` subsection under `## Synthesis`.** The **first** appearance of an issue ID in a given output carries its gloss (`ID + gloss`, per Canonical rendering); later same-output references may be bare ID; an ID that appears only ever bare (never grounded) is a violation. **Explicitly note:** this does not supersede the Humanisation rule — bare later mentions must still pass its reader-understanding test, and a skill should re-ground in a section where a bare ID would read unintelligibly.
   **Chosen (granularity):** per-whole-output — one grounding anywhere satisfies the mechanical rule; per-section re-grounding is a readability nicety the Humanisation test may require but the mechanical rule doesn't.

2. **New bullet on the `## Validation / normalise` → Checks list:** "an issue ID that is never grounded by its gloss anywhere in the output (bare-ID-only)."
   **Chosen (normalise behaviour):** on violation, **rewrite** — inject the gloss at first mention when derivable (per Generation source order); if it can't be derived, **flag** (`where → which rule → the fix`). Matches the prose-skimmability rewrite-not-flag precedent.

## HOW — behaviour
Pure docs edit.
1. Under `## Synthesis — the issue-gloss contract`, add the `### First-mention grounding` subsection (place it among the existing synthesis subsections; reference the Humanisation rule by name for the subordination clause).
2. Append the new check bullet to the existing `**Checks:**` list under `## Validation / normalise`.
3. Leave all other subsections unchanged.

Locate anchors by heading content, not line number.

**Risks/edges.** Over-strictness (forcing a gloss on *every* reference) defeats the ID-only-after-first-mention allowance — keep it first-mention-only. Queue grids already carry per-row glosses, so they ground inline; no conflict. The loophole risk (grounded-once-then-unintelligibly-bare) is closed by the explicit subordination to the Humanisation test.

## DONE — Definition of Done
- [ ] `skills/faffidavit-rendering/SKILL.md` has a new `### First-mention grounding` subsection under `## Synthesis`.
- [ ] It states: first ID mention carries the gloss; later same-output references may be bare; a never-grounded ID is a violation.
- [ ] It records per-whole-output granularity AND explicitly subordinates to the Humanisation rule (bare later mentions must still pass the reader-test; re-ground per section where needed).
- [ ] The `## Validation / normalise` Checks list has a new bullet for bare-ID-only (never-grounded) output.
- [ ] Normalise behaviour specified: rewrite (inject gloss at first mention) when derivable, else flag.
- [ ] Diff is additive — no existing subsection reworded; limited to `faffidavit-rendering/SKILL.md`.

confidence: high
