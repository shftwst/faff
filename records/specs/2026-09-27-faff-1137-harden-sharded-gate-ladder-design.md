# FAFF-1137 — Harden the sharded gate ladder against local oversubscription starvation

> Spec: faffter-dark-nlspec · 2026-09-27 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-1137.

This is the buildable spec for FAFF-1137. Its audience is the build agent that will implement the change and the human reviewers who gate it. It covers the general robustness of `faff gates run`'s sharded UNIT rung so that adding any resource-heavy (e.g. docker) test stops producing spurious local REDs. The FAFF-1107-file-specific probe fix is a **separate** ticket (FAFF-1138) and is out of scope here.

## 1. WHY — Problem and Principles

**The model this turns on.** `faff gates run` executes the local UNIT rung by splitting `node --test` into N shards and running all N concurrently, where N defaults to the host core count. On an 8-core box that means 8 `node --test` processes saturating every core at once. A shard whose tests spawn heavy child work (a docker build/run, or a test that itself spawns several CLI subprocesses) pushes the box past saturation, and any test whose pass/fail turns on wall-clock timing — a detached poller that must tick on a 1s cadence, a test that spawns four real subprocesses — loses its CPU slice and fails. It is a scheduling artefact of the sharded run, not a code defect: the same tests pass in isolation, pass unsharded, and pass on CI (CI disables docker on unit shards).

**Problem statement.** Adding FAFF-1107's docker-heavy real-container test to the suite makes two pre-existing timing-fragile tests (`decline-parity.test.mjs`, `sentry-poller.test.mjs`) flip to spurious RED under the sharded local ladder purely from CPU/IO starvation. faff is built with faff, so every adopter who adds a resource-heavy test to the sharded ladder hits the same false RED. This change makes the two fragile tests immune to starvation and reduces the starvation pressure the sharded ladder puts on every test, so a resource-heavy test no longer reds the ladder.

**Design principles.**

**The fix must degrade by default, not behind an operator flag.** faff's own memory bars a manual operator workaround for an automation gap. A new knob whose default reproduces today's oversubscription would leave every adopter hitting the RED until they discover the knob. The default behaviour must itself leave scheduling headroom; the knob only tunes it.

