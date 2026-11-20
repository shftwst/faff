# Resume review on the captured diff

Graft reads one compact next step for the current diff from the issue checkpoint. The reviewer can condition its Phase-2 write on the same diff under the checkpoint lock. The original raw read and unguarded write forms remain available to existing callers. A completed finding reference must resolve to a readable file in the review worktree. When the file is missing, the matching Phase-1 pass still allows a bounded Phase-2 retry.

The outage count belongs to the issue across drains. Phase writes used to discard it. Retaining the count and serializing increments preserves the existing cap. A recorded advisory skip identifies its kind for reconciliation. It cannot authorize delivery. The original verdict, live checkout and merge gate still govern the result.

## Rule inventory

| Prose rule | Command or caller action | Covering test | Disposition |
|---|---|---|---|
| `On re-dispatch after a slow adversarial` | Autonomous graft consults one hint on the captured diff. | test/review-progress-resume.test.mjs | kept |
| `no usable Phase-1 verdict` | Absent, malformed or wrong-issue receipts return fresh. | test/review-progress-resume.test.mjs | kept |
| `the hard Phase-1 verdict still holds` | A matching pass resumes at bounded Phase 2 or returns the saved findings path. | test/review-progress-resume.test.mjs | kept |
| `the diff moved since Phase-1 passed` | A changed hash returns fresh. | test/review-progress-resume.test.mjs | kept |
| `the ref the review diff was captured against` | Forward the original base, issue, run directory and hash. | test/review-progress-resume.test.mjs | kept |
| `Interactive calls skip checkpoint writes` | Only the autonomous caller records checkpoints. | test/review-progress-resume.test.mjs | kept |
| `\| Boundary \| Command \|` | Phase writes occur at the existing reviewer boundaries. | test/review-progress-resume.test.mjs | kept |
| `--phase1-pass --diff-hash <cur_hash>` | Record the pass and its original hash. | test/review-progress-resume.test.mjs | kept |
| `Immediately before the helper call` | Record in-flight before invoking the helper. | test/review-progress-resume.test.mjs | kept |
| `--phase2 complete --findings <path>` | Store the path for a completed review. | test/review-progress-resume.test.mjs | kept |
| `--phase2 skipped_deadline` | Persist the deadline skip as its own status. | test/review-progress-resume.test.mjs | kept |
| `Availability/rate-limit pass+skip` | Persist the outage skip as its own status. | test/review-progress-resume.test.mjs | kept |
| `Needs-human/unavailable exits return terminal` | A non-pass never writes a skip or completion. | test/review-progress-resume.test.mjs | kept |
