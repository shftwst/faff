# Local `faff gates run` UNIT rung: shard the whole-suite run so it fits a foreground turn

> Spec: faffter-dark-nlspec · 2026-09-13 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1002.

This spec is the buildable design for FAFF-1002, addressed to the build agent and human reviewers. It makes the local UNIT rung of `faff gates run` (and the identical re-run inside `faff post-merge-check`) complete inside a single foreground turn on a large test suite, without changing which tests run.

## 1. WHY — Problem and Principles

**The load-bearing model:** a rung is executed by one primitive, `runRung`, which runs the rung's command as a single `spawnSync` child and classifies its exit as pass/fail/errored. When that command is faff's own whole `node --test` suite (~4226 tests, ~500s+ in one process), the single child outlives the Bash tool's 600s foreground cap, so `faff gates run` cannot finish in one call. Sharding the run and executing the shards **concurrently** on the local machine collapses the wall-clock from the sum of the shards to roughly the slowest shard, which fits a turn.

**Problem statement:** `gates.js` `normaliseLocalRungCommand` deliberately strips `--test-shard` when deriving the local rung, so the local UNIT rung is always the unsharded whole suite in one process. On faff's own suite that process exceeds a foreground turn, so a local graft (interactive or dispatched) and `faff post-merge-check` cannot run the UNIT rung to a verdict in one call. This change executes the local UNIT rung as N concurrent shards so the ladder completes within a turn while still running every test.

**Design principles:**

- **No change to which tests run.** The set of tests executed by the local UNIT rung is identical before and after — only *how* the run is partitioned across processes changes. A rung's pass/fail/errored verdict must mean exactly what it means today.
- **Wall-clock, not total-work, is the constraint.** The turn cap is a wall-clock ceiling. Any design whose wall-clock is the *sum* of shard times (i.e. sequential) does not solve the problem and must be rejected — see the Design Decision Rationale.
- **Centralise at the one execution primitive.** Both consumers (graft Step 7.5 via `runLadder`, and `faff post-merge-check` via a direct `runRung` call) must benefit without a per-call-site edit. The behaviour change belongs at `runRung`, gated on the command being shard-capable, so every other rung stays byte-identical.
- **Fail-safe classification is sacred.** The existing distinctions — `timed-out`, `stdout-overflow`, `127`/spawn-error → `errored`; a non-zero exit → `fail`; `0` → `pass` — are what keep the gate honest (FAFF-984, FAFF-981). The sharded aggregate must preserve every one of them, never collapse an errored shard into a pass.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/gates.js` — `runRung` | Node CLI | The single rung-execution primitive this change makes shard-aware |
| `plugin/skills/faff/bin/lib/gates.js` — `normaliseLocalRungCommand` | Node CLI | Strips CI `--test-shard`; the symmetric point where the local shard is re-derived |
| `plugin/skills/faff/bin/lib/gates.js` — `readGatesConfig` | Node CLI | Where `gates.*` knobs (e.g. `rung_timeout_ms`, `max_rungs_per_kind`) are resolved; the new `gates.local_shards` override lives here |
| `plugin/skills/faff/bin/lib/post-merge.js` — `verifyPostMerge` | Node CLI | The second consumer; calls `runRung(unitRung, tmp)` directly against a merge-sha worktree |
| `.github/workflows/validate.yml` — `unit` job | YAML | The CI 4-way shard matrix (`--test-shard=${{ matrix.shard }}/4`) whose local counterpart this change adds |

**Scope statement:** this sits entirely inside the local gate-ladder execution path — the runnable UNIT rung and its two consumers — and touches no CI behaviour, no discovery/reporting resolver, and no verdict contract.

## 2. OUT OF SCOPE

- **CI-side sharding** — Why excluded: already delivered by FAFF-987 (the `unit` matrix in `validate.yml`); this ticket is the local counterpart only. Extension point: `.github/workflows/validate.yml`.
- **The rung-timeout classification / `rung_timeout_ms` default** — Why excluded: FAFF-984 already raised the per-rung `spawnSync` timeout to 30 min and added the `timed-out` reason; that is orthogonal (it governs when a *single* child is killed, not the foreground-turn cap). Extension point: `readGatesConfig` / `runRung` timeout branch.
- **Discovery / reporting resolvers** (`discoverRungsReporting`, `discoverCiWorkflowsRunnable`, coverage/partial classification) — Why excluded: this changes only how a resolved rung is *executed*, not how rungs are discovered, deduped, capped, or reported. Extension point: `selectRunnableRungs`.
- **Sharding non-`node --test` rungs** (lint/static/type) — Why excluded: those commands have no `--test-shard` facility and are already fast; sharding is meaningless for them. Extension point: the shard-capability predicate in `runRung`.
- **Coverage capture across local shards** — Why excluded: the local rung captures no coverage (that is a CI-only concern via `NODE_V8_COVERAGE`); merging per-shard coverage locally is unneeded. Extension point: a future local-coverage rung.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| shard-capable command | A rung command that is a Node test invocation (`node … --test`) carrying **no** explicit `--test-shard` token — the only command class Node can partition with `--test-shard=<i>/<N>` |
| local shard count (N) | The number of shards the local UNIT rung is split into and the max concurrency it runs at; derived from `os.availableParallelism()`, overridable by `gates.local_shards` |
| aggregate rung result | The single `RungResult` synthesised from N per-shard results, presented to callers exactly as a one-process rung result is today |

**Type definitions:**

```
RECORD RungResult:            # unchanged public shape — callers already consume this
  kind: string               # e.g. "UNIT"
  name: string
  command: string            # the LOGICAL rung command (unsharded form), not a per-shard command
  status: "pass" | "fail" | "errored"
  duration_ms: int           # WALL-CLOCK of the aggregate (≈ slowest shard), not the sum
  detail: string             # bounded tail; for a sharded run, a bounded digest across shards
  reason?: "timed-out" | "stdout-overflow"   # preserved from the per-shard results (see aggregation)

