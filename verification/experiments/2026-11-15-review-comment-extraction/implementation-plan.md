# Review-comment extraction and Claude verification

Scope: the three drafts in the root checkout's
`verification/experiments/2026-11-15-review-findings-extraction/ticket-drafts.md`.
Codex implements; Claude Code independently reviews and runs the candidate.
Preserve the existing eleven-case oracle, decisions and recorded observations.
Source branch starts at `576888cbd7a83b63583127d53584c3cf8a49cb00`.

## Boundaries

- Preserve the user's existing worktrees and untracked audit evidence.
- Until the operator resolves the recorded release condition, edit only the
  evaluation harness, its tests and implementation records.
- Keep model and effort at the existing recorded settings for paired evaluation.
- Keep live tracker effects out of experiments. Prepare reviewable commits and
  PR updates as part of driving the work. Merge and release remain separate.
- Independent expectations must not be exposed to the model or planner adapter.

## Review focus

Claude must verify actual command use, preserved human text, forbidden attempts,
source bindings, treatment differences and complete accounting. Source-size
reduction and checkpoint model cost are separate results.

### Task 1: Close eval admission and evidence gaps

- [x] Add failing tests for registry/input mismatch before model admission,
  total paired attempt limits, swallowed post-finish calls and in-stream errors.
- [x] Fix the bounded harness paths. Retain raw failed attempts and reservations.
- [x] Run `node --test test/control-parity*.test.mjs`.
  Expected: all cases pass, including the existing 110 cases.
- [x] Commit the harness changes with operator sign-off.

The initial commit attempt could not unlock the encrypted SSH-signing key. The
operator then authorised committing without cryptographic signing; DCO sign-off
is retained. Focused verification is 122/122, including independent Claude review.

### Task 2: Implement the pure planner

Requires resolution of the release condition. Inputs are the seven recorded
decisions, supplied comment list and replacement body. Output is a versioned
create/update plan with reason, comment ID, body and original-body SHA-256.

- [ ] Freeze invalid-input and marker/fence boundary semantics in a spec.
- [ ] Write independent tests, including the eleven expected outcomes.
- [ ] Add TypeScript, emitted CLI registration, coverage and build manifest.
- [ ] Run planner tests, build, region and CLI coverage checks; commit.

### Task 3: Bind the real command and compare declared treatments

Consumes Task 2's command contract. Fixture-only adapter work proceeds before
Task 2 while the release condition is pending. Keep strict comparison unchanged;
a separate report classifies narrow declared differences and candidate conformance.

- [x] Test a fixture-only command adapter and command-invocation evidence.
- [x] Bind source/artifact hashes, arm tool definitions and complete schedule.
- [x] Add paired CLI entry, source-drift and deliberate mutant tests.
- [x] Run deterministic harness checks and obtain Claude's independent review.
- [ ] Bind the production candidate from Task 2 before model admission.

The reviewed harness has 171 passing deterministic tests. It can be committed
independently of production changes. `planner-boundaries.md` records proposals
for the unresolved input boundaries, not additional operator decisions.

### Task 4: Reduce caller prose and verify it in Claude Code

Consumes the command, independent oracle and reviewed harness. The actual reduced
caller bytes are the experiment treatment, never a surrogate prompt.

- [ ] Map removed obligations in a spec rule inventory and retain caller-owned
  reads, writes, uncertainty, findings judgement and logging.
- [ ] Run validation, reference, rule-inventory and prose-size checks.
- [ ] Give Claude the pinned candidate and ask it to run fresh old/new cases,
  bounded to 22 executions, no retries, with the existing $10 experiment cap.
- [ ] Resolve regressions, complete required tests and record measured size,
  conformance, usage and elapsed time without a whole-workflow savings claim.

No model batch starts until readiness and its declared limits pass. Any remaining
release restriction applies to production edits as directed by the operator.
