---
name: faffter-dark-concurrency-parallel
description: "Concurrent build-pass executor for the `concurrency` slot — runs faff-beep-boop's builds in multiple worktrees at once, capped, with rebase-before-merge. The speed option vs the sequential default. Runs as a configured slot, not the user `/` menu."
user-invocable: false
judgement_seam: none
---

# faffter-dark-concurrency-parallel

The concurrent executor for the `concurrency` slot. Runs `/faff-beep-boop`'s build pass with **multiple `/faff-graft` invocations in flight at once**, each in its own git worktree, up to a configurable cap — with a **rebase-before-merge** rule so parallel PRs can't merge stale-green against a moving `main`. The speed option; the sequential default (`faffter-noon-concurrency-sequential`) is the safe one.

```yaml
slots:
  concurrency: faffter-dark-concurrency-parallel
# optional cap (default 4):
concurrency_max: 4
```

## When it runs

Invoked by `/faff-beep-boop`'s build pass as the configured `concurrency` skill. It honours the same slot contract every `concurrency` occupant must (see the gateway → **Mechanism slots** → _The `concurrency` slot contract_): build every issue in the partition, serialise within collision groups, record every terminal outcome to the run ledger, and never weaken the merge gate. This skill adds concurrency and the merge-safety that concurrency requires.

## Concurrency cap

Read `concurrency_max` from `.faffrc` via the bundled resolver (`faff config get concurrency_max` — the CLI applies the default **4** when unset, FAFF-182; resolve the `faff` executable per gateway → **Resolver** if it isn't on `PATH`). Never exceed it — at most `concurrency_max` `/faff-graft` builds run at once. The cap bounds worktree count, disk, and the number of branches racing `main` at any moment. A queue longer than the cap drains as slots free up; nothing is dropped.

## Worktree isolation

Each in-flight build runs in its **own git worktree** at `~/.faff/worktrees/<repo>/<branch>` (default; per the gateway → **Worktree policy**, `worktree_root`-overridable — `/faff-graft` creates one per issue, never shared across concurrent builds). Two builds writing the same working tree is the one thing parallel execution must never do; the per-issue worktree isolation guaranteed by that policy is what makes independents safe to run together.

Every concurrency unit is dispatched as a **build subagent** (Agent/Task tool), never run inline via the Skill tool — **one subagent per collision-group serial chain, one per independent**. Each carries a `BuildDispatch` in its prompt — `{ issues, run_id, run_dir, session_id, mode_signal: "autonomous" }` (a chain's `issues` is its ordered members; an independent's is one element). The subagent runs `faff-graft` autonomously in **its own context** (own worktree, build, gates, review, CI wait, merge) and returns **only** a `TerminalToken{ issue, outcome, pr }` per member, so the orchestrator re-absorbs the token + on-disk artifacts, never the build's working set. Reconcile each token against `.faff/runs/<run-id>/ISSUE-XX/` + git ground truth before recording the ledger bucket; never parse the subagent transcript. `outcome` is one of the existing six ledger buckets — `claimed-by-peer` is resolved pre-dispatch, never returned.

1. **Independents** are the parallelism pool — schedule them up to the cap, launching a new build subagent whenever a slot frees.
2. **Collision groups** stay serial *within* the group (member N+1 starts only after member N reaches a terminal state), but a whole group runs concurrently *with* independents and other groups. The whole chain runs in **one** build subagent (its shared rebase-before-merge context stays together), occupying **one** concurrency slot at a time, not one per member. The slot contract's **merge requirement applies here too** (see the gateway → **Mechanism slots** → _The `concurrency` slot contract_, obligation 2): a member that *depends on* an earlier member only builds if that blocker **merged** — if the blocker landed `pr-open` / `parked` / `errored`, park the dependent (`in-run blocker did not merge`) rather than building it against a `main` missing the dependency. (Same-surface-only members just serialise.)
3. Keep launching until the partition is exhausted and all in-flight build subagents have returned terminal tokens. Record each terminal outcome to the run ledger as it lands (mapping `pr-open-for-human` → `pr-open`, per the slot contract).

Each agent that refreshes the heartbeat does so through the single sanctioned `faff heartbeat "$run_dir"` write path (FAFF-234) — never a hand-rolled ledger edit; the orchestrator forwards `run_dir` in each `BuildDispatch` so an in-build tick lands on the owning ledger. `faff heartbeat`'s field-merge re-reads the ledger before writing only `owner.last_heartbeat`, which narrows but does not close the window below:

> **Heartbeat ownership under N concurrent subagents is unresolved** — with more than one active writer, a heartbeat field-merge can still interleave with a concurrent *outcome* write and clobber it (the single-active-writer property the sequential default relies on does not hold here). This is a known punt for the parallel executor — its named extension point is a dedicated single-value heartbeat file decoupled from ledger content (FAFF-234 OUT OF SCOPE); resolve it before enabling subagent dispatch under parallel mode in anger. The sequential default is unaffected.

## Rebase-before-merge (the merge-race fix)

Several PRs going green in parallel were each tested against the `main` they branched from. By the time the second one merges, `main` has moved — its green is stale and the merge can break `main` even though CI passed. So merges are **serialised and re-validated** — each build subagent runs its own rebase/merge inside its graft flow, the executor only owns the cross-subagent merge lock:

1. **One merge at a time.** A build subagent acquires a logical merge lock before its graft enters its merge step (only one build is merging at once); the others keep building.
2. **Rebase onto latest `main`, then re-confirm green.** Before merging, the subagent rebases (or merges `main` into) its PR branch and re-runs the checks the gateway merge gate requires — AC verification stays valid, CI must be **green on the rebased head**, review `pass` still stands, and **under the L4 lights-out signal the per-issue code-blind holdout must still return `meets-spec`** (the FAFF-311 fourth floor condition, asserted last). Merging on pre-rebase green is forbidden under concurrency.
3. **If the rebase conflicts** → this is a real collision the partition missed (two independents that turned out to share surface). The subagent's own graft flow resolves it on the rebased branch (iterate), or parks per the shared protocol if it can't be resolved autonomously — returning the corresponding terminal token. Then it releases the lock; the next ready subagent rebases against the now-updated `main`.
4. **If CI fails after rebase** → the subagent treats it as a normal post-build CI failure (graft Step 10: one fix attempt if fixable, else park). The stale-green never reaches `main`.
5. The subagent releases the merge lock; the next ready build takes it.

This keeps the throughput win of parallel building while making the *merge* boundary as safe as the sequential default — each PR lands against the `main` it was actually re-validated against.

## Rules

- Honours all four slot-contract obligations (the gateway → **Mechanism slots** → _The `concurrency` slot contract_) — concurrency changes *ordering and isolation*, never *whether* the merge gate runs.
- The merge gate (AC + CI-green + review `pass`, **plus the L4 per-issue holdout `meets-spec` under the lights-out signal** — FAFF-311 obligation-4) is never weakened; rebase-before-merge only *adds* a re-validation, it never removes one.
- Never run two builds in the same worktree. Never exceed `concurrency_max`. Never merge on pre-rebase green.
- Sequencing/holding a build for a free slot is **not** a park — it's scheduling. Every partition member still builds.
