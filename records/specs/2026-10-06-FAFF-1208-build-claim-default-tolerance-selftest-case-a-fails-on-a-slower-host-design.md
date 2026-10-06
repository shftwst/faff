# FAFF-1208: Pin the build-claim default skew tolerance against an injected clock

> Spec: faffter-dark-nlspec · 2026-10-06 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1208.

This spec fixes the build-claim selftest's default-tolerance pin (case A), which fails on a slow host. It is written for the build agent and for human reviewers.

## 1. Why

**The model.** `reclaimIfStale` judges a claim's age as `Date.now()` at check time, minus the 60 second skew tolerance, minus the claim's `last_heartbeat`. The selftest stamps `last_heartbeat` before the claim is acquired, so every millisecond of git work between the stamp and the check is added to the measured age. Case A has 500 ms of slack. Passing one captured instant both as the heartbeat base and as the check's clock makes the measured age exactly the intended backdate, whatever the host's speed.

**Problem.** At `origin/main` `6ff75ee7` on macOS with Node 24, `node plugin/skills/faff/bin/faff regions selftest --region factory` fails 3 of 3 runs on `buildClaimStore: default-tolerance pin, case A (lower bound)` (`plugin/skills/faff/bin/lib/bundle.js`, around lines 1695 to 1699). The acquire's push to a local bare remote takes about 480 to 520 ms on this host, so the 959,500 ms backdate reads as past 960 s and the claim is reclaimed. CI's required `validate` job runs this selftest (`.github/workflows/validate.yml:117`), so a slow runner would fail it too. This change adds a default-off clock parameter to `reclaimIfStale` and uses it in the two pin cases.

**Design principles.**

**The pin must stay exact.** Case A must fail for a 59 s default and case B must fail for a 61 s default. Any fix that widens the 500 ms margins, or that bypasses `reclaimIfStale`'s own tolerance subtraction, weakens the oracle and is rejected.

**The clock seam stays out of reach.** The new parameter is a JavaScript argument only. No config key, environment variable or CLI flag sets it, and every existing caller keeps its current behaviour.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/bundle.js`, `claimStoreCore` / `reclaimIfStale` | JavaScript | The one `Date.now()` read the staleness verdict depends on (`const skewedNowMs = Date.now() - toleranceSecs * 1000`) |
| `plugin/skills/faff/bin/lib/bundle.js`, `buildClaimStore` | JavaScript | Returns the core store object directly, so `storeB.reclaimIfStale` in the selftest is the core function |
| `plugin/skills/faff/bin/lib/bundle.js`, `buildClaimStaleAware` | JavaScript | Cross-box row hands `nowMs` to `runcheck.runIsHeld` |
| `plugin/skills/faff/bin/lib/runcheck.js`, `runIsHeld` | JavaScript | Stale when `(nowMs - last_heartbeat) / 1000 > heartbeatStaleSecs(env)` (default 900, strict greater-than) |
| `plugin/skills/faff/bin/lib/bundle.js`, selftest `arg()` helper | JavaScript | Stamps `last_heartbeat = Date.now() - hbAgeMs` at call time |
| `records/specs/2026-08-25-FAFF-906-harden-claimstorecore-clock-skew-staleness-toctou-reclaim-design.md` | Markdown | FAFF-906 reasoned that 959,500 ms was safe up to a 500 ms harness gap; this host exceeds that |

**Scope.** A selftest determinism fix in the claim-store module, with one optional parameter added to the shared reclaim function.

## 2. Out of scope

- **The other cross-box skew fixtures (920 s and 990 s).** They have 20 s and 30 s of slack and do not flake. Extension point: the same `nowMs` argument, if they ever need it.
- **The local gate ladder's `regions selftest` exclusion** (`.faffrc.yaml`, `gates.exclude`). The ticket's default leaves it alone; re-checking the governance region's state sensitivity is separate work.
- **Build-claim staleness semantics** (FAFF-1090, a live-but-silent build being reclaimed). That ticket changes what "stale" means; this one only makes the existing pin deterministic.
- **`landingClaimStore`'s wrapper and `recoveryClaimStore`.** The landing wrapper keeps its three-argument signature; the recovery store passes the core function through unchanged. Neither needs the clock today. Extension point: the wrapper's `reclaimIfStale(identity, arg, env)` in `bundle.js`.

## 3. What

**Vocabulary.**

| Term | Meaning |
|---|---|
| Pin instant | One `Date.now()` value captured by the selftest before case A or case B, used both to stamp the backdated heartbeat and as the clock passed to `reclaimIfStale` |
| Default tolerance | `CLAIM_CLOCK_SKEW_TOLERANCE_SECS_DEFAULT`, 60 seconds, used when `FAFF_CLAIM_CLOCK_SKEW_TOLERANCE_SECS` is unset |

**Interface change.**

```
FUNCTION claimStoreCore(...).reclaimIfStale(identity, ownerSnapshot, env, nowMs?)
  nowMs: number (epoch milliseconds), optional
         absent or undefined -> Date.now() at call time (current behaviour, unchanged)
  skewedNowMs := nowMs - toleranceSecs * 1000     # replaces Date.now() - toleranceSecs * 1000
  everything else in the function is unchanged
