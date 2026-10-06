# FAFF-1192: wait for the andon pump's state file in the sentry-poller tests

> Spec: faffter-dark-nlspec · 2026-10-06 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1192.

This spec covers FAFF-1192, an intermittent failure in the FAFF-472 andon tests in `test/sentry-poller.test.mjs`. It is written for the build agent and for human reviewers. It changes one test file and no production code.

## 1. Why: problem and principles

**The model.** The detached sentry poller runs one abort tick in a fixed order: it appends the `sentry-checkpoint` event, writes the `abort-actioned` log line, appends the `sentry-trip` event, then runs `faff andon pump` as a blocking child (`spawnSync`). The pump posts to the webhook and only then writes `andon-state.json`. After that the poller process exits. A test that observes one step in this chain may only assert on that step and on earlier steps. Anything later must be waited for, or checked after a step that comes later still.

**Problem.** On 2026-10-05, PR #999 (markdown only) failed the Node 24 `typecheck` job at `test/sentry-poller.test.mjs:548` with `the pump's own cursor/dedupe state was written`. The test waits for the webhook POST, then checks `andon-state.json` once with `existsSync`, but the pump writes that file after the POST, so the check can run first. The `andon.url unset` test has the same fault: it waits for the `abort-actioned` log line and then reads `events.jsonl` for the `sentry-trip` event, which the poller appends after that log line. The fix makes every such assertion wait for, or follow, the step that produces its evidence.

**Design principles.**