RECORD ShardPlan:
  n: int                     # number of shards == max concurrency (single wave when host cores >= n)
  commands: List<string>     # command with `--test-shard=<i>/<n>` appended, i in 1..n

CONFIG gates.local_shards:   # optional; default = os.availableParallelism()
  int >= 2                   # a present value < 2 or non-integer is ignored (falls back to the default)
```

**Config surface:** one new optional knob `gates.local_shards`, resolved in `readGatesConfig` alongside the existing `rung_timeout_ms` / `max_rungs_per_kind` guards, defaulting to `os.availableParallelism()`. Absent/malformed → default. This mirrors the existing "present-ness guard before coercion" idiom in `readGatesConfig` (an unset key must not coerce to a spurious `0`).

**Shard-capability predicate (the trigger):** a rung is sharded iff its command matches a `node … --test` invocation with no existing `--test-shard`. Every other command runs exactly as today. This is deterministic from the command string — no timing measurement, no size heuristic.

## 4. HOW — Behavior

**Architecture and approach.** `runRung` becomes shard-aware. On entry it tests the command for shard-capability. If not shard-capable, it runs the existing single-`spawnSync` path unchanged (byte-identical — this is what keeps the selftests and every non-UNIT rung stable). If shard-capable, it resolves N, builds the ShardPlan, runs the N shard commands **bounded-parallel** (concurrency = N, so a host with ≥ N cores runs them in one wave), then folds the per-shard results into one aggregate RungResult. Because the change is centralised here, `runLadder` (graft Step 7.5) and `verifyPostMerge` (`faff post-merge-check`) both inherit it with no call-site change.

**Behaviour summary:** split the whole-suite UNIT rung into N file-partitioned shards, run them at once, and report a single rung result whose wall-clock is the slowest shard rather than the sum.

```
PROCEDURE runRung(rung, root):
  1. cfg := readGatesConfig(root)      # includes rung_timeout_ms and local_shards
  2. IF NOT shard_capable(rung.command):
       return run_single(rung, root, cfg)          # today's exact path, unchanged
  3. n := cfg.local_shards               # default os.availableParallelism()
     IF n <= 1: return run_single(rung, root, cfg) # 1-core host: no benefit, fall back to today
  4. plan := [ rung.command + " --test-shard=" + i + "/" + n  for i in 1..n ]
  5. started := now()
     results := run_bounded_parallel(plan, root, concurrency=n, timeout=cfg.rung_timeout_ms)
       # each shard is a spawn child classified by the SAME rules as run_single:
       #   ETIMEDOUT / bare-signal -> errored, reason "timed-out"
       #   ENOBUFS                 -> errored, reason "stdout-overflow"
       #   error || exit 127       -> errored
       #   exit 0                  -> pass ; else fail
  6. return aggregate(rung, results, wall_ms = now() - started)

