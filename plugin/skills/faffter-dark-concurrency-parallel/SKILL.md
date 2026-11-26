---
name: faffter-dark-concurrency-parallel
description: "Parallel concurrency slot: execute beep-boop builds in capped concurrent worktrees, with rebase before merge. Alternative to the sequential default."
user-invocable: false
judgement_seam: none
---

# faffter-dark-concurrency-parallel

The `concurrency` executor runs `/faff-beep-boop`'s build pass with **multiple `/faff-graft` invocations in flight**, each in its own git worktree, up to the configurable cap. **Rebase-before-merge** prevents stale-green merges against moving `main`. It favours speed; `faffter-noon-concurrency-sequential` is the safer default.

```yaml
slots:
  concurrency: faffter-dark-concurrency-parallel
# optional cap (default 4):
concurrency_max: 4
```

## When it runs

Invoked by `/faff-beep-boop`'s build pass as the configured `concurrency` skill. It honours the gateway → **Mechanism slots** → _The `concurrency` slot contract_: build every issue in the partition, serialise within collision groups, record every terminal outcome to the run ledger, never weaken the merge gate, bracket every graft dispatch with integrity-digest custody (obligation 5), persist + verify the returned per-issue AC/review evidence (obligation 6), and run the merge above the cut for each `pr-ready` member (obligation 7). This skill adds concurrency and the merge-safety that concurrency requires.

## Concurrency cap

Read `concurrency_max` from `.faff/config.yaml` via the bundled resolver (`faff config get concurrency_max` — the CLI applies the default **4** when unset; resolve the `faff` executable per gateway → **Resolver** if it isn't on `PATH`). Never exceed it — at most `concurrency_max` `/faff-graft` builds run at once. The cap bounds worktrees, disk and branches racing `main`; longer queues drain as slots free, dropping nothing.

## Worktree isolation

Each in-flight build runs in its **own git worktree** at `~/.faff/worktrees/<repo>/<branch>` (default; per the gateway → **Worktree policy**, `worktree_root`-overridable — `/faff-graft` creates one per issue, never shared across concurrent builds). Never let concurrent builds write the same working tree.

Dispatch one build subagent per independent issue or ordered collision chain via Agent/Task. Use background dispatch and refill slots on individual returns (step 3). Never run graft inline via the Skill tool.

On a Sentry corrective re-dispatch only, run `faff corrective check --run-dir <run_dir> --issue <issue>` first. A mandate of `empty` or `indeterminate` parks the unit. Attach the verified `constraints` to the returned BuildDispatch only for `disposition:"trusted"` with `mandate:"narrowed"`. Omit constraints for channel-D or absent correction.

Run `faff dispatch prepare-build --executor parallel` and apply **Build worker prompt** in `faff/references/l4.md`, including its foreground-to-terminal clause. Use the prepared background Agent arguments. The worker's own steps run in the foreground.

Each autonomous graft builds, tests, reviews and waits for CI in its own worktree and context. It returns a `TerminalToken{ issue, outcome, pr }` and a separate `EvidenceReturn` per member. The executor verifies the return, reconciles it with the issue’s run artifacts and git, and records the bucket under concurrency obligation 3. A clean `pr-ready` goes through the executor's merge (obligation 7) before recording. Never use a worker transcript as evidence. Queue routing and budget outcomes are orchestrator-only. Peer claims resolve before dispatch.

1. **Independents** are the parallelism pool — schedule them up to the cap, launching a new build subagent whenever a slot frees.
2. **Collision groups** stay serial *within* the group (member N+1 starts only after member N reaches a terminal state), but a whole group runs concurrently *with* independents and other groups. The whole chain runs in **one** build subagent (its shared rebase-before-merge context stays together), occupying **one** concurrency slot at a time, not one per member. The slot contract's **dependency-disposition requirement applies here too** (see the gateway → **Mechanism slots** → _The `concurrency` slot contract_, obligation 2), forked by the `graft.dependency_wait` knob (resolved once per pass via `faff config get graft.dependency_wait -d`):
   - **`off` (default):** a member that *depends on* an earlier member only builds if that blocker **merged** — if the blocker landed `pr-open` / `parked` / `errored`, park the dependent (`in-run blocker did not merge`) rather than building it against a `main` missing the dependency. Byte-identical to today.
   - **`stack`:** a member whose blocker landed **`pr-open`** is stacked, not parked — resolve the blocker's PR + head branch + **pinned tip SHA once**, write and commit the `stack-parent.json` anchor, dispatch the dependent's graft with `FAFF_WORKTREE_BASE_REF` set to **that same pinned SHA**, and apply the `faff-stacked` label (mechanics per obligation 2). At the dependent's merge locus (obligation 7, run under this executor's cross-member merge lock) merge-gate's additive `dependency_gate` leg refuses the merge until the blocker's PR merges; once it merges, the merge locus runs the bounded `git rebase --onto <pinned-sha>` before merging. The two owner-park outcomes — blocker PR **closed-unmerged** (dead base) and a rebase **conflict** — are enacted **here** (`reconsider:human`) from merge-gate's surfaced park intent, never inside merge-gate. A blocker that landed `parked`/`errored` parks the dependent under both knob values (no branch to stack on); git-only mode degrades `stack` to `off`.

   (Same-surface-only members just serialise, unaffected by the knob.)
