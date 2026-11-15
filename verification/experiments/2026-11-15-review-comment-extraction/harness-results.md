# First harness hardening results

This change prepares the review-comment extraction. It changes evaluation code
and tests only. The production planner, candidate adapter and skill prose switch
are still pending. No new model comparison was run.

## Behaviour

- Check fixture, policy and expected-outcome hashes against the independent
  registry before invoking Claude and again before launching a batch.
- Count both arms against the paired attempt cap: eleven pairs need 22 attempts.
- Retain rejected post-finish calls, unknown tools and invalid finish calls in
  raw evidence. Such attempts cannot be graded as clean successes.
- Detect provider stream errors, CLI retry records and explicitly flagged
  synthetic CLI errors even when a later record looks successful.

The raw protocol events stay outside the schema-2 semantic projection. Existing
saved traces retain their interpretation. The first violation becomes a stop
reason; the complete calls and arguments remain in `events.jsonl`.

## Verification

| Check | Result |
|---|---|
| Existing focused suite | 110 passed |
| First regression run | 110 passed, four new cases failed as expected |
| Final focused suite | 122 passed, zero failed or skipped |
| Independent Claude Code verification | Same patch applied to a fresh baseline; 122 passed; no must-fix findings |
| Full suite with test-process Git signing disabled | 8,580 tests: 8,552 passed, one failed, 27 skipped |
| Failed PostgreSQL integration, isolated rerun | One passed; original failure was an occupied port 5432 |
| `faff regions check` | Passed |
| `faff validate-adapters` | Passed, 21 slot skills |
| `faff lint-cli-coverage` | Passed, 152 commands |
| `git diff --check` | Passed |

The first full-suite attempt inherited the operator's SSH-signing requirement
in temporary test repositories and was interrupted. Representative failing cases
then passed 18/18 with `GIT_CONFIG_COUNT=1`,
`GIT_CONFIG_KEY_0=commit.gpgsign`, `GIT_CONFIG_VALUE_0=false` scoped to the test
process. No global Git setting changed. The complete rerun used that same
override with `node --import ./test/hermetic-env.mjs --test`. Its sole remaining
failure was the PostgreSQL port collision above; no code change was needed for
the successful isolated rerun.

## Decisions and remaining limits

- A corrected invalid `finish` still makes an attempt incomplete. This keeps
  the protocol violation in the denominator rather than calling it a clean
  success; it can conservatively lower measured completion rates.
- Retry recognition has deterministic and installed-binary evidence. No paid
  retry was induced merely to test the detector.
- Readiness repeats a policy-hash mismatch per scenario; this is cosmetic.
- Candidate command invocation, pinned per-arm source and tool bindings,
  intended-difference classification and accounting refinements remain separate
  work. This patch does not make the extraction ready for a paid comparison.
- The Claude worker has an authenticated interactive CLI, but neither credential
  environment variable supported by the isolated eval driver is available.
- Production edits remain subject to the recorded release condition. PR #1187
  was open and behind main when checked; the latest release was `faff--v0.44.0`.
- The patch is on `feat/review-comment-extraction` in the managed worktree
  `/Users/shftwst/.codex/worktrees/9f7d/faff`. The initial commit attempt could not
  unlock the configured encrypted SSH-signing key. The operator then authorised
  an unsigned commit with DCO sign-off retained. The override applies only to
  that commit; no Git configuration change or push is part of this step.

See [the independent review](claude-harness-verification.md). No prompt-size,
model-cost or latency saving is claimed by this preparation patch.
