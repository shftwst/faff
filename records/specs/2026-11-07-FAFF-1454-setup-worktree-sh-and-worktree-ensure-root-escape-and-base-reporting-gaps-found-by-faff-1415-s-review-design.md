*Agent-written (Claude Code), at the operator's request: FAFF-1454 spec, amended on 2026-11-07 with the operator's approval to add the §4.1 prose-growth bullet.*

# FAFF-1454: close setup-worktree.sh's root-escape and base gaps, and tidy worktree ensure's recreate checks and base reporting

> Spec: faffter-dark-nlspec · 2026-11-07 · interactive · claude-code/unknown · faff 0.44.0 · confidence: high. Full spec on Linear FAFF-1454.

This spec is for the build agent and its reviewers. It fixes the six gaps FAFF-1415's holdout and independent review found in the bundled `setup-worktree.sh` and in `faff worktree ensure`.

> **Spec-review state (2026-11-04).** Two adversarial rounds (architectural, infosec, QA). Round 1: `reject-approach` on one major and one minor, the same defect from two lenses (the checks named the unflattened branch, while the script creates and pushes the flattened one); fixed in §3.1, §3.2 and §4.1. Round 2: architectural clear, two minors (which ref matched; a test for the no-binary branch), both fixed in this text. `faff spec-review round` returned `park` on its churn rule (QA objected for the first time in round 2, with a minor). Following the operator's minors-only rule, no third round ran; recommended for accept.

## 1. WHY

**The load-bearing idea:** every path that creates a worktree must refuse the same unsafe cases, and the result must report what actually happened. Today the recreate path refuses a symlink and an existing entry, but the fresh path does not, and the fresh result reports a base it re-derives rather than the one used.

- **Root escape (fresh).** A symlink at `<root>/<branch-slug>` pointing outside the root lets `setup-worktree.sh`'s `git worktree add` register a worktree outside it. `worktree ensure`'s step-6 root assert then parks the issue `root-outside` on every drain until someone cleans up by hand.
- **Divergent base (fresh).** With `origin/<branch>` present, the script still branches the new local branch from the default base, so a later push diverges from the remote branch.
- **Silent root fallback.** `WT_ROOT=$(… faff worktree-root …) || true` swallows a resolver failure and falls back to `$HOME/.faff/worktrees/<repo>`. During the FAFF-1415 build a test fixture wrote into the real `~/.faff/worktrees` this way.
- **A check that cannot fire.** In `recreate`, the slug flattens `/` to `-`, so `dirname(wtPath)` is always the root and the `realCandidate` check always passes. The `lstat` symlink refusal is what blocks the escape; the comment says otherwise.
- **An untested refusal.** Removing `recreate`'s "path already exists" refusal breaks no test.
- **Inexact `base_ref`.** On a fresh create, git-only mode reports the local default branch while the script branched from the root checkout's `HEAD`; with an origin, `freshBase` fetches again after provisioning, so the reported base can differ from the commit used.

### Reference context

- `plugin/skills/faff-graft/setup-worktree.sh` (181 lines): root resolution (around lines 40–55), base resolution (lines 66–100), `git worktree add -b` (line 103).
- `plugin/skills/faff/bin/lib/worktree-ensure.ts`: `recreate` (lines 379–417), `freshBase` (lines 440–449), `freshCreate` (lines 451–471), `blocked` (line 226), `Deps.lstat`, `Deps.gitNet`; `lightsOut.isStrictlyUnderRoot`.
- `plugin/skills/faff-graft/remote-diff-base.sh`: the shared base resolver.
- `test/worktree-ensure.test.mjs` (53 tests), `test/faff-1077-dependency-stacking.test.mjs` (drives the script with `FAFF_WORKTREE_BASE_REF`).
- `faff-graft/SKILL.md` lines 128–146 (Step 3: `worktree ensure`, routing on `disposition`); `docs/guide/cli.md` line 150.

### Already shipped against this surface

