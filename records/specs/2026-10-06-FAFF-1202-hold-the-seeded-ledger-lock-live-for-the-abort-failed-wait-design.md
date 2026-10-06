# FAFF-1202: hold the seeded ledger lock live for the whole abort-failed wait

> Spec: faffter-dark-nlspec · 2026-10-06 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1202.

This spec covers FAFF-1202, a timing flake in the FAFF-472 abort-failed tick test in `test/sentry-poller.test.mjs`. It is written for the build agent and for human reviewers. It changes one test and no production code.

## 1. Why: problem and principles

**The model.** `fs-lock.js` decides whether a lock file is held by one comparison: the lock is stale when `Date.now() - mtime > STALE_LOCK_MS` (5000 ms), and only then is it taken over. The test seeds `run-ledger.json.lock` with a fresh mtime, so the lock looks live for exactly 5 seconds and then goes stale. Every abort attempt inside that window fails with `LEDGER_LOCKED`, which is the path the test exists to check. Once the window closes, the next abort takes the lock over and succeeds, which is a different path. Giving the seeded lock an mtime in the future moves the moment it goes stale without touching the comparison, so the test can wait as long as a loaded host needs while still exercising only the locked path.

**Problem.** On 2026-10-06 the test failed in two of three runs on unchanged `origin/main` on a macOS host running Node 24 under a load average of 60 to 108. The poller logged `abort-failed` about 4.4 seconds after starting, but the test waits 4 seconds after `sentry-poller start` returns, about 4.65 seconds in all. Raising the wait past 5 seconds is not safe, because the seeded lock then goes stale inside the wait and a slow tick would take it over, so the case would test a takeover instead of a failed abort. This change moves the stale point far past the wait and checks that no takeover happened.

**Design principles.**

- **Exercise the same production branch.** The seeded lock must still reach `fs-lock.js` as an existing lock whose age is not over `STALE_LOCK_MS`, so every abort attempt exhausts `ACQUIRE_BUDGET_MS` and exits `LEDGER_LOCKED`. No other branch may be reachable during the test.
- **No production knob.** The `fs-lock.js` header says its tuning constants are deliberately not configuration. A seam that lets the environment lengthen or disable stale takeover would let a production run wedge on a dead holder's lock.
- **Prove the path, not just the outcome.** The test asserts that the abort child failed with exit 1 and that the seeded lock is still in place at the end, so a stale takeover cannot pass unnoticed.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `test/sentry-poller.test.mjs`, the abort-failed tick test (about line 630) | JavaScript (node:test) | The only test this change edits. It already has `waitUntil` and `ABORT_LANDING_BUDGET_MS` (30000). |
| `plugin/skills/faff/bin/lib/fs-lock.js` | JavaScript | `acquireFileLock`: an exclusive create; on `EEXIST`, `statSync` and a stale check against `mtimeMs`; otherwise retry until `ACQUIRE_BUDGET_MS` (2000) and throw the caller's code. Read only. |
| `plugin/skills/faff/bin/lib/sentry-poller.js`, the abort branch (about lines 285 to 325) | JavaScript | Runs `faff sentry abort`; on a non-zero exit it logs `abort-failed {"exit":<status>}` and retries the next tick. Read only. |
| `test/economics.test.mjs`, line 752 | JavaScript | An existing test that sets a future mtime with `utimesSync`, the precedent for the technique. |
| FAFF-1192 (Done) | Ticket | Fixed the other two FAFF-472 pump tests in this file and recorded this flake as discovered scope. |

**Scope.** This is a test-only reliability fix in the sentry-poller integration suite.

## Already shipped against this surface

- FAFF-1192 (Done, 2026-10-06): fixed the cross-process ordering races in the andon-configured and andon-unset tests. It did not touch this test, and recorded this flake as discovered scope.
- FAFF-1200 (Done, 2026-10-06): fixed the local macOS, Node 24, non-UTC suite failures. Its causes did not include this test.
- FAFF-635 (Done): sized `ABORT_LANDING_BUDGET_MS` for a contended CI runner. This spec reuses the constant.

None of these covers this test, so the premise holds.

## 2. Out of scope

