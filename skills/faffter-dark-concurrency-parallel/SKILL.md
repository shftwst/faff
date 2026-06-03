# faffter-dark-concurrency-parallel

The concurrent executor for the `concurrency` slot. Runs `/faff-beep-boop`'s build pass with **multiple `/faff-graft` invocations in flight at once**, each in its own git worktree, up to a configurable cap — with a **rebase-before-merge** rule so parallel PRs can't merge stale-green against a moving `main`. The speed option; the sequential default (`faffter-noon-concurrency-sequential`) is the safe one.

```yaml
planning_skills:
  concurrency: faffter-dark-concurrency-parallel
# optional cap (default 4):
concurrency_max: 4
```

## When it runs

Invoked by `/faff-beep-boop`'s build pass as the configured `concurrency` skill. It honours the same slot contract every `concurrency` occupant must (see the gateway → **Mechanism slots** → _The `concurrency` slot contract_): build every issue in the partition, serialise within collision groups, record every terminal outcome to the run ledger, and never weaken the merge gate. This skill adds concurrency and the merge-safety that concurrency requires.

## Concurrency cap

Read `concurrency_max` from `.faffrc` via the bundled resolver (`~/.claude/skills/faff/bin/faff config get concurrency_max -d 4`); default **4** when unset. Never exceed it — at most `concurrency_max` `/faff-graft` builds run at once. The cap bounds worktree count, disk, and the number of branches racing `main` at any moment. A queue longer than the cap drains as slots free up; nothing is dropped.

## Worktree isolation

Each in-flight build runs in its **own git worktree** at `~/.faff/worktrees/<repo>/<branch>` (default; per the gateway → **Worktree policy**, `worktree_root`-overridable — `/faff-graft` creates one per issue, never shared across concurrent builds). Two builds writing the same working tree is the one thing parallel execution must never do; the per-issue worktree isolation guaranteed by that policy is what makes independents safe to run together.

## Scheduling the partition

1. **Independents** are the parallelism pool — schedule them up to the cap, launching a new one whenever a slot frees.
2. **Collision groups** stay serial *within* the group (member N+1 starts only after member N reaches a terminal state), but a whole group runs concurrently *with* independents and other groups. A group occupies **one** concurrency slot at a time (its current member), not one per member. The slot contract's **merge requirement applies here too** (see the gateway → **Mechanism slots** → _The `concurrency` slot contract_, obligation 2): a member that *depends on* an earlier member only builds if that blocker **merged** — if the blocker landed `pr-open` / `parked` / `errored`, park the dependent (`in-run blocker did not merge`) rather than building it against a `main` missing the dependency. (Same-surface-only members just serialise.)
3. Keep launching until the partition is exhausted and all in-flight builds have reached terminal states. Record each terminal outcome to the run ledger as it lands (mapping `pr-open-for-human` → `pr-open`, per the slot contract).

## Rebase-before-merge (the merge-race fix)

Several PRs going green in parallel were each tested against the `main` they branched from. By the time the second one merges, `main` has moved — its green is stale and the merge can break `main` even though CI passed. So merges are **serialised and re-validated**:

1. **One merge at a time.** Acquire a logical merge lock before merging any PR (only one build is in its merge step at once); the others keep building.
2. **Rebase onto latest `main`, then re-confirm green.** Before merging, rebase (or merge `main` into) the PR branch and re-run the checks the gateway merge gate requires — AC verification stays valid, CI must be **green on the rebased head**, review `pass` still stands. Merging on pre-rebase green is forbidden under concurrency.
3. **If the rebase conflicts** → this is a real collision the partition missed (two independents that turned out to share surface). Hand it back to `/faff-graft` to resolve on the rebased branch (iterate), or park per the shared protocol if it can't be resolved autonomously. Then release the lock; the next ready PR rebases against the now-updated `main`.
4. **If CI fails after rebase** → treat as a normal post-build CI failure (graft Step 10: one fix attempt if fixable, else park). The stale-green never reaches `main`.
5. Release the merge lock; the next ready build takes it.

This keeps the throughput win of parallel building while making the *merge* boundary as safe as the sequential default — each PR lands against the `main` it was actually re-validated against.

## Rules

- Honours all four slot-contract obligations (the gateway → **Mechanism slots** → _The `concurrency` slot contract_) — concurrency changes *ordering and isolation*, never *whether* the merge gate runs.
- The merge gate (AC + CI-green + review `pass`) is never weakened; rebase-before-merge only *adds* a re-validation, it never removes one.
- Never run two builds in the same worktree. Never exceed `concurrency_max`. Never merge on pre-rebase green.
- Sequencing/holding a build for a free slot is **not** a park — it's scheduling. Every partition member still builds.
