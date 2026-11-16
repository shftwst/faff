# Claude Code review: adapter integration patch

Reviewed 2026-11-15 by the Claude Code verification worker. Review and tests only: no source was edited, no credential was read, and no model request or external network call was made.

## Verdict

No false pass was found, and the defects from the previous review are fixed. One must-fix item remains: model input errors and harness refusals are recorded as the same violation, and both make the attempt incomplete. Fix this before any paired run. Three further requirements apply to the next slice, the manifest and paired-run wiring, which this patch does not claim to cover.

## What was reviewed

| Item | Value |
|---|---|
| Patch | `adapter-integration-review.patch`, 48,693 bytes, SHA-256 `d40b2a7b553ed4a245e1ad52fb33dccaf0a1aabf5402f802ec727a2178d7dd8e` |
| Review tree | Fresh detached worktree at `d9781d39`: `/tmp/claude-501/-Users-shftwst-workspace-shftwst-faff/8916b070-29a9-4847-9cbf-e07c2085fd3f/scratchpad/review-wt3`. The patch applied cleanly; no other worktree was touched |
| New files | `eval/control-parity/candidate-command.mjs`, `eval/control-parity/command-use.mjs`, `test/control-parity-command.test.mjs`, `test/control-parity-command-use.test.mjs`, `verification/experiments/2026-11-15-review-comment-extraction/command-contract.md` |
| Changed files | `claude-driver.mjs`, `run.mjs` (`TOOL_FILES` only), `tool-server.mjs`, two existing test files, `implementation-plan.md` |

## Validation run

| Command (in the review tree) | Tests | Pass | Fail | Skip |
|---|---|---|---|---|
| `node --test test/control-parity-command.test.mjs` | 15 | 15 | 0 | 0 |
| `node --test test/control-parity-command-use.test.mjs` | 12 | 12 | 0 | 0 |
| `node --test test/control-parity*.test.mjs` | 150 | 150 | 0 | 0 |

Node is v22.23.5. The suite grew from 132 to 150 tests.

Extra probes, local only, script at `/tmp/claude-501/-Users-shftwst-workspace-shftwst-faff/8916b070-29a9-4847-9cbf-e07c2085fd3f/scratchpad/stdio-probe/probe.mjs`:

| Probe | Result |
|---|---|
| Real stdio tool server bound to the real committed `plugin/` tree at `d9781d39`. Calls: `list_comments`, a planner call missing fields, a valid planner call, `create_comment`, `finish` | The server stayed up for all five calls. The malformed call returned `isError` with "invalid candidate command input" and recorded the `command-refused` violation. The valid call ran the real `faff` under `env: {}` and the permission sandbox, and returned `isError` with `command-exit`, exit 2, "unknown subcommand 'review-comment'", because the planner is not written yet. `commands.jsonl` held 4 records in attempt/result order. Grade: `incomplete` |
| Same sequence against a fixture repository, with the committed planner file edited between two planner calls | The first valid call returned the plan. After the edit, the next call was refused ("candidate plugin is dirty") without spawning, and the server stayed up. Both refusals were recorded. Grade: `incomplete` |
| Baseline runtime before and after the patch | Identical: `HARNESS_INSTRUCTION` SHA-256 prefix `b091a4f85835`, tool-definition hash prefix `f6c9fa880f02`, the same four allowed tools, and the same user-prompt hash. The baseline bundle's system prompt is still `HARNESS_INSTRUCTION`. The baseline arm and its runtime fingerprint are unchanged |

## Previous findings: status

| Finding (from `claude-command-code-review.md`) | Status |
|---|---|
| Disk bytes not compared with the commit | Fixed. Each file's git blob hash is computed in the repository's object format and compared with the `ls-tree` object id. Tests cover `--assume-unchanged` and `--skip-worktree`. `.gitattributes` sets `-text` on two `plugin/skills` Markdown patterns and adds no conversion, so the real tree binds |
| Thrown errors killing the tool server | Fixed. `createCommandAdapter` catches errors, writes a durable `command-result`, records a violation and returns a `TrackerError`. Confirmed over real stdio |
| Duplicate-id rule | Still open in ticket 1. The adapter still rejects an update whose target id appears more than once |
| Git config run during status | Fixed (`-c core.fsmonitor=false`) |
| Root not checked as the repository top level | Fixed |
| Evidence gaps (argv, environment keys, stdin bytes and hash, raw output, spawn timing) | Fixed. Exact argv, `cwd`, `env_keys: []`, `stdin` and its SHA-256, base64 stdout and stderr with hashes, `spawn_duration_ns` and `duration_ns` are recorded. Invalid UTF-8 output is rejected and kept as the original bytes |
| Network not isolated | Unchanged, and now stated in `command-contract.md`. Acceptable as documented |