PROCEDURE aggregate(rung, results, wall_ms):
  1. status precedence (worst-wins, preserving fail-fast meaning at the rung level):
       IF any shard "errored" -> aggregate "errored" (carry the first shard's `reason` if present)
       ELSE IF any shard "fail" -> aggregate "fail"
       ELSE -> aggregate "pass"
  2. duration_ms := wall_ms                          # slowest shard, NOT the sum
  3. command := rung.command                         # the logical unsharded command
  4. detail := bounded digest — for each non-pass shard, "shard i/n: <tail>", capped to the
       existing ~500-char tail budget (per-shard tails truncated so the aggregate stays bounded)
  5. return { kind, name, command, status, duration_ms, detail, reason? }
```

**Ordering / precedence note (errored vs fail).** The aggregate is **errored-wins-over-fail**: an errored shard means "could not conclude" and must not be masked by a sibling shard's clean fail (mirrors `runLadder`, where an errored rung → `needs-human` rather than a gated `fail`). Within a single process today, one command yields one status; across shards the worst status wins, with errored the worst because it is the least-conclusive.

**Edge cases and error handling:**

- **Host with fewer cores than shards.** Concurrency is capped at N and N == shard count, so on a ≥ N-core host it is one wave; on a host with C < N cores, `run_bounded_parallel` still caps concurrency at N but the OS schedules C at a time — wall-clock rises toward (N/C) × shard, still well under the sum. No correctness impact.
- **1-core host (`availableParallelism()` == 1).** Fall back to the single-process path (step 3) — sharding into 1 is a no-op and 2 sequential shards would reintroduce the sum. Byte-identical to today on such a host.
- **A shard times out or overflows.** Classified per-shard exactly as the single path does, then surfaced as an errored aggregate carrying that `reason` — never silently dropped.
- **`--test-shard` already present.** Not shard-capable by the predicate (the command already carries a shard) → single path. This cannot arise for the *local* rung today because `normaliseLocalRungCommand` strips it upstream, but the predicate is defensive.
- **A non-UNIT `node` command that isn't `--test`.** Not shard-capable → single path.

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure:** concurrent same-host shards contend for shared ambient state (a fixed port, `/tmp`, `~/.faff`, cwd) and flake when run together though they pass one-at-a-time. Unlike CI, where each shard is its own runner with its own filesystem, local shards share one filesystem. **How you'd know:** the sharded local rung reports `fail`/`errored` while both an unsharded local run and the green CI 4-way matrix pass; re-running flips the result. **What it means:** narrow — the suite has cross-shard contention on a shared host that the CI-per-runner model hid; fix isolation (the `hermetic-env` preload is the existing seam — see Assumptions) rather than abandoning parallelism.
- **The failure:** wall-clock still exceeds the turn on a low-core host with a very large suite. **How you'd know:** `runRung` for the UNIT rung still approaches the timeout on a 2-core box. **What it means:** proceed — the `gates.local_shards` override lets an operator raise N above the core count (more, smaller shards still cap concurrency at N but each shard is shorter); the design does not claim to fix a suite larger than any turn can hold.

**Anti-pattern:** running the shards sequentially inside one `runRung` call. Why: the wall-clock is then the *sum* of shard times (≈ the whole-suite time), so it still blows the 600s foreground cap — it does not solve the ticket.
**Anti-pattern:** rewriting the shard status into the aggregate by "most common" or "last wins". Why: it can mask an errored/failed shard behind passing siblings, breaking the honest-verdict floor.

## 5. SCENARIOS — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given faff's own whole `node --test` UNIT rung (~500s+ in one process)
When `faff gates run` executes it on a host with >= N cores
Then the UNIT rung completes to a pass/fail/errored verdict with a wall-clock ≈ the slowest shard (well under the 600s foreground cap), and the ladder returns a single quality-gates signal
```

```
Given a UNIT rung split into N local shards where exactly one shard exits non-zero (a real test failure)
When the shards are aggregated
Then the aggregate rung status is `fail` (a passing sibling shard never masks it)
```

- A non-shard-capable rung (lint/static, or `true`/`sleep` in the selftests) MUST run through the unchanged single-`spawnSync` path and yield a byte-identical `RungResult` to today.
- `os.availableParallelism()` == 1 MUST fall back to the single-process path (no sharding).

## 6. DESIGN DECISION RATIONALE

**Sequential shards vs bounded-parallel shards?**
- *Sequential:* simplest process management, but wall-clock ≈ sum of shard times. The evidence has the whole suite at ~500s+ and four manual shards at 116–213s each, so the sum ≈ the whole-suite time — still over the 600s cap. It does **not** achieve the ticket's goal.
- *Bounded-parallel:* wall-clock ≈ slowest shard (≈ whole/N on a host with N cores), which fits the turn. Requires spawning N children and awaiting all (async), a moderate complexity bump.
- **Chosen:** bounded-parallel. Rationale: the stated definition of done ("fit a foreground turn") is a wall-clock constraint that sequential provably cannot meet on faff's own suite — this is a correctness fact, not a taste preference. The extra process-management complexity is the price of actually solving the problem.

**How is the shard count N derived?**
- Options: a hardcoded 4 (matching CI); `os.availableParallelism()`; a config knob.
- **Chosen:** `N = os.availableParallelism()`, overridable by an optional `gates.local_shards` (int ≥ 2, default = `availableParallelism()`), clamped so `N <= 1` falls back to the single path. Rationale: `availableParallelism()` matches CI's own "N = 4 matches the 4-vCPU runner" reasoning while adapting to the actual dev box; the config knob follows the existing `gates.*` override pattern (`rung_timeout_ms`, `max_rungs_per_kind`) and is the escape hatch named in the low-core failure mode. A hardcoded 4 over-shards a 2-core box and under-shards a 16-core one.

**Always-on, or gated on a size/time threshold?**
- A time/size threshold would require running or measuring the suite first (chicken-and-egg) and adds a heuristic knob.
- **Chosen:** always-on for shard-capable commands (a `node … --test` rung with no existing `--test-shard`); no threshold. Rationale: shard-capability is deterministic from the command string and cheap to test; the only cost on a small suite is a few extra `node` process spawns (negligible), whereas a threshold needs a measurement the gate does not have up front. Non-shard-capable rungs are untouched.

**Where does the behaviour live — `runRung`, or each consumer?**
- **Chosen:** make `runRung` shard-aware, gated on the shard-capability predicate. Rationale: both consumers (`runLadder` for graft Step 7.5, and `verifyPostMerge` for `post-merge-check`) call `runRung`, so centralising fixes both with no call-site change, and the predicate keeps every non-`node --test` rung — including the selftests' `true`/`sleep 5`/missing-command rungs — byte-identical, preserving the existing `runRung` tests.

**Re-adding a shard flag that `normaliseLocalRungCommand` strips — isn't that circular?**
- **Chosen:** yes, and deliberately so — `normaliseLocalRungCommand` strips the *CI* shard (an unexpanded `${{ matrix.shard }}` that is not runnable locally); the executor then re-derives a *local* shard sized to this host. The two are symmetric: strip the un-runnable CI shard at discovery, add a runnable local shard at execution. Rationale: keeps discovery host-agnostic and confines host-specific sharding to the execution primitive.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — both open questions in the ticket resolve to Chosen decisions above (bounded-parallel is required by the wall-clock constraint; always-on is chosen over a threshold that would need an up-front measurement).

**Assumptions:**

- **Assumes:** `test/hermetic-env.mjs` (the `--import` preload the UNIT command already carries) isolates each shard process's ambient state well enough to run the shards **concurrently on one host**. The suite already runs as 4 parallel shards on separate CI runners; the new axis is shared-filesystem concurrency on a single box. *Validation before build-complete:* run the sharded local rung and an unsharded local run back-to-back (and against the green CI matrix); if the sharded run flakes where the unsharded run is green, the isolation is insufficient and must be fixed (or `gates.local_shards` documented as requiring an isolated tmp per shard) before this is considered done.

## 8. DONE — Definition of Done

### From WHY
- [ ] `faff gates run` on faff's own repo completes the UNIT rung to a verdict within a single foreground turn (wall-clock < 600s) on a host with ≥ 2 cores.
- [ ] The exact set of tests run by the local UNIT rung is unchanged (same suite, only partitioned across processes).

### From WHAT (types and interfaces)
- [ ] `runRung` returns the same `RungResult` shape for a sharded run as for a single run; `command` is the logical unsharded command and `duration_ms` is wall-clock (≈ slowest shard), not the sum.
- [ ] `gates.local_shards` is read in `readGatesConfig` with the present-ness-before-coerce guard; absent/malformed/`< 2` → default `os.availableParallelism()`.
- [ ] The shard-capability predicate matches `node … --test` with no existing `--test-shard`, and nothing else.

### From HOW (behaviour)
- [ ] A shard-capable UNIT rung runs N shards bounded-parallel at concurrency N; a non-shard-capable rung runs the unchanged single-`spawnSync` path (byte-identical result).
- [ ] `os.availableParallelism()` == 1 falls back to the single-process path.
- [ ] Aggregation is worst-wins: any errored shard → aggregate `errored` (carrying its `reason`); else any fail → `fail`; else `pass`.
- [ ] Both consumers benefit without a call-site change: `runLadder` (graft Step 7.5) and `verifyPostMerge` (`post-merge-check`) run the UNIT rung sharded.

### From HOW (edge cases)
- [ ] A timed-out shard surfaces as an errored aggregate with `reason: "timed-out"`; a stdout-overflow shard as errored with `reason: "stdout-overflow"`.
- [ ] The aggregate `detail` is bounded (per-shard tails truncated so the aggregate stays within the existing ~500-char budget).

### From Assumptions
- [ ] The hermetic-isolation assumption is validated (sharded vs unsharded local run compared for flakiness) and any contention fixed before completion.

**Integration smoke test:**

```
PROCEDURE smoke:
  1. In a faff checkout on a >=2-core host, run `faff gates run --json`.
  2. Assert: the UNIT rung entry has status pass, duration_ms well under 600000, and the ladder
     signal is a single quality-gates value.
  3. Introduce one deliberately failing test in one shard's partition; re-run.
  4. Assert: the UNIT rung aggregate status is `fail` (a passing sibling shard did not mask it).
```

confidence: high
spec-review: approve
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```

## Already shipped against this surface

Related but **not** superseding — the premise (local UNIT rung is a >600s monolith that exceeds a foreground turn) still holds:

- **FAFF-987** (Done) — sharded the suite 4-way *on CI only*; its own `normaliseLocalRungCommand` deliberately strips the shard for the local rung, which is precisely the gap this ticket closes.
- **FAFF-984** (Done) — fixed the CI-side rung-timeout *classification* and raised `rung_timeout_ms` to 30 min; orthogonal (governs when one child is killed, not the foreground-turn cap).
- **FAFF-981** (Done) — fixed the `spawnSync` maxBuffer overflow misclassification; the aggregation here preserves that `stdout-overflow` reason.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** No issues. One cohesive change to a single primitive (`runRung`) plus its config resolver and the two consumers that already call it — a single 1–3 day unit. No two independent concerns to split; no always-ships-together sibling to merge.
- **Workstream fit?** No issues. Sits squarely in the gate-ladder reliability workstream (FAFF-984 / FAFF-981 / FAFF-849 / FAFF-639 family), with a clear outcome: the local gate ladder completes within a foreground turn.
- **Deps surfaced?** No open dependency. The precedent it builds on (FAFF-987's `normaliseLocalRungCommand`, FAFF-984's `rung_timeout_ms`) is already Done, so there is no implicit unlinked blocker. Adjacent "fit a foreground turn" work exists (FAFF-1035 CI wall-clock bound — Todo; FAFF-985 adversarial-review turn window — Backlog) but neither blocks nor is blocked by this.
- **Risk profile?** Surfaced, contained. The one real risk is same-host shard concurrency (a new axis vs CI's per-runner model) contending on shared filesystem/ambient state. It is bounded by the `**Assumes:**` on `test/hermetic-env.mjs` plus its named validation step; the isolation seam already exists, so no de-risking spike is warranted — proceed with the validation gate in DONE.
