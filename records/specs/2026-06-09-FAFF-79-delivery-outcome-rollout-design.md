# Spec — FAFF-79: delivery-outcome contract-as-code rollout

> Spec: faffter-dark-nlspec · 2026-06-09 · autonomous · adaptor: faffidavit-spec · confidence: high.

Applies the proven FAFF-77 pattern to the delivery-outcome contract. Full spec on Linear FAFF-79.

## Decisions (all Chosen)
- Schema delivery-outcome.schema.json: {outcome: enum[shipped,not-ready,failed], reason, conformant, violations}.
- Extraction: {outcome:"<verbatim>", reason, corroborated:bool}.
- computeDeliveryOutcome: outcome∉enum → coerce to failed (never shipped); shipped+!corroborated → coerce to failed; not-ready/failed with empty reason → violation. Schema-validated.
- Exit: 0/1/2 (uncorroborated/malformed → coerce to failed exit 1; unparseable → fail-loud exit 2). Safe coerce target = failed.
- Two-tier gate + integrity floor stay in graft/gateway (not the script).

## DONE — all verified
- delivery-outcome --selftest 6/6; no regression (all-contracts green); coercion correct; validate-adapters passes faffidavit-ship + fails on bypass; backstop green.

confidence: high