- **An environment or configuration seam in `fs-lock.js`.** Rejected in section 6. A future need for an injectable clock would go in `acquireFileLock`'s options object, which only in-process callers can pass.
- **The in-process lock tests** in `test/ledger-concurrency.test.mjs` and `test/events-chain.test.mjs`. They seed a live lock and call the locked code synchronously in the same process, so their 2-second budget runs inside one call and host load cannot let the lock go stale part-way through a poll.
- **Changes to `sentry-poller.js` or `fs-lock.js`.** None are needed.

## 3. What: changes to the test

There are no new types or interfaces. One test changes.

**Seed the lock with a future mtime.** After writing `run-ledger.json.lock`, set its access and modification times to `now + SEEDED_LOCK_HOLD_MS` with `utimesSync`, where `SEEDED_LOCK_HOLD_MS` is a named constant beside the other budgets, set to 60000. The lock's age then stays negative for 60 seconds and goes stale only after `SEEDED_LOCK_HOLD_MS + STALE_LOCK_MS`, about 65 seconds after seeding.

```
lock := runDir/run-ledger.json.lock
write lock (empty)
hold_until := now + SEEDED_LOCK_HOLD_MS
utimes(lock, atime = hold_until, mtime = hold_until)
```

**Chosen:** a future mtime on the seeded lock, with no production change. It moves the stale point using the same `mtimeMs` that `fs-lock.js` already reads, so the code runs the identical comparison and takes the identical not-stale branch.

**Wait with the shared landing budget.** Replace the 4000 ms wait for `abort-failed` with `ABORT_LANDING_BUDGET_MS`. The wait now ends at most 30 seconds after `start`, well inside the 65-second stale point.

**Chosen:** `ABORT_LANDING_BUDGET_MS`, the budget the file's other abort-path waits already use (sized by FAFF-635), and not a new number.

**Assert the path, not only the outcome.**

- The log matches `abort-failed {"exit":1}`, the `LEDGER_LOCKED` exit, not merely `abort-failed`.
- `run-ledger.json.lock` still exists at the end of the assertions. A stale takeover would have unlinked it and released it after the abort.
- The existing assertions stay: no `abort-actioned`, no `sentry-trip` event, and the poller still alive.

**Chosen:** add both path assertions. Together they show every attempt took the locked branch: the takeover branch unlinks the lock, and a successful abort would log `abort-actioned`.

**Comments.** Replace the comment that says the wait is bounded under the 5-second window with one that says why the lock carries a future mtime and why the wait can use the landing budget. Update the seeding comment the same way, so neither says "fresh mtime".

## 4. How: behaviour

```
PROCEDURE abort_failed_tick_test:
  1. Build the stale-heartbeat L4 fixture (unchanged).
  2. Write run-ledger.json.lock; set its atime and mtime to now + SEEDED_LOCK_HOLD_MS.
  3. Start the poller with --interval-secs 1 (unchanged).
  4. failed := waitUntil(log includes "abort-failed", timeoutMs = ABORT_LANDING_BUDGET_MS); assert failed.
  5. Assert the log matches abort-failed {"exit":1}.
  6. Assert no abort-actioned, no sentry-trip event, and the poller pid alive (unchanged).
  7. Assert run-ledger.json.lock still exists.
  8. finally: stop the poller and remove the temporary root (unchanged).
```

**Edge cases.**

- If a filesystem rounds the mtime to whole seconds, the hold shrinks by under a second, which is negligible against a 35-second margin.
- If the poller never logs `abort-failed` within 30 seconds, the test fails with its existing message, as before.
- The lock's age is negative while it is in the future. `fs-lock.js` only checks `age > STALE_LOCK_MS`, so a negative age reads as live, as intended.

**Failure modes.**

- **The failure:** a later change to `fs-lock.js` might treat a future mtime as stale or invalid (for example, clamping clock skew). **How you'd know:** the lock-exists assertion or the `exit 1` match fails, or the log shows `abort-actioned`. **What it means:** revisit the seam, at that point through an options-object clock in `acquireFileLock` (section 2).
- **The failure:** host load slows the first tick past 30 seconds. **How you'd know:** the `abort-failed` wait times out. **What it means:** the test then fails loudly and never passes on a wrong path. The budget matches the file's other abort waits.