```

**Design decision: how to make case A independent of elapsed time.**

| Option | Keeps the exact pin | Production change | Notes |
|---|---|---|---|
| Optional `nowMs` fourth argument on the core `reclaimIfStale` | Yes | One default-off argument | Exercises the real tolerance subtraction and staleness predicate |
| Clock dependency on `claimStoreCore`'s `spec` or a `buildClaimStore` deps object | Yes | More plumbing through two constructors | No caller needs per-store clocks |
| Widen the backdate margin (for example 959,000 ms) | No | None | Still depends on host speed; a 59 s default no longer fails case A |
| Measure elapsed time and adjust the expectation | Partly | None | Turns the oracle conditional on timing; harder to read |
| Call `buildClaimStaleAware` directly with a hand-computed `nowMs` | No | None | Skips `reclaimIfStale`'s own tolerance subtraction, so the default would not be pinned through the reclaim path |

**Chosen:** an optional `nowMs` fourth argument on the core `reclaimIfStale`, defaulting to `Date.now()`. It is the smallest change that keeps both bounds exact and keeps the default tolerance flowing through the real code path.

## 4. How

**Behaviour.** Production callers pass three arguments and behave exactly as today. The selftest's two pin cases capture a pin instant, stamp the heartbeat from it, and pass it to `reclaimIfStale`.

```
PROCEDURE default_tolerance_pin(storeA, storeB, pinEnv):
  # pinEnv: process.env with FAFF_RUN_HEARTBEAT_STALE_SECS and
  # FAFF_CLAIM_CLOCK_SKEW_TOLERANCE_SECS deleted (unchanged from today)
  1. pinNowMs := Date.now()
  2. Case A:
     a. acquire FAFF-SKEW-PIN-A on storeA as machine-A, heartbeating, with
        last_heartbeat = ISO(pinNowMs - 959500)
     b. result := storeB.reclaimIfStale(FAFF-SKEW-PIN-A, machine-B owner, pinEnv, pinNowMs)
     c. assert result.reclaimed == false AND result.reason == "held"
  3. Case B:
     a. acquire FAFF-SKEW-PIN-B the same way with last_heartbeat = ISO(pinNowMs - 960500)
     b. result := storeB.reclaimIfStale(FAFF-SKEW-PIN-B, machine-B owner, pinEnv, pinNowMs)
     c. assert result.reclaimed == true
