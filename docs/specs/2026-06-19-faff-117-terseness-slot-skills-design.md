# Spec — FAFF-117: Terseness + cruft pass (slot skills)

> Spec: faffter-dark-nlspec · 2026-06-19 · interactive · confidence: high.

Prose-only lean pass over the 13 slot skills — the FAFF-116 counterpart — stripping refer-back boilerplate now that shared prose has a home (FAFF-115). Same two-tier gate, tier (b) smoke-or-waive per FAFF-180.

## WHAT
- Collapse over-repeated contract ids (FAFF-109/81/108) to one defining mention per slot skill (esp. ship 5, review 4); KEEP FAFF-80/21/22 + defining mentions.
- Strip refer-back restatements → gateway references (no-op already-reference; verify each; tie-break KEEP).
- faffidavit-rendering paragraph→list.

## Verification (Chosen)
(a) Deterministic floor in CI: validate-adapters + node --test + 8 selftests + 3 eval loaders resolve + size-gate reduction.
(b) Judgement reverify: smoke-or-waive (scoped `run-evals.mjs --only <case> --reps ~5`, OR a documented human waiver-with-rationale on the PR) — NOT the full ~1k-run sweep (FAFF-180). Sequence after FAFF-180 ideally.

## OUT OF SCOPE
Orchestration skills (FAFF-116); gateway body (FAFF-179); charter/lint (FAFF-120); caching-order (FAFF-119); any behaviour/contract change (prose-only).

## DONE
- [ ] Over-repeats collapsed to one defining mention; KEEP refs retained.
- [ ] Genuine refer-back restatements → gateway references; already-reference no-op'd.
- [ ] faffidavit-rendering paragraph→list.
- [ ] No behaviour/contract change; validate-adapters + node --test + selftests green; 3 loaders resolve; size net reduction + re-baselined.
- [ ] Judgement gate = scoped smoke OR documented waiver (not the full sweep).

confidence: high
