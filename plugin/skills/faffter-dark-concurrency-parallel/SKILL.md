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

Every concurrency unit is dispatched as a **build subagent** (Agent/Task tool), never run inline via the Skill tool — **one subagent per collision-group serial chain, one per independent**.

These builds are *deliberately* dispatched in the background (**`run_in_background`** left at its default/true) — that is exactly what puts N in flight at once, unlike the sequential default's foreground pin. Naming the flag makes the choice visible; the turn-survival cost of backgrounding is discharged by the await-all gate at step 3 below (gateway → **Producer dispatch** for the background-by-default *why*).

Each carries a `BuildDispatch` in its prompt — `{ issues, run_id, run_dir, session_id, mode_signal: "autonomous", model, effort }` (a chain's `issues` is its ordered members; an independent's is one element). **`model` is the per-lane build model (FAFF-315):** resolve `faff config get models.build` **once per run** at queue-assembly (fail-loud on an invalid token — the CLI exits 2 naming the legal set) and stamp it into every `BuildDispatch`; a token is passed as the Agent-tool `model` parameter per launch, while `inherit` (default) **omits the parameter** — today's dispatch, byte-for-byte. **`effort` is the per-lane build effort (FAFF-416):** resolve `faff config get effort.build` **once per run** at queue-assembly (fail-loud on an invalid token — exit 2 naming the legal set) and stamp it into every `BuildDispatch`; a resolved level is passed as the dispatch's reasoning-effort arg while `inherit` (default) **omits it** — byte-for-byte today. It is also the value the build subagent tags onto its FAFF-415 `data.effort` event.

**Per-issue build-model routing (FAFF-334, opt-in):** when `models.build_by_confidence` is configured, resolve **per issue at dispatch** instead — for each unit, `faff models build-for <that issue's retained confidence>` (the confidence rides the partition entry the orchestrator annotates at assembly, so no new tracker read) — and stamp the per-issue token into that unit's `BuildDispatch`. A **collision-chain is one subagent = one `model` param**, so resolve it to the model for its **most-demanding member** — the **lowest** retained confidence in the chain (`medium` outranks `high`) — so no chained member is under-served by a cheaper model chosen for an easier sibling. Matcher **absent** ⇒ the once-per-run scalar resolution above, byte-for-byte; `inherit` still omits the param. Record the resolved per-issue model on the `BuildDispatch` / run log so it is never silent.

The subagent runs `faff-graft` autonomously in **its own context** (own worktree, build, gates, review, CI wait, merge) and returns **only** a `TerminalToken{ issue, outcome, pr }` per member, so the orchestrator re-absorbs the token + on-disk artifacts, never the build's working set. Reconcile each token against `.faff/runs/<run-id>/ISSUE-XX/` + git ground truth before recording the ledger bucket; never parse the subagent transcript. `outcome` is one of the existing six ledger buckets — `claimed-by-peer` is resolved pre-dispatch, never returned.

1. **Independents** are the parallelism pool — schedule them up to the cap, launching a new build subagent whenever a slot frees.
2. **Collision groups** stay serial *within* the group (member N+1 starts only after member N reaches a terminal state), but a whole group runs concurrently *with* independents and other groups. The whole chain runs in **one** build subagent (its shared rebase-before-merge context stays together), occupying **one** concurrency slot at a time, not one per member. The slot contract's **merge requirement applies here too** (see the gateway → **Mechanism slots** → _The `concurrency` slot contract_, obligation 2): a member that *depends on* an earlier member only builds if that blocker **merged** — if the blocker landed `pr-open` / `parked` / `errored`, park the dependent (`in-run blocker did not merge`) rather than building it against a `main` missing the dependency. (Same-surface-only members just serialise.)
3. Keep launching until the partition is exhausted and all in-flight build subagents have returned terminal tokens. **The await-all gate: never end a turn with build subagents still in flight.** Because the builds are backgrounded (paragraph above), the turn will not block on them by itself — so after launching, hold the turn open with a **foreground wait** (a `Monitor` / `Bash` until-loop polling on-disk state — the run-ledger `outcomes` and per-issue `.faff/runs/<run-id>/ISSUE-XX/` artifacts; `Monitor` streams shell output, it is not a native await-agents primitive, so the poll target is on-disk state, and note foreground `sleep` is blocked, so the loop condition does the waiting) until **every** in-flight unit has a terminal outcome. Ending the turn with an un-awaited build outstanding leaves an idle parent that unattended reaping kills along with every in-flight build. Record each terminal outcome to the run ledger as it lands (mapping `pr-open-for-human` → `pr-open`, per the slot contract).

Each agent that refreshes the heartbeat does so through the single sanctioned `faff heartbeat "$run_dir"` write path — never a hand-rolled ledger edit; the orchestrator forwards `run_dir` in each `BuildDispatch` so an in-build tick lands on the owning run. A tick's only write is the dedicated per-run heartbeat file (`.faff/runs/<run-id>/heartbeat`), never the run ledger — so N concurrent tickers are safe by construction: each tick is an atomic whole-file replace of a single-value file, and last-writer-wins is the correct outcome for a freshness scalar. The run ledger is orchestrator-only — build subagents never write it — so there is nothing left for a concurrent tick to clobber: the outcome-write race this section used to describe as unresolved is closed structurally, not by careful sequencing.

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
