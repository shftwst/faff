# FAFF-53 — Wire every faff skill's human-facing output through the renderer

> Spec: faffter-dark-nlspec · 2026-06-06 · confidence: high. Full spec on Linear FAFF-53.

## WHY
FAFF-52 (Done) defined the universal-renderer contract + prose-skimmability rule, but it's
inert until each skill applies it. This wires the gap skills.

## WHAT / HOW (doc-only, no code)
Audit: gateway/wtf/map + tidy/beep-boop (tabular) already routed; jot/prep/graft/plot did not.
- jot, prep, graft, plot: add a `## Rendering` note — all human-facing descriptions/comments/
  summaries pass through the rendering_adaptor normalise pass before emit/write (gateway →
  Rendering, Universal-routing rule); enumerable sets → lists.
- tidy, beep-boop: broaden the existing tabular-only renderer line to cover their description/
  comment writes (chain-gap tickets, park comments, run-summary tracker post).
- wtf, map: confirmed conformant; no change.

## Decisions
- Chosen: per-skill final pass (resolved by FAFF-52; no central emit point).
- Chosen: defer the optional CI "emits-without-render" check to a follow-up ticket (static
  prose detection is fuzzy; ties FAFF-48).

## DONE
- [x] jot/prep/graft/plot route human-facing output through the renderer.
- [x] tidy/beep-boop broadened beyond tabular.
- [x] wtf/map confirmed conformant.
- [x] validate-adapters + config PASS; diff limited to skill SKILL.md files.
- [ ] Follow-up ticket filed for the optional CI check (post-merge).
