# Batch the prep queue transition

Beep-boop sends its already-scoped live issue facts to `faff next prep-queue`. The command resolves control labels once and reuses the eligibility and next-step kernels. It returns ordered prep IDs. Incomplete or invalid batches produce no IDs. The caller keeps its per-issue fallback for complete observations.

Tracker reads, stale-spec judgement, dispatch and the prep and graft backstops stay in the caller. The command makes no tracker request or write.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `` Gather every issue that is: `` | changed: the prep queue gather and batch call retain the original filters |
| `` - Not cancelled or archived (shared rule) `` | changed: the caller retains the original visibility filter |
| `` skip anything **not automation-eligible** `` | changed: the batch calls the configured eligibility kernel |
| `` - Not explicitly blocked `` | changed: the caller retains the exclusion and the batch uses the supplied blocker flag |
| `` In Backlog or similar pre-Todo state `` | changed: Step 2 retains workable-category querying |
| `` Lacking a valid spec (no spec, or spec marked stale) `` | changed: the caller treats stale and superseded specs as missing |
| `` Flagged by the tidy pass as a prep candidate `` | changed: only Todo issues tidy flagged join the Step 2 scan |
| `` Decide membership via `faff next`, not by re-deriving these criteria by hand `` | changed: the batch calls the same next kernel, including support for tracker and git-only review holds |
| `` This is the prep queue. The eligibility-exclusion here `` | changed: prep and graft keep their backstops, and the queue skips before dispatch |
