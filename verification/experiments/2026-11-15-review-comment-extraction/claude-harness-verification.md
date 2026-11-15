# Claude Code verification: first harness hardening patch

Independent verification on 2026-11-15, using Claude Code. Review and tests only: no source was fixed, nothing was committed or pushed, no experiment model request was sent, no credential was read or exported, and no external service was contacted.

## Verdict

No must-fix defect was found in this slice. I found no false pass that the patch introduces, and no regression against the committed data or the recorded historical evidence. One behaviour change is a policy judgement for the operator (item A below). Three small advisories are listed after it.

## What was reviewed

| Item | Value |
|---|---|
| Candidate worktree `/Users/shftwst/.codex/worktrees/9f7d/faff` | Not accessible from this environment |
| Patch reviewed instead | `harness-candidate.patch` in this directory, 23,682 bytes |
| Patch SHA-256 | `b703b0b2eedaf6bb92d3be1421b274b472993cc5f75cbbfc54de5db13ee4933c` |
| Base | `576888cbd7a83b63583127d53584c3cf8a49cb00` |
| Review tree | Fresh detached worktree at the base, in the session scratchpad: `/tmp/claude-501/-Users-shftwst-workspace-shftwst-faff/8916b070-29a9-4847-9cbf-e07c2085fd3f/scratchpad/review-wt`. Existing worktrees were not touched |
| Patch applied cleanly | Yes, `git apply --check` then `git apply` |
| Diff equals the patch | Yes: `git diff --binary 576888cb` is byte-identical to the patch file (same SHA-256) |
| Files changed | 5 source files under `eval/control-parity/`, 3 test files; 162 insertions, 20 deletions |

## Tests

| Tree | Command | Tests | Pass | Fail | Skip |
|---|---|---|---|---|---|
| Base `576888cb` (earlier today, `.worktrees/controlled-skill-runs`) | `node --test test/control-parity*.test.mjs` | 110 | 110 | 0 | 0 |
| Base plus patch (review tree) | `node --test test/control-parity*.test.mjs` | 122 | 122 | 0 | 0 |

The patch adds 12 tests and changes three existing tests:

- One assertion in `test/control-parity-claude.test.mjs` now expects a trailing `protocol-violation` event after an unknown-tool call. That is the intended new behaviour.
- Two paired-run tests in `test/control-parity-run.test.mjs` now prepare with `attempts: 22`, which the new pair limit requires.

The patch weakens or deletes no existing assertion.

## Checks against each item in scope

| Scope item | What the patch does | Verified by |
|---|---|---|
| Input hashes before model admission | New `inputProblems` checks: fixture identity is unique; every fixture and expectation id is in the registry; each fixture's canonical hash equals the registry `input_sha256`; the policy hash equals the registry `policy_sha256`; effects, terminal and the final-comments hash in `expected-outcomes.json` equal the registry. It runs in `preflight` before the capture probe, and again in `assertLaunchable` at batch launch | New tests for a changed fixture, policy and oracle each give `not_ready` with the capture probe never called. Separately, I ran `prepareExperiment` plus `preflight` on the real committed data with stub probes and no credential. No input problem was reported, and the capture probe ran 0 times (it was blocked only by the expected "uncommitted changes" and "credential not set") |
| 22 attempts for 11 pairs | `runPairs` refuses when `schedule.attempts.length * 2 > limits.attempts`, before it creates the output directory or runs any driver | New test: the driver is never called. With no retries, each schedule item runs at most two executions, so the limit bounds total executions, including failed ones |
| Rejected late calls | `open(op, args)` records a `protocol-violation` with reason `post-finish-call` before throwing | My earlier probe on the base showed a write after `finish` graded `pass`. New tests show a late write, read or second `finish` now gives `incomplete` with stop `post-finish-call`, and the late write does not change state |
| Unknown tools | The tool server calls `tracker.recordViolation('unknown-tool', …)` | New test |
| Invalid finish | Each invalid-finish path records `invalid-finish` before throwing | New test |
| Provider in-stream errors | `parseSse` sets `stream_error` on an SSE `error` event, and `complete` becomes false even when `message_stop` follows. The proxy stops with `upstream-stream-error` and holds the reservation | New test; I confirmed the parse result directly |
| CLI retries | `parseStreamJson` gives `cli-retry` on any `system`/`api_retry` record | New test. The installed CLI binary (2.1.325) contains the strings `api_retry`, `retry_delay_ms` and `error_status`, which match the record shape the test uses. A live emission was not observed |
| Explicitly flagged synthetic CLI errors | `cli-stream-error` when an assistant record has model `<synthetic>` and a truthy `error` field, or when a record has top-level `type: "error"` | New test. Historical CLI output shows real synthetic records carry `error: "unknown"` alongside a `result`/`success` record, which confirms the gap was real |

