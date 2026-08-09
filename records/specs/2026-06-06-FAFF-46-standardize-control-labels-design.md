# FAFF-46 — Standardize faff control labels to the faff- prefix

> Spec: faffter-dark-nlspec · 2026-06-06 · confidence: high (names ratified). Full spec on Linear FAFF-46.

## WHY
faff control labels were inconsistently named. Standardize every faff-owned control label to `faff-…`.

## WHAT (ratified names)
- `automation-hold` → `faff-automation-hold`
- `parked-by-faff`  → `faff-parked`
(`faff-jot-intake`, `faff-chain-gap-fill` already conform.)

## HOW
- **Code/doc (this PR):** rename the two literals across the skill SKILL.md files; add the
  `faff-`-prefix control-label convention to the gateway. Historical `records/specs/*` left as-is.
- **Tracker (human-run):** the Linear MCP has no rename-label tool, so the in-place rename is
  done in the Linear UI (Settings → Labels → edit name), which preserves all ~40 associations
  atomically. This is the side-effect-outside-PR step — human-supervised by design.
- **Ordering:** rename the Linear labels FIRST, then merge this PR. Merging before the rename
  would make faff look for the new names while the tracker still has the old ones, briefly
  dropping every hold. CI (validate-adapters / config) is unaffected by the label literals.

## DONE
- [x] Names ratified (faff-automation-hold + faff-parked).
- [x] Literals renamed across the SKILL.md files; 0 stale literals in skills/.
- [x] Gateway states the faff- control-label convention.
- [x] validate-adapters + config still PASS.
- [ ] (human) Linear labels renamed in-place; held count unchanged → THEN merge this PR.