3. Keep launching until the partition is exhausted and all in-flight build subagents have returned terminal tokens. **The await-all gate: never end a turn with build subagents still in flight.** While builds are in flight, foreground-wait for the next worker return or supervision checkpoint. Use a Monitor or bounded Bash poll of per-issue artifacts for wakeups. Verify each return before releasing its slot. A PR opening alone does not free a slot. After the checkpoint permits dispatch, fill available slots with ready independents or collision chains before waiting again, including while verified PRs queue for the serial merge. A chain retains its slot until its worker returns. Drain all workers and pending merges before closing the wave. Record each terminal outcome to the run ledger as it lands (mapping `pr-open-for-human` → `pr-open`, `retry-later` → `parked` + `review_outage_pending` annotation, per the slot contract). **Each poll iteration also runs the canonical between-units checkpoint** (`faff-beep-boop` → _The interrupt_, by reference — never restated here, per the `faff validate-adapters` duplicated-block rule): budget check, effects check, `faff sentry check --json --run-dir <dir>`, emit the `sentry-checkpoint` event. This is the fleet consult — the poll loop is the only component awake while N members are in flight, exactly where a member stall must be caught. Act on the result:
   - **A member-scoped `pause` verdict for an in-flight member** → run the _Member-park procedure_ below.
   - **`abort` (run-scoped)** → `faff run checkpoint`'s abort rule (L4 acts via `faff sentry abort --run-dir <run-dir>`; a non-L4 run logs + surfaces, **unless it declared unattended — `autonomous.unattended: true`, or the `autonomous.sentry_acting: true` alias — then it acts too** — the abort kill-switch keyed on attendedness rather than the L4 mint, so an unattended L3 run gets a live kill-switch).
   - **Healthy members** (`continue`, or a `pause`/`correct` naming a different, still-live member) → keep polling to terminal outcomes, unchanged.

Forward `run_dir` in every `BuildDispatch`. Each worker ticks `faff heartbeat "$run_dir" --unit <issue>` for its independent issue or current chain member. A tick atomically refreshes the shared `heartbeat` and that issue's single-writer `heartbeat.<issue>`. Workers leave ledger and event-log writes to the orchestrator (gateway → **Run-artifact write authority**).

## Fleet member supervision

Step 3's between-units checkpoint uses `faff sentry check`'s **member-resolved** evaluation: each in-flight member's `heartbeat.<issue>` (from its `--unit` ticks) plus the run-level surface. A member trip caps at `pause`, never run-wide `abort`. If **every** member goes silent, the run heartbeat also stops and the independent run-scoped `wall-clock-runaway` → `abort` route applies unchanged. No new shared-mutable surface: only that member ticks its file; `sentry check` is read-only.

**Member-park procedure** — reached only on a member-scoped `pause` verdict for a still-in-flight member:

