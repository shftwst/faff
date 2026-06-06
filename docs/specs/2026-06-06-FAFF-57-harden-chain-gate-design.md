# FAFF-57 — Harden the interactive chain-to-build gate

> Spec: faffter-dark-nlspec · 2026-06-06 · confidence: high (Punt resolved → Option A, always-ask). Full spec on Linear FAFF-57.

## WHY
/faff-prep chained into /faff-graft (→ PR → merge) on FAFF-50/47 because the build gate was
folded into an unrelated decision's options. The gateway Chaining-pattern contract permitted a
"short-choice Build/Review/Reprep" prompt but never forbade bundling chain-consent into an
unrelated resolution.

## WHAT / HOW (doc-only: gateway + prep)
- Gateway ## Chaining pattern hardened: the gate is a dedicated standalone decision; resolving a
  spec/approach/scope/name decision is NOT chain-consent; bundling "resolve X" + "proceed to Y"
  in one option is a contract violation; the only triggers are a standalone-gate affirmative or
  an explicit prior user instruction; interactive-only; autonomous chaining is the orchestrator's
  (beep-boop) job — a sub-skill never auto-chains from within itself; honest-limit note (not
  statically lintable).
- prep Step 3 build gate restates: invoke graft only on the standalone affirmative; never bundle;
  on medium→resolve, re-present the standalone build gate (resolving a punt is not build consent).

## Decisions
- Chosen: Option A (always-ask), no config knob, no hard-B. Autonomous = beep-boop orchestrates.

## DONE
- [x] Gateway states standalone gate / resolving≠consent / no-bundling / only-triggers / interactive-only + orchestrator-owns-autonomous / honest-limit.
- [x] prep build gate restates standalone + resolving≠consent.
- [x] No config knob added (always-ask).
- [x] validate-adapters + config pass; diff limited to faff/SKILL.md + faff-prep/SKILL.md.
