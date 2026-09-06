# Spec — FAFF-1013: require explicit `--execute` or `--check-only` on `faff merge-gate`

> Spec: faffter-noon-spec · 2026-09-06 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-1013.

## WHY

`faff merge-gate` today resolves its mode with `const mode = args.includes("--check-only") ? "check-only" : "execute";` (merge-gate.js:1118). Execute, which runs the irreversible `gh pr merge` (PR path) or the base-ref advance (`--local` path), is the silent fall-through. A caller who passes neither flag merges. `--execute` is documented at :1110-1113 only as an accepted no-op alias for that default, so it carries no weight: omitting it does exactly what passing it does. `--check-only` is the sole way to get a dry-run. This misfired in practice: an intended-as-preview `--squash` invocation with no `--execute` merged PR #869 during the FAFF-1005 graft.

This change makes intent mandatory. When neither `--execute` nor `--check-only` is present, the command errors (exit 2) instead of merging, naming the fix. The mutual-exclusion guard for both-flags-present (:1114-1117) is unchanged.

**Principle: require intent before a hard-to-reverse action.** A merge is not reversible in the sense the tool can undo it, so the affirmative to perform it must be explicit, never a default.

**Safe to require, because every sanctioned caller already passes a mode.** Grep of the shipped tree confirms the merge-ok landing template (landing-comment.js:106-107), the internal verdict shell (landing-comment.js:189-201, `--check-only`), faffter-noon-ship/SKILL.md:43 and :45, and faff-graft/SKILL.md:530/:560/:572 all pass an explicit `--execute` (or `--check-only`). The one exception is the non-graft/human-override template at landing-comment.js:95-97, given `--execute` here.

### Out of scope

- **Interactive confirmation prompt for merges.** This change is a hard requirement (error on missing intent), not a soft "are you sure?" prompt. Excluded because merge-gate already fences human-only flags on a real TTY (:1159 onward) and the agent-mediated sessions that call it are not TTYs, so a prompt would be dead weight in the exact path that merged #869. Extension point: a future `--interactive` confirm could layer on top of the required flag without changing the mode contract.
- **What `execute` and `check-only` do.** The merge behaviour, the `--check-only` short-circuit verdict (:1067 local, :1288 PR), the head-pin, and post-merge classification are untouched. Extension point: none needed; this change only gates entry.
- **The non-graft template's missing `--run-dir`/`--level`.** landing-comment.js:95-97 also omits `--run-dir` and `--level`, which merge-gate requires (:1145), so that template is already incomplete for a separate reason. **Punt:** FAFF-1013 adds only `--execute` per the operator decision to keep this change scoped to the mode default; adding `--execute` alone does NOT make the template runnable (it still exits 2 at :1145 for the missing `--run-dir`). Extension point: a follow-up ticket should complete that template (or confirm it is intentionally a fill-in-the-blanks stub); flagged, not fixed here.

## WHAT

Two source changes plus test coverage.

1. **Mode contract (merge-gate.js).** Add a guard, immediately after the existing mutual-exclusion guard (:1114-1117) and before the mode resolution at :1118, that errors when neither mode flag is present. Update the :1110-1113 comment so it states `--execute` is now the required affirmative for a merge, not a no-op alias.

2. **Caller fix (landing-comment.js:95-97).** Add `--execute` to the non-graft/human-override template so the emitted command satisfies the new mode contract. **This does not make the template runnable.** The same template omits `--run-dir` and `--level`, which merge-gate still requires at merge-gate.js:1145, so the emitted command exits 2 there even with `--execute`. Completing the template (the missing `--run-dir`/`--level`) is a separately-flagged follow-up listed in Out of scope; per the operator decision, FAFF-1013 adds `--execute` only and does not claim the template merges.

3. **Test coverage (`test/*.mjs`).** Add the neither-flag exit-2 test, and update every test helper and inline invocation that currently omits a mode flag so the existing execute-path tests keep exercising execute.

### Correction to the explore's coverage premise

The explore brief stated there is no `test/*.mjs` suite and that new coverage lands in `mergeGateSelftest` (merge-gate.js:1471). That is not correct. A real CLI test suite exists and is the right home for this behaviour:

- `test/merge-gate.test.mjs` — deterministic CLI seam (exit codes, arg validation). The both-flags mutual-exclusion is already tested here at lines 123-126.
- `test/merge-gate-controlflow.test.mjs` — impure routing past the gh calls, including the `--check-only` short-circuit and the execute positive control, using a stubbed `gh` and a merge sentinel.
- `test/merge-gate-local.test.mjs` — the `--local` branch.