1. **Confirm the member boundary first** — a member intervention acts ONLY when the member's subagent has returned (its slot is idle) or its liveness is genuinely dead per the verdict (`heartbeat.<issue>` AND its `build-start` baseline are both older than the stall window). **Never** interrupt a subagent that is actually still running — a live-but-slow member is left to keep polling; the verdict alone is not sufficient without this boundary confirm.
2. **Commit worktree WIP** to the member's branch (park-protocol shape, never a force-reset). Stage **selectively** via the shared chokepoint — `faff stage-guard --worktree <member-worktree> --mode wip` (stages tracked changes + non-secret-class untracked paths, dropping any secret-class file so a stray `.env` is never swept into the WIP), then `git commit`. **Never `git add -A`** (the secret-leak vector).
3. **Post the park comment** on the tracker issue citing the verdict's evidence (`heartbeat_age_secs`, `source`) — the same shape every other park uses.
4. Use `faff label add` with the resolved `parked` name and apply its descriptor.
5. **Record the ledger outcome** `"parked"` for that member (the orchestrator's own write — a build subagent never writes the ledger).
6. **Free the slot** — the next queued independent/group may now launch. A collision-chain's undispatched remainder parks per the existing "in-run blocker did not merge" rule (step 2 above) rather than building against a parked blocker.

**Member-park is orchestrator housekeeping at every level**: record a liveness-dead member and preserve WIP, without corrective authority over live work. It is reversible: `/faff-graft` resumes the parked issue's branch + draft PR. Unlike member-park, run-scoped `abort` acts on L4/lights-out or a declared-unattended non-L4 run (`autonomous.unattended` or `sentry_acting` alias); otherwise log + surface. The independent run-scoped abort route in step 3 is unchanged.

## Rebase-before-merge (the merge-race fix)

Parallel PRs' original green may predate a moving `main`. **Serialise and re-validate merges** in this **executor**, not the build subagent: each `pr-ready` return enters obligation 7's merge locus under one cross-member merge lock. **Once at pass start, before the first dispatch, emit the build-lane boundary** (`faff lane-boundary emit --run-dir <run_dir> --lane build`) so all merges read `dispatched` and require detective custody (gateway obligation 7). A non-zero emit parks the pass before any dispatch:

1. **One merge at a time.** The executor takes a logical merge lock before running a `pr-ready` member's merge locus (only one merge runs at once); the other build subagents keep building.
2. **Rebase onto latest `main`, then re-confirm green.** Before merging, the executor rebases (or merges `main` into) the member's PR branch and, once CI is green on the rebased head and still inside the lock, re-runs obligation 5's run-grain verify and then `faff evidence verify-return --against-ledger` (a non-zero exit of either parks the member, never merges; gateway obligation 7), immediately before it re-confirms the gateway merge floor on the rebased head — AC verification stays valid, CI must be **green on the rebased head**, review `pass` still stands, and **under the L4 lights-out signal the per-issue code-blind holdout must still return `meets-spec`** (the fourth floor condition, asserted last). **Then, still inside the lock, the executor produces the per-issue detective-custody verdict over obligation 5's held run-grain baseline (`integrity-digest verify --record-result`) on the rebased head and threads `--custody-verdict`/`--custody-verdict-sha256` into the `slots.ship` call** — a tamper/unavailable verdict parks the member, never merges (gateway obligation 7). Merging on pre-rebase green is forbidden under concurrency.
3. **If the rebase conflicts** → a real collision the partition missed (two independents that turned out to share surface). The executor **re-dispatches** the member to resolve it on the rebased branch (a fresh build subagent, as _Resume-from-ledger_ does), or records the park if it can't be resolved autonomously. Then it releases the lock; the next ready member rebases against the now-updated `main`.
4. **If CI fails after rebase** → a normal post-build CI failure — re-dispatch the member for one fix attempt if fixable, else record the park. The stale-green never reaches `main`.
5. The executor releases the merge lock; the next ready `pr-ready` member takes it.

Each PR lands against the `main` it was re-validated against while builds remain parallel.

## Integrity-digest custody chain (obligation 5 — placement here)

N dispatches share one run-grain member set. Obligation 5 owns the one-chain-per-orchestrator rule, write sequence and Class A/B closing treatment; this section only places the wave's chain boundaries. The orchestrator is every bracketed member's writer (ledger sole writer, `corrective/` orchestrator-side CLI, `events.jsonl` sole appender), so "everything since the last baseline I did not write is tamper" is exact.

- **Wave start** (before the first dispatch): snapshot → hold baseline B0 in context — this is where the chain opens.
- **On each subagent return**, use the held baseline in the obligation-6 `faff dispatch verify-member` call before consuming that member’s token. A run-scoped failure starts the halt-and-drain below.
- **On each orchestrator own-write to a byte-exact member** (ledger outcome record, park writes, corrective ops): the gateway's mandatory re-baseline sequence, unchanged — verify → write → post-write check → re-snapshot → intended-content check.
- **Poll-loop `sentry-checkpoint` event appends:** no re-baseline — `events.jsonl` is prefix-preserving, so appends verify clean against any older baseline.
- **Wave end** (all units terminal): final verify, then discard the baseline — this is where the chain closes.

**On a run-scoped failure** the wave response is: launch **no new dispatches**, await the already-in-flight subagents to their terminal states through their own per-return verifies (record each — clean or tamper — against ground truth), then end the wave loudly; **never interrupt a genuinely live subagent**, and an in-flight merge the executor already holds the lock for cannot be un-run (it runs against git ground truth through the untouched merge floor — obligation 7). Member set, the chain, the write sequence, exit outcomes, and park mechanics (including the `integrity_tampered` ledger array and the merged-PR park comment) are all the gateway's — see obligation 5.

## Per-issue evidence verify (obligation 6 — placement here)

For `scope: member`, park only that member on failure. Siblings keep running and the wave keeps launching. On agreement, append any returned `evidence_persisted` through the re-baseline sequence before reconciling the token (obligation 6).

## Merge above the cut (obligation 7 — placement here)

A clean build returns `pr-ready`, not `shipped` — the merge no longer runs in the lane. For each `pr-ready` member, **after** the obligation-5 run-grain verify and the obligation-6 verify have passed for it, this executor runs the merge locus against the dispatcher-verified `ac-checklist.json` / `review-verdict.json`, **inside the _Rebase-before-merge_ serialisation above** (one member merges at a time under the merge lock, re-validated on the rebased head, with obligation 7's pre-merge re-verify in step 2): assert the floor, run the ADR/PRDR-collision guard, invoke `slots.ship` (`--pr`/`--issue`/`--run-dir`/`--level`) and route its `faff-contract:delivery-outcome`, and on `shipped` run the post-merge tail — then record the resulting `shipped` / `pr-open` / `parked` bucket. Any other returned token records as today, no merge. The floor, the routing, the ship handoff, and the fixed bucket completion are all the gateway's — see obligation 7.

## Rules

- Honours all seven slot-contract obligations (the gateway → **Mechanism slots** → _The `concurrency` slot contract_) — concurrency changes *ordering and isolation*, never *whether* the merge gate runs.
- The merge gate (AC + CI-green + review `pass`, **plus the L4 per-issue holdout `meets-spec` under the lights-out signal** — obligation-4) is never weakened; rebase-before-merge only *adds* a re-validation, it never removes one.
- Never run two builds in the same worktree. Never exceed `concurrency_max`. Never merge on pre-rebase green.
- Sequencing/holding a build for a free slot is **not** a park — it's scheduling. Every partition member still builds.
- Fleet member supervision never interrupts a genuinely live subagent — a member-park acts only at a confirmed member boundary (dead liveness or a returned slot), never mid-flight. It adds no new shared-mutable write surface (every `heartbeat.<issue>` file is single-writer) and never widens a member-scoped trip into a run-wide `abort`.
- **`TerminalToken` stays `{ issue, outcome, pr }` — no token/spend field, ever**, on any member of any concurrency slot. A build subagent never measures its own token spend (its worktree cwd would mis-resolve the transcript root, and an in-subagent measure would return the whole-run cumulative, not its delta) and never writes `events.jsonl` (single-writer, same as the run ledger — see `faff heartbeat`'s single-writer note above). The orchestrator alone emits `issue-outcome --tokens` per returning member, pinned to the run's `measure_root` + session id, so per-subagent four-class spend is captured without adding a second writer.
