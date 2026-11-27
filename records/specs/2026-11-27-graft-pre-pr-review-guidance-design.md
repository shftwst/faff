# Graft review outcome routing

The Step 9 table and the autonomous summary both describe pre-PR review. The table previously directed a human-judgement park to draft a PR before one exists. Step 9 owns terminal comments and routing. Step 9b owns opening a PR after a passing review. The autonomous summary retains the appetite-scaled fix limit.

## Rule inventory

| Prose rule | Retained behaviour | Covering test | Disposition |
|---|---|---|---|
| `Proceed to merge-confidence gate` | Open a PR on pass before consulting the merge gate. | test/graft-pre-pr-review-guidance.test.mjs | kept |
| `Flip PR to draft. Park per the shared park protocol.` | Correct the inconsistent table entry to use the specified pre-PR tracker park. | test/graft-pre-pr-review-guidance.test.mjs | kept |
| `Run Step 9 (review phase)` | Follow Step 9's tracker comment and four signal routes. | test/graft-pre-pr-review-guidance.test.mjs | kept |
| `proceed to Step 9b (open the PR).` | Open a PR only on pass. | test/pr-open.test.mjs | kept |
| `fix flagged items, re-run tests, re-run review` | Retest and re-review until clear or the configured appetite cap is reached. | test/review-iteration-cap.test.mjs | kept |
| `surface on the tracker issue` | Park before PR open and return the human handoff. | test/graft-pre-pr-review-guidance.test.mjs | kept |
| `run **Review dialogue, judge and holds**` | Route unavailable review through Step 9's bounded hold or park. | test/review-hold.test.mjs | kept |
| `exactly as canonical Step 9b defines it` | Use the shared PR-opening procedure on pass. Git-only skips to Step 10. | test/pr-open.test.mjs | kept |
