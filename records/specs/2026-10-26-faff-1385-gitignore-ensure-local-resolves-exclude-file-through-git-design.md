# gitignore-ensure --local resolves the exclude file through git, so it works in a linked worktree

> Spec: faffter-dark-nlspec · 2026-10-24 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1385.

This is the design spec for FAFF-1385, written for the build agent and human reviewers. It fixes a path bug in `faff gitignore-ensure --local`: the command hand-builds the `.git/info/exclude` path from the project root, which is wrong inside a linked git worktree. The fix asks git where the exclude file lives instead of assuming a layout.

## 1. WHY — Problem and Principles

**Load-bearing model.** `.git` is only a directory in a main checkout. In a linked worktree (`git worktree add`) `.git` is a *file* holding a `gitdir:` pointer, and the personal exclude file `info/exclude` is a shared, common-dir resource — not something that lives at `<worktree>/.git/info/exclude`. So the one correct way to locate it is to ask git, not to join path segments onto the checkout root.

**Problem statement.** `faff gitignore-ensure --local` (FAFF-1062) targets `path.join(root, ".git", "info", "exclude")` — a hand-built path valid only in a main checkout. Run from a graft worktree, that path points at a `.git` *file*'s nonexistent child, so the writer either fails on `mkdirSync`/`writeFileSync` or silently creates a stray `.git/info/exclude` directory tree git never reads, and the `.faff/` patterns it means to exclude stay committable. This change resolves the exclude file via git so `--local` works identically from a worktree and a main checkout.

**Design principles.**

- **Ask git for git's paths.** Any per-checkout git resource is located through a git plumbing command, never by assuming the on-disk `.git` layout. This is the principle the existing `mainWorktreeRoot` helper (`git rev-parse --git-common-dir`) already embodies for run-dir resolution; this change extends the same discipline to the exclude file.
- **No git repo, no write.** `--local` writes only into git's own exclude file. With no repository to own that file, the command reports the fact and writes nothing — it never fabricates a `.git/info/exclude` outside a repo (the current silent-stray-write failure).
- **Standard mode is untouched.** Only `--local` exclude-path resolution changes. The default (no `--local`) path — root `.gitignore` plus `.faff/.gitignore` — and all its hazard-detection behaviour are byte-for-byte unchanged.

## 2. OUT OF SCOPE

- FAFF-1297's hook-ignore step.
- Migrating stray `.git/info/exclude` trees already written by the old buggy path.
- Standard-mode (`.gitignore` / `.faff/.gitignore`) path resolution. Unchanged.

## 3. WHAT — Vocabulary, Types, and Interfaces

**New helper (home: `shared-infra.js`, exported, pure-ish — read-only git).**

```
FUNCTION resolveInfoExcludeFile(root) -> string | null:
  run: git -C <root> rev-parse --git-path info/exclude
  IF exit != 0: return null                      # not a git repo
  out := trimmed stdout
  IF out == "": return null                      # defensive; treat as no-repo
  return out is absolute ? out : path.resolve(root, out)   # --git-path is cwd-relative
```

**Changed function signature — none.** `gitignoreEnsure(root, local)` keeps its signature and return shape `{ path, created, added, already, faff_dir, warnings }`. Only the `local === true` branch changes how `path` is derived, plus one new terminal case for "no repo".

## 4. HOW — Behavior

```
PROCEDURE gitignoreEnsure(root, local):
  IF local:
    target := resolveInfoExcludeFile(root)
    IF target == null:
      return { path: null, no_repo: true, created: false, added: [], already: [], faff_dir: null, warnings: [] }
    result := ensureOneTarget(target, FAFF_GITIGNORE_PATTERNS_LOCAL)   # unchanged writer
    return { ...result, no_repo: false, faff_dir: null, warnings: [] }
  # standard mode below: unchanged
  ...
```

```
PROCEDURE cmdGitignoreEnsure(args):   # the command layer
  ...
  result := gitignoreEnsure(root, local)
  IF result.no_repo:
    print (or JSON): "not a git repository — no .git/info/exclude to update; wrote nothing"
    return 0                           # exit 0, wrote nothing (the AC)
  ... existing describeTarget / --json output ...
  return 0
```

## 5. SCENARIOS

```
Given a linked worktree created by `git worktree add`
When `faff gitignore-ensure --local` runs from inside that worktree
Then `.faff/` is written to the main repo's common-dir info/exclude
 And `git check-ignore -v .faff/config.local.yaml` from the worktree reports it ignored via that exclude file
```

```
Given a directory that is not inside any git repository
When `faff gitignore-ensure --local` runs there
Then the command exits 0, prints that there is no git repo, and creates no .git/info/exclude
```

```
Given a normal main checkout
When `faff gitignore-ensure --local` runs
Then the written file and the command output are unchanged from the pre-fix behaviour
```

## 8. DONE — Definition of Done

### From WHY
- [ ] Run from a linked worktree, `faff gitignore-ensure --local` writes `.faff/` to the main repo's common-dir `info/exclude` (not a stray path under the worktree).

### From WHAT (resolver)
- [ ] `resolveInfoExcludeFile(root)` is exported from `shared-infra.js`, returns the absolute common-dir `info/exclude` path for a repo (main or worktree) and `null` outside a repo, via a single read-only `git rev-parse --git-path info/exclude`.
- [ ] `gitignore-ensure.js` imports and uses it in the `--local` branch; the hand-built `path.join(root, ".git", "info", "exclude")` is gone from the `--local` path.

### From HOW (behaviour)
- [ ] From a main checkout, the written file and command output are byte-identical to pre-fix behaviour.
- [ ] Outside a git repository, the command exits 0, reports no git repo, and writes no file.
- [ ] `--json` output in the no-repo case is valid JSON with `path: null` and no written file.
- [ ] Standard mode (no `--local`) is unchanged — root `.gitignore` + `.faff/.gitignore` writing and hazard warnings behave exactly as before.

### From HOW (tests — repository test floor)
- [ ] The `gitignoreEnsureSelftest` `--local` cases are updated to run against **real** throwaway git repos (`git init`) rather than hand-made `.git/info/` dirs, since `git rev-parse` now does the resolution; the no-repo case asserts a non-repo temp dir exits 0 and writes nothing. `faff gitignore-ensure --selftest` passes.
- [ ] A linked-worktree case is added to the real-git CLI test `test/impure/gitignore-ensure-set.test.mjs`: `git init` a repo, `git worktree add` a linked worktree, run `faff gitignore-ensure --local` from it, assert the pattern lands in the main repo's common-dir `info/exclude` and `git check-ignore` confirms it from the worktree. `node --test test/impure/gitignore-ensure-set.test.mjs` passes, and the full `node --test` suite stays green.

confidence: high
build-tier: standard