- **Wait for a positive signal, not for time.** Every new wait uses the existing `waitUntil` helper with a named budget constant. A fixed sleep is the pattern FAFF-1137 removed from this file.
- **Check an absence only after the step that would have produced it.** A negative assertion made before the pump has run passes whatever the pump does. The `andon-state.json` absence check therefore follows the poller's exit, which comes after the pump's blocking child has returned.
- **Leave production code alone.** The poller's step order is correct and documented (FAFF-686, the FAFF-472 HOW section 4). Only the tests misread it.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `test/sentry-poller.test.mjs` | JavaScript (node:test) | The only file this change edits. It holds the `waitUntil` helper (line 82), `ABORT_LANDING_BUDGET_MS` (30000) and `POLLER_EXIT_BUDGET_MS` (20000). |
| `plugin/skills/faff/bin/lib/sentry-poller.js`, lines 285 to 321 | JavaScript | The abort tick. It appends `sentry-checkpoint`, logs `abort-actioned`, appends `sentry-trip`, runs `spawnSync` on `faff andon pump`, then returns, which ends the poller process. Read only. |
| `plugin/skills/faff/bin/lib/andon.js`, `runPump` (line 389) | JavaScript | Posts each event with `postWithRetry`, then calls `writeAndonState` once at the end, using a temporary file and an atomic rename. Read only. |
| FAFF-686 (Done) | Ticket | The earlier fix in this file. It made the checkpoint assertion wait for the `abort-actioned` line. The same approach, one step further along the chain. |
| FAFF-1137 (Done) | Ticket | Replaced fixed sleeps in this file with waits on a positive progress signal. |
| FAFF-1098 (Backlog) | Ticket | Reports both FAFF-472 pump tests failing on CI on 2026-09-24 (PR #931): first the `andon.url unset` test, then the `andon-state.json` assertion. The second failure is the race this ticket reports. The first failure's assertion was not recorded; the `sentry-trip` read race fixed here is its likely cause. |

**Scope.** This is a test-only reliability fix inside the sentry-poller integration suite. It does not change how the watchdog or andon behave.

## Already shipped against this surface

- FAFF-686 (Done, 2026-08-04): fixed the checkpoint race in the L4 abort test by waiting for the `abort-actioned` line. The premise still holds: that fix does not cover the `sentry-trip` event or the andon state file.
- FAFF-635 (Done, 2026-08-04): sized `ABORT_LANDING_BUDGET_MS` and `POLLER_EXIT_BUDGET_MS` for a contended CI runner. This spec reuses those constants.
- FAFF-1137 (Done, 2026-09-27): replaced fixed sleeps in the advisory tests with positive-signal waits. This spec follows the same convention.

None of these covers the two FAFF-472 assertions this spec fixes, so the premise holds.

## 2. Out of scope

- **Changes to `andon.js` or `sentry-poller.js`.** The step order is correct; only the tests misread it. A future change to delivery semantics would go in `runPump` in `andon.js`.
- **Pump test helpers outside this file** (for example `test/andon.test.mjs`). The ticket scopes the audit to `test/sentry-poller.test.mjs`. A wider audit would be a new ticket against the andon test file.
- **Closing or relinking FAFF-1098.** A human decides whether this change resolves that ticket. This spec only records that the two races it reports are the ones fixed here.
- **The 2-second fixed observation window in the pause test (line 493).** It checks that nothing happens over two more ticks, not that a step has finished, so the same race does not apply. Changing it is outside this ticket.

## 3. What: changes to the test file

There are no new types or interfaces. The changes are edits to three FAFF-472 tests.

**Andon configured test (line 519), the reported failure.** Replace the single `existsSync` check of `andon-state.json` with a wait:

```
state_written := waitUntil(existsSync(runDir/andon-state.json), timeoutMs = ABORT_LANDING_BUDGET_MS)
assert state_written, "the pump's own cursor/dedupe state was written"
```

Keep the existing failure message so CI history stays searchable. Add a short comment beside the wait. It should say that the pump posts before it writes its state, so the file follows the POST, and that a crash between the two re-sends the notification on restart (at-least-once delivery). That is deliberate, because a duplicate page is safer than a missed one.

**Chosen:** a `waitUntil` on the state file with `ABORT_LANDING_BUDGET_MS`, placed where the `existsSync` check is now. This matches the ticket and the convention FAFF-686 set. Moving the check below the poller-exit wait would also work, but it would hide a missing state file behind a poller-exit failure message.

**Andon configured test, the "exactly one notification" assertion (line 535).** Keep it where it is. After the poller-exit wait, assert `posts.length === 1` a second time. At line 535 the pump may still be running, so an extra POST arriving later would go unseen. After the exit, the pump's blocking child has returned, so the count is final.

**Chosen:** add the second count check after the poller exits. It is one line, and it turns an early snapshot into a check on the final count.

**Andon unset test (line 559).** It has two faults, both caused by asserting before the step that produces the evidence:

1. The `sentry-trip` count (line 571) reads `events.jsonl` right after `abort-actioned` appears. The poller appends `sentry-trip` after that log line, so the read can miss it. Fix: wait for the event with `waitUntil(events().some(type === "sentry-trip"), ABORT_LANDING_BUDGET_MS)`, then assert the count is exactly 1.
2. The `andon-state.json` absence check (line 573) runs before the pump has run, so it would pass even if a disabled pump wrote a state file. Fix: move the check below the existing poller-exit wait. The poller exits only after its blocking pump child returns, so the absence then reflects what the pump did.

**Chosen:** wait for the `sentry-trip` event and move the absence check after the poller exits. Each assertion then runs after the step that produces its evidence.

**Audit result for the rest of the file.** Every other assertion that follows a cross-process side effect already runs after the producing step:

| Assertion | Why it is safe |
|---|---|
| Handle fields after `start` (lines 187 to 190) | `start` writes the handle before it returns, inside the blocking `run` call. |
| Log matches after the process dies (lines 241, 263) and the handle after exit (line 310) | The process wrote the log before exiting. |
| Ledger reads after a wait on the same ledger (lines 282, 360, 394, 602) | The wait observed the same file. |
| `sentry-checkpoint` events after `abort-actioned` (line 296) | The checkpoint is appended before the log line. FAFF-686 fixed this. |
| Negative checks after `advisory-trip` (lines 331, 430) | An advisory tick never writes the ledger. FAFF-1137 fixed this. |
| `sentry-trip` events after the POST (lines 539, 610) | The event is appended before the pump child starts, so it precedes any POST. |
| `abort-failed` negatives (lines 643 to 645) | The ledger lock stays live for the whole bounded window, so the abort cannot succeed. |

## 4. How: behaviour

The build edits `test/sentry-poller.test.mjs` only:

```
PROCEDURE fix_andon_configured_test:
  1. Replace the existsSync assertion at line 548 with a waitUntil on andon-state.json
     (timeout ABORT_LANDING_BUDGET_MS), asserting the result with the existing message.
  2. Keep the event-ordering comment above it, and add the at-least-once comment beside the new wait.
  3. After the existing poller-exit assertion, assert posts.length === 1 again.

PROCEDURE fix_andon_unset_test:
  1. After abort-actioned settles, wait (ABORT_LANDING_BUDGET_MS) for a sentry-trip event.
  2. Assert exactly one sentry-trip event.
  3. Move the andon-state.json absence assertion below the existing poller-exit wait and assertion.
```

**Edge cases.**

- If the poller never exits within `POLLER_EXIT_BUDGET_MS`, the poller-exit assertion fails first, with its own message, before the moved absence check runs. That is the right failure to report.
- If the pump never writes its state file, the new wait fails after 30 seconds with the original message. On a healthy run it returns as soon as the file appears, at most one 200 ms poll interval later.

**Anti-pattern:** a fixed sleep before the state-file check. Why: it is the pattern FAFF-1137 removed, and it either wastes time or still loses the race under load.

**Anti-pattern:** reading `andon-state.json` contents to prove the pump ran in the unset test. Why: the unset test asserts that the pump does nothing, so the only evidence is absence after the pump step has finished.

## 5. Scenarios

```
Given the andon-configured fixture and a pump that is slow to write andon-state.json after its POST
When the test observes the POST
Then it waits for andon-state.json within ABORT_LANDING_BUDGET_MS instead of failing at once
```

```
Given the andon-unset fixture and a poller that has logged abort-actioned but not yet appended sentry-trip
When the test checks events.jsonl
Then it waits for the sentry-trip event and asserts exactly one
```

```
Given the andon-unset fixture and a pump that wrongly writes andon-state.json while disabled
When the test checks for the file after the poller has exited
Then the absence assertion fails
```

## 6. Design decision rationale

**How should the state-file assertion wait?**
Options: a `waitUntil` on the file; moving the assertion after the poller-exit wait; a fixed sleep.
**Chosen:** a `waitUntil` on the file with `ABORT_LANDING_BUDGET_MS`. It matches the ticket's scope and the FAFF-686 convention, and its failure message names the missing file. Moving it after the exit wait would report a poller-exit failure instead. A fixed sleep is the anti-pattern above.

**Where should the unset test's absence check go?**
Options: keep it after `abort-actioned`; wait for the pump in some other way; move it below the poller-exit wait.
**Chosen:** move it below the poller-exit wait. The poller exits only after its blocking pump child returns, so this is the earliest point where an absence means something, and it needs no new wait.

**Should the "exactly one notification" count be checked again?**
Options: leave the early snapshot; move it; check it a second time after the poller exits.
**Chosen:** check it a second time after the exit. The early check keeps its place in the narrative, and the late check makes the count final.

**Should delivery stay at-least-once?**
Options: keep post-then-write (at-least-once); write the cursor first (at-most-once).
**Chosen:** keep at-least-once and record it in a comment beside the assertion. A duplicate page is safer than a missed one, and the ticket keeps `andon.js` unchanged.

## 7. Open questions and assumptions

There are no open questions. The ticket's one open question, delivery semantics, is settled above with the ticket's own default.

**Assumes:** `test/sentry-poller.test.mjs` on `origin/main` still has the FAFF-472 tests at about lines 519 to 619, with the assertions described above. Validation: before editing, read the file and confirm the `existsSync(join(runDir, "andon-state.json"))` assertions and the `abort-actioned` waits are there.

## 8. Definition of done

### From why
- [ ] No assertion in the three FAFF-472 andon tests reads a file or event that the poller or pump produces later in the abort tick than the step the test last observed.

### From what
- [ ] The andon-configured test waits for `andon-state.json` with `waitUntil` and `ABORT_LANDING_BUDGET_MS`, keeping the message `the pump's own cursor/dedupe state was written`.
- [ ] A comment beside that wait records the at-least-once delivery semantics and why they are kept.
- [ ] The andon-configured test asserts `posts.length === 1` again after the poller-exit assertion.
- [ ] The andon-unset test waits for the `sentry-trip` event before asserting exactly one.
- [ ] The andon-unset test checks `andon-state.json` absence only after the poller-exit assertion.
- [ ] `git diff --stat origin/main` lists only `test/sentry-poller.test.mjs` and the committed spec. `andon.js` and `sentry-poller.js` are unchanged.

### From how
- [ ] `node --import ./test/hermetic-env.mjs --test test/sentry-poller.test.mjs` passes locally on Node 20 and on Node 24.
- [ ] A stress loop of 10 back-to-back runs of the FAFF-472 subtests (`--test-name-pattern "FAFF-472"`) passes 10 out of 10 locally.
- [ ] CI `unit` shards (Node 20) and the `typecheck` job's full suite (Node 24) pass on the PR.

**Integration smoke test.**

```
run: node --import ./test/hermetic-env.mjs --test test/sentry-poller.test.mjs
expect: every FAFF-472 subtest passes; total runtime is close to today's, because the new waits return as soon as their signal appears
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (principle 4).** One test file, about a day's work, one concern. The FAFF-1098 overlap is the only sizing finding. FAFF-1098 (Backlog) reports the same two FAFF-472 test failures, and this change fixes both races behind them, so the two tickets ship together. Recommended action: after this merges, a human decides whether to close FAFF-1098 as resolved by FAFF-1192. This prep does not change FAFF-1098.
- **Workstream fit (principles 1 and 5).** No issues. The ticket has no project. It is CI reliability work related to FAFF-1171, which made the race visible.
- **Surfaced dependencies (principle 6).** No issues. Nothing blocks the change. FAFF-1200 (In Progress) fixes unrelated local-only test failures and is not a dependency.
- **Risk profile (principle 7).** No issues. The change is test-only and reversible, with no new integration, so no spike is needed.

build-tier: complex
spec-review: approve
confidence: high

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