Precedence in `runClaudeScenario` is unchanged for existing reasons. A proxy stop still wins, and the new CLI reasons slot in after `malformed-output`, ahead of `missing-result` and `cli-error`. In `captureScenario`, a violation sets the stop only when the driver gave none. Either way the attempt cannot pass.

## Backwards compatibility against recorded evidence

I scanned all 20 historical `stdout.jsonl` files and both sets of `tool-calls.jsonl` under `.worktrees/controlled-skill-runs/verification/experiments/` (2026-11-14 controlled runs and the 2026-11-15 comment-policy measurement):

| Record kind | Count | Effect of the patch |
|---|---|---|
| `system`/`api_retry` | 0 | None |
| Top-level `type: "error"` | 0 | None |
| `<synthetic>` assistant with `error` | 3 | All three are in the zero-cost capture probes. There the proxy stop `probe-captured` takes precedence, so readiness evaluation is unchanged |
| `rate_limit_event` | 17 | Not flagged; correct, these are informational |
| Tool calls with an error result | 0 of 50 | No historical paid attempt contained a late, unknown or invalid-finish call |

No historical paid attempt would be reclassified. The trace schema and `TRACE_KINDS` are unchanged, and `protocol-violation` stays in `events.jsonl` only, so existing schema-2 traces still validate as written.

## Items for the operator

**A. Policy judgement: a self-corrected invalid finish now makes the attempt incomplete.** Before the patch, a model that sent `finish` with a bad status, got the tool error and then sent a valid `finish` could pass. Now that attempt is `incomplete` with stop `invalid-finish`. The test `a swallowed invalid finish is retained even when the driver later completes correctly` asserts this on purpose. It errs towards failing, it never produced a false pass, and no historical attempt is affected. Confirm that this is the intended grading before the paid run, because a rejected `finish` the model then corrects will lower the completion rate rather than show up as a behaviour failure.

**Advisories (not blocking):**

1. Violation detail reaches `trace.json` only as the stop reason of the first violation. The full set, with arguments, is in the raw `events.jsonl` beside it. That is recorded evidence, but a reader of `run.json` sees one reason only.
2. The `api_retry` and top-level `error` detections are based on the record shape and on strings found in the binary. Neither was observed in a live run. Retries the proxy has already refused are caught earlier, by the proxy stop.
3. When the policy drifts, `inputProblems` repeats the same policy message once per scenario (11 times). This is cosmetic.

## Gaps that predate the patch and fall outside this slice

These are unchanged by the patch and remain open, as listed in `claude-verification-preflight.md`:

- There is no candidate planner tool. Both arms still get the same tools, instruction and allowed-tool list.
- `runPairs` still has no command-line entry point.
- Paired arm roots are still not bound: no pin, dirty check or artifact hash.
- The runtime fingerprint still folds in tool definitions, so a declared tool addition would make every pair `unpaired-runtime`. There is no intended-difference classification.
- Readiness still probes the baseline runtime only.
- Accounting still mixes held reservations into `spend_nanos`. There is no per-arm total or held count in the pairs report, a failed attempt's partial usage is dropped, and the two cache-write durations are merged.
- The CLI's `tool_use` blocks are still not reconciled against tracker events.
- The installed CLI (2.1.325) still differs from the measured run (2.1.311), so any paid run needs a fresh `prepare` and `preflight`.

## Housekeeping

The review worktree is registered in the repository's git worktree list. It is in the session scratchpad, which may be cleared. Remove it with `git worktree remove --force <path above>`, or run `git worktree prune` after the scratchpad is cleared.
