# Spec — FAFF-115: Single-source the entry preamble (lean the duplicated boilerplate)

> Spec: faffter-dark-nlspec · 2026-06-19 · interactive · confidence: high.
> **Human steer (build-time):** the original spec's "add an Entry-preamble *home* + a refer-back-convention *rule* to the gateway" was dropped. Rationale: the gateway is always loaded into context when a skill runs, so a `gateway → Section` pointer is an **authoring** discipline, not a runtime lookup — documenting it *inside the runtime gateway* adds tokens for zero runtime value, and a "home" for the load-the-gateway *explanation* is near-circular (the bootstrap line that triggers the load must live in the skill regardless). So this ships as a pure **reduction**: tighten the 9 duplicated preambles, add nothing to the gateway. The refer-back convention, being authoring guidance, is deferred to **FAFF-120's** `docs/reference/skill-authoring.md` charter (off the runtime prompt).

## 1. WHY

The FAFF-114 audit found faff's shared prose was **already** single-sourced (every big rule — Untrusted-input, Rendering, eligibility, Agent Lanes — is reference-only). The one remaining duplicated, un-homed block was the `**Load the gateway first.**` entry preamble: 9 entry skills each carried ~100 words of identical generic boilerplate enumerating the shared rules. That enumeration is redundant — the agent reads those rules in the gateway it's told to load. This tightens each preamble to its irreducible core.

## 2. OUT OF SCOPE

- Any gateway edit (the gateway is left byte-for-byte identical to main).
- Cutting cruft inside the 9 sub-skill bodies beyond the preamble (FAFF-116/117).
- The other duplication clusters (already reference-only — FAFF-116/117).
- Documenting the refer-back convention (deferred to FAFF-120's authoring charter).

## 3. WHAT

Each entry skill's preamble is reduced to: the **bootstrap** ("if `faff/SKILL.md` isn't in context this turn, Read it now — it holds the shared rules + fixed contracts faff applies") + **only what's skill-specific** (the fixed contracts that skill uses, the slots it delegates to, and any unique note — e.g. onboard's "runs *before* a config exists" caveat, graft's consumer-of-`faff-contract:*`-blocks clause). The generic enumeration of shared rules (`.faffrc`, ignore-cancelled, logging, autonomous-mode, park, untrusted, …) is dropped from every skill — it's already in the gateway each one loads.

**Decision (Chosen, per the human steer):** pure per-skill tightening, **no** gateway home/convention/ToC. The bootstrap line stays in each skill (it can't be deduplicated — it triggers the gateway load).

## 4. HOW

Replace the single `**Load the gateway first.**` line in each of the 9 entry skills (faff-wtf/tidy/jot/plot/prep/graft/map/beep-boop/onboard) with the tight self-contained form. Re-baseline the FAFF-171 prompt-size floor for the reduction. Regression gate: the 3 `cli-driver.mjs` eval loaders still resolve (no gateway anchor touched), validate-adapters + node --test green.

## 5. SCENARIOS

- Each entry skill carries one tight preamble: bootstrap + skill-specific clauses only; the generic shared-rule enumeration appears in none of them.
- The gateway is unchanged → all 5 frozen anchors verbatim, the 3 loaders resolve.
- Full CI gate (validate-adapters + selftests + node --test) green.

## 8. DONE

- [x] Each of the 9 entry skills' preamble reduced to bootstrap + skill-specific clauses; the generic shared-rule enumeration removed from all of them.
- [x] No gateway edit; all 5 frozen anchors verbatim; the 3 eval loaders resolve non-empty.
- [x] No sub-skill body cruft cut beyond the preamble (FAFF-116/117).
- [x] FAFF-171 floor re-baselined for the net reduction (~-879 est tokens, -0.6%).
- [x] validate-adapters + selftests + node --test pass (330/330).

confidence: high
