# FAFF-52 — Renderer as the universal contract for human-facing output

> Spec: faffter-dark-nlspec · 2026-06-06 · confidence: high. Full spec on Linear FAFF-52.

## WHY
faff output is hard to skim: enumerable sets get crammed into dense ·/comma run-on paragraphs.
The rendering_adaptor was scoped to terminal output only (tracker descriptions/comments ungoverned)
and had no prose-skimmability rule. This ticket defines the contract; wiring each skill is FAFF-53.

## WHAT / HOW (doc-only: gateway + faffidavit-rendering)
- **Gateway Universal-routing rule:** all human-facing output (terminal + tracker descriptions +
  comments) routes through the configured rendering_adaptor's normalise pass before print/write.
  Carve-outs: skill source files + .faff/ logs. Per-skill final pass (no central emit point).
- **faffidavit-rendering scope** widened from "terminal output" to "all human-facing faff output";
  the table-vs-list scope line widened to match.
- **Prose-skimmability rule** added (folded into Validate/normalise as a rewrite):
  3+ enumerable items → list (never ·/comma run-on); bold-lead bullets; prose density cap
  (~3 sentences / ~4 lines). The FAFF-49 Open-questions run-on is named as the anti-example
  (FAFF-49 itself not edited).

## Decisions
- Chosen: per-skill final pass vs single chokepoint (no central emit function exists).
- Chosen: rewrite, not just flag (acceptance = dense output cannot be produced).
- Chosen: 3+ → list, reusing the existing 3+ inline-chain threshold; ~3 sentence / ~4 line cap.

## DONE
- [x] Gateway states universal routing (terminal + tracker desc + comments); carve-outs named.
- [x] faffidavit-rendering scope = all human-facing output; carve-outs intact.
- [x] Prose-skimmability rule present, folded into normalise as a rewrite.
- [x] FAFF-49 named as the anti-example; FAFF-49 not edited.
- [x] Diff limited to faff/SKILL.md + faffidavit-rendering/SKILL.md (no skill wiring → FAFF-53).