These run under `node --test` via `test/helpers/run-cli.mjs`, which spawns the real `bin/faff`. `mergeGateSelftest` tests pure functions (`decideFloor`, `resolveMergeFlags`, `holdoutIsFresh`), not argv routing, so it is the wrong place for a mode-flag exit-code assertion.

**Chosen:** put the neither-flag exit-2 test in `test/merge-gate.test.mjs` next to the existing mutual-exclusion test, and fix the execute-path helpers rather than adding a `mergeGateSelftest` case. Rationale: CLI exit-code and argv behaviour is already covered there via the real entrypoint; matching the established convention keeps one home for this class of test.

## HOW

### The mode contract

`mode` is resolved once, at :1118, before the `--local` dispatch at :1130. Both entry points read it: the PR path uses it at :1288, and the `--local` path receives it through `cmdMergeGateLocal({ ... mode ... })` at :1136 and short-circuits on it at :1067. A single guard at the shared resolution site therefore covers both paths.

```
# existing, unchanged (:1114-1117):
if args has "--execute" AND args has "--check-only":
    stderr "faff merge-gate: --execute and --check-only are mutually exclusive"
    return 2

# new guard, inserted here (before the :1118 mode line):
if args has neither "--execute" nor "--check-only":
    stderr "faff merge-gate: pass --execute to merge or --check-only to preview"
    return 2

# unchanged (:1118): exactly one flag is now guaranteed present
mode = args has "--check-only" ? "check-only" : "execute"
```

**Chosen:** the neither-flag guard sits beside the mutual-exclusion guard, before mode resolution and before the `--local` dispatch and the required-flag checks. Rationale: it fails fast before any gh/CI observation or side effect, it covers both PR and `--local` with one guard because mode is resolved once at :1118, and it keeps the two mode-argument guards adjacent and consistent. It mirrors the existing guard's shape exactly: a one-line stderr write and `return 2`, matching merge-gate's usage-error convention (`usageError` also returns 2, argv.js:209-212), rather than introducing a new exit code.

**Chosen:** the error message names the fix directly: `pass --execute to merge or --check-only to preview`. Rationale: the operator who forgot a mode is told the two valid intents and what each does, in one line, consistent with the sibling mutual-exclusion message.

**Chosen:** `--execute` becomes the required affirmative and stops being a no-op alias. The :1110-1113 comment is rewritten to say so. Rationale: after this change, omitting `--execute` no longer performs the merge, so the old comment ("the documented, accepted way to say the unchanged default mode") is now false and would mislead the next reader.

**Chosen (scope boundary):** a hard requirement (error), not a soft interactive confirm and not a docs-only clarification. Alternatives considered: (a) a soft confirm prompt, rejected because the calling sessions are non-TTY and the prompt would not fire on the path that merged #869; (b) leave the default and improve the docs, rejected because it leaves the irreversible action as the silent fall-through, which is the defect. The blast radius of the hard requirement is one shipped template (landing-comment.js:95-97), so the stricter option costs almost nothing.

### The caller fix

landing-comment.js:95-97 is the `kind === "non-graft"` template. It currently emits:

```
faff merge-gate --pr <pr> --issue <issue> \
  --human-override --interactive --override-reason "<what merged + why no floor applies>" \
  --merge-args "--squash --delete-branch"
```

Add `--execute` to the emitted flag set (for example on the `--human-override --interactive ...` line). The requirement is that the emitted command string contains `--execute`. **The template is still not runnable after this change:** it carries no `--run-dir` and no `--level`, both of which merge-gate requires at :1145, so the emitted command exits 2 at that check regardless of `--execute`. That completion is out of scope (see above). The merge-ok template at :106-107 already carries both `--execute` and `--run-dir`/`--level` and is unchanged.

### Test migration

Every merge-gate CLI invocation in the suite that omits a mode flag relies on the removed default and must gain an explicit mode. The execute-path helpers gain `--execute`; the dry-run tests already pass `--check-only` and are unchanged. A bare `--squash` on a helper is a merge-method argument, not a mode flag, so a helper that carries `--squash` but no `--execute`/`--check-only` still trips the new guard and must gain `--execute`.

