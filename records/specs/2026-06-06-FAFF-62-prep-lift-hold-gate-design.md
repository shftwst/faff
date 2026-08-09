# FAFF-62 — Interactive prep gate offers to lift the hold

> Spec: faffter-dark-nlspec · 2026-06-06 · confidence: high. Full spec on Linear FAFF-62.

## WHY
Interactive /faff-prep on a held ticket only warned ("stays held") and never offered to change
eligibility, so a freshly-prepped ticket sat held and the human had to un-hold it separately.

## WHAT / HOW (doc-only: faff-prep/SKILL.md + 1 gateway line)
- Scenario A automation-hold paragraph: prep never AUTO-removes the hold, but interactive prep
  now offers to lift it on explicit confirm once the spec is attached.
- Step 3: a standalone "Held-ticket lift gate" before the build gate — lift / keep — when the
  ticket carries faff-automation-hold. On lift: remove the label (human-confirmed, logged); on
  keep: continue. Never folded into the build gate (FAFF-57). Never auto-lifts. Lift-only
  (freezing a not-held ticket stays jot/tidy's job). Autonomous prep unchanged (held → skip).
- Gateway Automation hold → Release: names /faff-prep as a sanctioned interactive lift entry
  point alongside /faff-tidy (contract already permitted "offer to lift on explicit confirm").

## DONE
- [x] Standalone lift/keep gate in Step 3 (not folded into the build gate).
- [x] Lift removes faff-automation-hold (human-confirmed, logged); keep leaves it.
- [x] Autonomous prep unchanged (held → skip, never lift).
- [x] Lift-only; freeze-not-held deferred to jot/tidy.
- [x] Gateway Release names /faff-prep.
- [x] validate-adapters + config pass; diff limited to faff-prep + gateway.
