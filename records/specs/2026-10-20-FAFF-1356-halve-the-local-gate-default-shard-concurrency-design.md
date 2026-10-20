# FAFF-1356: Halve the local gate's default shard concurrency

> Spec: faffter-dark-nlspec · 2026-10-20 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1356.

This spec changes the default number of unit-test shards that `faff gates run` runs at once on a developer machine, and requires the build agent to prove the new default on the 8-core host where the false failures were seen. It is written for the build agent and for human reviewers of the gate ladder.

## 1. WHY

**The load-bearing model.** The local UNIT rung splits the suite into `local_shards` partitions (default: the host's core count) and runs them through a bounded worker pool whose width is `local_shard_concurrency`. The pool width, not the partition count, decides how much CPU and process-table pressure the timing-sensitive tests see. Narrowing the pool lowers that pressure without changing which tests land in which shard.

**Problem.** The default width is `max(2, local_shards - 1)`, which is 7 on an 8-core host. At that width 3 to 5 shards fail on every run, in lock, sentry, andon, docker-gated holdout and no-tty tests that pass in CI and pass locally at width 1. This change lowers the default to half the shard count, so a local gate run reports a real result without a local overlay.

**Design principles.**

- **Keep partitioning and concurrency separate.** Fix the pool width only. Changing `local_shards` changes which tests run together and is rejected (the FAFF-1137 anti-pattern still holds).
- **Evidence over arithmetic, with an honest bound.** Five passes in a row do not prove a failure rate of zero. They do mean that, if a single run at the new width still failed with probability 0.46 or more, five straight passes would happen less than 5% of the time (0.54 to the fifth power is about 0.046). At width 7 the ticket reports failures on every run, so a residual rate near that level would be a large improvement still worth shipping; anything lower is left to the follow-up hardening ticket.
- **Evidence over arithmetic.** The new default ships only once five consecutive gate runs on this 8-core host pass the UNIT rung with no overlay.
- **The knob stays the escape hatch.** A present `gates.local_shard_concurrency >= 1` is still honoured verbatim, in either direction.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/gates.js` (plain `.js`, no `.ts` source) | Node | `readGatesConfig` (~line 815) computes the default at ~line 850; `runShardedRung` (~761) is the pool; `gatesSelftest` pins the default at ~1300-1307 |
| `records/specs/2026-09-27-faff-1137-harden-sharded-gate-ladder-design.md` | Spec | Introduced the pool and the one-core-reserve default; historical, not edited |
| `test/gates-local-shard.test.mjs` | Node test | Sharding behaviour tests; none assert the concurrency default |

**Scope statement.** This touches only the default value of one `gates.*` knob in the local execution path of `faff gates run`; CI sharding and rung discovery are unchanged.

## 2. OUT OF SCOPE

- **Making the timing-sensitive tests tolerant of load** (polling instead of fixed sleeps, longer lock timeouts). Why excluded: it spans at least six test files and each needs its own progress signal; that is wider than one ticket. Extension point: a follow-up ticket over the likely files `test/sentry-poller.test.mjs`, `test/sentry.test.mjs`, `test/sentrycheck.test.mjs`, `test/andon.test.mjs`, `test/ledger-concurrency.test.mjs`, `test/bundle-recover-lock.test.mjs`, `test/holdout-rpc-evaluate-integration.test.mjs` and `test/contract-describe.test.mjs`, seeded with the failing test names the build agent records (see DONE).
- **Changing the default shard count `local_shards`.** Why excluded: it changes partitioning, not load. Extension point: `local_shards` resolution in `readGatesConfig`.
- **Adaptive concurrency** (sizing from load average or free memory). Why excluded: a new mechanism with its own flakiness; a static default plus the knob is enough. Extension point: the new default helper described below.
- **Editing earlier specs under `records/specs/`** that describe `max(2, local_shards - 1)`. Why excluded: records are historical and keep the wording of their time.
- **User-facing config documentation for `gates.*`.** Why excluded: no file under `docs/`, `plugin/**/*.md` or `.faff/` documents `local_shard_concurrency` today (verified by grep), so there is nothing to update; adding a `gates.*` reference page is a separate docs ticket. Extension point: `docs/reference/`.

## 3. WHAT

**Vocabulary.**

| Term | Meaning |
|---|---|
| shard count (`local_shards`) | How many `node --test --test-shard=i/n` partitions the local UNIT rung is split into; default `availableParallelism()` |
| shard concurrency (`local_shard_concurrency`) | How many of those partitions run at once in `runShardedRung`'s pool |
| wave | One batch of shards running together; with 8 shards, width 7 gives waves of 7 and 1, width 4 gives waves of 4 and 4 |

**Config surface (unchanged shape, new default).**

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

**Decision: fix the cause or lower the default.** The ticket offers lowering the default, hardening the tests, or both. Hardening is the root-cause fix, but it touches many files and each test needs its own progress signal; lowering the default is a one-line change that the ticket's own evidence (pass at width 1, fail at width 7) shows is effective at some width.
**Chosen:** lower the default in this ticket and defer test hardening to a follow-up (see OUT OF SCOPE). The measured result decides whether half is enough.

**Decision: which default width.** Options: reserve more cores (`local_shards - 2`), half the shard count, a quarter, or serial.
**Chosen:** half, `floor(local_shards / 2)`. With 8 shards, width 7 already needs two waves (7 then 1), so width 4 (4 then 4) keeps two waves and costs little wall-clock while cutting peak pressure by almost half. A quarter or serial is held back as the measured fallback, not the first choice. The formula is measured only at 8 cores. On a 16-core host it gives width 8, which is unmeasured. Half is still the proportionate choice there, because the pressure that starves a shard scales with how many of the host's cores are busy, and half leaves half the host free at every size. The knob remains the escape hatch, and a failure mode below names the signal.

**Decision: floor of the default.** Options: keep the old floor of 2, or floor at 1.
**Chosen:** floor at 1. A floor of 2 keeps a 2- or 3-core host at full width with no headroom, which is the same overload this ticket fixes. On those hosts the run becomes serial and slower; an operator who prefers speed sets the knob.

**Decision: where the default lives.** **Chosen:** a small exported pure function `defaultShardConcurrency(local_shards)` in `gates.js`, called by `readGatesConfig`, so selftests can pin the table above without faking the host core count. It follows the existing `safeAvailableParallelism` export pattern.

## 4. HOW

**Approach.** Replace the default expression in `readGatesConfig` with a call to the new helper. Update the two comments that describe the default (the `runShardedRung` header comment near line 754 and the `local_shard_concurrency` block near line 844) to say "half the shard count" instead of "reserves one core". Update the selftest label and expected value at ~line 1300-1307. No other caller changes: `runRung` already passes the resolved value to `runShardedRung`, which already accepts any width >= 1.

```
PROCEDURE readGatesConfig(root):   # only the changed step
  ...
  local_shard_concurrency := defaultShardConcurrency(local_shards)
  lsc := floor(num("gates.local_shard_concurrency"))
  IF lsc is finite AND lsc >= 1: local_shard_concurrency := lsc
  ...
```

**Measurement on this host (acceptance, not a unit test).** Behaviour summary: prove the new default removes the false failures on the 8-core host that reported them.

```
PROCEDURE measure_default():
  1. Confirm nproc = 8 and `faff config get gates.local_shard_concurrency` prints nothing
     (exit 3, key unset in every config layer).
  1b. Confirm nothing else is loading the host: `pgrep -f "node --test"` prints nothing and no other
      worktree build or gate run is active. Record the 1-minute load average.
  1c. Control run: in the build worktree, run `faff gates run --json` once with the overlay
      gates.local_shard_concurrency: 7 (the old default), then remove the overlay. Record the UNIT
      status and failing test names. A failing control establishes that the false failures
      reproduce today, so the passes below are evidence the new default fixed them. A passing
      control means the failures did not reproduce today: run the control once more, and if it
      still passes, carry on but state in the PR body that the measurement is non-causal
      (the default is then supported only by the ticket's own evidence).
  2. In the build worktree, with the change applied and no overlay, run `faff gates run --json` five times in a row.
  3. For each run, record: the UNIT rung's status (rungs[] where kind == "UNIT"),
     its duration_ms, and the names of any failing tests from its detail.
  4. IF all five runs have a UNIT rung with status "pass": ship half. Record the five durations
     in the PR body.
  5. ELSE (any UNIT status != "pass", or the UNIT rung is absent because an earlier rung failed):
     a. If an earlier rung failed, fix or explain that rung and repeat from step 2; it is not a
        concurrency signal.
     b. Re-run step 2 with the overlay gates.local_shard_concurrency: 2 (a quarter of 8).
     c. IF five of five pass at 2: change the helper to max(1, floor(local_shards / 4)),
        update the table, selftests and comments, remove the overlay, and repeat step 2
        against the new default.
     d. ELSE: stop, do not lower the default further, and report (park) with the failing
        test names. That result means load tolerance in the tests, not pool width, is the
        remaining cause, and the follow-up hardening ticket is a prerequisite.
```

**Anti-pattern:** setting a local overlay during the measurement to make it pass. Why: the measurement exists to prove the unconfigured default.

**Anti-pattern:** lowering `local_shards` instead. Why: it changes partitioning and test balance, not just load.

**Failure modes.**

- **The failure:** the new default is still too wide on a host with 12 or more cores. **How you'd know:** an adopter or builder on such a host reports the same lock, sentry or andon false failures at the new default, and they pass with `gates.local_shard_concurrency` set lower. **What it means:** the half ratio does not hold at that size; file a follow-up to cap the default or move to the load-tolerance hardening. This host cannot measure it.

- **The failure:** half the cores is still too much on this host. **How you'd know:** a UNIT failure in any of the five measured runs. **What it means:** follow the quarter fallback in `measure_default`; if a quarter also fails, narrow this ticket to a report and park.
- **The failure:** the failures are caused by something other than CPU load (a shared temp path, a port, docker contention) that persists at width 4 but not at width 1. **How you'd know:** the same tests fail at width 4 and 2 but pass at 1. **What it means:** the quarter fallback fails too; park with the test names so the hardening ticket targets them.
- **The failure:** shard durations are uneven, so width 4 runs noticeably slower than width 7 despite the same wave count. **How you'd know:** the recorded UNIT `duration_ms` values are well above the pre-change runs. **What it means:** proceed; correctness outranks a few minutes of wall-clock, and the knob restores width for anyone who wants it.
- **The failure:** a 2-core developer machine now runs the unit suite serially and the run nears `rung_timeout_ms` (30 minutes by default). **How you'd know:** a timeout-kill UNIT result on a low-core host. **What it means:** proceed; the operator raises `gates.local_shard_concurrency` or `gates.rung_timeout_ms`. Not measurable on this host and not a blocker.

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

## 5. DESIGN DECISION RATIONALE

**Fix the cause or lower the default?** Options: default only / hardening only / both. Hardening alone leaves the ladder at width 7 for every future timing-sensitive test; both together is wider than one ticket.
**Chosen:** lower the default now, hardening as a follow-up, so the gate is trustworthy immediately and the follow-up is driven by the recorded failing tests.

**Which width?** Options: `n - 2` / `n / 2` / `n / 4` / serial. `n - 2` gives 6 on this host, still close to the failing 7. Serial is known to pass but loses the sharding benefit FAFF-1002 added.
**Chosen:** `max(1, floor(n / 2))`, with `n / 4` as the measured fallback. At the time of writing the only evidence is pass at 1 and fail at 7; half is the smallest step that is likely to pass at near-equal wall-clock.

**Floor of 1 or 2?**
**Chosen:** 1, because a floor of 2 leaves small hosts at full width with no headroom.

**Where to compute the default?**
**Chosen:** a pure exported helper, so selftests cover several host sizes deterministically.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions.** None.

**Assumptions.**

- **Assumes:** the build runs on the reference host: the same 8-core Linux container with docker available, where the false failures were observed. Validation: `uname -s` prints `Linux`, `node -p "require('os').availableParallelism()"` prints 8 (`nproc` agrees on this host), and `docker info` exits 0 before step 1b of `measure_default` (all true at spec time). If any check fails, the host is not the reference host: do not ship a measured default from it. Record the host facts and take the park branch (step 5d) with the cause "measurement host is not the reference host", so a human runs the measurement on the reference host.

## 7. DONE

### From WHY
- [ ] On this 8-core host, with `gates.local_shard_concurrency` unset, five consecutive `faff gates run --json` runs each report a `rungs[]` entry with `kind: "UNIT"` and `status: "pass"`; the five `duration_ms` values, the control run's result (status and failing test names at width 7) and the load average are recorded in the PR body.
- [ ] If any of those runs failed, the PR body lists the failing test names and which branch of `measure_default` was taken (quarter default shipped, or parked).

### From WHAT
- [ ] `gates.js` exports `defaultShardConcurrency`; for inputs 2, 3, 4, 8 and 16 it returns 1, 1, 2, 4 and 8 (or the quarter-fallback table if that branch was taken), each pinned by a `gates --selftest` case.
- [ ] `readGatesConfig` with no `local_shard_concurrency` returns `defaultShardConcurrency(local_shards)`; the existing absent, non-numeric and `0` selftest cases expect that value and their labels no longer say `max(2, local_shards-1)`.
- [ ] A present `local_shard_concurrency: 7` and `local_shard_concurrency: 1` are both honoured verbatim (selftest).
- [ ] `grep -n "max(2, local_shards - 1)\|reserves one core\|reserve one core" plugin/skills/faff/bin/lib/gates.js` returns nothing.

### From HOW
- [ ] `runShardedRung` and `runRung` are unchanged apart from comments.
- [ ] `faff gates --selftest` prints a line starting `RESULT: PASS`.
- [ ] `node --test test/gates-local-shard.test.mjs` passes.
- [ ] No file under `records/specs/` is modified.

### Integration smoke test

```
1. nproc -> 8; faff config get gates.local_shard_concurrency -> no output, exit 3
2. faff gates --selftest -> RESULT: PASS (N cases, 0 failed)
3. faff gates run --json (x5) -> each: UNIT rung status "pass"
```

## Already shipped against this surface

- **FAFF-1002** (Done): added local sharding, `gates.local_shards`, default `availableParallelism()`.
- **FAFF-1137** (Done): added the bounded pool, `gates.local_shard_concurrency` and the `max(2, local_shards - 1)` default this ticket replaces, plus hardening of `sentry-poller` and `decline-parity`. Its own failure mode named "set `local_shard_concurrency` lower" as the escape hatch; this ticket makes that the default.
- **FAFF-1149** (Done): strips the CI matrix shard token so the local rung reshards to `local_shards`. Unaffected.
- **FAFF-1332**: its PR body records 10 local load-sensitive failures that pass in CI, the same pattern as this ticket.

## Revision notes

- Revised 2026-10-20 after spec-review round 1 (reject-approach routed to prep, two minor objections): `measure_default` now runs a width-7 control before the three measured runs and checks the host is otherwise idle, and the width decision states that only 8 cores was measured, with a failure mode for hosts of 12 or more cores.

- Revised 2026-10-20 after spec-review round 2 (reject-approach routed to prep, three minor objections): the measurement is five consecutive passes with a stated statistical bound; the reference-host check uses `uname -s`, `os.availableParallelism()` and `docker info` (the host is a Linux container, where `nproc` and `pgrep` are present); and a build on any other host takes the park branch rather than leaving the first Done item undecidable.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized (principle 4).** No issues. The code change is one small helper, one call site, two comments and four selftest lines in `gates.js`. The three-run measurement is the acceptance evidence, not a separate concern, and the "report and park" branch stops scope from growing into test hardening.

**Workstream fit (principles 1 and 5).** No issues. One outcome: a local `faff gates run` reports a real result without an overlay. Project-less Backlog matches the default-landing rule.

**Deps surfaced (principle 6).**
- **FAFF-1355 overlap.** FAFF-1355 (in the same run) also edits `gates.js`, at the selftest fixture strings near lines 1281 and 1361. The hunks don't touch this spec's 844-852 and 1300-1307, and neither ticket needs the other's output, so a blocker link would be false. Serialise the builds, or rebase whichever merges second and re-run `faff gates --selftest`.
- **Follow-up hardening ticket.** It doesn't exist yet. If the park branch of `measure_default` is taken, file it in Backlog with the recorded failing test names and name it in the park note.

**Risk profile (principle 7).**
- **Load from the same run can skew the measurement (main risk).** If another build or gate run is active on this 8-core host during `measure_default`, the extra load can turn a passing width into a fail. Before step 2, confirm no other worktree build or gate run is active (for example `pgrep -f "node --test"` returns nothing, or a quiet load average), and note the host load in the PR body next to the three durations.
- **Measurement wall-clock.** Three full gate runs, up to six with the fallback, take a while. Accepted by the spec's duration failure mode.

confidence: high
build-tier: standard
spec-review: approve
