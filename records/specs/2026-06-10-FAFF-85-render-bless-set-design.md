# Spec — Render bless-set proposals in faff-wtf and faff-tidy (read-only)

> producer: faffter-dark-nlspec · adaptor: faffidavit-spec · 2026-06-10 · confidence: high

Surface FAFF-84's bless-set proposals as skimmable, approvable cards in /faff-wtf §5b and /faff-tidy §4a.
Strictly list-only (no mutation). Compose existing On-hold-entry + value-chain render forms.

## Chosen
- Render in both wtf §5b (beside value-chains) + tidy §4a (after On-hold list); request bless-set.
- Compose existing forms; thin faffidavit-rendering sub-form only if needed.
- Strictly list-only — no eligibility mutation.

## DONE
- wtf §5b + tidy §4a render "Bless-set proposals" read-only; skip silently when no qualifying proposals.
- Each card: root (On-hold-entry form), ordered slice + per-member badge, stop-reason, hypothetical-verdict
  distribution one-liner, deferred-with-reason members; routed through rendering_adaptor (skimmable lists).
- Neither surface mutates eligibility; block omitted when no methodology (degrade to flat On-hold list); validate-adapters passes.