- FAFF-1415 (`faff worktree ensure`, #1176): the command and its recreate refusals. FAFF-708: the remote-backed base. FAFF-1077: `FAFF_WORKTREE_BASE_REF`. FAFF-382: `faff worktree-root` as the one resolver.

## 2. OUT OF SCOPE

- The `WorktreeCreate` hook input mode of the script, beyond the root-lookup change (both modes share it).
- A link planted between the refusal and `git worktree add` (a TOCTOU race). The build claim keeps one runner per issue, and the step-6 root assert still refuses an escaped worktree, as the recreate comment already says.
- Resuming from an `origin/<branch>` on a fresh create. A fresh create refuses instead (§3.2).

## 3. WHAT

### 3.1 Root escape on a fresh create

- Both checks below use the **flattened name**: the branch with every `/` replaced by `-`, which is the local branch the bundled script creates (`SAFE_NAME`, `git worktree add -b`) and the path's last segment, exactly as `recreate` builds `wtPath`. Under the `slash-scoped` naming scheme, `feature/faff-9-x` becomes `feature-faff-9-x`.
- `worktree ensure`'s `freshCreate` refuses, before running any provisioning script, when the path `<root>/<flattened name>` is a symlink (dangling or not) or already exists. The result is `blocked` with cause `setup-refused` and detail `{ reason: "path is a symlink" | "path already exists", path }`. `blocked` already maps to `parked` (autonomous) or `hand-over` (interactive).
- The bundled script makes the same two refusals itself before `git worktree add`, writing a `FATAL:` line to its log and exiting 1, so a direct or hook invocation is covered too.
- **Chosen:** refuse in both places, by the flattened name. Rationale: the flattened name is what is created and pushed; the TypeScript check covers a project-specific `scripts/setup-worktree.sh` the repo may supply instead; the script check covers callers other than `worktree ensure`.

### 3.2 An existing `origin/<branch>`

- With an `origin` remote, `freshCreate` checks `git ls-remote --exit-code --heads origin <flattened name>` (through `gitNet`) before running the script. When the flattened name differs from the branch name, it checks each with its own call, and refuses if either exists; `detail.branch` names the ref that matched (both, as a list, if both did).
  - Exit 0 (the branch exists on origin): `blocked`, cause `setup-refused`, detail `{ reason: "remote branch exists", branch }`.
  - Exit 2 (no such branch): continue.
  - Any other exit: `blocked`, cause `setup-refused`, detail `{ reason: "remote branch check failed", exit }`. Fail closed: an unreachable origin must not let a fresh branch shadow a pushed one.
- The bundled script makes the same check after its fetch, and refuses with a `FATAL:` log line and exit 1.
- **Chosen:** refuse, not base on `origin/<branch>`. Rationale: a fresh create is reached on `checkpoint-mismatch`, `store-mismatch` or no checkpoint at all, so the remote branch's content is unverified. Basing on it would build on work the resume checks did not vouch for. The refusal names the branch so a human can delete it or resume deliberately.
- **Chosen:** a pinned `FAFF_WORKTREE_BASE_REF` (FAFF-1077 stacking) does not bypass this check. Rationale: the pin chooses the base, not whether a same-named remote branch may be shadowed.

### 3.3 Root lookup

- In `setup-worktree.sh`, when `faff worktree-root` exits non-zero or prints nothing, the script writes `setup-worktree: faff worktree-root failed (exit <n>); refusing to fall back to $HOME` to stderr and exits 1, before any `mkdir`.
- When no `faff` binary resolves at all, the script exits 1 with `setup-worktree: no faff binary resolvable; cannot resolve the worktree root`.
- **Chosen:** no `$HOME` fallback in either case. Rationale: FAFF-382 makes `worktree-root` the single resolver; a script that guesses the root on failure is the drift FAFF-382 removed, and the guess already wrote outside a test sandbox once.

### 3.4 `recreate`'s checks

- Delete the `realCandidate` check (lines 400–403). Rewrite the comment above `lstat` to say that the strictly-under-root assert on the path plus the symlink refusal are what keep the worktree inside the root, because the slug flattens `/` and the path's parent is always the root.
- Add a test: an empty directory at the recreate path yields `resume-recreate-failed` with reason `path already exists`, and no `git worktree add` runs.

### 3.5 `base_ref` and `base_sha` on a fresh result

- A fresh result gains `base_sha`: the new worktree's `HEAD` commit, read with `git -C <wt> rev-parse HEAD` immediately after the script returns. A fresh branch has no commits of its own, so this is the commit it was created from, for any provisioning script.
- `base_ref` on a fresh result:
  - pinned `FAFF_WORKTREE_BASE_REF`: that value (unchanged);
  - bundled script with an origin: the `origin/<default>` name that `remote-diff-base.sh` resolved, obtained *before* the script runs, so `freshBase` makes no second fetch afterwards;
  - bundled script, git-only: the root checkout's branch (`git symbolic-ref --short HEAD`), or `HEAD` when detached, which is what the script branches from;
  - project script: `null`, with a warning `base_ref unknown for a project setup script; see base_sha`.
- **Chosen:** report the exact commit as a new field instead of making the name exact. Rationale: the name can only be a best guess for a project script, while the worktree's own `HEAD` is exact for every script and costs one local git call.

## 4. HOW

### 4.1 Edge cases

- **Dangling symlink.** Refused (`lstat`, not `stat`), in both §3.1 checks.
- **Branch names with `/`.** The path and the created branch use the flattened name; the `ls-remote` check covers the flattened name and, when different, the unflattened one (§3.2). A test pins a `slash-scoped` branch: a symlink at the flattened path is refused, and a pushed flattened branch is refused.
- **`base_sha` read fails.** `base_sha` is `null` with a warning; the disposition is unchanged, since the field is informational.
- **Graft prose.** Step 3's routing table is unchanged (`setup-refused` arrives as `parked` or `hand-over`). Step 3 gains one sentence: on `setup-refused` with reason `remote branch exists`, the surfaced message names the branch. `docs/guide/cli.md` line 150 names `setup-refused` and `base_sha`.
- **Prose growth.** The Step 3 sentence grows graft. Run `faff validate-adapters` and `faff prose-size` on the branch; for `faff-graft` only, set `SKILL_LINE_BASELINE` to the measured line count if it rose, and `prose-baseline.json` to the measured byte count if it rose. Lower either with `faff prose-size baseline --lower` if it fell. Name both numbers in the PR description.

### 4.2 Tests (in `test/` only, `node --test`, no new `--selftest` cases)

Extend `test/worktree-ensure.test.mjs`:

- a symlink at the fresh path (to a directory outside the root, and dangling): `setup-refused`, reason `path is a symlink`, and the script is never run;
- an existing empty directory at the fresh path: `setup-refused`, reason `path already exists`;
- `ls-remote` exit 0: `setup-refused`, reason `remote branch exists`; exit 2: the script runs; exit 128: `setup-refused`, reason `remote branch check failed`; and with `FAFF_WORKTREE_BASE_REF` set, exit 0 still refuses;
- `recreate` with an empty directory at the path: `resume-recreate-failed`, reason `path already exists`, no `worktree add`;
- a fresh create returns `base_sha` equal to the worktree's `HEAD`; git-only `base_ref` is the root checkout's branch; a project script gives `base_ref: null` and the warning; with an origin, `remote-diff-base.sh` runs once.

Add `test/setup-worktree-script.test.mjs`, driving the bundled script against temp git repos with `FAFF_WORKTREE_ROOT` pointing at a temp dir:

- a symlink or an existing entry at the worktree path: exit 1, nothing registered (`git worktree list`);
- an existing `origin/<flattened name>` in a local bare origin: exit 1, no local branch created;
- a `faff` stub on `PATH` whose `worktree-root` exits 1: exit 1, and `$HOME` (pointed at a temp dir) gains no `.faff` directory;
- no `faff` on `PATH` and `CLAUDE_PLUGIN_ROOT` unset: exit 1, stderr has `setup-worktree: no faff binary resolvable`, and `$HOME` gains no `.faff` directory.

Register the new test file in `lint-cli-coverage.js`' `TEST_FILE_COVERAGE` if the lint asks for it.

## Scenarios

```
Given a git repo with a local bare origin, FAFF_WORKTREE_ROOT set to an empty temp dir, and a symlink at <root>/faff-9-x pointing to /tmp
When `faff worktree ensure --issue FAFF-9 --mode interactive --slug x --root <repo> --json` runs
Then it exits 0 with disposition "hand-over" and cause "setup-refused"
And detail.reason is "path is a symlink"
And `git worktree list` in the repo lists only the main checkout
```

```
Given the same repo, no symlink, and a branch faff-9-x pushed to the origin but absent locally
When the same `faff worktree ensure … --json` runs
Then it exits 0 with disposition "hand-over" and cause "setup-refused"
And detail.reason is "remote branch exists" and detail.branch is "faff-9-x"
And the repo has no local branch faff-9-x
```

```
Given a git repo with no origin, FAFF_WORKTREE_ROOT set to an empty temp dir, and the main checkout on branch main
When `faff worktree ensure --issue FAFF-9 --mode interactive --slug x --root <repo> --json` runs
Then it exits 0 with disposition "ready" and mode "fresh"
And base_ref is "main"
And base_sha equals `git -C <wt> rev-parse HEAD` and equals `git rev-parse main` in the repo
```

```
Given PATH holds a faff stub whose worktree-root subcommand exits 1, and HOME is an empty temp dir
When `bash plugin/skills/faff-graft/setup-worktree.sh faff-9-x <repo>` runs
Then it exits 1
And stderr has a line starting "setup-worktree: faff worktree-root failed"
And HOME has no .faff directory
```

## 5. DESIGN DECISION RATIONALE

- Refusing in TypeScript before any script runs gives every provisioning script the same floor; the script's own checks keep its direct use safe.
- Fail-closed on an unreachable origin matches FAFF-708's posture: the provisioner never branches on a guess.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

- **Assumes:** no caller relies on the script's `$HOME` fallback when `faff` is not on `PATH`. `worktree ensure` always resolves `faff`, and graft no longer triggers the `WorktreeCreate` hook.
- **Assumes:** `ls-remote --exit-code` returns 2 for a missing ref on every supported git (documented behaviour since git 1.x).

## 7. DONE

### From WHAT
- [ ] A fresh create refuses a symlink or an existing entry at the worktree path, in `worktree ensure` before any script runs and in the bundled script, and never registers a worktree outside the root.
- [ ] A fresh create refuses when `origin/<branch>` exists, or when the check fails, with cause `setup-refused` and the reason in `detail`.
- [ ] `setup-worktree.sh` exits 1 with a named error when the root lookup fails or no `faff` resolves, and never creates `$HOME/.faff`.
- [ ] `recreate` has no `realCandidate` check, its comment names the checks that keep the worktree inside the root, and its "path already exists" refusal has a test.
- [ ] A fresh result carries `base_sha` equal to the worktree's `HEAD`, and `base_ref` follows §3.5.
- [ ] `docs/guide/cli.md` names `setup-refused` and `base_sha`; graft Step 3 names the branch on a `remote branch exists` refusal.

### Tests
- [ ] `test/worktree-ensure.test.mjs`, `test/setup-worktree-script.test.mjs` and `test/faff-1077-dependency-stacking.test.mjs` pass under `node --test`.
- [ ] `npm run build` leaves the committed `worktree-ensure.js` and `build-manifest.json` matching the `.ts`.

confidence: high
build-tier: complex
admissibility: admissible
spec-review: accept (human, after round 2)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```

## Methodology critique

- **Right-sized?** No issues. Six small, related fixes in one script and one command, about a day with tests.
- **Workstream fit?** No issues. Follow-up to FAFF-1415 on the prose-to-command lane.
- **Deps surfaced?** None blocking. FAFF-1077's stacking test drives the same script; §3.2 keeps its pinned-base path working when no same-named remote branch exists.
- **Risk profile?** Low to medium. Two new refusals can park issues that used to proceed (a pushed branch with no local worktree); each names its reason, and the previous behaviour diverged silently.
