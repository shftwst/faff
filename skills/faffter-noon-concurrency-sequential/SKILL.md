# faffter-noon-concurrency-sequential

The default executor for the `concurrency` slot. Runs `/faff-beep-boop`'s build pass **sequentially** — one `/faff-workit` at a time — over the partition that conflict analysis produced. The safe, zero-contention default: no worktree juggling, no merge races, no concurrency cap to tune. Swap to `faffter-dark-concurrency-parallel` when you want speed and your project can absorb concurrent worktrees.

```yaml
planning_skills:
  concurrency: faffter-noon-concurrency-sequential   # the default — explicit for clarity
```

## When it runs

Invoked by `/faff-beep-boop`'s build pass (full pipeline step 6, and the explicit-list build loop) as the configured `concurrency` skill — the default when the slot is unset. It is a **mechanism** slot (no paired adaptor): it executes the build pass, it does not produce or translate anything.

## The slot contract (shared by every `concurrency` occupant)

**Input.** The conflict-analysis partition for the current wave:

```json
{ "independents": ["ISSUE-A", "ISSUE-B"], "groups": [["ISSUE-D", "ISSUE-E"]] }
```

plus the per-issue build action — invoke `/faff-workit ISSUE-XX` in autonomous mode — and the run ledger at `.faff/runs/<run-id>/run-ledger.json`.

**Obligations every occupant must honour:**

1. **Build every issue in the partition.** Independents and group members alike each reach a `/faff-workit` invocation. Nothing in the partition is skipped or deferred — that is the gateway's deferred-queue anti-pattern (see gateway → Autonomous Mode Contract) and is caught by `runcheck`.
2. **Serialise within a collision group — and require a *dependency* blocker to have merged.** A group's members build **in listed order**: each starts only after the prior one reaches a terminal state. A "terminal state" is **not** the same as "merged" — `pr-open`, `parked`, and `errored` are terminal but unmerged. So for a member that *depends on* an earlier member (declared blocker), only build it if the blocker **merged** (`shipped`); if the blocker terminated **unmerged** (`pr-open` / `parked` / `errored`), its dependents must **not** build — they'd build against a `main` that lacks the dependency. **Park each blocked dependent** (cause: `in-run blocker did not merge — <blocker-id> landed <state>`) and record it `parked`. Members grouped only for *same-surface* reasons (touch the same files, no dependency between them) just serialise in order — the merge requirement applies only to a member that names an earlier member as its blocker.
3. **Record every terminal outcome to the run ledger** the moment an issue lands in a bucket — one of `shipped` / `pr-open` / `parked` / `errored`, per the gateway's Run ledger contract (this is what `runcheck` audits). Map `/faff-workit`'s caller-facing return values to the ledger buckets: **`pr-open-for-human` → `pr-open`**, `errored` → `errored`, `parked` → `parked`, a merged ship → `shipped`. Write the ledger *bucket* name, never the raw return token, or `runcheck` will flag the outcome as invalid.
4. **Never weaken the merge gate.** AC-verified + CI-green + review `pass` is fixed in the gateway and `/faff-workit`; a `concurrency` skill controls *ordering and isolation*, never *whether* the gate runs.

**Output.** Every issue in the partition reaches a terminal state, all recorded in the ledger. Control returns to beep-boop's wave drain.

## How the default runs it

Strictly one issue at a time, no worktree concurrency:

1. Order the work: independents first (in the order beep-boop supplied — already priority → chainable-unlock-value, reframed by any methodology), then each collision group as a contiguous block (members in listed order).
2. For each issue in that flattened order, invoke `/faff-workit ISSUE-XX` autonomously and **wait for it to reach a terminal state** before starting the next. `/faff-workit` owns its own worktree, build, review, CI wait, and auto-merge.
3. Write the terminal outcome to the run ledger as each issue lands.
4. When the list is exhausted, return to beep-boop.

Because only one build runs at a time and each `/faff-workit` merges (or parks) before the next starts, every later build sees `main` exactly as the prior build left it — there is no merge race to manage and no rebase step needed. The one case to handle: a dependent whose in-group blocker terminated **unmerged** is parked, not built (obligation 2) — it can't build on a `main` that's missing its dependency. Throughput is the cost; safety and simplicity are the payoff.

## Rules

- This is the **minimum** executor. A richer occupant (`faffter-dark-concurrency-parallel`) may run independents concurrently — but must still honour the four slot-contract obligations above.
- No WIP cap applies to autonomous runs (the WIP cap is a human-flow concept — see the methodology slot). Sequential execution is a *safety/simplicity* choice, not a throttle.
- It never parks an issue for being "later in the queue" — sequencing is not deferral. Each issue runs; `/faff-workit` decides its terminal state.
