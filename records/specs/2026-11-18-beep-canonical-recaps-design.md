# Beep canonical recap reduction

Shorten four Guarantees recaps. Preserve the canonical procedures, headings, unique examples, budget exception and other guarantees unchanged. No runtime or judgement policy changes.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `Never reports a clean run without confronting the ledger against ground truth (step 11.5). A shipped outcome` | changed: redundant recap replaced by explicit canonical same-run reference; see mapping below |
| `Always wave-loops until queue stability. The build phase is wave-based — after each wave's queue drains, the` | changed: redundant recap replaced by explicit canonical same-run reference; see mapping below |
| `Post-merge housekeeping never halts the queue. Branch delete, worktree remove, shell return-to-main, tracker` | changed: redundant recap replaced by explicit canonical same-run reference; see mapping below |
| `Never prompts the human mid-run for a build/scope/merge/admission decision — this is a hard, harshly-worded ` | changed: redundant recap replaced by explicit canonical same-run reference; see mapping below |

## Canonical rule mapping

- Ground truth: step 3, Reconcile every return against attach ground truth, retains attach checks, recovery and errored fallback; step 11.5 retains shipped/sibling divergence and L4 versus L3 handling.
- Wave convergence: step 8.5 retains default tracker L3, opted-out L3, forced L4 and git-only branches, run-done, discovered scope and reported backstop.
- Housekeeping: required autonomous reference, Autonomous Mode Contract, retains failure examples, skip/log/continue, no prompt and Human follow-ups. Required build reference Worktree policy retains scoped prune; the recap still names the command and prohibition.
- No prompt: required autonomous reference, The no-prompt invariant and Banned rationalisations, retains the full prohibition and exceptions.

## Validation limits

Source deduplication only. Existing mechanical checks cannot prove model adherence to cross-references; no paid model trial or workflow claim.
