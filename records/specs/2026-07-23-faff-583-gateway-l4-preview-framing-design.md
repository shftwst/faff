# Spec — FAFF-583: one honest L4 framing in the gateway levels section

> Spec: faffter-dark-nlspec · 2026-07-22 · autonomous · confidence: high. Full spec on Linear FAFF-583.

This spec is for the build agent (and human reviewers) who will apply a small, contained prose fix to the always-loaded gateway skill, `plugin/skills/faff/SKILL.md`. It touches wording only — no code, no CLI, no behaviour.

## 1. WHY — Problem and Principles

**The load-bearing model.** The gateway's levels section makes a *maturity claim* about L4 in two adjacent places — a table row and the narrative bullet under it. For a trust product, those two claims must agree, because a reader calibrates how far to trust an autonomous run off exactly this wording. Today they disagree within one screen, so the fix is to pick one honest framing and say it once in both spots.

**Problem statement.** The levels table (`plugin/skills/faff/SKILL.md:21`) labels the top rung "**L4 · out** of the loop (preview)", while the narrative bullet directly below (:26) opens "**L4 · out of the loop.** Lights-out, and shipped". A reader sees both "preview" and "shipped" asserted about the same rung on the same screen. The honest state is neither pure claim: the v1 machinery (fail-closed preflight, the strict-defaults L4 run-ledger, the trust banner) is real and shipped, but the holdout lane "has not yet completed a real end-to-end run" (:37) — so L4 is *shipped as a preview*, and the prose should say that once, consistently.

**Design principles.**