## Must-fix

**1. Model input errors and harness refusals share one violation, and both make the attempt incomplete.**
- What happens: `createCommandAdapter` records every refusal as `protocol-violation` with reason `command-refused`. The same reason covers:
  - the model sending malformed planner input (`validateInput`);
  - input over the size limit;
  - the call limit being reached;
  - harness or source drift (binding changed, dirty plugin, changed artifact).
- Why it matters: `captureScenario` turns any violation into a trace stop, so all of these become `incomplete`. A candidate whose shipped prose makes the model build bad planner calls would be reported as missing evidence, not as a candidate failure. The paired comparison would then sit at `incomplete` indefinitely and never show the regression.
- An inconsistency: input the planner itself rejects (non-zero exit) is graded `command-error`, while the same mistake caught by the adapter's own validation is graded `incomplete`.
- Fix: record distinct reasons, for example `command-input-invalid`, `command-input-limit`, `command-call-limit`, `command-source-changed`.
  - Only source drift and harness faults should stop the trace.
  - A model-caused input error should be a graded candidate outcome. That means the `command-error` grade, or a new `input-invalid` grade, kept in `commands.jsonl` without stopping the trace.
- Who decides: the operator, if a different grading is wanted. This is a grading question, like the earlier self-corrected `finish` question.

## Requirements for the next slice (wiring; not defects in this patch)

1. **Pass raw events and the stop to the grader.** `gradeCommandUse` must receive the raw `events.jsonl` from `tracker.readEvents()` and the attempt's stop, not `trace.events`. The trace keeps only some event kinds and renumbers `seq`. Passing it would hide `protocol-violation` events, and `after_event_seq`, which counts raw events, would then compare against the renumbered sequence. Add a test that grades a trace containing an earlier violation.
2. **Put the command limits in the manifest.** `command-contract.md` says the 5-second deadline and 1 MiB caps are part of the experiment configuration before model admission. They are currently defaults inside `invokeCandidateCommand` and `createCommandAdapter` (16 calls). Bind them in the manifest beside the command binding.
3. **Treat the candidate arm in readiness and pairing.** The candidate bundle changes the system prompt and adds a fifth tool, so `evaluateCapture` (which expects the four baseline tools) and the runtime fingerprint in each trace will both reject or unpair the candidate. This is the declared-treatment work already planned.

## Advisories

- **No `blocked` path can be graded `followed`.** `gradeCommandUse` requires `terminal.status === 'completed'`, and the plan schema has no blocked action. All 11 current registry cases expect `completed`, so nothing is affected now. Define the grading for blocked or fault-injected cases before they are added.
- **Grading is conservative in two places.** Any planner call after the first effect gives `not-used`. Any failed call gives `command-error` even if a later call succeeded. Both err towards failing; record them as intended in the grading definition.
- **The tool schema allows any extra comment keys.** The planner input schema declares `additionalProperties: true` on comments, which `command-contract.md` states on purpose. The input-match check compares the whole canonical comment object with the last read, so a dropped or added key still gives `input-mismatch`.
- **A call can block the tool server for up to 5 s.** That allows at most 80 s across the default 16 calls, within the 600-second attempt limit.

## Housekeeping

There are now three registered review worktrees (`review-wt`, `review-wt2`, `review-wt3`) under `/tmp/claude-501/-Users-shftwst-workspace-shftwst-faff/8916b070-29a9-4847-9cbf-e07c2085fd3f/scratchpad`. The probe repositories are in the system temp directory under `mut-*`, `srv-*` and `b-*`. `git worktree prune` cleans up the worktree records once the scratchpad is cleared.
