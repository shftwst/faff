# Claude Code review: adapter final delta

Reviewed 2026-11-15 by the Claude Code verification worker. Review and tests only: no edits, no credential read, no model request.

## Verdict

The grading finding from `claude-adapter-integration-review.md` is fixed. There is no must-fix defect in this delta, one advisory, and no false pass.

## What was reviewed

| Item | Value |
|---|---|
| Patch | `adapter-final-review.patch`, 50,600 bytes, SHA-256 `1267bb228b1dd9665b484387c3328c2e92e0df5a3e3a506849c41d978ce42d61` |
| Review tree | Fresh detached worktree at `d9781d39`: `/tmp/claude-501/-Users-shftwst-workspace-shftwst-faff/8916b070-29a9-4847-9cbf-e07c2085fd3f/scratchpad/review-wt4`. The patch applied cleanly |
| Delta from the previous patch | I compared every modified and untracked file in this tree with the tree from the previous review (`review-wt3`). The only differences are: a `CommandInputError` class with a reason code in `candidate-command.mjs`; the input, input-limit and call-limit paths throwing it; the adapter catch-block classification in `command-use.mjs`; one new test, plus one changed expectation (the call cap now grades `command-error`); and the rewritten paragraph in `command-contract.md`. The treatment classifier files are not in the patch, as stated |

## Validation run

| Command (in the review tree) | Tests | Pass | Fail | Skip |
|---|---|---|---|---|
| `node --test test/control-parity-command.test.mjs` | 15 | 15 | 0 | 0 |
| `node --test test/control-parity-command-use.test.mjs` | 13 | 13 | 0 | 0 |
| `node --test test/control-parity*.test.mjs` | 151 | 151 | 0 | 0 |

I reran the stdio probe from the previous review (`/tmp/claude-501/-Users-shftwst-workspace-shftwst-faff/8916b070-29a9-4847-9cbf-e07c2085fd3f/scratchpad/stdio-probe/probe.mjs`) against this tree:

| Probe | Before (previous patch) | Now |
|---|---|---|
| Real committed tree: malformed planner call, then a valid call (the planner is absent, so `command-exit`), then write and finish | One `command-refused` violation; grade `incomplete` | No violation; grade `command-error`; the server stayed up |
| Fixture repository: malformed call, valid call, committed file edited, call again | Two violations; grade `incomplete` | One `command-refused` violation, from the source drift only; grade `incomplete`; the server stayed up |

## Classification check

| Cause | Thrown as | Violation recorded | Grade |
|---|---|---|---|
| Malformed model input (shape, or a value that is not valid JSON) | `CommandInputError` `command-input-invalid` | No | `command-error` |
| Input over the byte limit | `CommandInputError` `command-input-limit` | No | `command-error` |
| Call limit exceeded | `CommandInputError` `command-call-limit` | No | `command-error` |
| Invalid harness limit setting | Plain `Error` | `command-refused` | `incomplete` |
| Binding changed, dirty plugin, artifact changed | Plain `Error` | `command-refused` | `incomplete` |
| Planner call after `finish` | Plain `Error` | `post-finish-call` and `command-refused` | `incomplete` |
| Planner non-zero exit, timeout, output limit, invalid plan | Recorded evidence error, not thrown | No | `command-error` |

This matches the stated contract: model-caused failures are graded candidate failures, and harness faults are incomplete evidence. Model input errors no longer stop the schema-2 trace. The trace can therefore pass while `command_use` is `command-error`. That is correct only if acceptance requires both. Ticket 2's report wiring must show the command grade beside the trace status, so that a passing trace without `followed` is never read as extraction evidence.

## Advisory

**Input is checked before source drift.** `invokeCandidateCommand` validates input and the input size before it calls `assertCandidateCommandUnchanged`. A malformed call made after the candidate source changed is therefore classified `command-input-invalid` and grades `command-error`, and the drift is not recorded for that call. I confirmed this with a probe: committed file edited after binding, then a malformed call, giving reason `command-input-invalid` and 0 violations.

The attempt still fails, so this is not a false pass. Drift is caught at the next valid call, and the next slice's launch-time rebinding catches it before the run. Checking the binding first would make the drift visible in every case. Changing the order would not alter any test outcome in the current suite.

## Still open, already planned

- Wiring the grader with raw `events.jsonl` and the stop.
- Binding the command limits in the manifest.
- Candidate readiness and pairing with the declared tool treatment.
- The ticket 1 rule for duplicate comment ids.
- The `blocked` grading rule, before blocked or fault cases are added.

## Housekeeping

Review worktrees `review-wt` to `review-wt4` are registered under `/tmp/claude-501/-Users-shftwst-workspace-shftwst-faff/8916b070-29a9-4847-9cbf-e07c2085fd3f/scratchpad`. `git worktree prune` cleans them up once the scratchpad is cleared.