- **One framing, stated once per locus.** The single honest reconciliation is "shipped as a preview": machinery shipped, holdout lane not yet exercised end-to-end. It must read the same in the table row and the bullet. This is the framing FAFF-351 already established at :21 and :37 — the fix restores the bullet to it, it does not invent a new label.
- **Minimal blast radius.** Wording change only, confined to the levels section of the one file. Do not restyle the table, renumber levels, touch the lights-out banner, or edit any other doc — the banner and sibling guide docs are owned elsewhere (FAFF-351 shipped the banner; FAFF-570 owns the guide docs).
- **Skimmability lint holds.** The gateway is a `SKILL.md` under the `faff validate-adapters` lint; the edited lines must keep line-length / paragraph rules and stray-marker rules so CI stays green.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/SKILL.md` (levels section, ~lines 16–39) | Markdown | The always-loaded gateway; the only file this issue edits. Lines 21 (table row) + 26 (bullet) are the fix sites; line 37 (mechanical/model-compliance table) is the already-honest anchor to match. |

**Scope statement.** This is a prose-honesty correction to the gateway's public front page; it sits within the trust-maturity labelling story that FAFF-351 (Done) owns.

## 2. OUT OF SCOPE

- **The lights-out banner** — Why excluded: FAFF-351 already shipped the "(preview)" label into the banner; re-touching it is out of this ticket. Extension point: the `faff lights-out` banner-minting path in the CLI (`lightsOutPreflight` / banner writer), if the maturity label ever changes again.
- **The `docs/guide/*` enforcement-claim honesty pass** — Why excluded: that overclaim-of-enforcement class in `docs/guide/unattended.md` and `architecture.md` is FAFF-570's job (different files, distinct class). Extension point: FAFF-570.
- **Any change to what L4 *is* or how mature it actually is** — Why excluded: this is a wording fix, not a maturity re-grade; the underlying preview status (holdout lane not yet run end-to-end) is unchanged. Extension point: FAFF-351's guarantee-table framing / the holdout-lane end-to-end run tickets.
- **Line 37's model-compliance cell** — Why excluded: it already reads "**L4 (preview)** … **preview** — the holdout lane has not yet completed a real end-to-end run", which is the honest anchor. Leave it verbatim. Extension point: none needed.

## 3. WHAT — the exact edits

Two edit sites in `plugin/skills/faff/SKILL.md`, both in the levels section. Wording is illustrative — the reviewer/builder may tune phrasing so long as both loci carry the single "shipped as a preview" framing and the skimmability lint passes.

**Edit A — the levels table row (line 21).** State "preview" once in the row rather than twice. Current:

```
| **L4 · out** of the loop (preview) | off down the pub | the agent | adversarial review + isolated holdout *(preview)* | `faff lights-out` |
```

Target: keep the "(preview)" on the level name (the row's maturity marker) and drop the now-redundant trailing `*(preview)*` in the "what keeps it honest" cell, so the row asserts preview a single time:

```
| **L4 · out** of the loop (preview) | off down the pub | the agent | adversarial review + isolated holdout | `faff lights-out` |
```

**Edit B — the narrative bullet (line 26).** Replace the overclaiming opener "Lights-out, and shipped" with the honest "shipped as a preview" framing. Current opener:

> **L4 · out of the loop.** Lights-out, and shipped: `faff lights-out` is the single entry point that promotes an L3 run to L4.

Target opener (rest of the bullet unchanged — it already ends with the "Still maturing … the preview tag … being formalised" clause, which now reads consistently):

> **L4 · out of the loop.** Lights-out, shipped as a preview: `faff lights-out` is the single entry point that promotes an L3 run to L4.

**Design decisions.**

**Which honest framing?** Options: (a) call L4 "shipped" (drop the preview tags) — rejected, it overclaims: the holdout lane hasn't run end-to-end (:37). (b) Call L4 "preview/not shipped" (drop the shipped language) — rejected, it underclaims: the preflight, ledger, and banner machinery genuinely shipped. (c) "shipped as a preview" — the machinery is real, the lane is not yet exercised. **Chosen:** (c) "shipped as a preview" — it is the only framing true to both facts, and it matches the "(preview)" table tag and the :37 anchor FAFF-351 already shipped, so the section becomes internally consistent rather than newly labelled.

**State preview once, or leave the table row's double tag?** The row currently carries "(preview)" on both the level name and the honesty cell. **Chosen:** state it once — keep the level-name "(preview)" (the row's canonical maturity marker, aligned with the :37 table's "**L4 (preview)**") and drop the redundant cell parenthetical. Saying it twice in one row is the same say-it-once concern the ticket raises across the table/bullet, applied within the row.

## 4. HOW — Behavior

There is no runtime behaviour. The "procedure" is the edit itself:

```
PROCEDURE apply_fix(gateway = plugin/skills/faff/SKILL.md):
  1. Edit A: in the L4 table row, remove the trailing " *(preview)*" from the
     "what keeps it honest" cell; leave the level-name "(preview)" intact.
  2. Edit B: in the L4 narrative bullet, change the opener
     "Lights-out, and shipped:" to "Lights-out, shipped as a preview:".
  3. Leave line 37 (the mechanical/model-compliance table's L4 row) unchanged.
  4. Run the skimmability lint (`faff validate-adapters`) and confirm it passes.
```

**Anti-pattern:** rewording line 37 or the lights-out banner to "match." Why: line 37 is already the honest anchor, and the banner is FAFF-351's shipped surface — touching either widens the blast radius past this ticket and risks re-litigating settled wording.

## Scenarios

The objective — the section reads one consistent maturity claim for L4 — is a concrete, checkable outcome, so it is born-verifiable:

```
Given the gateway levels section of plugin/skills/faff/SKILL.md
When a reader reads the L4 table row (:21) and the L4 narrative bullet (:26) together
Then both convey "shipped as a preview" (machinery shipped, holdout lane not yet run end-to-end)
And neither asserts a bare "shipped" that contradicts the "(preview)" framing
```

- The `faff validate-adapters` skimmability/lint gate MUST pass on the edited file.

## 6. DESIGN DECISION RATIONALE

**What single framing reconciles "preview" and "shipped"?**
- *Options:* "shipped" (overclaims — holdout lane unrun); "preview/not shipped" (underclaims — machinery is real); "shipped as a preview" (true to both).
- **Chosen:** "shipped as a preview" — the one framing consistent with both the real v1 machinery and the not-yet-run holdout lane, and already the framing at :21's tag and :37's anchor. It closes the contradiction without inventing a new label. Temporal anchor: as of writing, the holdout lane has not completed a real end-to-end run (:37); when it does, the "(preview)" framing is revisited (FAFF-351's home).

**State preview once or twice in the table row?**
- *Options:* keep the double "(preview)" (name + cell); state once (name only).
- **Chosen:** state once — keep the level-name "(preview)", drop the redundant honesty-cell tag; the level name is the canonical maturity marker (matches :37's "**L4 (preview)**").

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — no `**Punt:**` items.

**Assumptions:** none load-bearing. (Line numbers 21/26/37 are current at HEAD; the builder locates the edit sites by the quoted text, not the line numbers, in case the file has drifted — the fix targets the L4 table row and the L4 bullet by content.)

## 8. DONE — Definition of Done

### From WHY
- [ ] The gateway levels section no longer asserts both "(preview)" and a bare "shipped" for L4 on the same screen.

### From WHAT (the edits)
- [ ] The L4 table row (:21) states "(preview)" once — on the level name — with the redundant `*(preview)*` removed from the "what keeps it honest" cell.
- [ ] The L4 narrative bullet (:26) opens with the "shipped as a preview" framing instead of "and shipped".
- [ ] Line 37 (mechanical/model-compliance table L4 row) is unchanged.
- [ ] No file other than `plugin/skills/faff/SKILL.md` is edited; the lights-out banner and `docs/guide/*` are untouched.

### From HOW (lint)
- [ ] `faff validate-adapters` passes on the edited gateway (skimmability / line-length / stray-marker rules hold).

**Integration smoke test:**

```
PROCEDURE smoke:
  1. Open plugin/skills/faff/SKILL.md to the levels section.
  2. Confirm the L4 row and the L4 bullet both read "shipped as a preview" (or equivalent one-framing wording).
  3. Run `faff validate-adapters` — exit 0.
```

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" } ] }
```
