*Agent-written (Claude Code): FAFF-1416 spec, produced by interactive prep for the operator. Revised after spec-review rounds 1–2.*

# FAFF-1416: faff pr open — move graft's Step 9b PR opening from prose into a command

> Spec: faffter-dark-nlspec · 2026-10-31 · interactive · claude-code/unknown · faff 0.44.0 · confidence: high. Full spec on Linear FAFF-1416.

> 2026-10-31 operator amendment: scenario issue id X-1 → TT-1 (X-1 is refused by pr-body's id rule; ids only, no behaviour change).

This spec is for the build agent and its reviewers. It replaces graft Step 9b's ordered PR-opening sequence with one verb, `faff pr open`, which composes the existing commands. It follows the pattern of `faff land` (FAFF-1396) and `faff graft admit` (FAFF-1414): typed tokens, injected dependencies for tests, and a rule inventory that maps every deleted SKILL.md line.

## 1. WHY

**The load-bearing idea:** every step of Step 9b is already a CLI call or a git command. The prose's job is the order, the failure handling between steps, and the governed brackets. That order is the safety property (anchor committed and pushed before the PR exists, no unsanitized body, no ungranted governed PR), and today it is enforced only by a static lint over prose. In code it becomes a tested sequence.

- Step 9b is about 53 lines of `faff-graft/SKILL.md` (origin/main 948a8f1d, lines 502–554), re-read on every turn of every build.
- It sits directly before `faff land`, so after this ticket the whole path from review `pass` to merge is code.
- The "reached only when Step 9 returned `pass`" rule is prose-only today. Nothing stops a PR opening on a `fail` verdict except the agent remembering. The command enforces it.
- The anchor-before-PR order (FAFF-1001) and the no-broad-swallow rule on the anchor commit (FAFF-1005) are guarded by `validate-adapters` scanning prose. A test over the command's real call sequence is a stronger guard than a text scan.

### Design principles

- **Compose, don't re-implement.** The command calls `faff pr-create`, `faff events anchor`, `faff evidence write`, `faff bundle publish`, `faff effects declare|observe` and `faff commissaire effect declare|authorize|observe` as they are, and the `pr-body` sanitizer and checker in-process. None of them changes.
- **The chokepoint stays a chokepoint.** `faff pr-create` remains the sole `gh pr create` path and keeps verifying a grant it did not mint.
- **Judgement stays with the agent.** Composing the PR body, resolving the title from the `pr_title` convention, reading the tracker, and the In Review status write stay agent-side.
- **Fail closed before anything outward.** Every refusal that can be decided before the push is decided before the push.

### Reference context

- `plugin/skills/faff-graft/SKILL.md` Step 9b (lines 502–554) and Step 8b (lines 366–384, the build-complete push, unchanged).
- `plugin/skills/faff/bin/lib/merge-gate-pr-create.js` (`cmdPrCreate`), `pr-body.js` (`sanitizePrBody`, `checkPrBody`), `merge-gate-floor.js` (`readReviewVerdict`, `readHoldout`), `merge-authorize.ts` (`deriveInputs`, `facade`), `events.js` (the `events anchor` refusal codes and the exported `validateAnchorGenesis`), `land.ts` (deps-injection shape), `validate-adapters.js` (`checkAnchorBeforePrOrder`, `checkAnchorCommitNoBroadSwallow`, `SKILL_LINE_BASELINE`), `regions.js`, `lint-cli-coverage.js`, `bin/faff`.

### Already shipped against this surface

- FAFF-1118: `faff pr-create`, the sole sanctioned `gh pr create` path with the fail-closed pr-create grant leg. Composed, unchanged.
- FAFF-214: `faff pr-body sanitize|check`. Reused in-process, unchanged.
- FAFF-1001 / FAFF-1005: anchor-before-PR order and the no-broad-swallow commit rule, as prose lints. Moved into code and tests here.
- FAFF-1396 `faff land`, FAFF-1414 `faff graft admit`, FAFF-1426 `faff merge authorize|observe`: the composition pattern this follows. FAFF-1426's input derivation is reused.

None of these opens a PR end to end, so the premise holds.

## 2. OUT OF SCOPE

- Step 8b's build-complete push and its governed bracket (unchanged; a separate collapse if wanted).
- Changing `faff pr-create`, `faff pr-body`, `faff events anchor`, `faff bundle publish` or any Commissaire module. Commissaire gains no verb, flag or concept.
- Writing tracker status. The In Review transition stays agent-mediated (no `faff status set`, held anti-pattern).
- Composing the PR body or choosing the title.
- Merging, auto-merge, or anything FAFF-1441 adds on the GitHub side.
- Graft Step 3 (FAFF-1415).

## 3. WHAT

### Vocabulary

- **Draft body:** the agent-composed PR body file, before sanitizing.
- **Safe body:** the sanitized bytes the command writes to its own temporary file and hands to `faff pr-create`.
- **Anchor commit:** the commit that adds `.faff/anchors/<run-id>/<ISSUE>/`, subject `chore(<ISSUE>): anchor run evidence`.
- **Governed:** the governed-run check (`faff commissaire contract status --run-dir`) returned `governed: true`.

### Interface

```
faff pr open --run-dir DIR --issue ID --base BRANCH --title T --body-file FILE
             [--spec-review-evidence FILE] [--json]
```

- A new top-level `pr` dispatcher with one subverb, `open`, in `plugin/skills/faff/bin/lib/pr-open.ts`. `faff pr-create` and `faff pr-body` keep their names and behaviour.
- Runs in the feature worktree (cwd), on the feature branch.
- `--json` prints one result object; without it, one summary line plus one line per warning or blocker.

**Result (JSON):** `{ token, exit, pr_url?, pr_number?, head_sha?, anchor_dest?, cause?, blockers?, warnings[], governed?, tracker_transition? }`. `tracker_transition` is present only on `opened` and `already-open`: `{ to: "In Review", governed, effect: { kind: "tracker-write", target: "<ISSUE>:In Progress->In Review", reversible: true } }`.

| Token | Exit | Meaning | Nothing outward happened? |
|---|---|---|---|
| `opened` | 0 | PR opened at the pushed, anchor-carrying head | n/a |
| `already-open` | 0 | an open PR for this branch and base already exists; head pushed, no create | n/a |
| `no-op` | 0 | git-only (no pushable remote) | yes |
| `refused` | 1 | `review-not-pass`, `body-unsafe`, `open-pr-other-base`, or `pr-create-refused` (blockers carry `faff pr-create`'s own lines) | yes for the first three; for `pr-create-refused` the anchor is already pushed |
| `needs-human` | 3 | `anchor-no-events`, `anchor-genesis-invalid`, `anchor-floor-incomplete`, `commissaire-status-failed`, `already-open-ungranted`, `pr-create-denied` | yes for all but `pr-create-denied` (anchor pushed, no PR) |
| `errored` | 2 | usage, unreadable input, `wrong-branch`, `gh-unavailable`, anchor CLI error, commit or push failure | yes unless the push itself partly failed |

### Where the code lives

- `plugin/skills/faff/bin/lib/pr-open.ts` (new, TypeScript, layout d, committed `.js` emit, `build-manifest.json` regenerated; added to `tsconfig.json` include and the `test/check-no-boundary-cast.test.mjs` pin list).
- `bin/faff`: register `pr` (lazy-loaded `cmdPr`).
- `regions.js`: `pr: "factory"`, `REGION_SELFTEST_ARGV.pr = null`. `lint-cli-coverage.js`: `TEST_FILE_COVERAGE.pr = ["test/pr-open.test.mjs"]`.
- `merge-authorize.ts`: extract the level, attendance and holdout derivation into one exported function both commands call, taking the run dir, issue and the head the anchor was minted at. `faff merge authorize`'s behaviour is unchanged (its existing tests pass unmodified).
- `validate-adapters.js`: the faff-graft Step 9b lint is re-targeted (4.2 D6); `SKILL_LINE_BASELINE["faff-graft"]` lowered.
- `docs/guide/cli.md`: one row for `pr open`.
- `plugin/skills/faff-graft/SKILL.md`: Step 9b rewritten.

## 4. HOW

### 4.1 Procedure

Steps run in this order. A step that refuses stops the command; later steps never run.

1. **Parse and validate.** All five required flags present; `--issue` matches the same id pattern `pr-create` uses; `--body-file` readable. Else `errored` exit 2.
2. **Git-only.** No pushable remote (the same `gitRemoteEmpty` check `pr-create` uses) → `no-op` exit 0.
3. **Branch check.** HEAD must be on a named branch that is not `--base` and does not begin with `-`. Else `errored` / `wrong-branch`.
4. **Review precondition.** `readReviewVerdict(runDir, issue)` must return `pass`. Anything else (`fail`, `needs-human`, `unavailable`, `missing`) → `refused` / `review-not-pass` exit 1.
5. **Governed-run check.** Spawn `faff commissaire contract status --run-dir DIR` with a 30-second timeout. Non-zero exit, timeout, or stdout that is not exactly one JSON object with a boolean `governed` → `needs-human` / `commissaire-status-failed` exit 3 (cause names exit code, `timeout` or `unparseable output`, never stderr text).
6. **Spec-review evidence floor file (best-effort).** When `--spec-review-evidence` is given, pipe it to `faff evidence write spec-review-verdict --run-dir DIR --issue ID`. A non-zero exit adds a warning and continues.
7. **Sanitize and check.** `sanitizePrBody(draft, issue)` then `checkPrBody(safe, issue)` on the exact sanitized bytes, written to a command-owned temporary file. A throw or a failed check → `refused` / `body-unsafe` exit 1. The draft is never handed to `gh`.
8. **Existing PR.** `gh pr list --head <branch> --state open --json number,url,baseRefName,headRefOid` through the `runGh` chokepoint, before anything outward. A `gh` failure or unparseable output → `errored` / `gh-unavailable` exit 2 (`pr-create` could not succeed either). An open PR for the branch against a different base → `refused` / `open-pr-other-base` exit 1. An open PR against `--base` is the **existing PR**. On a governed run, an existing PR additionally requires `resolvePrCreateGrantDetail(runDir, issue, base, trustCtx)` (the chokepoint's own leg, `merge-gate-effects.js`) to report a valid grant; otherwise → `needs-human` / `already-open-ungranted` exit 3, so an out-of-band PR is never blessed on a governed run.
9. **Already anchored.** When there is an existing PR whose `headRefOid` equals local HEAD and HEAD's tree already contains `.faff/anchors/<basename DIR>/<ISSUE>/` (`git ls-tree HEAD -- <dest>` non-empty) → `already-open` exit 0 with no anchor, commit or push. Nothing has changed since the head was anchored and pushed, and re-minting would only re-anchor ledgers that grew after the PR opened.
10. **Anchor.** Spawn `faff events anchor --run-dir DIR --issue ID --dest .faff/anchors/<basename DIR>/<ISSUE>/`. Exit 3 is a refusal. The command classifies it by a fixed stderr prefix and the exported validator, never by free text: stderr beginning `faff events anchor: floor-incomplete` is `floor-incomplete`; otherwise it calls `events.js`'s exported, read-only `validateAnchorGenesis(runDir)` and takes its `code` (`no-events` or `genesis-invalid`); a refusal it cannot classify is `genesis-invalid` (fail closed to the park). Each → `needs-human` with cause `anchor-<code>` exit 3; the cause text names the run dir and, for `floor-incomplete`, says it is a build-evidence defect rather than a provisioning fault. Any other non-zero → `errored`. An `evidence-schema warn-only` stderr line on exit 0 becomes a warning.
11. **Anchor commit.** `git add -- <dest>`. If `git diff --cached --quiet` reports nothing staged, skip the commit (the only tolerated "nothing to commit" case). Otherwise `git commit -m "chore(<ISSUE>): anchor run evidence"` with hooks enabled; any non-zero from `add` or `commit` → `errored` exit 2. No error is swallowed.
12. **Push (governed bracket).** When governed, `faff effects declare --run <basename DIR> --issue ID --step push` with stdin `[{"kind":"push","target":"<branch>","reversible":true}]`; a non-zero exit adds a warning. Then `git push origin refs/heads/<branch>:refs/heads/<branch>` (no force; the full refspec keeps a branch value from ever being read as an option); non-zero → `errored` exit 2. When governed and the push succeeded, the same with `observe`; a non-zero exit adds a warning.
13. **Bundle (best-effort).** `faff bundle publish --run-dir DIR --boundary-kind issue-merge-floor --boundary-key ID`. `store_unavailable` or any non-zero adds a warning.
14. **Existing PR updated.** When there is an existing PR (its head was behind local HEAD, or HEAD carried no anchor), the push has updated it → `already-open` exit 0 with its url and number; no declare, no create.
15. **Governed pr-create producer half.** When governed: derive `{level, attended, holdout}` with the function `faff merge authorize` uses (level from the just-minted anchor's ledger copy, attendance from `verificationUnattended`, holdout from `readHoldout`). `faff commissaire effect declare --run-dir DIR --producer <basename DIR> --unit-id ID --step pr-create` with stdin `[{"kind":"pr-create","target":"<base>","reversible":true}]`, then `authorize` with stdin `{effect:{kind:"pr-create",target:"<base>"}, level, attended, holdout}` and `--level <level>`. A `deny` verdict, a non-zero exit, or unparseable output → `needs-human` / `pr-create-denied` exit 3; the PR is not opened.
16. **Open.** Spawn `faff pr-create --run-dir DIR --issue ID --base <base> --body-file <safe> --title <title> --json`. `opened` → continue. `refuse` or exit non-zero → `refused` / `pr-create-refused` exit 1 with its blockers. `no-op` → `no-op`.
17. **Observe (governed).** `faff commissaire effect observe` with the same descriptor; a non-zero exit adds a warning (the PR is already open).
18. **Clean up and emit.** Delete the safe-body temp file in every path that created it (a `finally`). Emit the result; `tracker_transition` on `opened` / `already-open`.

All subprocesses are spawned with argument arrays and no shell. Body bytes are only ever passed as a file path.

### 4.2 Decisions

- **D1 New verb, not an extension of `pr-create`.** **Chosen:** add `faff pr open` in a new TypeScript module and leave `faff pr-create` byte-for-byte unchanged. `pr-create` is the chokepoint that *verifies* a covering grant; folding the producer half (declare and authorize) into it would let the chokepoint mint the grant it then checks, collapsing the producer/verifier split FAFF-1118 built. It would also put git commit, push and park semantics inside a JavaScript chokepoint that other callers rely on, against AGENTS.md (new commands are TypeScript; a small JS edit stays JS). Composing it keeps one PR-open path: `pr open` cannot open a PR any way `pr-create` would refuse.
- **D2 Review precondition in code.** **Chosen:** refuse unless `readReviewVerdict` returns `pass`, using the merge floor's own reader. This tightens today's prose-only rule and cannot loosen it. The verdict file is written by graft Step 9 and is not bound to a head sha; that is the merge floor's existing property, and `faff merge-gate` re-checks it against the anchored copy at merge, so this command adds no new trust in it.
- **D3 Governed-run check inside the command.** **Chosen:** the command runs the same check graft's prose defines, with the same failure handling, so a governed run never takes an ungoverned path because the agent skipped the check. It reaches Commissaire only through its existing `contract status` verb.
- **D4 Inputs derived, never passed.** **Chosen:** no flag supplies level, attendance or holdout; the command derives them as `faff merge authorize` does. `faff merge authorize` already derives these values this way, so its behaviour does not change. What changes is the pr-create authorize payload relative to today's prose, which passed the raw `holdout.json` aggregate or omitted it: an absent holdout is now recorded as `missing`, and a stale `meets-spec` is now `blocked`. Both only matter at L4, where `evaluateLevelPolicy` denies anything but `meets-spec` either way, except that a stale verdict now also denies, which is the merge floor's own rule.
- **D5 `already-open` on re-run.** **Chosen:** the existing-PR lookup (step 8) runs before anything outward. A re-run after a crash between `pr-create` and the In Review write finds the open PR at an anchored local HEAD and returns `already-open` with no anchor, commit or push (step 9), instead of re-minting an anchor over ledgers that grew after the PR opened. When local HEAD is ahead of the PR head, or HEAD carries no anchor, it anchors and pushes so the PR head always carries its anchor, then returns `already-open` (step 14). On a governed run, `already-open` requires the chokepoint's own pr-create grant leg to be valid (step 8), so a PR opened outside the chokepoint is surfaced, not blessed.
- **D6 Lint re-targeted, guarantee moved to tests.** **Chosen:** `validate-adapters` keeps failing closed when faff-graft has no bounded `**Step 9b:` … `**Step 10:` section, and now also fails when that section does not invoke `faff pr open`, or when a code span inside it invokes `gh pr create`, `faff pr-create`, `faff pr-body`, `faff events anchor` or `git push` directly. `checkAnchorBeforePrOrder` and `checkAnchorCommitNoBroadSwallow` are removed with their fixture tests, and their two guarantees are pinned in `test/pr-open.test.mjs` over the command's recorded call sequence: anchor, commit and push precede `pr-create`; a commit failure produces no push and no `pr-create`; only the nothing-staged case skips the commit. The ordering is now executed code under test rather than prose under a text scan, so the guard is stronger, not weaker.
- **D7 Push target.** **Chosen:** `git push origin refs/heads/<branch>:refs/heads/<branch>`: Step 8b's explicit-remote form, so a branch with no upstream (`graft.push_at_build_complete` off) still pushes, written as a full refspec so a branch value can never be read as an option. **Assumes:** the remote is `origin`, as Step 8b and `remote-diff-base.sh` already assume.
- **D8 Anchor commit subject.** **Chosen:** `chore(<ISSUE>): anchor run evidence`, the subject graft's anchor commits already carry (e.g. FAFF-1444's `3fdffafd`). Prose never fixed it; the command does.
- **D9 Title and body stay agent-side.** **Chosen:** the command requires `--title` and `--body-file`. Summarising the change and assembling the AC checklist are judgement and rendering the agent already does; `pr-create` already refuses a missing title.
- **D10 Tracker transition as a descriptor.** **Chosen:** the command never writes the tracker. It emits `tracker_transition`, and graft's prose keeps the live re-read, the monotonicity check, the `save_issue` write and its governed bracket.
- **D11 `--run-dir` required.** **Chosen:** required, as `pr-create` already requires it, so no PR could open without a run dir today either.

### 4.3 Graft Step 9b after the change

The step keeps, in about 20 lines:

1. The `pass`-only entry sentence and the git-only skip.
2. Locate the newest `## Spec-review evidence` comment, else the Step 4 committed spec, and save it to a file (none is fine).
3. Compose the complete draft body (every generated section, including the Step 8 AC checklist) and resolve the title from `faff conventions get pr_title`, always explicit.
4. One `faff pr open` call (one sentence on what it runs, in order, and why the anchor precedes the PR), and delete the draft afterwards.
5. A token routing table: `opened` / `already-open` → the In Review transition, then Step 10; `no-op` → Step 10; `refused` `body-unsafe` → fix the draft once and re-call, else park; any other `refused`, `needs-human` or `errored` → the shared park protocol with the cause (anchor causes keep their provisioning versus build-evidence remedy).
6. The In Review transition PROCEDURE block, unchanged in substance, plus its governed bracket now taking the effect payload from `tracker_transition`, and the existing anti-patterns line.

### 4.4 Docs

- `docs/guide/cli.md`: a `pr open` row naming the tokens and exit codes.
- The `SKILL_LINE_BASELINE` comment gains a `FAFF-1416 -N faff-graft` entry.

### 4.5 Edge cases

- **Re-run after `refused` / `pr-create-refused`.** The anchor is pushed and no PR exists; the re-run re-mints the anchor (the ledgers may have grown), commits only if it changed, pushes, and retries the create.
- **Re-run after a partial push failure.** The commit exists locally; the re-run skips the commit and pushes again.
- **`already-open` with a different head.** Local HEAD is ahead of the PR head; the command anchors and pushes, CI fires on the new head exactly as a review-fix push to an open PR does today, and returns `already-open`.
- **Open PR against another base.** Refused before anything outward (`open-pr-other-base`); the human decides which base is right.
- **Dispatched build lane.** The command uses only cwd and the run dir, so it runs unchanged in a concurrency lane's worktree.
- **Effects after the anchor.** The governed pr-create declare, authorize and observe (steps 15 and 17) append after the anchor is minted, so the anchor at the PR head never carries them. That is today's order too; `merge-gate` and `governance-check` read the live run dir and the anchor as they do now.
- **Same-repository heads.** `gh pr list --head <branch>` matches a same-repository branch, which is what graft opens; a fork head is out of scope.
- **Hooks.** The anchor commit runs repository hooks (the DCO `prepare-commit-msg` hook adds the sign-off). A rejecting hook is a commit failure → `errored`.

### 4.6 Tests (in `test/` only, `node --test`, no new `--selftest`)

`test/pr-open.test.mjs`, driving the exported runner with injected dependencies (spawn, git, gh, clock, filesystem root) and recording every call in order. Each bullet is one named test case (the bold name is the test name); the rule inventory's covering-test column cites these names.

- **happy path**: ungoverned, call order is review read, status, sanitize, check, pr list, anchor, add, commit, push, bundle, pr-create; result `opened` with `tracker_transition`.
- **governed**: push declare before the push and observe after; pr-create declare and authorize before `pr-create`, observe after.
- **order guarantee** (FAFF-1001): `pr-create` is never called before the push returned 0.
- **commit-failure** (FAFF-1005): `commit` exits 1 → `errored`, and no push or `pr-create` call is recorded.
- **nothing-staged**: no `commit` call; the push still runs.
- **review-not-pass**: one case per non-pass signal (`fail`, `needs-human`, `unavailable`, `missing`); no push, no `pr-create`.
- **body-unsafe**: sanitizer throw and failed check; no pr list, no push.
- **anchor codes**: `no-events`, `genesis-invalid`, `floor-incomplete` and an unclassifiable exit 3; no commit, push or `pr-create`.
- **commissaire-status-failed**: non-zero, timeout and unparseable status; nothing after.
- **pr-create-denied**: `deny`, non-zero and unparseable authorize; no `pr-create`.
- **already-open anchored**: existing PR at an anchored HEAD records no anchor, commit or push.
- **already-open ahead**: HEAD ahead of the PR head records anchor, commit and push and no `pr-create`.
- **already-open-ungranted**: governed existing PR with an absent grant → needs-human, no push.
- **other refusals**: `open-pr-other-base`, `gh-unavailable`, `pr-create-refused`, `no-op`, `wrong-branch` (including a branch beginning with `-`).
- **usage errors**: each missing required flag and an invalid `--issue`.
- **best-effort warnings**: evidence write, bundle, effects declare and observe, Commissaire observe and an `evidence-schema warn-only` line each add a warning and leave the token unchanged.
- **temp-file cleanup**: the safe-body file is deleted on every path that created it.
- **inputs-equal**: the inputs passed to `authorize` equal those `faff merge authorize` derives for the same run dir and head.
- **holdout payload**: on a governed L4 run, an absent `holdout.json` sends `holdout: "missing"` and a `meets-spec` verdict older than `build-progress.json` sends `holdout: "blocked"`.
- **push-failure**: `git push` exits non-zero → `errored`, no bundle, no pr list follow-up, no `pr-create`.
- **tracker_transition descriptor**: present with the exact effect payload on `opened` and `already-open`, absent on every other token.

Plus a **CLI-level** test that spawns the real `bin/faff pr open` against a temporary repository with a local bare remote and a `gh` stub on `PATH`, and the re-targeted `validate-adapters` cases (real faff-graft passes; a Step 9b that calls `faff pr-create` or `gh pr create` directly fails; a missing Step 9b section fails).

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a feature worktree on branch b with a local bare remote as origin, a run dir whose genesis events chain, ac-checklist.json and review-verdict.json (signal pass) are valid, and a gh stub that answers `pr list` with [] and `pr create` with https://example.invalid/pr/7
When `faff pr open --run-dir D --issue TT-1 --base main --title T --body-file draft.md --json` runs
Then it exits 0 with token "opened" and pr_url "https://example.invalid/pr/7"
And origin's branch b head is a commit with subject "chore(TT-1): anchor run evidence" that adds .faff/anchors/<run-id>/TT-1/
And the gh call log shows `pr create` after origin's branch b already pointed at that commit
```

```
Given the same setup and a draft body that cites a sibling issue X-2 and the target TT-1
When `faff pr open` runs
Then the file passed to `gh pr create --body-file` contains no bare tracker-recognisable X-2 identifier
And it contains exactly one closing reference to TT-1
```

```
Given the first scenario has already run and the gh stub now answers `pr list` with that PR (base main, headRefOid equal to the worktree's HEAD)
When `faff pr open` runs again on the unchanged tree
Then it exits 0 with token "already-open", that PR's url, and a tracker_transition to "In Review"
And no new commit is created, origin's branch head is unchanged, and the gh call log has no second `pr create`
```

```
Given a worktree with a pre-commit hook that exits 1, origin, and a run dir with a pass review verdict and a valid chain
When `faff pr open` runs
Then it exits 2 with token "errored"
And origin's branch head is unchanged and the gh call log has no `pr create`
```

```
Given a repository with no remote
When `faff pr open --run-dir D --issue TT-1 --base main --title T --body-file draft.md --json` runs
Then it exits 0 with token "no-op" and creates no commit
```

## 5. DESIGN DECISION RATIONALE

- The order is the safety property, so it belongs in code with a test, not in prose with a text scan (D6).
- Keeping `pr-create` as an unchanged chokepoint preserves the producer/verifier split and the single PR-open path (D1).
- Deriving the governed inputs from one shared function means `pr open` and `merge authorize` cannot disagree about a run's level, attendance or holdout (D4).
- Everything that needs judgement or the tracker stays with the agent, so the command stays a pure sequencer that reads files and spawns commands (D9, D10).

## 6. OPEN QUESTIONS AND ASSUMPTIONS

- **Assumes:** the remote is `origin` (D7).
- **Assumes:** `faff events anchor` keeps its exit 3 for all three refusals and the `floor-incomplete —` stderr prefix (origin/main `events.js` l.1481 and l.1492), and `validateAnchorGenesis` stays exported (l.2455).
- **Punt:** whether Step 8b's build-complete push should also move into a command. Out of scope; file separately if wanted.

## 7. DONE

### From WHY
- [ ] `faff pr open` refuses with `refused` / `review-not-pass` unless `review-verdict.json` re-validates to `pass`.
- [ ] Graft Step 9b calls `faff pr open` and no longer contains its own `faff events anchor`, `git push`, `faff pr-body` or `faff pr-create` invocations.

### From WHAT
- [ ] `plugin/skills/faff/bin/lib/pr-open.ts` exists with its committed `.js` emit; `build-manifest.json` is regenerated and `node scripts/build-manifest.js check` passes.
- [ ] `pr-open.ts` is in the `tsconfig.json` include list and the `test/check-no-boundary-cast.test.mjs` pin list.
- [ ] `regions.js` maps `pr` to `factory` with `REGION_SELFTEST_ARGV.pr = null`, and `TEST_FILE_COVERAGE.pr` names `test/pr-open.test.mjs`; `faff regions check` and `lint-cli-coverage` pass.
- [ ] `merge-gate-pr-create.js`, `pr-body.js`, `events.js`, `bundle.js` and every `commissaire*` module are unchanged by the PR.
- [ ] `docs/guide/cli.md` has a `pr open` row.

### From HOW
- [ ] Every token and exit code in the 3. WHAT table is produced by at least one test.
- [ ] `validate-adapters` fails a faff-graft Step 9b that invokes `gh pr create`, `faff pr-create`, `faff pr-body`, `faff events anchor` or `git push` directly, or does not invoke `faff pr open`, and still fails a missing Step 9b section.
- [ ] `SKILL_LINE_BASELINE["faff-graft"]` is lowered to the new line count with a `FAFF-1416` comment entry, and `ANCHOR_PHRASES` for faff-graft still resolve (`validate-adapters` reports no RATCHET and no FAIL).

### Rule inventory
- [ ] Every line the PR deletes from `faff-graft/SKILL.md` maps to a row P1–P44 below; the PR description lists the deleted line ranges against row ids.
- [ ] Every `kept` and `changed` row whose covering-test cell names a test has that named case in `test/pr-open.test.mjs` (or the named CLI-level / validate-adapters test), and it passes. Rows marked `agent-side` (prose, no executable unit) or `unchanged: <command>` (behaviour owned by an unchanged command and its existing tests) are exempt, and every row is one of these three kinds.

### Tests
- [ ] `test/pr-open.test.mjs` passes under `node --test`, including the order and commit-failure cases in 4.6.
- [ ] The full gate ladder (`faff gates run`) passes.

## Rule inventory

Disposition key: `kept` = the command or the remaining prose does what the old prose says; `changed` = differs, with the reason; `dropped` = not carried, with the reason. "Agent" means it stays in Step 9b's prose.

| # | Prose rule (graft Step 9b) | Where it lives now | Covering test | Disposition |
|---|---|---|---|---|
| P1 | Reached only when Step 9 returned `pass` | step 4, plus the entry sentence | review-not-pass | changed: now enforced in code |
| P2 | Single PR-creation point, identical in both modes | one command, both modes | happy path | kept |
| P3 | Git-only: no-op, no body, no temp files, no pr-body, no gh | agent skips; step 2 no-ops | no-op | kept |
| P4 | Locate newest `## Spec-review evidence` comment, else committed spec | agent | agent-side | kept |
| P5 | Pipe it to `faff evidence write spec-review-verdict`; non-zero logged, never blocks | step 6 | best-effort warnings | kept |
| P6 | Required floor stays ac-checklist + review-verdict | `events anchor` floor-incomplete, unchanged | anchor codes | kept |
| P7 | Compose the complete body incl. the Step 8 AC checklist into a draft | agent | agent-side | kept |
| P8 | `pr-body sanitize --target` | step 7 | CLI-level | kept |
| P9 | `pr-body check` re-verifies the exact bytes that ship | step 7 | body-unsafe | kept |
| P10 | Non-zero from either stops before PR creation; never fall back to the draft | step 7 refuses before anchor | body-unsafe | kept (earlier stop) |
| P11 | Mint the anchor with `faff events anchor --dest .faff/anchors/<run-id>/<ISSUE>/` | step 10 | happy path | kept |
| P12 | `git add` + commit the anchor | step 11 | happy path | kept |
| P13 | Tolerate only "nothing to commit" | step 11 staged check | nothing-staged | kept |
| P14 | Any other add/commit failure aborts before `gh pr create`; never a broad error-swallow | step 11 | commit-failure | kept (now tested code) |
| P15 | Push the branch head before the PR; fires no CI | step 12 | order guarantee | kept |
| P16 | With build-complete push off, this push carries the build commits | step 12 (`origin refs/heads/<branch>`) | happy path | kept |
| P17 | Bundle publish after anchor, before PR, `issue-merge-floor` / ISSUE | step 13 | happy path | kept |
| P18 | `store_unavailable` never fails the build | step 13 warning | best-effort warnings | kept |
| P19 | Title always explicit, from the `pr_title` convention | agent; `--title` required | usage errors | kept |
| P20 | `faff pr-create` is the sole `gh pr create` path; regular non-draft PR | step 16 | happy path | kept |
| P21 | Ungoverned: grant not-applicable, opens identically; governed fails closed without a grant | `pr-create` unchanged | pr-create-refused | kept |
| P22 | Create-only in both push configs | step 16 after step 12 | order guarantee | kept |
| P23 | CI fires first at PR open | consequence of P15/P22 | order guarantee | kept |
| P24 | Delete both temp files after the create attempt | step 18 (safe body); agent (draft) | temp-file cleanup | changed: the command owns the safe file |
| P25 | Quoted paths / argument arrays; never interpolate body bytes | all spawns use arrays, no shell | CLI-level | kept |
| P26 | Governed anchor-head push: declare before, observe after success | step 12 | governed | kept |
| P27 | Bracket is record-only; failures logged, push proceeds; skipped ungoverned | step 12 warnings | best-effort warnings | kept |
| P28 | Governed pr-create declare + authorize before `pr-create`, base matches | step 15 | governed | kept |
| P29 | Authorize inputs: ledger level, attended from verification, holdout aggregate | step 15 via merge authorize's derivation | inputs-equal | changed: one shared derivation (D4) |
| P30 | `deny` parks, PR not opened | step 15 → needs-human | pr-create-denied | kept; also non-zero/unparseable now fail closed |
| P31 | Observe after `pr-create` opens | step 17 | governed | kept |
| P32 | `pr-create` suppresses its schema:2 trail on a covered create | `pr-create` unchanged | unchanged: `pr-create` | kept |
| P33 | Anchor before PR: crash windows reasoning | step order | order guarantee | kept |
| P34 | Anchor contents and governance-check legs | `events anchor` unchanged | unchanged: `events anchor` | kept |
| P35 | A run dir without an anchor is flagged by the Action | unchanged | unchanged: `governance-check` | kept |
| P36 | Runs identically interactive and autonomous | one command | happy path | kept |
| P37 | `no-events` / `genesis-invalid` → abort before PR, park naming genesis and run dir | step 10 → needs-human; agent parks | anchor codes | kept |
| P38 | `events.jsonl` left byte-for-byte | `events anchor` unchanged | unchanged: `events anchor` | kept |
| P39 | `floor-incomplete` same route, build-evidence cause | step 10 cause text | anchor codes | kept |
| P40 | `evidence-schema warn-only` is not a refusal | step 10 warning | best-effort warnings | kept |
| P41 | Bundle store details; git-only run-close boundary lives in beep-boop | bundle CLI unchanged; pointer dropped | none (dropped) | dropped: explanation with no action in Step 9b |
| P42 | In Review transition procedure (live re-read, no-op cases, forward write, never fails the build) | agent, driven by `tracker_transition` | agent-side | kept |
| P43 | Anti-patterns: no `faff status set`; missing In Review state is not fatal | agent | agent-side | kept |
| P44 | Governed In Review tracker-write bracket | agent, payload from `tracker_transition.effect` | tracker_transition descriptor | kept |

The governed-run check's own rule (graft line 122: non-zero, 30-second timeout or unparseable → `commissaire-status-failed` needs-human) is applied by step 5 and covered by its three tests; the rule's text stays at line 122 for graft's other governed steps.

## Methodology critique

- **Right-sized?** Yes. One command composing existing calls, one prose step rewritten, one lint re-targeted; about the size of `faff graft admit`.
- **Workstream fit?** The skill-prose-to-code track (2026-10-22 review §1.4, collapse 7).
- **Deps surfaced?**
  - FAFF-1415 (`faff worktree ensure`, Step 3) also edits `faff-graft/SKILL.md`, `SKILL_LINE_BASELINE`, `regions.js`, `lint-cli-coverage.js`, `tsconfig.json`, the boundary-cast pin list and `build-manifest.json`. No functional dependency either way; whichever builds second rebases with the usual union resolution.
  - FAFF-1442 (byte ratchet), if it lands first, adds a byte baseline this PR must also lower.
  - FAFF-1441 (GitHub-button merges through merge-gate) touches merging, not opening. `pr open` returns `pr_number` and `head_sha`, which 1441 may consume; no conflict.
- **Risk profile?** Low novelty: every step exists as a CLI call today. The main risk is changing the order; the order test pins it.

confidence: high
spec-review: accept (human)
build-tier: complex