**Test-level hardening is the guarantee; the ladder guard is pressure relief.** The two named tests are made robust so they pass no matter how starved the box is — that is the actual correctness guarantee. The shard-concurrency headroom reduces starvation for the tests we cannot hand-harden (an adopter's own tests), but it is a mitigation, not a promise. The two must not be conflated: shipping only the guard would leave the fragile tests on the edge.

**Preserve the FAFF-987 speed intent.** The sharding exists to fit a >600s whole-suite run into a foreground turn. The guard must not serialise the ladder; it caps concurrency just below saturation, keeping near-single-wave execution.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/gates.js` | Node (JS) | The whole gate ladder; `runShardedRung`, `readGatesConfig`, `safeAvailableParallelism`, `runRung`, `gatesSelftest` all live here |
| `test/sentry-poller.test.mjs` | Node test | Fragile test 1 — fixed "nothing happened" sleeps at ~line 320 and ~line 419 race the detached poller's tick cadence |
| `test/decline-parity.test.mjs` | Node test | Fragile test 2 — `run()` (~line 29) spawns real CLI subprocesses with no timeout; 4+ spawns per test |
| `test/holdout-rpc-evaluate-integration.test.mjs` | Node test | The docker-heavy test whose addition surfaced the starvation (FAFF-1107); its `probeDocker()` at module top level is FAFF-1138's concern, not this ticket's |

**Scope statement.** This sits in the local execution path of `faff gates run` (`runShardedRung` and its config) plus the two fragile test files; it does not touch discovery, CI workflows, or the contract boundary.

## 2. OUT OF SCOPE

- **FAFF-1107's top-level docker probe (`probeDocker()` at module load).** Why excluded: making that one file's build/run legs lazy, plus its teardown/fixed-port/inert-assertion nits, is FAFF-1138's file-specific hardening. Extension point: `test/holdout-rpc-evaluate-integration.test.mjs` lines ~87-101, owned by FAFF-1138 (related, tracked separately).
- **A `faff validate-adapters`-style lint for docker-gated test probes.** Why excluded: `validate-adapters` lints `SKILL.md` prose; a test-probe linter is a different mechanism and a larger unit than this 1-2 day change. Extension point: a follow-up ticket adding a test-authoring linter; the convention doc this ticket ships (below) is the spec such a lint would encode.
- **A dedicated serial "docker rung" lane in `gates.js`.** Why excluded: a new rung-scheduling mechanism (a per-kind resource budget or serial lane) is the most invasive option and is not needed once concurrency headroom plus test hardening land. Extension point: `runLadder`/`runRung` in `gates.js` if a future ticket proves the headroom insufficient.
- **CI shard behaviour.** Why excluded: CI already disables docker on unit shards (dead `DOCKER_HOST`) and is green; the fault is local-only. Extension point: `.github/workflows/validate.yml` unit matrix, unchanged here.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| shard count | N — how many partitions `node --test` is split into (`gates.local_shards`, default = host parallelism) |
| shard concurrency | how many of those N shards run at the same time; today implicitly equals N |
| progress anchor | an observable side-effect (a log line the poller writes each tick) that a test waits on instead of a fixed wall-clock sleep |
| transient spawn failure | a fork that fails with `EAGAIN`/`ENOMEM` because the process table is momentarily exhausted, not because the command is wrong |

**New config knob** (resolved in `readGatesConfig`, same present-ness-before-coerce idiom as the existing `gates.local_shards`):

```
gates.local_shard_concurrency: Integer   # optional; max shards run at once
  CONSTRAINT >= 1 (else falls back to default)
  DEFAULT = max(2, local_shards - 1)      # leave one core of scheduling headroom
```

**Config resolution behaviour.**

```
RECORD GatesConfig (added field):
  local_shard_concurrency: Integer   # >=1; == local_shards means single-wave (today's behaviour)
```

- Absent / non-numeric / < 1 → default `max(2, local_shards - 1)`.
- Present and >= 1 → honoured verbatim (an operator may set it equal to `local_shards` to opt back into full-width single-wave, or lower it further on a docker-saturating box).
- When the effective concurrency >= N, `runShardedRung` runs a single wave — byte-identical scheduling to today.

**Design decision — the general guard mechanism.** Options for making the ladder degrade gracefully:

| Option | Pro | Con |
|---|---|---|
| Cap shard *concurrency* below N (bounded pool) | Keeps N-way partition balance; pure scheduling change; single localised edit to `runShardedRung` | Slowest shards may run in a second wave (small wall-clock cost) |
| Lower the default shard *count* | Fewer processes and single wave | Changes partition balance; coarser test distribution |
| Docker-awareness / detect heavy tests | Targeted | Heuristic, fragile, needs to inspect test bodies |
| Serial docker rung lane | Fully isolates docker | New mechanism, most invasive (out of scope above) |

**Chosen:** Cap shard concurrency below N via a bounded worker pool in `runShardedRung`. It preserves the FAFF-987 partition balance and speed intent, is a localised scheduling change, and gives the smallest safe default headroom.

**Design decision — the concurrency default value.**

**Chosen:** `max(2, local_shards - 1)` — reserve exactly one core. Rationale: one reserved core restores schedulability for the co-running detached poller and for a test's helper subprocesses at near-zero wall-clock cost (only the single slowest shard can spill into a brief second wave), while the test-level hardening is what actually guarantees no spurious RED regardless of headroom. A more aggressive reserve (e.g. 25%) would slow every local run for a problem the test hardening already closes.

## 4. HOW — Behaviour

### The bounded shard pool

`runShardedRung` today builds all N shard promises and awaits `Promise.all`, so concurrency equals N. Replace the unbounded fan-out with a fixed-size worker pool; everything downstream (`classifyRungResult`, `aggregateShardResults`, worst-wins folding, the wall-clock `duration_ms`, the logical unsharded `command` on the result) is unchanged — only how many shards are in flight at once changes.

```
PROCEDURE runShardedRung(rung, root, rung_timeout_ms, n, concurrency):
  1. started = now()
  2. Build the work list: shard indices 1..n, each producing
     spawnAsync(`${rung.command} --test-shard=${i}/${n}`, …) then classifyRungResult
  3. Run the work list through a pool of size min(concurrency, n):
     - keep at most `concurrency` shards running at once
     - as each finishes, start the next pending shard
     - collect { index, ...classified } for every shard (order preserved by index)
  4. RETURN aggregateShardResults(rung, shardResults, n, now() - started)
```

- `runRung` resolves `concurrency` from `readGatesConfig` alongside `local_shards` and passes it in.
- When `concurrency >= n`, the pool degenerates to a single wave — the current code path's behaviour, preserved.
- **`runShardedRung` is exported** (`gates.js:~1904`), so its new `concurrency` parameter MUST default to single-wave (`concurrency` absent / non-numeric / `< 1` → treat as `n`) — an external caller that omits it is byte-identical to today, never broken.
- **Order preserved by index** is required, not incidental: `aggregateShardResults` reports the *first errored shard's reason in index order* (the `gatesSelftest` case confirms this), so the pool must collect results keyed by shard index and fold in index order — a completion-order fold would silently change which reason surfaces.
- `aggregateShardResults` is untouched: still N results, still worst-wins (`errored > fail > pass`), still wall-clock `duration_ms`. **Every one of the N shards is awaited and collected before folding** — the pool never resolves while a shard is still pending, so a later-wave shard's RED can never be dropped (the fail-open the QA selftest below pins).

**Anti-pattern:** reducing `local_shards` itself to cut concurrency. Why: that changes how `node --test` partitions the suite (test balance), not just how many run at once — the two concerns must stay separate.

### Fragile test 1 — `sentry-poller.test.mjs`

Two tests assert "let ticks elapse, then confirm the poller tripped *advisory* (logged `advisory-trip`) and did NOT abort (ledger byte-identical, no `abort-actioned`)". They do it with `await waitUntil(() => false, { timeoutMs: 3000, intervalMs: 3000 })` — a fixed 3s "nothing happened" sleep (~line 320, ~line 419). Under starvation the detached poller (two `spawnSync` children per 1s tick) may not tick even once in 3s, so `advisory-trip` is absent and the assertion at ~line 325 / ~424 fails.

**Behaviour summary:** wait on a positive progress signal (the poller has demonstrably ticked at least once) before checking the negative invariant, instead of sleeping a fixed window and hoping a tick happened.

```
PROCEDURE assert_advisory_no_abort(runDir, before):
  1. tripped = waitUntil(() => log(runDir).includes("advisory-trip"),
                         { timeoutMs: ADVISORY_TRIP_BUDGET_MS })
  2. assert tripped                              # the poller ran its decision at least once
  3. assert run-ledger.json bytes == before      # no abort mutated the ledger
  4. assert log does NOT include "abort-actioned"
  5. assert pidAliveProbe(startedPid)            # non-L4 poller keeps polling
```

- Add a named budget `ADVISORY_TRIP_BUDGET_MS`, sized like the existing FAFF-635 constants (`ABORT_LANDING_BUDGET_MS = 30000`, `POLLER_EXIT_BUDGET_MS = 20000`) for a CPU-contended box. `waitUntil` returns the instant the predicate is true, so a healthy run pays nothing.
- This is strictly stronger than the fixed sleep: a *real* abort regression still fails the test — an abort mutates the ledger (step 3 fails) and `advisory-trip` never appears (step 1 times out, step 2 fails). "Nothing happened" is verified at a point where the poller is *known* to have executed its trip decision, not at an arbitrary wall-clock offset.

**Anti-pattern:** scaling the fixed sleep up (e.g. to 30s). Why: it makes every healthy run pay the full window and still races on a sufficiently starved box — the absence of a progress anchor is the defect, not the window size.

### Fragile test 2 — `decline-parity.test.mjs`

`run()` (~line 29) is `execFileSync("node", [CLI, ...])` with no timeout; `declineSequence()` chains three CLI spawns plus a real `git init` per test. Under an oversubscribed process table a fork can fail transiently (`EAGAIN`/`ENOMEM`), erroring the subprocess and failing the assertion; a genuinely wedged child would also hang the shard with no timeout to cut it.

**Behaviour summary:** make each CLI spawn survive a transient fork failure, and cut a wedged child fast with a generous timeout rather than hanging the shard.

```
PROCEDURE run(args, root):
  1. attempt = 0
  2. LOOP:
     a. res = execFileSync("node", [CLI, ...args],
                { cwd: root, timeout: CLI_SPAWN_BUDGET_MS, maxBuffer: <ample> })
     b. IF spawn error code in { EAGAIN, ENOMEM } AND attempt < MAX_SPAWN_RETRIES:
          attempt += 1; short backoff; CONTINUE      # transient process-table exhaustion
     c. RETURN / re-throw as today (allowFail semantics unchanged)
```

- `CLI_SPAWN_BUDGET_MS`: a generous, contention-scaled ceiling (align with the FAFF-635 sizing rationale) — its job is to fail *fast and diagnostically* on a wedged child, not to bound a healthy run.
- `MAX_SPAWN_RETRIES`: small bounded count (e.g. 2-3) with a short backoff; retries only on the transient fork-failure codes, never on a real non-zero CLI exit (that still surfaces exactly as today, honouring `allowFail`).
- Preserve `run()`'s existing return/throw contract so the assertions and `allowFail` callers are unaffected.

### Failure modes

- **The failure:** the reserve-one-core default is insufficient — a docker build that saturates all cores still starves co-running shards.
  **How you'd know:** an adopter's timing-fragile test still reds under the sharded ladder after this change, but goes green when `gates.local_shard_concurrency` is set lower.
  **What it means:** proceed — the operator knob absorbs it, and the two named tests stay green regardless because their hardening (progress anchor, spawn retry) does not depend on headroom. This is why the guard is framed as pressure relief, not the guarantee.

- **The failure:** the `decline-parity` RED is not transient fork-exhaustion but a genuine logic race, so the `EAGAIN`/`ENOMEM` retry never triggers.
  **How you'd know:** under a reproduced starved run the retry path is never taken (no `EAGAIN`/`ENOMEM` observed) yet the test still fails deterministically.
  **What it means:** narrow — the concurrency headroom plus the generous timeout become the operative fix for this file, and the retry is harmless dead-weight to remove; re-open with the observed error signature.

- **The failure:** `CLI_SPAWN_BUDGET_MS` is set too tight, so under extreme starvation a healthy-but-slow child is killed by the timeout — trading a fork-starvation RED for a timeout RED.
  **How you'd know:** the retry path is not taken (no `EAGAIN`/`ENOMEM`) but `run()` fails with a timeout-kill signature rather than a real non-zero CLI exit.
  **What it means:** the budget is sized to fail *fast and diagnostically* on a genuinely wedged child, not to bound a healthy run — size it against the FAFF-635 contention rationale (generous), and if it misfires, raise it; a timeout that only ever fires on a real hang is correct, one that fires on a merely-slow child is too tight.

## Scenarios

```
Given a host where gates.local_shards resolves to 8 and gates.local_shard_concurrency is unset
When faff gates run executes the shard-capable UNIT rung
Then at most 7 node --test shards are in flight at once, and the aggregate RungResult is one worst-wins result over all 8 shards
```

```
Given gates.local_shard_concurrency is set >= gates.local_shards
When the sharded UNIT rung runs
Then all shards run in a single wave (scheduling identical to the pre-change Promise.all path)
```

```
Given a CPU-starved box where the detached L3 poller ticks slower than a fixed 3s window
When the attended-L3 stale-heartbeat test runs
Then the test waits on the advisory-trip progress signal and passes, asserting the ledger is byte-identical and no abort-actioned was logged
```

- The sharded UNIT rung's aggregate status MUST remain worst-wins (`errored > fail > pass`) and its `command` MUST remain the logical unsharded form after the pool change.
- A transient `EAGAIN`/`ENOMEM` fork failure in `decline-parity`'s `run()` MUST be retried (bounded); a real non-zero CLI exit MUST NOT be retried.

## 5. DESIGN DECISION RATIONALE

**How should the ladder degrade under a resource-heavy test?**
Options: cap shard concurrency (bounded pool) / lower shard count / docker-awareness / serial docker lane. Concurrency cap keeps partition balance and is the least invasive scheduling change; lowering the count changes test distribution; docker-awareness is heuristic; a serial lane is a new mechanism.
**Chosen:** bounded worker pool in `runShardedRung` capping concurrency below N.

**What default concurrency?**
Options: equal to N (no protection — bans by the degrade-by-default principle) / reserve one core / reserve a fraction (e.g. 25%).
**Chosen:** `max(2, local_shards - 1)` — reserve one core; minimal wall-clock cost, and the test hardening carries the correctness guarantee so a larger reserve is unwarranted.

**How to make the sentry-poller "nothing happened" assertion robust?**
Options: scale the fixed sleep up / anchor on a positive progress signal then assert the negative invariant.
**Chosen:** anchor on the `advisory-trip` log line (the poller's per-tick side-effect), then assert the ledger/abort invariant — you cannot poll for absence, but you can pin the absence check to a point where the actor is known to have run.

**How to harden decline-parity's real-subprocess spawns?**
Options: leave as-is / add a timeout only / add a timeout plus bounded retry on transient fork failure.
**Chosen:** generous contention-scaled timeout (fail fast on a wedged child) plus a bounded retry on `EAGAIN`/`ENOMEM` only, preserving the existing return/throw and `allowFail` contract.

**Does FAFF-1137 ship the docker-gated-test authoring convention?**
Options: doc + lint / doc only / neither.
**Chosen:** doc only — add a short "docker-gated tests: probe cheaply at discovery, defer build/run into the gated body" convention to `docs/reference/` (a new short testing-conventions note or a section in an existing reference doc), citing FAFF-1138's lazy probe as the exemplar. The lint is a separate mechanism and a larger unit (out of scope above).

At the time of writing, `gates.js` has no hardcoded shard count (it uses `os.availableParallelism()`), no concurrency cap, and no docker-awareness; Node has no `--test-concurrency`/`--jobs` pinned anywhere in the repo.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None blocking. (The residual tuning risk of the one-core reserve and the decline-parity root-cause uncertainty are captured as Failure modes with observable signals, not deferred decisions.)

**Assumptions.**

- **Assumes:** the detached poller writes an `advisory-trip` log line on every advisory (non-acting) trip tick, as the existing assertions at ~line 325 / ~424 already rely on. Validate before starting: confirm the poller logs `advisory-trip` per trip in the sentry-poller source, so the progress anchor is a real per-tick signal and not a one-shot.
- **Assumes:** `execFileSync` surfaces a transient fork failure with an inspectable `err.code` of `EAGAIN`/`ENOMEM`. Validate before starting: confirm Node's `child_process` error shape for a fork-exhaustion failure so the retry keys on the right field.

## 7. DONE — Definition of Done

### From WHY / principles
- [ ] With `gates.local_shard_concurrency` unset, the sharded UNIT rung runs at most `max(2, local_shards - 1)` shards at once. This leaves headroom without a flag on hosts with **>=3 cores**; on a 2-core host it resolves to `max(2, 1) = 2 = N` → single wave with no headroom, and there the test hardening is the sole guarantee (consistent with the pressure-relief-not-guarantee principle). The DoD wording must not overstate headroom at the low end.

### From WHAT (config)
- [ ] `readGatesConfig` returns `local_shard_concurrency`: default `max(2, local_shards - 1)`; absent/non-numeric/<1 → default; present and >=1 → honoured — verified by `gates --selftest` cases mirroring the existing `local_shards` resolution cases.
- [ ] Setting `local_shard_concurrency >= local_shards` yields single-wave scheduling.

### From HOW (bounded pool)
- [ ] `runShardedRung` runs shards through a pool of size `min(concurrency, n)`; at most `concurrency` in flight at once.
- [ ] The exported `runShardedRung`'s new `concurrency` parameter defaults to single-wave (absent/non-numeric/<1 → treat as `n`), so an external caller omitting it is byte-identical to today.
- [ ] The aggregate RungResult is unchanged: N shard results, worst-wins status (`errored > fail > pass`), wall-clock `duration_ms`, logical unsharded `command` — verified by `gates --selftest` sharded-pass and sharded-fail cases.
- [ ] **Second-wave fail-open is proven closed:** a `gates --selftest` case with `concurrency < n` and the *failing* shard forced into a later wave still folds to `fail` (worst-wins holds across waves; a later-wave RED is never dropped). This is the pool's fail-open guard — a single-wave (`concurrency == n`) case does not exercise it.
- [ ] Shard results are collected keyed by index and folded in index order, so `aggregateShardResults`'s first-errored-in-index-order reason is preserved (a completion-order fold would change it).

### From HOW (sentry-poller)
- [ ] The two fixed `waitUntil(() => false, { timeoutMs: 3000, intervalMs: 3000 })` sites (~line 320, ~line 419) are replaced by a wait on the `advisory-trip` progress signal bounded by a new FAFF-635-sized `ADVISORY_TRIP_BUDGET_MS`.
- [ ] Both tests still fail on a real abort regression (ledger mutated OR `advisory-trip` never logged).

### From HOW (decline-parity)
- [ ] `run()`'s `execFileSync` carries a generous contention-scaled `timeout` and ample `maxBuffer`.
- [ ] A transient `EAGAIN`/`ENOMEM` fork failure is retried up to a bounded count with backoff; a real non-zero CLI exit is not retried and surfaces exactly as today (`allowFail` semantics unchanged).

### From DESIGN (convention)
- [ ] A short docker-gated-test authoring convention (probe cheaply at discovery; defer build/run into the gated body) is added under `docs/reference/`, citing FAFF-1138 as the exemplar.

### Integration smoke test
```
1. On the 8-core box, run `faff gates run` with the FAFF-1107 docker test present and gates.local_shard_concurrency unset.
2. Confirm the UNIT rung reports pass (no spurious RED from decline-parity or sentry-poller).
3. Run `faff gates --selftest` → RESULT: PASS (new local_shard_concurrency + pool cases included).
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized?** No issues. Three components — the bounded shard-concurrency pool in `gates.js`, hardening two independent test files, and a short convention doc — sit under one problem statement ("the sharded ladder spuriously REDs a resource-heavy test") and each is small: the pool change is a single-function rewrite of `runShardedRung` plus a `readGatesConfig` field mirroring the existing `local_shards` idiom, the two test fixes are self-contained edits to `sentry-poller.test.mjs` (two `waitUntil` call sites) and `decline-parity.test.mjs` (`run()`'s spawn wrapper), and the convention doc is a short new note. Total effort reads as 2-2.5 days, inside the 1-3 day band. The spec's own design principle — the test hardening is the correctness guarantee, the concurrency guard is pressure relief, and shipping only one half would be incomplete — is the right reason to keep these coupled in one ticket rather than splitting by file boundary.

**Workstream fit?** No issues. No workstream/project is assigned, and that is the correct default for a self-dogfooding friction ticket captured mid-build (via `/faff-jot` off FAFF-1107) — a standalone fix has no outcome container to join.

**Deps surfaced?** No issues. FAFF-1137 and FAFF-1138 carry a `relatedTo` link, not `blockedBy` — correct, since neither ticket's Definition of Done requires the other to land first: FAFF-1137's scope statement excludes `probeDocker()` and the file `test/holdout-rpc-evaluate-integration.test.mjs` entirely (all of FAFF-1138's four items live there), so there is no shared file or code path. This also resolves FAFF-1138's own open question (does the lazy docker probe land here or in FAFF-1137?) — the spec keeps the probe fix in FAFF-1138 and takes only the general concurrency/hardening fix here. The split is the right boundary; the two can ship in either order.

**Risk profile?** No issues — the spec's own medium self-rating is already de-risked in-ticket rather than left as residual exposure. Both flagged uncertainties have a bounded, observable fallback written into the spec itself:
- The decline-parity root cause (transient `EAGAIN`/`ENOMEM` fork failure, inferred not reproduced) is covered by an Assumptions "validate before starting" check plus a named Failure Mode: if the retry path is never exercised under a reproduced starved run, the retry becomes harmless dead weight and the concurrency headroom + timeout carry the fix instead.
- The one-core-reserve default is a tuning judgement, validated by the DoD's own Integration smoke test (run `faff gates run` on the real 8-core box with the FAFF-1107 docker test present) before the ticket closes, with a second Failure Mode naming the escape hatch (`gates.local_shard_concurrency` set lower).

A dedicated de-risking spike would duplicate work the spec already schedules inside its own Assumptions and DoD sections — no separate step is warranted.

confidence: medium
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```
