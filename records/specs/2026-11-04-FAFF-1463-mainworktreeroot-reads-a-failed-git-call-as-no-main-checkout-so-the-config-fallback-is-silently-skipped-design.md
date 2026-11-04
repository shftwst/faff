# FAFF-1463: a failed main-checkout git probe stops the config lookup instead of silently skipping the fallback

> Spec: faffter-dark-nlspec · 2026-11-04 · interactive · claude-code/unknown · faff 0.44.0 · confidence: high. Full spec on Linear FAFF-1463.

## 1. WHY — Problem and Principles

`mainWorktreeRoot(root)` in `plugin/skills/faff/bin/lib/shared-infra.js` runs `git -C <root> rev-parse --git-common-dir` and returns `null` on any non-zero exit. `null` also means "there is no main checkout to fall back to" (not a repo, a bare repo, an odd layout). The two cases cannot be told apart.

The config and overlay lookups (`findLocationWithMainFallback`, behind `findConfigLocation` and `findOverlayLocation`) use it for the FAFF-208 main-checkout fallback. When that git call fails, the lookup quietly resolves to "no file":

- **Linked worktree, config only in the main checkout:** a config-reading command runs on defaults, with nothing on stderr. This is the silent gate-degradation FAFF-198 and FAFF-208 exist to prevent (the adversarial-review host resolving to localhost).
- **Main checkout with a config but no overlay** (this repo's CI case): the overlay probe fails and the command carries on. The result happens to be right, because a main checkout's fallback finds nothing anyway, but a failed git command has been swallowed.

[FAFF-1428](https://linear.app/shftwst/issue/FAFF-1428)'s `faff rule-inventory check` must never exit 0 when a git command it runs fails (its holdout scenarios:21). Its own calls now all fail closed. The one call left is this shared probe, and the operator chose on 2026-11-04 to fix it here, in shared code, before FAFF-1428 lands, rather than amend the scenario.

Principles:

- **A git failure inside a repo is an error, never an absence.** Only a genuine "not a repo" or "no main checkout" may read as `null`.
- **Fail closed at the config seam.** A config lookup that cannot finish its fallback stops the command with exit 2, through the same dispatch arm that already turns a malformed or legacy-named config into exit 2.
- **Change no behaviour when git works.** The in-checkout file still wins with no git call, the fallback still fires only for a linked worktree, and every caller that gets a successful probe sees the same value as today.
- **Small and land-first.** This ticket only distinguishes the failure and surfaces it where a silent skip changes a result. Callers whose `null` already fails closed keep the old wrapper, and the spec says why for each.

## 2. OUT OF SCOPE

- Converting FAFF-1428's two `PENDING_OPERATOR` test entries to exit-2 assertions. That belongs to FAFF-1428, which rebases on this change (section 7).
- `resolveRunDir`'s use of `mainWorktreeRoot` (shared-infra.js, the FAFF-591 run-dir fallback). Some of its callers write, so whether a probe failure there is safe needs its own census. It keeps the wrapper unchanged; see the proposed ticket in section 7.
- How the blanket-catch callers treat errors **other than** `MainWorktreeProbeError`. They keep swallowing a malformed config exactly as today. Section 4.2a only makes them pass this one new error through.
- `gates-doctor.js`'s fragile-link classification. It is an advisory report, and teaching it an "unknown" class is a separate change.
- Any Commissaire verb, object or flag. The standalone `commissaire` binary shares `runGovernedDispatch`, so it picks up the new exit-2 arm exactly as it picked up the malformed-config arms. That is shared dispatch, not new Commissaire surface.
- Converting `shared-infra.js` to TypeScript (FAFF-1432's job). This is a small edit to a legacy JS module, so it stays JS.

## 3. WHAT — Vocabulary, Types and Interfaces

**Probe failure.** The `git -C <root> rev-parse --git-common-dir` call:

- exits non-zero;
- fails to spawn (`error` set, e.g. no `git` on PATH);
- is killed by a signal; or
- exits 0 with empty stdout.

**Enclosing git entry.** A `.git` file or directory at `root` or any ancestor of it, checked on **both** the path as given and its `fs.realpathSync` form, so a checkout reached through a symlink or bind path is still recognised. The walk tests for `.git` **only**. Unlike `findRoot`, it never stops at `.faff`: a `.faff`-only workspace with no git anywhere is "not a repo", and a failed probe there reads as `null`. Its presence is what says "this is a repo, so the probe should have worked".

**`MainWorktreeProbeError`** (new, exported from `shared-infra.js`):

- an `Error` whose `message` is the token `"git-probe-failed"`, following the existing `"base-parse-error"` / `"legacy-config-name"` token convention that `runGovernedDispatch` branches on;
- fields:
  - `root` — the resolved root it probed;
  - `detail` — git's first stderr line, or the spawn error's message, or `exited <code> with no output`. Control characters are stripped and it is capped at 200 characters.

**`probeMainWorktree(root)`** (new, exported). Returns `string | null`, or throws `MainWorktreeProbeError`:

| Probe outcome | Result |
|---|---|
| Success, common dir's basename is `.git` | The common dir's parent (the main checkout), exactly as `mainWorktreeRoot` returns today |
| Success, any other basename (bare repo, odd layout) | `null` |
| Probe failure, no enclosing git entry | `null` (not a repo) |
| Probe failure, an enclosing git entry exists | Throws `MainWorktreeProbeError` |

**`mainWorktreeRoot(root)`** keeps its contract: it calls `probeMainWorktree` and returns `null` when that throws `MainWorktreeProbeError`. Any other exception propagates as it would today.

**Dispatch arm.** `runGovernedDispatch` gains one arm, beside the existing `base-parse-error` arm. When `e.message === "git-probe-failed"`, it writes one stderr line and returns 2:

```
faff <label>: cannot proceed — git could not resolve the main checkout for <root>: <detail>
```

Every faff subcommand and the `commissaire` binary dispatch through it, so any command whose config lookup throws exits 2 with this line.

**`config get -d`** (existing, unchanged). `faff config get <key> -d <default>` (also `--default`) prints `<default>` when the key resolves to nothing. **Assumes:** this is the current parser in `config.js` (`cmdConfig`'s `get` branch reads `-d`/`--default`), checked on 2026-11-04; scenario 4 relies on it.

**`SharedInfraApi`** in `worktree-ensure.ts` gains `probeMainWorktree(root: string): string | null`.

## 4. HOW — Behaviour

**4.1 Config and overlay lookups.** `findLocationWithMainFallback(root, findIn)`:

1. `here = findIn(root)`. If found, return it. No git call is made, as today.
2. `mainRoot = probeMainWorktree(root)`. A `MainWorktreeProbeError` propagates.
3. If `mainRoot` is set and differs from `root`, return `findIn(mainRoot)`; otherwise return `null`, as today.

`findConfigLocation`, `findOverlayLocation`, `findConfig`, `findOverlay` and `loadConfig` change only in that the error can now propagate through them. Base and overlay fallbacks stay independent (FAFF-387): a worktree with its own config but no overlay still probes for the overlay, and that probe failing is an error.

**4.2 Per-caller disposition.**

| Caller | Disposition | Why |
|---|---|---|
| `findLocationWithMainFallback` (config + overlay) | **Adopts** `probeMainWorktree` | A silent skip changes which config every command runs on |
| `worktree-ensure.ts` `resolveRepoRoot` | **Adopts**, catching `MainWorktreeProbeError` and rethrowing it as `EnsureUsageError` with the same detail, so `worktree ensure` exits 2 through its existing usage arm | Today a failed probe returns `root0`, the linked worktree, as the repo root, and provisioning then proceeds against the wrong root. `--show-toplevel` has just succeeded, so the repo is real |
| `lights-out.js` `cmdWorktreeRoot` (`faff worktree-root`'s `--root` mapping) | **Adopts**; the error propagates to the dispatch arm (exit 2) | Today a failed probe leaves `root` as the worktree, so the default `<repo>` suffix and the `--assert` isolation check are computed against the wrong repo name |
| `admissibility.js` `holdoutRunDirContained` | Keeps `mainWorktreeRoot` | With `null`, only the checkout's own `.faff/runs` is searched, so a run dir in the main checkout is refused as not contained. That fails closed |
| `evidence.js` `guardWriterPaths` | Keeps `mainWorktreeRoot` | With `null`, only the checkout's own runs dir is accepted, and anything else is a `WriterFault`. That fails closed |
| `gates-doctor.js` `classifyGlobalLink` | Keeps `mainWorktreeRoot` | An advisory install-health report, not a gate; see section 2 |
| `shared-infra.js` `resolveRunDir` | Keeps `mainWorktreeRoot` | Out of scope pending a census of its writers (section 2) |

**4.2a Blanket-catch callers pass the new error through.** Some callers wrap the whole `loadConfig` call in a `try` whose `catch` falls back to defaults. Before this change, a failed overlay probe in a main checkout read as "no overlay", and those callers still got the **base** config. If they swallowed the new error, a broken git would cost them the base config too, and a gate would silently run on defaults. That is a fail-open this ticket would create. **Chosen:** every such `catch` rethrows `MainWorktreeProbeError` first (`if (e && e.message === "git-probe-failed") throw e;`), so the command exits 2 through the dispatch arm, and keeps its existing fallback for every other error.

- **Known sites** (2026-11-04 grep):
  - `gates-config.js:24`
  - `state.js:25`
  - `profile.js:327`
  - `bundle.js:864`
  - `fixtures.js:189`
- **Already safe:** `conventions.js:805` and `validate-adapters.js:644` rethrow any error they don't recognise.
- **The build re-censuses** every `loadConfig`, `findConfig`, `findOverlay`, `findConfigLocation` and `findOverlayLocation` call that sits inside a `try`, and treats any further swallower the same way. The PR lists every site with its disposition (rethrows, or already safe).

**4.3 Telling "not a repo" from "git failed".** `rev-parse` exits 128 both outside a repo and on a real fault, so the exit code can't decide it. **Chosen:** the filesystem decides. After a probe failure, walk from `root` up to the filesystem root looking for a `.git` entry (file or directory), and nothing else. A non-empty `GIT_DIR` in the environment also counts as an enclosing git entry, but only when it names an existing file or directory (resolved against `root` when relative): in that layout the repo has no on-disk `.git` entry to find, and the failure must still throw. A stray `GIT_DIR` naming nothing is not evidence of a repo and does not count. The walk runs over both the given path's ancestors and the realpath's ancestors; a `.git` entry on either chain counts. Any filesystem error during the walk (an unreadable ancestor, a `realpath` failure, a failed `GIT_DIR` stat other than not-found) counts as "an entry exists", so the walk can only fail toward throwing, never toward `null`. None → `null`. One → throw. This uses no second git call, so it can't itself fail the same way. It deliberately does not reuse `findRoot`, which also stops at `.faff`.

**4.4 Failure modes.**

- **`safe.directory` / dubious ownership.** git refuses every command, and the error is git's own message. A main checkout with no overlay used to carry on silently. It now exits 2 with git's message in `detail`, so the operator sees the fix. Almost every faff command needs git anyway, so this surfaces a broken environment earlier rather than creating one.
- **No `git` on PATH inside a repo.** The spawn error lands in `detail` and the command exits 2. Outside a repo, `null` as today.
- **A command that catches config errors locally** passes this error through (section 4.2a) and keeps its fallback for every other error, so it too reaches `runGovernedDispatch` and exits 2. FAFF-1428's command is not one of the swallowers.

**4.5 Tests** go in a new `test/main-worktree-probe.test.mjs` under `node --test`. Fixtures are temporary repos, with linked worktrees made by `git worktree add`. Probe failures are injected with a `git` wrapper placed first on `PATH`:

- it appends its full argument list, one line per call, to a log file named by an environment variable;
- it exits 128 with a fixed stderr line when its arguments include `--git-common-dir`;
- otherwise it runs the real `git`.

The "no git call made" checks read that log. The walk takes an optional filesystem dependency (the `existsSync`/`lstatSync`/`realpathSync` it calls), so a unit case can make one of them throw a non-`ENOENT` error and assert that `probeMainWorktree` throws `MainWorktreeProbeError`; this does not rely on file permissions, which a root test runner ignores. A unit case calls `runGovernedDispatch` with an arbitrary label and a handler that throws `MainWorktreeProbeError`, and asserts exit 2 and the line; that is the arm the `commissaire` binary shares. `shared-infra.js` has no `--selftest` block. `lights-out.js` has one (`worktreeRootSelftest`): any of its cases that exercises the `--root` mapping moves to `test/` per AGENTS.md, and the build lists which moved, or states that none did. The existing `test/config-under-faff-dir.test.mjs` and `test/resolve-run-dir.test.mjs` must still pass unchanged.

## 5. SCENARIOS

> 3 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a git repo whose main checkout holds .faff/config.yaml with tracking.spec_docs_path: design/specs/
And a linked worktree made by git worktree add, with no .faff/config.yaml of its own
And a git wrapper first on PATH that exits 128 with "fatal: injected" when its arguments include --git-common-dir
When faff config get tracking.spec_docs_path runs in the linked worktree
Then it exits 2
And stderr has one line starting "faff config: cannot proceed — git could not resolve the main checkout for" and containing "fatal: injected"
And stdout is empty
```

```
Given the same repo and linked worktree with a healthy git on PATH
When faff config get tracking.spec_docs_path runs in the linked worktree
Then it exits 0
And it prints design/specs/
```

```
Given a linked worktree that has its own .faff/config.yaml and its own overlay file setting tracking.spec_docs_path: overlay/specs/
And the git wrapper that fails --git-common-dir first on PATH
When faff config get tracking.spec_docs_path runs in the linked worktree
Then it exits 0
And it prints overlay/specs/
And the wrapper's log has no --git-common-dir call
```

```
Given a git repo whose main checkout holds .faff/config.yaml setting gates.fallback to a non-default value, and no overlay file
And the git wrapper that fails --git-common-dir first on PATH
When gates-config.js's knob reader (its blanket-catch `loadConfig` call) runs with the main checkout as root
Then it throws MainWorktreeProbeError rather than returning the default knobs
And a command reaching it through runGovernedDispatch exits 2 with the dispatch arm's line
```

```
Given a git repo whose main checkout holds .faff/config.yaml and no overlay file
And a symlink outside the repo that points at the main checkout
And the git wrapper that fails --git-common-dir first on PATH
When faff config get tracking.spec_docs_path runs with the symlinked path as its working directory
Then it exits 2
```

```
Given a git repo with a subdirectory pkg/ that holds its own .faff/config.yaml and no overlay, and no .git entry of its own
And the git wrapper that fails --git-common-dir first on PATH
When faff config get tracking.spec_docs_path runs in pkg/
Then it exits 2, because the repo's .git sits above the .faff entry the walk passes first
```

```
Given a git repo whose .git directory is moved to a path outside the work tree and exported as GIT_DIR, with GIT_WORK_TREE set to the work tree
And no .git entry at the work tree or any of its ancestors
And .faff/config.yaml in the work tree with no overlay file
And the git wrapper that fails --git-common-dir first on PATH
When faff config get tracking.spec_docs_path runs in the work tree
Then it exits 2
```

```
Given a directory under the system temp dir with no .git entry at it or any ancestor, and no .faff directory
And GIT_DIR exported as a path that does not exist
And the git wrapper that fails --git-common-dir first on PATH
When faff config get tracking.spec_docs_path -d fallback/ runs there
Then it exits 3
And it prints fallback/
```

```
Given a git repo whose main checkout holds .faff/config.yaml setting tracking.spec_docs_path: design/specs/ and no overlay file
And a healthy git on PATH
When faff config get tracking.spec_docs_path runs in the main checkout
Then it exits 0
And it prints design/specs/
```

```
Given a directory under the system temp dir with no .git entry at it or any ancestor
And a .faff/config.yaml in it setting tracking.spec_docs_path: ws/specs/
And the git wrapper that fails --git-common-dir first on PATH
When faff config get tracking.spec_docs_path runs there
Then it exits 0
And it prints ws/specs/
```

```
Given a linked worktree of a repo whose main checkout holds .faff/config.yaml
And the git wrapper that fails --git-common-dir first on PATH
When faff worktree-root --json runs in that linked worktree
Then it exits 2
And stderr starts with "faff worktree-root: cannot proceed — git could not resolve the main checkout for"
```

```
Given a linked worktree that has its own .faff/config.yaml but no overlay
And the main checkout holds the overlay file setting tracking.spec_docs_path: design/specs/
And the git wrapper that fails --git-common-dir first on PATH
When faff config get tracking.spec_docs_path runs in the linked worktree
Then it exits 2
```

```
Given a linked worktree that has its own .faff/config.yaml setting tracking.spec_docs_path: own/specs/
And the git wrapper that fails --git-common-dir first on PATH
And the worktree also has its own overlay file, which does not set tracking.spec_docs_path
When faff config get tracking.spec_docs_path runs in the linked worktree
Then it exits 0
And it prints own/specs/
And the wrapper, which logs its arguments, recorded no --git-common-dir call
```

## 6. DESIGN DECISION RATIONALE

- **Throw a typed token error, don't return a marker.** **Chosen:** `MainWorktreeProbeError` with the `"git-probe-failed"` message token. The config path already signals fatal config states by throwing token errors that `runGovernedDispatch` maps to exit 2, so one more arm reaches every command with no per-command change. A marker return would have to be checked at every one of the 40-odd `loadConfig` call sites.
- **Keep `mainWorktreeRoot` as a null-on-failure wrapper.** **Chosen:** add `probeMainWorktree` beside it, and move only the callers where a silent skip changes a result. Changing the shared function's contract in place would alter seven callers at once, including the run-dir writers this ticket has not audited.
- **Decide "in a repo" by a `.git` walk.** **Chosen:** section 4.3. A second git call could fail the same way, and the exit code carries no distinction.
- **Main checkout fails closed too.** **Chosen:** the overlay probe failing in a main checkout exits 2, even though the fallback would have found nothing. Skipping the probe for a main checkout would need a filesystem guess at the layout (is `.git` a directory?), which `GIT_DIR` and separate-git-dir layouts can defeat, and FAFF-1428's spec forbids the exit 0 outright.
- **`worktree ensure` and `worktree-root` adopt it; the other callers don't.** **Chosen:** section 4.2, decided per caller by whether a `null` result fails closed today.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

- **Assumes:** none of the PreToolUse or Stop hook commands (`runcheck`, `prepcheck`, `turncheck`, `inflightcheck`, `sentrycheck`, `resumecheck`, `merge-fence`, `background-fence`) loads config directly. Checked on 2026-11-04 by grepping each module for `loadConfig`, `findConfig` and `findOverlay`. A hook that loaded config indirectly would exit 2 on a git failure, which for a fence is a block, which is fail-closed.
- **Assumes:** the existing `test/config-under-faff-dir.test.mjs` (which calls `findConfigLocation` on temp dirs) and `test/resolve-run-dir.test.mjs` run where git works, so they don't hit the new throw.
- **Follow-on for FAFF-1428** (not this ticket's work). FAFF-1428's branch `FAFF-1428-rule-inventory-check` (head 6ccf0a01) rebases on this change, then:
  - turns its two `PENDING_OPERATOR` entries into ordinary exit-2 assertions;
  - re-checks whether its own `verifyConfigLocation` guard is still needed, now that the shared lookup throws. Removing it would be FAFF-1428's call, under its own review.
- **Proposed ticket:** `resolveRunDir` keeps reading a failed probe as "no main checkout". Census its callers (`events`, `effects`, `effects-reconcile`, `decision-capture`, `bundle`, `sentry-poller`, `runcheck`) for any that write to the returned dir, and move the writers to `probeMainWorktree`.

## 8. DONE — Definition of Done

### From WHY
- [ ] Inside a repo, a failed `rev-parse --git-common-dir` during the config or overlay fallback makes the command exit 2 with the dispatch arm's stderr line, never a silent default.

### From WHAT (interfaces)
- [ ] `shared-infra.js` exports `MainWorktreeProbeError` (message `"git-probe-failed"`, fields `root` and `detail`, `detail` stripped of control characters and capped at 200 characters) and `probeMainWorktree`, following the outcome table in section 3.
- [ ] `mainWorktreeRoot` returns exactly what it returned before for every probe outcome, including `null` on a probe failure.
- [ ] `runGovernedDispatch` maps `"git-probe-failed"` to exit 2 with the stderr line in section 3.
- [ ] `worktree-ensure.ts`'s `SharedInfraApi` declares `probeMainWorktree`. The committed `.js` emit and `build-manifest.json` are rebuilt with `npm run build`.

### From HOW (behaviour)
- [ ] The in-checkout config or overlay still wins with no git call made.
- [ ] A healthy linked worktree still falls back to the main checkout's config and overlay, each resolved independently.
- [ ] A probe failure with no enclosing `.git` entry reads as `null`; with one, it throws.
- [ ] Every blanket-catch caller in section 4.2a rethrows `MainWorktreeProbeError` and keeps its fallback for every other error. The PR lists each site found by the re-census with its disposition.
- [ ] A non-empty `GIT_DIR` that names an existing path counts as an enclosing git entry, and one naming nothing does not; the walk checks both the given path and its realpath; a filesystem error during the walk counts as an entry existing.
- [ ] The `.git` walk tests `.git` only; a `.faff`-only workspace with a failing probe reads as `null`.
- [ ] `worktree ensure` exits 2 with a `faff worktree ensure:` line naming git's detail when its probe fails, and creates no worktree.
- [ ] `faff worktree-root` exits 2 through the dispatch arm when its root-mapping probe fails.
- [ ] `admissibility`, `evidence`, `gates-doctor` and `resolveRunDir` still call `mainWorktreeRoot`, unchanged.

### From HOW (tests)
- [ ] `test/main-worktree-probe.test.mjs` covers every scenario in section 5, every row of section 3's outcome table, each probe-failure shape (non-zero exit, spawn error, signal kill, empty stdout) with its `detail`, the injected walk-filesystem error, and the control-character strip and 200-character cap, using the PATH `git` wrapper, and passes under `node --test`. The existing `test/config-under-faff-dir.test.mjs` and `test/resolve-run-dir.test.mjs` pass unchanged.
- [ ] A mutation test shows the tests bite. Each of these mutants makes at least one case fail:
  - `probeMainWorktree` returns `null` on every failure;
  - the `.git` walk always reports "no repo";
  - the dispatch arm is removed;
  - `findLocationWithMainFallback` goes back to `mainWorktreeRoot`;
  - `cmdWorktreeRoot` goes back to `mainWorktreeRoot`;
  - the `.git` walk also stops at `.faff`;
  - `gates-config.js` swallows `MainWorktreeProbeError`;
  - `GIT_DIR` is ignored by the walk;
  - the walk checks only the given path, not its realpath;
  - a filesystem error during the walk counts as no entry;
  - any non-empty `GIT_DIR` counts, even one naming nothing.

### Integration smoke test

```
1. Make a repo with .faff/config.yaml in the main checkout; git worktree add ../wt.
2. In ../wt, run faff config get tracking.spec_docs_path → exit 0, the main checkout's value.
3. Put a git wrapper on PATH that fails --git-common-dir; run it again → exit 2, the
   "cannot proceed — git could not resolve the main checkout" line.
4. In the main checkout with the wrapper still on PATH and no overlay → exit 2.
```

## Methodology critique

*Lens: faffter-dark-methodology-agile-delivery, issue-critique.*

- **Right-sized?** No issues. One new function and error type, one dispatch arm, two adopting callers, a one-line rethrow at each blanket-catch site and one test file make a single small unit that has to ship together. A typed error that no dispatch arm maps would crash with a stack trace instead of exiting 2.
- **Workstream fit?** No issues. It is the prerequisite FAFF-1428 is blocked on, within the same skill-to-determinism guardrail work.
- **Deps surfaced?** No issues. It blocks FAFF-1428, and that link is set. Nothing blocks it.
- **Risk profile?** The one behaviour change is that a broken git environment inside a repo now stops config-reading commands with exit 2 instead of carrying on. Section 4.4 names it with its observable (git's own message in stderr) and its fix. No spike is needed.

confidence: high
build-tier: complex
admissibility: admissible
spec-review: accept (human, after round 4)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" },
    { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" }
  ] }
```
