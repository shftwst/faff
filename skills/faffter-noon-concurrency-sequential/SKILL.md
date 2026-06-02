# faffter-noon-concurrency-sequential

The default executor for the `concurrency` slot. Runs `/faff-beep-boop`'s build pass **sequentially** — one `/faff-workit` at a time — over the partition that conflict analysis produced. The safe, zero-contention default: no worktree juggling, no merge races, no concurrency cap to tune. Swap to `faffter-dark-concurrency-parallel` when you want speed and your project can absorb concurrent worktrees.

```yaml
planning_skills:
  concurrency: faffter-noon-concurrency-sequential   # the default — explicit for clarity
```

## When it runs

Invoked by `/faff-beep-boop`'s build pass (full pipeline step 6, and the explicit-list build loop) as the configured `concurrency` skill — the default when the slot is unset. It is a **mechanism** slot (no paired adaptor): it executes the build pass, it does not produce or translate anything.

## The slot contract

The `concurrency` slot contract is **fixed in the gateway** — see `~/.claude/skills/faff/SKILL.md` → **Mechanism slots (`concurrency`, `ship`)** → _The `concurrency` slot contract_. It is the authoritative definition for **every** occupant (this default and any third-party executor): the input (the conflict-analysis partition + per-issue build action + run ledger) and the four obligations — (1) build every partition issue, (2) serialise within a collision group and require a *dependency* blocker to have **merged** (park the dependent otherwise), (3) record every terminal outcome to the run ledger using the fixed buckets (mapping `pr-open-for-human` → `pr-open`), (4) never weaken the merge gate. This skill **refers back** to that contract; the recap here is non-normative and the gateway wins on any conflict. What follows is only *how this default discharges it*.

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
