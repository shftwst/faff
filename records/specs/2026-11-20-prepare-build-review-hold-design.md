# Prepare a build review hold

Graft supplies its run, issue and cause. The resume store reads the existing per-cause cap and stages the hold. For a provider outage, the updated review counter lands in the staged store alongside the receipt. The source run is unchanged because it hands back at this point. The next drain uses the existing restore path to read the updated counter. Dialogue holds retain their independent count, stage and round totals.

The unit of idempotency is one hold per source issue and run. A hold ends that run's review path. The published receipt contains the source run key, the attempt number and its limit. A retry after the directory swap returns the same hold. A retry after an interrupted swap recovers the old directory and publishes its successor once. A restored destination carries its parent generation locally so an obsolete caller cannot overwrite a later hold. Legacy stores remain restorable.

The local command returns a notice and role, or a park/stale decision. Graft owns the tracker operations, exact claim lease and terminal verdict. A hold writes no terminal verdict. A missing first store is normal, a lost resumed store parks and lock contention follows the existing one-retry policy. The separate prep hold survives publication.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `` Provider outage is availability, not suspicion about the work `` | changed: the command chooses the restorable hold or interactive park |
| `` checkpoint` absent OR `retries >= graft.review_outage_retry_limit `` | changed: the store transaction validates resumable checkpoints and applies the configured outage cap |
| `` retry-later**: do **NOT** write `review-verdict.json` `` | changed: the local hold publishes the counter and stash together, then the caller routes the role and claim with no terminal verdict |
| `` A `critical` finding enters the dialogue loop first `` | changed: the dialogue entry and the standing-critical human route remain in the caller |
| `` A reviewer re-evaluation or a judge pass inside the dialogue loop `` | changed: the dialogue source and resumed-state checks precede the independent hold |
| `` hold_count >= graft.build_review_hold_limit `` | changed: the store transaction computes cap exhaustion before publishing |
| `` Else → hold**: do **NOT** write `review-verdict.json` `` | changed: the caller routes the hold role and releases the claim only after a successful store publication |