| Location | Current | Change |
|---|---|---|
| `test/merge-gate.test.mjs` (new test) | none | add: neither-flag on the PR path returns exit 2, stderr matches the naming message |
| `test/merge-gate-controlflow.test.mjs:177-178` `baseArgs` | no mode flag (carries bare `--squash`) | add `--execute` (execute-path tests at :207, :220, :241, :250, :270, :284, :313, :405 depend on it) |
| `test/merge-gate-controlflow.test.mjs:230` inline no-method args | no mode flag | add `--execute` |
| `test/merge-gate-controlflow.test.mjs:389` `baseArgs`-style helper (no `--level`) | no mode flag | add `--execute` |
| `test/merge-gate-controlflow.test.mjs:597-598` `argsL4` | no mode flag | add `--execute` (FAFF-420 L4 tests at :624/:639/:663/:677 assert exit 1/refuse and reach the holdout leg through it; without a mode they now exit 2 at the guard) |
| `test/merge-gate-controlflow.test.mjs:716-717` `effArgs` | no mode flag (carries bare `--squash`) | add `--execute` (FAFF-383 execute-path tests at :728/:751/:779/:799/:814/:821 assert exit 0 plus a merge sentinel and reach execute through it; the `--check-only` case at :807 already carries a mode and is inert) |
| `test/merge-gate-local.test.mjs:64` `baseArgs` and :593 `l4Args` | no mode flag | add `--execute` (execute-path tests throughout depend on it) |
| `test/merge-gate-local.test.mjs:225` missing-required-flags test | no mode flag | add `--execute` so it still reaches the `--issue`/`--run-dir` required-flags check (the guard at :1118 now precedes the `--local` dispatch and that check) |
| `test/faff-895-pr-custody-basis.test.mjs:119` `prArgsL4` helper | no mode flag (carries bare `--squash`) | add `--execute` |
| `test/injection-probes.test.mjs:86` `localArgs` | no mode flag | add `--execute` |
| `test/merge-gate.test.mjs` inline exit-2 tests (:87, :92, :98, :143, :150, :157, :166, :175, :182, :188, :194) | no mode flag | add an explicit mode (`--execute`) so each still reaches the guard it is testing, since the neither-flag guard now precedes them |

The dry-run tests (`--check-only`) at controlflow :187/:196/:545, local :109, and effects :807 need no change.

**Coordination with FAFF-1012.** The FAFF-383 `effArgs` block (:716-769) is also rewritten by sibling ticket FAFF-1012 (its auto-declare changes the no-declare-escape assertions around :747-769). FAFF-1012 lands first; FAFF-1013 rebases onto it and adds `--execute` to the `effArgs` helper that FAFF-1012 will have rewritten (not to the pre-1012 form shown above). See the Assumes marker below.

### Risks and edge cases

- **Ordering of exit-2 reasons.** The neither-flag guard precedes the required-flag and level checks, so an invocation missing both a mode and a required flag reports the mode error first. Both still exit 2. The inline tests that assert a specific downstream stderr must add an explicit mode (see the table) so they reach the guard they target. This is exactly why the `--local requires --issue and --run-dir` test at local :225 needs `--execute`: the guard at :1118 now fires before the `--local` dispatch at :1130 and that message at :1131.
- **`--local` coverage.** Because mode is resolved once at :1118 before the `--local` dispatch, the guard fires for `--local` too. This is verified by the local path reading `mode` at :1067 and :1136.
- **Adding `--execute` to refuse/fence tests is inert.** Tests that exercise a refuse or a TTY-fence path return before the execute branch, so a helper carrying `--execute` does not change their outcome, the same way `baseArgs`/`effArgs` already carry a bare `--squash` that is inert on those paths. The FAFF-420 `argsL4` tests are refuse-path (exit 1) tests: `--execute` lets them past the new guard so they reach and refuse at the L4 holdout leg exactly as before.
- **Rebase dependency on FAFF-1012.** If FAFF-1013 lands before FAFF-1012 rebases, the `effArgs` edit may conflict or be applied to the wrong form. Mitigation: FAFF-1012 lands first; FAFF-1013's `effArgs` change is applied to the post-1012 helper.

## Scenarios

```
Given a faff merge-gate --pr invocation with a passing floor
And neither --execute nor --check-only is present
When merge-gate runs
Then it writes "pass --execute to merge or --check-only to preview" to stderr
And it exits 2
And no gh pr merge is spawned
```

```
Given a faff merge-gate --local invocation with a passing floor
And neither --execute nor --check-only is present
When merge-gate runs
Then it exits 2 with the same naming message
And no base-ref advance occurs
```

```
Given a faff merge-gate invocation on a merge-ok floor
When --execute is passed and --check-only is not
Then the merge proceeds and it exits 0 with verdict merge-ok
```

