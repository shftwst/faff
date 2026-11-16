# Fresh review-comment comparison

The comparison failed. Candidate `8ba8bd0c` passed 10 of 11 cases; released
baseline `690546db` passed 5 of 11. All 22 scheduled executions finished, with
97 provider requests, complete accounting and no retries. Claude Code 2.1.325
ran `claude-opus-5-5` at medium effort through the bounded fixture adapter.

| Scenario | Baseline | Candidate | Pair classification |
|---|---|---|---|
| author-not-preferred | Fail | Pass | Declared change |
| quoted-imitation | Pass | Pass | Preserved |
| create-when-absent | Pass | Pass | Preserved |
| duplicate-reconcile | Pass | Pass | Preserved |
| crlf-outside-region | Fail | Fail | Candidate failure |
| legacy-open-only | Pass | Pass | Preserved |
| repeated-pairs | Fail | Pass | Unexpected difference |
| timestamp-ties | Fail | Pass | Declared change |
| fenced-example | Fail | Pass | Unexpected difference |
| indented-and-trailing-whitespace | Fail | Pass | Unexpected difference |
| preserve-human-text | Pass | Pass | Preserved |

## Candidate failure and revision

In `05-candidate-crlf-outside-region-1`, the command received the exact live read
and returned the independently expected 194-byte body. Claude passed a 205-byte
body to `save_comment`: it exactly equals `JSON.stringify(plan.body).slice(1, -1)`.
The write contains literal backslash escape sequences instead of CR and LF.
Claude then reread the comment and reported the operation blocked. The incorrect
write had already happened; the grader correctly reports `not-followed` and a
candidate failure.

The caller now says to pass decoded JSON `body` unchanged without double-escaping
CR/LF. Shorter wording in the adjacent transport step keeps the loaded checkpoint
at 1,862 bytes. The planner, tool schema, oracle, historical declarations and this
run's pinned worktree are unchanged. This is a proposed caller correction, not a
verified model fix. It needs fresh Claude execution before acceptance.

## Baseline differences requiring review

These outcomes do not match the four predeclared historical projections. They
remain unexpected differences; this report adds no exemption.

- `repeated-pairs`: the baseline appended a stray quote, then made a second write
  to remove it. Final bytes were correct, but two writes violated the oracle.
- `fenced-example`: the baseline reported blocked without writing. The candidate
  correctly created a comment and preserved the fenced example.
- `indented-and-trailing-whitespace`: the baseline selected the expected comment
  but retained spaces and a tab on its marker lines. The candidate emitted the
  canonical framing required by the recorded policy.

## Size, usage and elapsed time

| Measure across eleven cases | Baseline | Candidate |
|---|---:|---:|
| Loaded policy bytes | 4,337 | 1,862 |
| Provider requests | 41 | 56 |
| Output tokens | 10,421 | 12,133 |
| Uncached input tokens | 84 | 114 |
| One-hour cache-write tokens | 32,648 | 27,927 |
| Cache-read tokens | 114,198 | 154,715 |
| Usage priced at the recorded rates | $0.4927796 | $0.4974750 |
| Sum of attempt elapsed time | 175.944 s | 202.471 s |
| Planner process time | 0 | 0.240 s |

The policy is 57.1% smaller; the combined review/graft prose reduction is 3,080
bytes. This run showed no cost or latency saving: candidate cost was 0.95% higher
and summed attempt time was 15.08% higher. These are observations from one
development run, including failures, not whole-workflow estimates. Both arms had
cache reads in every case, with one-hour cache writes and no unknown cache TTL.
The broad cache labels match; their token quantities differ. Fresh configuration
directories do not establish a cold cache. Subscription usage is priced for the
experiment budget, not represented as a cash charge.

Total priced usage was $0.9902546 against the $10 allowance. All reservations were
reconciled; none remain held or open. The batch took 383.286 seconds.

## Evidence and checks

- `run/report.json`: unchanged report, pair classifications and arm totals.
- `run/attempts/`: raw requests, responses, command inputs/results and tracker
  writes. Sensitive authentication headers were excluded by the recorder.
- `run/manifest.json`, `run/readiness.json`: source, CLI, policy, tool and runtime
  bindings. All attempts matched readiness; request settings stayed constant
  within each attempt.
- `evidence-reconciliation.json`: all 22 trace grades and command-use grades
  recomputed; all 97 response streams checked against recorded usage; costs
  recomputed from token buckets and matched to the report and ledger.

Reproduce the evidence reconciliation from the repository root:

```sh
node verification/experiments/2026-11-16-review-comment-pairs/reconcile-evidence.mjs \
  verification/experiments/2026-11-16-review-comment-pairs .
```

The unchanged deterministic checks remain valid for the planner. The revised
caller passes adapter/prose validation, reference lint and all twelve inventory
rows; the nineteen command-use and treatment tests pass. PR #1197 remains a draft.
The original 22-execution allowance is exhausted. No additional model run or
retry has been started.
