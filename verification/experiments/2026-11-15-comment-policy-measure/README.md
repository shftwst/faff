# Comment-policy measurement

One run of all eleven review-findings comment cases against the pinned pre-release prose (`plugin/skills/faff/references/review.md` at `f767bdd1`), using `claude-opus-5-5` at effort `medium` with Claude Code 2.1.311. Expected outcomes follow the operator's decisions of 15 November in `eval/control-parity/policy-decisions.json`.

Result: 7 pass, 4 differ, $0.5102856 and 175 seconds. Every attempt used provider-metered usage equal to the CLI's figure, and every attempt's runtime matched readiness.

| Case | Result | What the model did |
|---|---|---|
| create-when-absent | pass | |
| quoted-imitation | pass | |
| preserve-human-text | pass | |
| legacy-open-only | pass | |
| duplicate-reconcile | pass | |
| repeated-pairs | pass | Spliced only the first pair and kept the second as text |
| fenced-example | pass | Ignored the fenced paste and created a new comment, although the literal line rule would match it |
| author-not-preferred | differs | Updated the newer faff-authored comment; the prose allows this optional preference and the decision removes it |
| indented-and-trailing-whitespace | differs | Treated the indented comment as a match and kept its indentation; the decision excludes it |
| timestamp-ties | differs | Finished `blocked` without writing; the decision breaks ties by listing order |
| crlf-outside-region | differs | Converted `\r\n` to `\n` in the human text outside the region, contrary to the prose's explicit verbatim rule |

The first five cases also passed in the calibration batch, so they are 10 out of 10 over two runs. Every other case has one sample, so these results show what the model did once, not how often it does it.

For an extraction, three of the decisions (authorship, indentation, ties) change behaviour the model actually showed on the current prose and must be labelled behaviour changes. The CRLF result is a defect in the current behaviour against an explicit rule. Repeated pairs, fences and marker-line framing matched the decisions.

Raw request bodies (`requests/` and `probe/`) contain the account identifier the CLI sends and are not committed.
