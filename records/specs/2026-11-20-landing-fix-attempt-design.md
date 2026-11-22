# Bind landing fix attempts

The top-level autonomous graft owns dispatch, diagnosis, editing and push. The existing land observation and assessor still own CI and the definition of a repeating failure. The new local checkpoint binds the original observation, an independently allocated attempt ID, the implementor's confirmed push result and the eventual assessment. A retry of the same completion leaves the count unchanged. A second attempt on the same head requires the preceding attempt ID and receives a new one.

The current attempt and one ID on every new failed history entry are optional fields in the existing landing progress document. Both change in one write under the existing file-lock primitive. A validated legacy record keeps its budget, a missing record starts at zero, and a present corrupt record stops the automated path. The old CLI entry points continue to read legacy files. The active attempt carries exact case-sensitive check identities as digests so redacting the audit names cannot change failure matching. The checkpoint uses the existing evidence writer and restores wherever an existing bundle already carries it.

A resumed caller with a stored SHA continues observation on that SHA. A different live head exits that observation before CI reads. A pending slice or landing deadline does not count or replace the attempt. Between starting the implementor and receiving its push result, a crash can leave the result unavailable. Surface that fault, without launching a second implementor or assuming it did not push. The local attempt receipt does not attest the actual push. The matching live post-push observation is the check, and delivery still starts from the ordinary landing and merge gates. This change adds no off-box publication or deadline reset.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `` PROCEDURE landing_loop(issue, pr, run_dir): `` | changed: land observations and attempt status choose the next action |
| `` `handle_fixable_state` (below) with `CONFLICTING` `` | changed: needs-fix enters the staged fix cycle |
| `` reproduces today's leave-for-human exactly under the default `` | changed: the off route still leaves for a human |
| `` The autofix config gate. `` | changed: the loop resolves mode once before choosing an entry action |
| `` For either `needs-fix` route, keep the original `` | changed: begin binds the original observation and status persists it |
| `` With autofix off, leave the conflict or CI regression for a human `` | changed: the caller owns off mode and status enforces the enabled budget |
| `` Reuse the review-fail implementor inside the admitted `` | changed: implement retains the same cage, evidence context and owner |
| `` If a fix was pushed**, first observe with the same `` | changed: submit persists the push before the head-bound observation and assessment |
| `` Reinvoke land, then assess its fresh result against the original before file `` | changed: observe-again holds the same persisted attempt |
| `` The 25-minute deadline elapsed. Leave the PR open `` | changed: deadline retains its outcome and spends no cycle |
| `` Once for this attempt, run `` | changed: one locked state write records the failed ID and returns the budget disposition |
| `` Leave for a human with reason `autofix-shadow` `` | changed: shadow parks with its existing reason and no merge attempt |
| `` Re-enter the landing loop without incrementing `` | changed: a resolved unattended attempt returns to land and the existing floor |