```
Given a faff merge-gate invocation on a merge-ok floor
When --check-only is passed and --execute is not
Then it returns the merge-ok verdict without merging and exits 0
```

## Acceptance criteria

- [ ] merge-gate.js: a neither-flag guard is inserted after :1114-1117 and before the :1118 mode resolution; passing neither `--execute` nor `--check-only` writes `faff merge-gate: pass --execute to merge or --check-only to preview` to stderr and returns 2, on the PR path.
- [ ] The same neither-flag call returns exit 2 with the same message on the `--local` path (verified through the shared :1118 resolution reaching :1067/:1136).
- [ ] `--execute` alone (no `--check-only`) on a merge-ok floor proceeds to execute: exit 0, `verdict` `merge-ok`, merge spawned (sentinel present in the stubbed-gh test).
- [ ] `--check-only` alone on a merge-ok floor returns `merge-ok` without merging: exit 0, no merge spawned.
- [ ] Both `--execute` and `--check-only` together still exit 2 naming the mutual exclusion (existing behaviour, unchanged, and now asserted by a test).
- [ ] The :1110-1113 comment is updated to state `--execute` is the required affirmative for a merge, not a no-op alias.
- [ ] landing-comment.js:95-97 (the non-graft/human-override template) emits a command string containing `--execute`. This AC does not assert the template merges: the template still omits `--run-dir`/`--level` and so exits 2 at merge-gate.js:1145; completing it is a separately-flagged follow-up (Out of scope).
- [ ] No other shipped merge-gate invocation is changed (grep-verified: merge-ok template, verdict shell, faffter-noon-ship/SKILL.md, faff-graft/SKILL.md all already pass an explicit mode).
- [ ] A new test in `test/merge-gate.test.mjs` asserts the neither-flag exit-2 and its stderr message on the PR path.
- [ ] Every execute-path helper and inline invocation listed in the test-migration table gains an explicit `--execute` — including `argsL4` (controlflow :597-598) and `effArgs` (controlflow :716-717) — and the full `node --test` suite passes.

confidence: medium
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{"confidence":"medium","decisions":[{"kind":"Chosen","topic":"test coverage lands in the mjs CLI suite, not mergeGateSelftest (corrects the explore's no-mjs-suite premise)"},{"kind":"Chosen","topic":"neither-flag guard placed beside the mutual-exclusion guard, before mode resolution and the --local dispatch, covering both paths via the single :1118 resolution"},{"kind":"Chosen","topic":"error message names the fix: pass --execute to merge or --check-only to preview"},{"kind":"Chosen","topic":"--execute becomes the required affirmative; :1110-1113 comment rewritten"},{"kind":"Chosen","topic":"hard requirement (exit 2), not a soft interactive confirm and not docs-only"},{"kind":"Chosen","topic":"caller fix adds --execute to landing-comment.js:95-97 non-graft template for the mode contract only"},{"kind":"Punt","topic":"non-graft template stays non-functional: it still omits --run-dir/--level and exits 2 at :1145; completing it is a separate follow-up (operator decision to scope FAFF-1013 to the mode default)"},{"kind":"Chosen","topic":"test-migration table completed: the argsL4 (controlflow :597-598) and effArgs (controlflow :716-717) execute-path helpers also gain --execute, closing the two omissions that would have failed the suite"},{"kind":"Assumes","topic":"FAFF-1013 rebases onto FAFF-1012 (auto-declare, rewrites the effArgs block :716-769), which lands first; the effArgs --execute edit is applied to the post-1012 form"}]}
```

## Methodology critique

Right-sized: yes, one cohesive contract change (require an explicit merge/preview mode). Sibling of [FAFF-1012](https://linear.app/shftwst/issue/FAFF-1012) on the same `merge-gate` execute seam. **Keep separate** (distinct concern: irreversibility-default vs FAFF-1012's audit-coverage), with the existing relates-to link. **Rebases onto FAFF-1012** (lands second): FAFF-1012 rewrites the FAFF-383 `effArgs` test block (`merge-gate-controlflow.test.mjs:716-769`) first, then this ticket adds `--execute` to the post-1012 helper and the neither-flag guard together — captured in the Assumes marker. Deps: soft rebase-dep on FAFF-1012 (not a hard blocker). Risk: broad test surface (~a dozen helpers/inline sites across four files) — the main reason this stayed confidence:medium; each migration row is enumerated, so it is execution effort, not a design unknown.
