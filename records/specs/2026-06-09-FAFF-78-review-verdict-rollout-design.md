# Spec — FAFF-78: review-verdict contract-as-code rollout

> Spec: faffter-dark-nlspec · 2026-06-09 · autonomous · adaptor: faffidavit-spec · confidence: high.

Applies the proven FAFF-77 pattern to the review-verdict contract. Full spec on Linear FAFF-78.

## Decisions (all Chosen)
- Schema `skills/faff/contracts/review-verdict.schema.json`: {signal: enum[pass,fail,needs-human], findings[], conformant, violations}.
- Extraction: {signal:"<verbatim>", findings:[{location_present,action_present}]}.
- computeReviewVerdict: signal∉enum → coerce to needs-human (never pass) + violation; fail/needs-human with 0 findings → violation; finding missing location/action → violation; conformant=violations.length===0. Schema-validated.
- Exit: 0 conformant / 1 non-conformant (incl. coerced) / 2 fail-loud (unparseable extraction only — review has a safe coerce target, unlike spec-readiness).
- Generalised the CLI: CONTRACTS now {run,fixtures} per contract; cmdContract/contractSelftest contract-generic; uniform exit on violations.length; per-contract `--selftest [name]`.
- Wiring-check generic (REGISTRY contract field); CI step added.

## DONE — all verified
- review-verdict --selftest 5/5; spec-readiness --selftest still green; coercion correct; validate-adapters passes faffidavit-review + fails on bypass; full backstop green; no gate semantics in script.

confidence: high
