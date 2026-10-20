# FAFF-1356: Halve the local gate's default shard concurrency

> Spec: faffter-dark-nlspec · 2026-10-20 · autonomous · confidence: high. Full spec on Linear FAFF-1356.

This spec changes the default number of unit-test shards that `faff gates run` runs at once on a developer machine, and requires the build agent to prove the new default on the 8-core host where the false failures were seen.

## 1. WHY

**The load-bearing model.** The local UNIT rung splits the suite into `local_shards` partitions (default: the host's core count) and runs them through a bounded worker pool whose width is `local_shard_concurrency`. The pool width, not the partition count, decides how much CPU and process-table pressure the timing-sensitive tests see.

**Problem.** The default width is `max(2, local_shards - 1)`, which is 7 on an 8-core host. At that width 3 to 5 shards fail on every run, in lock, sentry, andon, docker-gated holdout and no-tty tests that pass in CI and pass locally at width 1. This change lowers the default to half the shard count.

**Design principles.**

- Keep partitioning and concurrency separate. Fix the pool width only; changing `local_shards` is rejected.
- Evidence over arithmetic, with an honest bound. Five passes in a row mean that a residual per-run failure probability of 0.46 or more would be seen less than 5% of the time.
- The new default ships only once five consecutive gate runs on this 8-core host pass the UNIT rung with no overlay.
- The knob stays the escape hatch. A present `gates.local_shard_concurrency >= 1` is still honoured verbatim.

## 2. OUT OF SCOPE

- Making the timing-sensitive tests tolerant of load (follow-up ticket).
- Changing the default shard count `local_shards`.
- Adaptive concurrency.
- Editing earlier specs under `records/specs/`.
- User-facing config documentation for `gates.*`.

## 3. WHAT

```
CONFIG gates.local_shard_concurrency: Integer   # optional
  DEFAULT = defaultShardConcurrency(local_shards)
  absent / non-numeric / < 1  -> DEFAULT
  present and >= 1            -> honoured verbatim (floored)

FUNCTION defaultShardConcurrency(local_shards: Integer) -> Integer:
  RETURN max(1, floor(local_shards / 2))
```

| `local_shards` | old default | new default |
|---|---|---|
| 2 | 2 | 1 |
| 3 | 2 | 1 |
| 4 | 3 | 2 |
| 8 | 7 | 4 |
| 16 | 15 | 8 |

**Decision: which default width.** Chosen: half, `floor(local_shards / 2)`. A quarter or serial is held back as the measured fallback.
**Decision: floor of the default.** Chosen: floor at 1.
**Decision: where the default lives.** Chosen: a small exported pure function `defaultShardConcurrency(local_shards)` in `gates.js`, called by `readGatesConfig`.

## 4. HOW

Replace the default expression in `readGatesConfig` with a call to the helper. Update the two comments describing the default (the `runShardedRung` header comment and the `local_shard_concurrency` block) to say "half the shard count". Update the selftest label and expected value.

```
PROCEDURE measure_default():
  1. Confirm 8 cores and `faff config get gates.local_shard_concurrency` prints nothing (exit 3).
  1b. Confirm nothing else loads the host. Record the 1-minute load average.
  1c. Control run with overlay gates.local_shard_concurrency: 7, then remove the overlay. Record UNIT status and failing test names.
  2. With the change applied and no overlay, run `faff gates run --json` five times in a row.
  3. Record each UNIT rung status, duration_ms and failing test names.
  4. IF all five pass: ship half. Record the five durations in the PR body.
  5. ELSE: fix an earlier failed rung; else retry at overlay 2 (quarter); if five of five pass, change helper to max(1, floor(local_shards / 4)) and re-measure; else stop and park with failing test names.
```

Anti-pattern: setting a local overlay during the measurement to make it pass. Anti-pattern: lowering `local_shards` instead.

Assumption: the build runs on the reference host (Linux, 8 cores via `os.availableParallelism()`, `docker info` exits 0). Otherwise take the park branch with cause "measurement host is not the reference host".

## Scenarios

```
Given a host where availableParallelism() is 8 and neither gates.local_shards nor gates.local_shard_concurrency is set
When faff gates run executes the UNIT rung
Then 8 shards run with at most 4 in flight at once, and the rung's aggregate status is the worst of all 8
```

```
Given gates.local_shard_concurrency: 7 in the config
When readGatesConfig resolves the gate config on any host
Then local_shard_concurrency is 7, regardless of the new default
```

- On this 8-core host, five consecutive unconfigured `faff gates run --json` runs MUST report the UNIT rung with status `pass`.

## 7. DONE

- [ ] On this 8-core host, with `gates.local_shard_concurrency` unset, five consecutive `faff gates run --json` runs each report a UNIT rung with status pass; the five `duration_ms` values, the control run's result and the load average are recorded in the PR body.
- [ ] If any of those runs failed, the PR body lists the failing test names and which branch of `measure_default` was taken.
- [ ] `gates.js` exports `defaultShardConcurrency`; for inputs 2, 3, 4, 8 and 16 it returns 1, 1, 2, 4 and 8, each pinned by a `gates --selftest` case.
- [ ] `readGatesConfig` with no `local_shard_concurrency` returns `defaultShardConcurrency(local_shards)`; the existing absent, non-numeric and `0` selftest cases expect that value and their labels no longer say `max(2, local_shards-1)`.
- [ ] A present `local_shard_concurrency: 7` and `local_shard_concurrency: 1` are both honoured verbatim (selftest).
- [ ] `grep -n "max(2, local_shards - 1)\|reserves one core\|reserve one core" plugin/skills/faff/bin/lib/gates.js` returns nothing.
- [ ] `runShardedRung` and `runRung` are unchanged apart from comments.
- [ ] `faff gates --selftest` prints a line starting `RESULT: PASS`.
- [ ] `node --test test/gates-local-shard.test.mjs` passes.
- [ ] No file under `records/specs/` is modified.
