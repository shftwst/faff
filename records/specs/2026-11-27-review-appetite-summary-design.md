# Shorten the review appetite rule

Keep the four appetite settings and the table of thresholds and caps. Explain once which defects are in scope and who owns escalation.

## Rule inventory

| Prose rule | Retained behaviour | Covering test | Disposition |
|---|---|---|---|
| `The defect bar (what counts as a bug` | Keep a fixed defect bar, narrowly permit adjacent cleanup at high/full and apply the cap from the CLI before escalating exhausted reviews. | test/review-iteration-cap.test.mjs | kept |
