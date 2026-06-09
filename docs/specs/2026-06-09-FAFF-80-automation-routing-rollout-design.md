# Spec — FAFF-80: automation-routing contract-as-code rollout

> Spec: faffter-dark-nlspec · 2026-06-09 · autonomous · adaptor: faffidavit-spec · confidence: high.

Applies the proven FAFF-77 pattern to the automation-routing contract — the last of the four. Full spec on Linear FAFF-80.

## Decisions (all Chosen)
- Schema automation-routing.schema.json: {verdict: enum[6], root_cause: enum[5]|null, conformant, violations}.
- Extraction: {verdict:"<one of six>", root_cause:"<one of five or null>"}.
- computeAutomationRouting: verdict∉six → fail-loud (no safe coerce target, like spec-readiness); root_cause∉five → normalise to null + violation; conformant=violations.length===0. Schema-validated.
- Exit: 0 conformant / 1 non-conformant (bad root_cause) / 2 fail-loud (bad/missing verdict, unparseable).
- Admission rule (which verdicts admitted) + repeat-parked no-resolve stay in gateway/beep-boop, NOT the script. Assignment input-consistency stays the adaptor's judgement.

## DONE — all verified
- automation-routing --selftest 5/5; all four contracts green (no regression); fail-loud on bad verdict; validate-adapters passes faffidavit-routing + fails on bypass; backstop green.

confidence: high
