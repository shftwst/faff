# Worktree setup must not clobber a tracked `.faffrc.yaml` — copy only the untracked overlay(s)

> Spec: faffter-dark-nlspec · 2026-07-17 · interactive · confidence: high. Full spec on Linear FAFF-532.

This spec addresses **FAFF-532**. It is written for the build agent that will patch `plugin/skills/faff-graft/setup-worktree.sh` and extend the worktree-config test surface, and for the human reviewer gating that change. The task is a bounded bug fix in the `WorktreeCreate` hook's config-copy step, plus a behavioural regression test.

## 1. WHY — Problem and Principles

**The load-bearing model.** When `git worktree add … <ref>` creates a linked worktree, every git-*tracked* path is materialised at that ref by git itself — the worktree already holds the correct committed content the moment it exists. A file only needs a manual `cp` from the invoking checkout when git will *not* carry it — i.e. an *untracked* machine-local overlay (`.faffrc.local.yaml`, `.env*`, `.claude/settings.local.json`). The hook's copy step currently ignores this distinction and copies from a fixed list unconditionally, so it overwrites the worktree's correctly-checked-out tracked `.faffrc.yaml` with a possibly-divergent copy from the invoking checkout. The fix is one predicate: **copy a listed file only if the worktree does not already track that path.**

**Problem statement.** `setup-worktree.sh` copies config into each new build worktree so the build sees the operator's config, but the copy list includes `.faffrc.yaml`, which in a migrated repo (like faff's own) is a *tracked, committed* file the worktree already has correctly at its ref. Copying it overwrites the good own-ref version with the invoking checkout's version — during FAFF-529's build this clobbered the FAFF-523-migrated base config with a stale pre-523 copy, forcing a wrong re-migration (caught by review, reverted). The fix restricts the copy to files git does not track, so a committed `.faffrc.yaml` is never clobbered while the untracked overlay is still carried.

**Design principles.**

**The worktree's own ref is the source of truth for any tracked path.** The invoking checkout (`$CWD`) is authoritative *only* for content git will not otherwise deliver to the worktree. Any step that lets `$CWD` win over the worktree's checked-out ref for a tracked file is a defect — especially under the parallel executor, where `$CWD` and the branch base can diverge mid-wave.

**Tracked vs untracked is decided per-file at runtime, not by hardcoding the list.** The same filename (`.faffrc.yaml`) is tracked in a migrated repo but gitignored-and-untracked in an unmigrated adopter repo. The copy must therefore ask git per-file at run time, not bake the tracked/untracked verdict into the static list.

## 2. OUT OF SCOPE

- **The FAFF-208 main-worktree config fallback** — read-time resolver concern, orthogonal to setup-time copying.
- **The `.faffrc.yaml` migration itself (FAFF-523 / FAFF-529)** — this bug is that setup *clobbered* a migrated config, not how migration works.
- **The non-config copy targets** (`.env*`, `.claude/settings.local.json`) — legitimately untracked overlays; the new predicate simply keeps copying them.
- **npm/setup install behaviour** (lines 63–97) — untouched.

## 3. WHAT

**The tracked-vs-overlay predicate.** Chosen: `git ls-files --error-unmatch <path>`, run in the worktree, as the canonical distinction. `check-ignore` answers a different, unreliable question here — `.faffrc.local.yaml` is untracked but not `.gitignore`-listed, so a `check-ignore`-based guard would wrongly skip copying the overlay.

**Design decision — copy semantics.** Copy a listed file *only when the worktree does not track it*; skip (leave the checked-out version intact) when it does.

**Design decision — keep the file list unchanged.** Retain `.faffrc.yaml` in the `for f in …` list; the per-file runtime tracked-test decides the outcome.

## 4. HOW

Add a single guard inside the existing loop body, between the existence check and the `cp`: if the worktree tracks `$f`, log a skip and `continue`; otherwise copy exactly as today.

```
if git ls-files --error-unmatch -- "$f" >/dev/null 2>&1; then
  echo "$(date '+%H:%M:%S') [worktree] skip $f — tracked at worktree ref" >&2
  continue
fi
```

Both streams suppressed; only the exit code consulted, so a tracked-but-locally-modified file still reports tracked (exit 0) and is correctly skipped. `set -euo pipefail` is not tripped because the failure path is inside an `if` test.

**Anti-pattern:** deciding tracked-vs-overlay with `git check-ignore`. **Anti-pattern:** running the tracked-test against `$CWD` instead of the worktree.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a repo whose committed .faffrc.yaml holds version A (the correct, migrated config)
  And the invoking checkout's working copy of .faffrc.yaml holds a divergent version B
When faff-graft's WorktreeCreate hook creates and configures the build worktree
Then the worktree's .faffrc.yaml still holds version A (its own checked-out ref)
  And it is NOT overwritten with version B from the invoking checkout
```

- The tracked-config file is left untouched while genuine overlays are still copied — the fix must not regress the FAFF-186/FAFF-387 overlay-carry behaviour.

## 7. DONE — Definition of Done

### From WHY
- [ ] After setup, a build worktree over a repo with a *tracked* `.faffrc.yaml` retains that file's own-ref content; it is not overwritten by the invoking checkout's copy.

### From WHAT (mechanism)
- [ ] The copy loop uses `git ls-files --error-unmatch` (not `git check-ignore`) to decide whether a candidate path is tracked.
- [ ] The `for f in …` candidate list is unchanged (still includes `.faffrc.yaml` and `.faffrc.local.yaml`).

### From HOW (behaviour)
- [ ] For each candidate file present in `$CWD`: if the worktree tracks the path, the copy is skipped (a skip line is logged) and the checked-out file is left intact; otherwise the file is copied as before.
- [ ] The tracked-test's stdout and stderr are suppressed and only its exit code is consulted; `set -euo pipefail` is not tripped by a non-tracked (exit-1) result.
- [ ] An untracked overlay present in `$CWD` is still copied into the worktree.

### From HOW (edge cases)
- [ ] An unmigrated repo whose `.faffrc.yaml` is gitignored-and-untracked still has it copied (tracked-test reports untracked).
- [ ] A tracked-but-locally-modified file in `$CWD` is still skipped (tracked-test exits 0).

### Tests
- [ ] **Behavioural (new)** — a Node test in the style of `test/config-worktree-fallback.test.mjs`: build a real tmp git repo, commit `.faffrc.yaml` = "A"; overwrite the working-tree `.faffrc.yaml` = "B" and add an untracked `.faffrc.local.yaml` overlay; invoke `setup-worktree.sh` with `SKIP_NPM_PACKAGES_INSTALL=1` and stdin JSON; read the printed worktree path; assert the worktree's `.faffrc.yaml` equals "A" and the overlay equals its content.
- [ ] **Static (extend `test/setup-worktree-config.test.mjs`)** — assert the script contains a `git ls-files --error-unmatch` guard.
- [ ] `node --test` green; `faff validate-adapters` clean.

confidence: high
spec-review: approve
