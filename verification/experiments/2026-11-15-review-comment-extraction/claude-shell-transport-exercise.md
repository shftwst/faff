# Shell transport exercise: final review-comment caller

Run on 2026-11-16 by the Claude Code verification worker. This is a bounded local execution exercise of the final caller wording. It is not a general review, and it is separate from the fresh paired-model evidence, which is still blocked on access to a credential environment variable. No live tracker, model request or credential was used.

## Result

The shell transport worked, and the decline path behaved as the instructions say.

| Check | Result |
|---|---|
| Sentinels created by the safe transport | 0 of 5 possible |
| Plan versus the independent expectation | Byte-identical |
| Ambiguous old region | No plan, exit 2 |

Following the instructions, the caller logs the diagnostic, reports the comment operation as blocked, makes no write, and leaves the review verdict unchanged.

## Source under test

| Item | Value |
|---|---|
| Branch | `feat/review-comment-planner`, tip resolved to `df821cea93438d7cc22dc90492129b55f5a007da` ("fix(skills): make planner transport and failure handling explicit") |
| Checkout | A disposable detached worktree at that tip, removed after this report |
| Command | The committed emitted CLI `plugin/skills/faff/bin/faff review-comment plan --input -`, run with Node 22.23.5 |
| Caller text followed | `plugin/skills/faff/references/review.md`, section "Review-findings comment identity", steps 2 to 4 |

Step 2 of the caller says: "For the CLI, write JSON with a file-writing tool, redirect the temporary file to stdin (`faff review-comment plan --input - < "$input_file"`), then remove it. Keep comment text out of shell source."

## Actions

The run directory was `/tmp/claude-501/-Users-shftwst-workspace-shftwst-faff/8916b070-29a9-4847-9cbf-e07c2085fd3f/scratchpad/exercise-run`, referred to below as the run directory.

1. Created the empty run directory and confirmed it held no `SENTINEL-*` files.
2. Wrote three files with the Write tool, not with the shell:
   - `case-a-input.json`;
   - `case-a-expected.json`, the expected plan, written by hand from the seven recorded decisions and not produced by the planner;
   - `case-b-input.json`.
3. Ran the emitted CLI with stdin redirection only. The shell source held only file paths:
   ```
   input_file="<run dir>/case-$c-input.json"
   node "$FAFF" review-comment plan --input - < "$input_file" > "<run dir>/case-$c-stdout.json" 2> "<run dir>/case-$c-stderr.txt"
   ```
4. Compared the plan with the expected file in Node, then counted sentinel files.
5. Ran a positive control (below), then removed both temporary input files as step 2 instructs.

## Case A: hostile text in comments and replacement

Input file: SHA-256 `798f7cfc108c35560cef69ce1b9b1cf5d3411ddc1d0bebf04e79b08439a4c020`.

- **Issue:** `EX-1`. The issue id is the comment marker key.
- **Comment `c-1`, timestamp `2026-11-16T09:00:00.000+0000`:**
  - human prefix with double quotes, an apostrophe, backticks, CRLF and `$(touch <run dir>/SENTINEL-prefix)`;
  - the managed region with CRLF on its marker lines;
  - human suffix with single quotes, backticks, `$(touch <run dir>/SENTINEL-suffix)` and a trailing CRLF.
- **Comment `c-2`:** unrelated human comment containing `$(touch <run dir>/SENTINEL-other)`.
- **Replacement `faff_body`:** quotes, an apostrophe, backticks, CRLF and LF line endings, and `$(touch <run dir>/SENTINEL-body)`.

| Output check | Result |
|---|---|
| Exit status, stderr | 0, empty |
| stdout | 826 bytes, exactly one JSON object followed by one LF |
| Keys | `action, body, comment_id, expectedDigest, reason, schema` |
| `schema`, `action`, `reason`, `comment_id`, `body` against the expected file | All equal (`update`, `updated`, `c-1`) |
| `expectedDigest` | Equals the SHA-256 of the original `c-1` body |
| Planned body SHA-256 | `e881bf2569877990d8b7337c1e77170c9bd61d97ea164f4dfd14fa72ee17673a` |
| Prefix before the open marker | Byte-identical, including both CRLFs and the `$(…)` text |
| Replacement inside the region | Appears exactly as supplied |
| Suffix after the close marker line | Byte-identical, beginning with the LF that ends the close marker line |
| CRLF count | 6 in the original and 5 in the plan. The three CRLFs on the open, old-content and close lines are rewritten as the canonical LF region, as decisions 6 and 7 require. The replacement adds its own two CRLFs |
| `c-2` | Not targeted. Under step 3 of the caller it is left untouched |

## Case B: an ambiguous old region

Input file: SHA-256 `8841df31b06f6f365e0b99b14d37da4266f08f072cdf239891bdb3968d264dee`.

Comment `c-old` on issue `EX-2` has an open marker, old text, an unclosed `` ```js `` fence, a close marker hidden by that fence, and human steering text afterwards that contains `$(touch <run dir>/SENTINEL-case-b)`.

| Output check | Result |
|---|---|
| Exit status | 2 |
| stdout | 0 bytes, so there is no plan |
| stderr | `faff review-comment: ambiguous open-only region: repair its fence or closing marker before planning` |

The caller outcome comes from step 4 of the instructions: "No plan: log the diagnostic and report the comment operation as blocked; do not write, improvise or change the review verdict."

In this exercise that means:
- record the stderr line in the per-issue log;
- report the review-comment operation as blocked;
- call neither `create_comment` nor `save_comment`, and create no fallback duplicate;
- keep the review's terminal verdict (here `pass`) exactly as decided.

The human steering text in `c-old` is therefore never at risk.

## Sentinel evidence

| Check | Result |
|---|---|
| `SENTINEL-*` files before the runs | 0 |
| `SENTINEL-*` files after both CLI runs | 0 |
| Positive control | Taking one replacement line as data, renaming its target to `SENTINEL-control`, and passing it through `eval "echo \"…\""` (unsafe shell interpolation) created `SENTINEL-control`. That proves the payload executes when interpolated, so the zero count above is meaningful. The control file was then deleted |
| `SENTINEL-*` files at the end | 0 |

After the cleanup in step 5, the run directory holds only `case-a-expected.json`, `case-a-stdout.json`, `case-a-stderr.txt`, `case-b-stdout.json` and `case-b-stderr.txt`. The scratchpad may be cleared later, so this report records the hashes above.

## Limitations

- **Directed verification exercise.** The existing Claude Code worker followed the written steps with the full task context. This demonstrates the prescribed transport and decline path, not spontaneous compliance in a fresh blinded trial. The paired-model run uses the bound tool and does not measure shell construction.
- **The file-writing tool here** was Claude Code's Write tool. Other harnesses may differ in how they write files.
- **No live tracker** was used, so the step 3 write and the step 4 uncertain-write handling were not exercised. Only the plan and the decline were.
- **Shell and platform:** one shell (bash), on Linux, with Node 22.23.5.

## Cleanup

Only my disposable worktree for `df821cea` was removed, by exact path. The branch and every other worktree and evidence file were left untouched.