**Anti-pattern:** raising the wait past 5 seconds while the seeded lock keeps a fresh mtime. Why: the lock goes stale inside the wait and a slow tick takes it over, so the test checks a different path.

**Anti-pattern:** refreshing the lock's mtime from a timer in the test. Why: the refresh is itself timing-dependent under the same host load, and no real holder in `fs-lock.js` refreshes its lock.

## 5. Scenarios

```
Given a seeded run-ledger lock whose mtime is SEEDED_LOCK_HOLD_MS in the future
When the poller's first abort tick lands 4.4 seconds or more after start on a loaded host
Then the test still observes abort-failed {"exit":1} and passes
```

```
Given the same fixture
When the assertions run
Then run-ledger.json.lock still exists and the log has no abort-actioned line
```

## 6. Design decision rationale

**How should the test hold the lock live for longer?**
Options: a future mtime on the seeded lock; an environment variable that changes `STALE_LOCK_MS` in `fs-lock.js`; a timer in the test that refreshes the mtime; a longer wait with a fresh lock.
**Chosen:** a future mtime. It needs no production change and drives the same comparison. An environment seam adds a production knob that could disable dead-holder takeover, against the module's stated design. A refresh timer is timing-dependent under the load it is meant to survive. A longer wait alone crosses the 5-second stale point and changes the path under test.

**How long should the hold be?**
Options: just over the wait budget; a wide margin.
**Chosen:** 60 seconds, so the stale point (about 65 seconds) is more than twice the 30-second wait budget, and a cleanup delay can't reach it either.

**Which wait budget?**
**Chosen:** `ABORT_LANDING_BUDGET_MS`, as in section 3.

**Should the test also prove the path?**
**Chosen:** yes, with the `exit 1` match and the lock-exists check (section 3).

## 7. Open questions and assumptions

There are no open questions. The ticket's open question is answered: no seam for the stale threshold exists. `STALE_LOCK_MS` is a module constant, and staleness is read from the lock file's mtime, which is the seam this change uses.

**Assumes:** `utimesSync` can set a future mtime on the test's temporary directory on Linux CI and on macOS. Validation: `test/economics.test.mjs` line 752 already does this, and passes on the Linux CI lanes and in local macOS runs.

## 8. Definition of done

### From why
- [ ] The abort-failed tick test passes whenever the poller behaves correctly, whatever the host load, and exercises only the `LEDGER_LOCKED` path.

### From what
- [ ] The seeded lock's atime and mtime are set to `now + SEEDED_LOCK_HOLD_MS` (60000), a named constant beside the other budgets.
- [ ] The `abort-failed` wait uses `ABORT_LANDING_BUDGET_MS`.
- [ ] The test asserts the log matches `abort-failed {"exit":1}`.
- [ ] The test asserts `run-ledger.json.lock` still exists after the assertions.
- [ ] Neither comment around the seeded lock still says the lock has a fresh mtime or that the wait must stay under 5 seconds.
- [ ] `git diff --name-only origin/main` lists only `test/sentry-poller.test.mjs` and the committed spec.

### From how
- [ ] Under synthetic CPU load (busy-loop processes numbering twice the core count), unchanged `origin/main` fails the test at least once in 5 runs, which shows the load reproduces the flake.
- [ ] Under the same load, the changed test passes in a 10-run stress loop.
- [ ] `test/sentry-poller.test.mjs` passes locally on Node 20 and Node 24.
- [ ] CI's `unit` shards (Node 20) and the `typecheck` job's full suite (Node 24) pass on the PR.

**Integration smoke test.**

```
run: node --import ./test/hermetic-env.mjs --test --test-name-pattern "abort-failed tick" test/sentry-poller.test.mjs
expect: 1 pass; the run takes about as long as before on an idle host, because the wait returns as soon as abort-failed is logged
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (principle 4).** No issues. One test, one concern, well under a day.
- **Workstream fit (principles 1 and 5).** No issues. It is CI reliability work alongside FAFF-1192, from which it was split as discovered scope.
- **Surfaced dependencies (principle 6).** No issues. Nothing blocks it. FAFF-1192 and FAFF-1200 are merged.
- **Risk profile (principle 7).** No issues. The change is test-only and reversible, with no new integration.

build-tier: standard
spec-review: approve
confidence: high

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