```

Step 1 may capture one pin instant for both cases or one per case; either way, each case's heartbeat and clock come from the same instant.

The arithmetic, with the 900 s heartbeat window and a strict greater-than in `runIsHeld`:

| Default tolerance | Case A age seen by `runIsHeld` | Case A result | Case B age seen by `runIsHeld` | Case B result |
|---|---|---|---|---|
| 59 s | 900.5 s | reclaimed (test fails) | 901.5 s | reclaimed |
| 60 s | 899.5 s | held (test passes) | 900.5 s | reclaimed (test passes) |
| 61 s | 898.5 s | held | 899.5 s | held (test fails) |

The ISO timestamp keeps millisecond precision, so `Date.parse(last_heartbeat)` returns exactly `pinNowMs - backdate`.

**Edge cases.**

- `nowMs` passed as `undefined` takes the default, so a JavaScript default parameter (or an explicit `undefined` check) is sufficient. No other value validation is added: the argument is not reachable from user input.
- The "missing holder" branch of `reclaimIfStale` falls through to `acquire` and never reads the clock; it is unaffected.
- The selftest's machine id for `storeB` is the real host id, not `machine-A`, so case A and case B stay on the cross-box row (frozen snapshot, `runIsHeld`). This is unchanged.

**Anti-pattern:** reading `process.env` or `.faffrc.yaml` for a clock override. Why: it would make the staleness verdict tunable outside tests, which the ticket rules out.

**Anti-pattern:** widening the 500 ms margins. Why: a 59 s or 61 s default would then pass one of the two cases, so the pair would no longer pin 60 s exactly.

**Anti-pattern:** generating synthetic CPU load to prove the fix. Why: the failing host already reproduces the fault 3 of 3 without it, and load generation disturbs other work on the machine.

## 5. Scenarios

```
Given a host where acquiring a build claim takes longer than 500 ms
When the factory-region selftest runs the default-tolerance pin case A
Then reclaimIfStale reports reclaimed: false with reason "held"
```

```
Given the default skew tolerance temporarily changed to 59 seconds in a local working copy
When the factory-region selftest runs
Then case A fails, showing the pin still catches a lower default
```

```
Given the default skew tolerance temporarily changed to 61 seconds in a local working copy
When the factory-region selftest runs
Then case B fails, showing the pin still catches a higher default
```

- Every existing caller of `reclaimIfStale` that passes three arguments MUST produce the same result as before the change.

## 6. Design decision rationale

**How should case A stop depending on elapsed wall time?** Options were an optional clock argument, a store-level clock dependency, a wider margin, a timing-aware expectation, or calling the staleness predicate directly. **Chosen:** an optional `nowMs` argument on the core `reclaimIfStale`. It keeps both bounds exact, keeps the default tolerance on the real reclaim path, and adds no config or environment surface. A store-level dependency would work but needs plumbing through `claimStoreCore`'s spec and `buildClaimStore` for no other caller.

**Should the local gate ladder's `regions selftest` exclusion change in this ticket?** Options were remove it now or leave it. **Chosen:** leave it. The ticket names this as the default, and the exclusion's real cause (governance-region state sensitivity) needs its own check.

## 7. Open questions and assumptions

**Open questions.** None.

**Assumptions.** None beyond the codebase facts cited above, all checked at `origin/main` `6ff75ee7`.

## 8. Done

### From why
- [ ] `node plugin/skills/faff/bin/faff regions selftest --region factory` passes 5 of 5 consecutive runs on the macOS, Node 24 host that reproduced the failure, with no synthetic load.
- [ ] CI's `validate` job passes on the pull request.

### From what (interface)
- [ ] The core `reclaimIfStale` accepts an optional fourth argument `nowMs`; when it is absent, the function reads `Date.now()` exactly as before.
- [ ] No config key, environment variable or CLI flag sets `nowMs`; `grep` for new `process.env` or config reads in the diff finds none.
- [ ] `landingClaimStore`'s wrapper keeps its three-argument signature.

### From how (behaviour)
- [ ] Case A and case B each stamp `last_heartbeat` from a captured pin instant and pass the same instant as `nowMs`.
- [ ] Both cases still pass `pinEnv` with `FAFF_RUN_HEARTBEAT_STALE_SECS` and `FAFF_CLAIM_CLOCK_SKEW_TOLERANCE_SECS` deleted.
- [ ] Backdates stay at 959,500 ms (case A) and 960,500 ms (case B); assertions are unchanged (`held` for A, `reclaimed: true` for B).
- [ ] Local mutation check, not committed: with `CLAIM_CLOCK_SKEW_TOLERANCE_SECS_DEFAULT` set to 59, case A fails; set to 61, case B fails; restored to 60, both pass. Results recorded in the build log.
- [ ] The selftest comment above the pin cases states that the clock is injected so host speed cannot shift the measured age.

### From how (edge cases)
- [ ] The other `reclaimIfStale` fixtures in the factory selftest, and the governance-region selftest, still pass.
- [ ] The full unit suite shows no new failures against `origin/main`.

**Integration smoke test.**

```
1. Run: node plugin/skills/faff/bin/faff regions selftest --region factory
2. Expect: RESULT: PASS, including both "default-tolerance pin" checks
3. Repeat four more times; expect PASS each time
```

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" } ] }
```
