# ADR 0079 — Self-hosting core-defect intake is execution-side bookkeeping — a sanctioned outward-self-intake classification, not a floor edit

- **Status:** Accepted
- **Provenance:** human
- **Date:** 2026-07-17
- **Issue:** FAFF-536

## Context

faff's scope-containment gate (FAFF-217/221) answers one question — is a discovered item's intended parent inside the subtree of the run's *mandate*? — and the appetite **hard floor** says an `outward` item is **never auto-filed at any appetite including `full`**; a human sanctions a new root via `/faff-jot`. That floor exists to stop an agent building a feature from spawning arbitrary new *product* scope in someone's roadmap.

In a **self-hosting repo** (faff building faff) the floor has a sharp edge. A core defect discovered while building ticket X is almost always outside X's subtree, so *every* faff-core discovery classifies `outward` and falls to a human. During run-20260716-152942-beepboop-full three genuine faff-core defects (FAFF-531/532/533) were discovered by the run but none were auto-filed — the run could only wave at them. The bottom-up "self-extend from doing" tributary (design/planning-loop.md) is nearly inert for faff-on-faff.

The tension is that `outward` conflates two different acts: **spawning new product direction** (what the floor guards) and **recording an observed defect into the same repo's own designated intake bucket** (execution-side bookkeeping). ADR-0069 draws faff's own trust line at **execution-autonomy (in-policy)** vs **direction-autonomy (out-of-policy)**, and reserves any relaxation of a self-hosting safety stance for a **conscious, superseding decision — never a silent default flip**. This ADR is that conscious act, sanctioned by human decision on 2026-07-17.

## Decision

**Sanction a bounded self-hosting core-defect intake lane, expressed as a NEW classification (`outward-self-intake`) computed at the filing chokepoint — never as an edit to the hard floor or to the `contain.js` primitive.**

The relaxation is admitted because filing a Backlog record of an observed defect into faff's own `faff-jot-intake` bucket is **execution-side bookkeeping under ADR-0069's line, not direction-setting**: it records an observation and decides nothing about what faff becomes. The ticket lands in `Backlog` with **no** `faff-automate` label; the human still shapes, gates, and admits it (or deletes it) through the unchanged eligibility gate — exactly as with a hand-jotted note. It is legibly reversible: the lane is default-off config, so retreat is a one-line revert.

The sanction is fenced by load-bearing, individually-fail-closed guardrails:

- **The hard floor is never edited.** "outward-new-root is never auto-filed at any appetite including `full`" stays byte-identical in the gateway, beep-boop, and tidy. An item earns `outward-self-intake` *before* the floor is consulted; everything that remains `outward-new-root` still hits the floor unchanged.
- **`contain.js` stays pure and repo-blind.** The primitive's verdict is still `outward`; the self-hosting signal is a wiring-layer input at the chokepoint, exactly as the project-mandate autonomous ceiling is. `subtreeContains` gains no repo concept; its selftests pass byte-identical.
- **Config opt-in AND structural check, each fail-closed.** The lane fires only when `containment.self_hosting_intake: true` (registry default `false`) **and** the candidate's intended home resolves to the mandate's own configured tracking team/repo (the run-outward SelfRef comparator shape). Either side unresolvable ⇒ `outward-new-root`. Neither condition alone suffices — an adopter's own repo never silently opts in, and an opted-in repo never files to a *different* team.
- **Deduped, appetite-gated, provenance-stamped.** Filings dedupe against open `faff-jot-intake`/`faff-chain-gap-fill` tickets, ride the existing Execution-discovered appetite row (`low` surface-only … `high`/`full` file), and stamp `faff intake-record --via jot --initiated autonomous`. No `--via fast-track` self-call ever converts an outward item — fast-track stays the human-override lane.

Cross-repo / cross-team outward items — the exact case the floor exists for — are untouched: they are never filed at any appetite.

## Consequences

- **The floor's unconditionality is preserved as prose and as code.** The gateway/beep-boop/tidy floor sentence is only *annotated* to name the new classification and its gate; it is never weakened. `contain.js` is unchanged.
- **Self-hosting discovery becomes visible and, when sanctioned, fileable.** Phase 1 (orchestrator-lane discovered-scope capture) ships unconditionally and makes orchestrator-hit defects (the FAFF-531 class) reach the run summary and `/faff-wtf` at minimum. Phase 2's lane, when switched on, files the same-repo core-defect records the floor previously stranded.
- **Reversible by conscious act.** Consistent with ADR-0069, this is a policy stance behind a default-off dial and a superseding ADR — not a code lock and not a silent flip. Switching `containment.self_hosting_intake` back to `false` restores today's behaviour byte-for-byte.
- **The trust boundary is unchanged, not widened.** The self-hosting check inherits FAFF-354's agent-sourced-ancestry boundary: `--record` binds the walked payload for `faff audit` recompute-and-compare (detective, not preventive). No new exposure beyond what containment already carries.
- **Watch item.** If the lane files junk (concrete-looking non-defects the human deletes rather than shapes), the named valid outcome is to tighten the `concrete` bar or switch the lane off — the default-off config makes that a one-line retreat.
