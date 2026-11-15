# Claude Code review: paired stream-failure delta

Reviewed 2026-11-15 by the Claude Code verification worker. Review and tests only: no implementation edits, no credential read, no model request.

## Verdict

The delta is correct and narrow. There is no must-fix case, and one minor advisory. The note text and the boundary document change only wording, as described.

## What was reviewed

| Item | Value |
|---|---|
| Patch | `paired-stream-final-review.patch`, 87,303 bytes, SHA-256 `b8df04afee5c09c655bade71e58494142b5fcbc5f819156d1cb4e6da1ffb362a` |
| Base | `ba93d04b`, applied cleanly to a fresh detached tree (`review-wt7`) |
| Comparison | Every modified and untracked file was compared with `review-wt6`, the tree reviewed in `claude-paired-final-review.md`. Exactly four files differ: `eval/control-parity/proxy.mjs`, `test/control-parity-claude.test.mjs`, `eval/control-parity/paired.mjs` (the `comparison_note` string only) and `verification/experiments/2026-11-15-review-comment-extraction/planner-boundaries.md` (wording only) |

## Validation run

| Command | Tests | Pass | Fail | Skip |
|---|---|---|---|---|
| `node --test test/control-parity-claude.test.mjs` (`review-wt7`) | 50 | 50 | 0 | 0 |
| `node --test test/control-parity*.test.mjs` (`review-wt7`) | 171 | 171 | 0 | 0 |
| The new `test/control-parity-claude.test.mjs` run against the previous `review-wt6` source | 50 | 49 | 1 | 0 |

The one failure on the previous source is the new test, "a failed response stream retains partial provider usage and holds its reservation". That shows it reproduces the old loss of partial usage. For this run, the test file was copied into `review-wt6` under a temporary name and deleted straight afterwards.

## The proxy change

| Behaviour | Before | After |
|---|---|---|
| The upstream body iterator throws after partial SSE data | The exception left `handle`, so the catch-all set stop `proxy-error`. No `response.txt` was written, no usage was recorded, and the reservation stayed `open` (never reconciled) | The bytes received so far are kept and written to `NNN.response.txt`. They are parsed for id, model and usage, with `transport_error` recording the error code. Cost is `null`, the reservation is `held`, the stop is `upstream-stream-error`, and the client response is ended |
| A complete SSE message followed by a transport error | The same loss as above | Usage is kept, but cost is still `null` and the reservation held: a transport error is never priced as a clean response. This errs towards caution |
| Stop precedence | Not applicable | `upstream-stream-error` comes before `usage-missing`, `pricing-unknown` and `served-model-mismatch` |

Downstream effects checked by reading the code:
- `attemptEvidence` still counts the retained token values in `observed_tokens` and their contributing-request counts. It counts the request in `requests_with_unknown_cost`.
- `ledgerAccounting` reports the hold under `held_reservation_nanos`, not as observed cost. Later requests are refused because the stop is set, so a CLI retry after the truncated stream cannot be admitted.

## Wording checks

- `comparison_note` now states that the derived comparison still fails on declared event differences or baseline obligation failures, and that acceptance uses the separate pair classifications. This resolves the advisory from the previous review.
- `planner-boundaries.md` now calls itself a proposed boundary specification. It names the four open proposals (replacement marker rejection, unclosed fences, duplicate ids, accepted timestamp formats) and says they are not additional operator decisions. This review treats them as proposals only; they still need operator decisions before the production planner is written.

## Advisory

On the non-200 path, a stream error is caught and the received bytes are kept, but `transport_error` is not set on the request entry. The stop is still `upstream-error` and the reservation is held, so nothing is lost or mispriced; the evidence just does not say the error body was cut short. Setting `transport_error` before the non-200 branch would make that visible.

## Housekeeping

After this report, the disposable review worktrees `review-wt` to `review-wt7` under `/tmp/claude-501/-Users-shftwst-workspace-shftwst-faff/8916b070-29a9-4847-9cbf-e07c2085fd3f/scratchpad` were removed by exact path. All other worktrees and evidence were left in place.
