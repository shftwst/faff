# FAFF-1239: review-call stays alive after a fallback backend serves findings, so a served review is reported as a deadline skip

> Spec: faffter-dark-nlspec · 2026-10-09 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1239.

This spec is for the build agent implementing FAFF-1239 and for the humans reviewing it. `review-call.mjs` races each fallback-chain backend against its time slice and, when the slice wins, moves on without cancelling the losing backend's HTTP request. That request's socket keeps the Node process alive after a later backend has served and `main` has returned exit 0, so `review-spawn.mjs` hard-kills the process at deadline plus grace and reports exit 8. This ticket cancels every chain element's network work when the element is abandoned or settles, adds a loud exit backstop to the CLI entry, and pins both with tests.

## 1. WHY

**The idea the rest turns on.** Exit codes in `review-call.mjs` are decided by `main`'s return value, but the process only ends when the event loop is empty. The CLI entry sets `process.exitCode` and waits for the loop to drain. `runReviewChain` "abandons" a slice-exhausted backend by dropping its promise, not by cancelling it, so its `http.request` stays open. A trickling stream resets the socket's inactivity timeout on every byte, so the socket can outlive the whole deadline, and the process with it. Fix the cancellation (the cause) and add a short exit backstop (so any future leak is loud and bounded, not converted into a misleading exit 8).

**Problem.**

- In FAFF-1223's Phase 2 review (`--deadline 540`, three backends, 180s slices), chain[0] and chain[1] exhausted their slices and chain[2] returned `### observation: no findings`. stderr logged `backend 3/3 … produced findings (after 2 skipped)`, the findings reached stdout, then `killable-spawn: HARD-KILL BACKSTOP firing … still alive at deadline(540s)+grace(30s)`. The wrapper returned exit 8, so a served review was recorded as `phase2: skipped-deadline`.
- Reproduced locally against today's `main`: a 127.0.0.1 server where model A trickles `: keepalive` SSE comments every 50ms and model B serves findings; `review-call.mjs --deadline 2` printed B's findings at about 1s and was still alive at 8s (SIGKILLed by the harness). A scratch prototype of the per-element abort below exited 0 at 1049ms with A's request closed at 1041ms, with and without a first-byte window.
- The other two callers block the same way: `fan-out.mjs` `runOne` resolves only on the child's `close` and has no timeout (a leaking lens stalls spec-review's `Promise.allSettled`), and `build-judge-evidence.js` `realRunReviewCall` uses `execFileSync` with no timeout.

### Design principles

**Cancel at the owner.** The chain loop is the one place that decides a backend is abandoned, so it owns the cancellation. Transport functions only honour a signal they are given; they never decide on their own.

**No caller change, no new exit code.** The fix lives inside `review-call.mjs`. The exit-code table, `review-spawn.mjs`, `killable-spawn.mjs`, `fan-out.mjs` and `build-judge-evidence.js` are unchanged.

**Direct callers stay byte-for-byte.** A `runReview` / `streamWithFirstByte` call with no signal and no first-byte window must still hand `streamFn` exactly four arguments (FAFF-885 tests at `test/adversarial-call.test.mjs` :3384, :3394 and :3459 assert this).

**A backstop must be loud.** The exit backstop exists so a served result exits 0 even if a handle leaks in future, but it must name the leak on stderr every time it fires; it must never silently mask a lifecycle bug.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` `runReviewChain` (:1928), `callReview` (:2019-2026), slice race (:2028-2036) and its comment (:2029-2031) | JavaScript | Owner of the per-element abort; the comment's "self-closes shortly" claim is false |
| same file, `streamWithFirstByte` (:1331-1352) and its header comment (:1323-1330) | JavaScript | FAFF-885 first-byte seam; gains an outer signal |
| same file, `TRANSPORT_RETRY` / `sleep` / `streamWithTransportRetry` (:1352-1386) | JavaScript | Retry loop; becomes abort-aware |
| same file, `realGet` (:1390-1410), `realStream` (:1413-1443), `preflightOpenAi` (:1447-1458) | JavaScript | Real transports; `realStream` already destroys on `opts.signal` (:1436-1439), `realGet` has no signal |
| same file, `streamOnceOpenAi` / `runReviewOpenAi` (:1460-1505), `streamOnceAnthropic` / `runReviewAnthropic` (:1507-1550), `runReview` (:1555) | JavaScript | Thread `signal` through |
| same file, CLI entry (:2435-2439) | JavaScript | Gains the exit backstop |
| `plugin/skills/faff/bin/lib/killable-spawn.mjs` (`runKillable` :120-182, `mapOutcomeExit` :70-79), `review-spawn.mjs` | JavaScript | Unchanged; hard kill maps to exit 8 by design (FAFF-793) |
| `plugin/skills/faffter-dark-adversarial-review/fan-out.mjs` `runOne` (:90), `plugin/skills/faff/bin/lib/build-judge-evidence.js` `realRunReviewCall` (:72) | JavaScript | Unchanged. `fan-out.mjs` passes `--deadline`, so it benefits; `build-judge-evidence.js` passes none, so it is not fixed here (FAFF-1244) |
| `test/adversarial-call.test.mjs` slice tests (FAFF-329 :1364-1427, FAFF-617 :3201-3310), FAFF-885 tests (:3384 on) | JavaScript (`node:test`) | Must stay green; new unit tests join this file |
| `test/impure/` | JavaScript (`node:test`) | Real-subprocess lane (runs in the Linux unit shards via the default `node --test` glob and on the macOS impure lane); home of the new regression test |

**Scope.** One per-element `AbortController` in `runReviewChain`, a signal threaded through the run, stream, preflight and retry functions, one exit-backstop helper wired into the CLI entry, comment fixes, three unit tests in `test/adversarial-call.test.mjs` and one subprocess regression test in `test/impure/`.

## 2. OUT OF SCOPE

- **Changing `review-spawn.mjs` / `killable-spawn.mjs` to recover a served result after a hard kill.** Why: FAFF-793 made exit 8 on hard kill deliberate, and the wrapper runs `stdio: "inherit"`, so it never sees the child's stdout (decision below). Extension point: `runKillable`'s `killed-deadline` settle in `killable-spawn.mjs`.
- **Timeouts or process-group kills in `fan-out.mjs` and `build-judge-evidence.js`.** Why: `fan-out.mjs` passes `--deadline`, so with this fix a served child exits promptly and an unserved one exits at its own deadline. `build-judge-evidence.js` dispatches `review-call.mjs` with no `--deadline` (`runReviewCall` at :212 and :241), so there is no slice race; a trickling unserved backend still resets the inactivity timeout, never settles, and can stall the judge indefinitely. That pre-existing gap is not closed by this ticket and is tracked as FAFF-1244 (blocked by this one). Extension point: `build-judge-evidence.js` `dispatchOne` arguments, `fan-out.mjs` `runOne`.
- **A mid-stream stall cap inside a slice.** Why: FAFF-885 left mid-stream stalls to the slice backstop, and the slice abort added here now actually tears the request down. Extension point: `realStream`'s inactivity timer.
- **A custom `http.Agent`.** Why: no keep-alive agent is configured; pooled idle sockets on the global agent are unref'd and were not the holder. Extension point: `realGet` / `realStream` request options.
- **The same exit pattern in `review-spawn.mjs` and `fan-out.mjs`'s CLI entries.** Why: neither holds network handles; the incident was review-call's. Extension point: those files' CLI entry blocks.
- **Cancelling an in-flight call when the whole chain is abandoned by its caller** (for example a parent killing review-call). Why: process death already releases every handle. Extension point: none needed.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Chain element | One iteration of `runReviewChain`'s loop that dispatches a backend (`callReview`) |
| Element signal | The `AbortSignal` of the `AbortController` created for one chain element |
| Abandoned element | An element whose slice sentinel won the race; its result is discarded |
| Settled element | An element whose `callReview` promise resolved (win or any failure class) |
| Exit backstop | The CLI-only unref'd timer that forces `process.exit(code)` if the process outlives `main` by the grace period |

### Interfaces

All new parameters are optional and trailing; absent means today's behaviour.

```
runReviewFn opts (runReview, runReviewOpenAi, runReviewAnthropic):
  + signal?: AbortSignal       # element signal; undefined for direct callers

FUNCTION streamWithFirstByte(streamFn, url, body, timeoutMs, headers, firstByteMs, signal?)   # exported, 7th param new

streamFn(url, body, timeoutMs, headers, opts?)    # unchanged shape; opts may now be { signal } alone
getFn(url, timeoutMs, headers, opts?)             # 4th param new; opts = { signal }; passed only when a signal exists

FUNCTION streamWithTransportRetry(streamCall, { policy?, deadlineMs?, signal? })   # module-private
FUNCTION sleep(ms, signal?) -> Promise<void>       # resolves early (and clears its timer) on abort

EXPORT CONST EXIT_BACKSTOP_GRACE_MS = 2000
EXPORT FUNCTION armExitBackstop(code, {
    graceMs = EXIT_BACKSTOP_GRACE_MS,
    write = (s) => process.stderr.write(s),
    exit = (c) => process.exit(c),
    flush = (cb) => process.stdout.write("", cb),
    activeResources = () => (process.getActiveResourcesInfo ? process.getActiveResourcesInfo() : []),
  } = {}) -> Timeout                               # returned timer is unref'd
```

- The injected seams on `armExitBackstop` are ordinary parameters with production defaults, the same pattern as `getFn` / `streamFn` / `checkFn`; there is no environment or test-only branch.
- Abort reasons are `Error` objects whose messages never contain `timed out` (so `isTransientTransport` can never read an abort as retryable): `"chain slice exhausted"`, `"chain element settled"`. The first-byte controller keeps its own breach path.

## 4. HOW

### Per-element abort in `runReviewChain`

One controller per dispatched element, aborted when the slice wins and, in all cases, once the element is done, so nothing the element started survives it.

```
PROCEDURE dispatch element i (only the changed steps):
  1. ac = new AbortController()                         # after the slice is computed, before callReview
  2. callReview passes signal: ac.signal to runReviewFn (alongside getFn/streamFn as today)
  3. IF totalDeadlineMs is a number:
       TRY
         result = await race(safeCall(callReview), sliceSentinel)
         clearTimeout(timer)
         IF result is SENTINEL: ac.abort(Error("chain slice exhausted"))   # BEFORE logging/continuing
       FINALLY
         IF NOT ac.signal.aborted: ac.abort(Error("chain element settled"))
     ELSE:
       TRY result = await safeCall(callReview)
       FINALLY ac.abort(Error("chain element settled"))
  4. everything after (classification, capture, logging, return/continue) unchanged
```

- The abort happens before the `continue` / `return` on the sentinel branch and before the winner's `return`, so by the time `runReviewChain` returns, every element's controller is aborted.
- Elements skipped before dispatch (missing model/host, unset key, over-window, slice underflow) create no controller.
- Rewrite the comment at :2029-2031: on a slice win the element's signal is aborted, which destroys its in-flight request (or preflight) and ends any retry backoff, so an abandoned backend cannot hold the process open; the sentinel timer stays unref'd. Name FAFF-1239. Keep the FAFF-617 comment block above the race; add one clause that "abandoned" now means "cancelled".

### Threading the signal

```
runReview(opts)                    -> passes opts through unchanged (signal included)
runReviewOpenAi({..., signal}):
  preflightOpenAi({..., signal})   -> getFn(url, timeoutMs, headers)                  IF no signal
                                      getFn(url, timeoutMs, headers, { signal })      IF signal
  streamOnceOpenAi({..., signal})  -> streamWithFirstByte(..., firstByteMs, signal)
  streamWithTransportRetry(streamCall, { deadlineMs, signal })
runReviewAnthropic({..., signal}): same, minus the preflight
```

### `streamWithFirstByte` with an outer signal

```
PROCEDURE streamWithFirstByte(streamFn, url, body, timeoutMs, headers, firstByteMs, signal):
  1. IF no positive finite window:
       IF signal is undefined: RETURN streamFn(url, body, timeoutMs, headers)          # byte-for-byte, 4 args
       ELSE:                   RETURN streamFn(url, body, timeoutMs, headers, { signal })
  2. controller = new AbortController()        # first-byte controller, as today
  3. IF signal:
       IF signal.aborted: controller.abort(signal.reason)
       ELSE: onOuter = () => controller.abort(signal.reason)
             signal.addEventListener("abort", onOuter, { once: true })
  4. timer, onFirstByte, breach promise: unchanged
  5. streamP = streamFn(url, body, timeoutMs, headers, { onFirstByte, signal: controller.signal })
  6. on streamP settle (either way): clear timer (as today) AND remove onOuter from signal
  7. RETURN race(streamP, breach)
```

- Linking is manual (`addEventListener`), not `AbortSignal.any` (decision below).
- An outer abort rejects `streamP` (the request is destroyed); `breach` stays pending and its timer is unref'd and cleared on settle, so the race rejects with the transport error. The element is already discarded, so the exact status is irrelevant.
- Update the header comment (:1323-1330): pass-through is byte-for-byte only when neither a window nor a signal is given; a signal alone yields a fifth argument `{ signal }`.

### Transports

`realStream` (:1413-1443):

```
  IF opts.signal:
    abortReq = () => r.destroy(Error("request aborted (" + reasonText(opts.signal) + ")"))
    IF opts.signal.aborted: abortReq()
    ELSE opts.signal.addEventListener("abort", abortReq, { once: true })
  on the promise settling (res "end", r "error", or the destroy path): remove abortReq from opts.signal
```

- `reasonText(signal)` is `signal.reason?.message ?? String(signal.reason ?? "aborted")`. `streamWithFirstByte` aborts its first-byte controller with `Error("first-byte breach")` (it passes no reason today), so a breach reads `request aborted (first-byte breach)`. The breach race already rejects with `FirstByteBreachError` and swallows this error, so the text is diagnostic only; no test or doc depends on the old `first-byte breach: socket torn down` wording. The message must not contain `timed out`.
- Removing the listener on settle stops a later element-settled abort from destroying a request that already completed (its socket may be back in the agent pool).
- Replace the FAFF-885 comment at :1434-1435 with one that covers both aborts (first-byte breach and chain cancellation).

`realGet` (:1390-1410) gains `opts = {}` as a fourth parameter with the same destroy-on-abort and listener-removal logic.

### Abort-aware retry

```
PROCEDURE streamWithTransportRetry(streamCall, { policy, deadlineMs, signal }):
  FOR attempt in 1..policy.attempts:
    IF signal?.aborted: lastErr = lastErr ?? signal.reason; BREAK
    TRY RETURN { ok: true, out: await streamCall() }
    CATCH e:
      IF signal?.aborted: lastErr = e; BREAK              # checked FIRST: never retry or rethrow an abort
      IF isFirstByteBreach(e): lastErr = e; BREAK         # unchanged
      IF NOT isTransientTransport(e): THROW e             # unchanged
      ... exhaustion and delay computation unchanged
      await sleep(delay, signal)
  RETURN { ok: false, error: lastErr }
```

- `sleep(ms, signal)`: if `signal` is already aborted, resolve immediately; otherwise resolve on the timer or on abort, whichever is first, clearing the timer and removing the listener either way.
- The truncation retry (second `streamOnce*` inside `streamCall`) needs no change: an aborted signal makes `realStream` destroy before sending.

### Exit backstop in the CLI entry

```
PROCEDURE armExitBackstop(code, seams):
  t = setTimeout(fire, graceMs); t.unref(); RETURN t
  fire:
    1. kinds = activeResources() joined with ", " (or "unknown" if empty or the call throws)
    2. write("review-call: process still alive " + graceMs + "ms after main returned exit " + code
             + "; leaked handle(s): " + kinds + "; forcing exit " + code + " (FAFF-1239)\n")
    3. flush(() => exit(code))          # stdout's queued writes go out before the forced exit

CLI entry (:2435-2439):
  main(argv)
    .then((code) => { process.exitCode = code; armExitBackstop(code); })
    .catch((e) => { write review-call error as today; process.exitCode = EXIT.OTHER; armExitBackstop(EXIT.OTHER); })
```

- The timer is unref'd, so on the healthy path (empty loop) the process exits normally and the backstop never fires.
- **Chosen:** 2000ms grace. Against review-spawn's default 30s grace, 2s leaves 28s of margin, so the backstop always beats the hard kill; it is long enough for a queued stdout write to a slow pipe reader to flush; and it only costs time when something has already leaked.
- Wire it only into the CLI entry. `runReviewChain` and `main` stay free of `process.exit` so in-process callers (tests, `test/adversarial-backends.test.mjs` calling `main`) are unaffected.

**Anti-pattern:** calling `process.exit(code)` immediately after `main` resolves. Why: it can drop queued stdout on platforms where pipe writes are asynchronous (macOS), and it hides every future leak instead of naming it.

**Anti-pattern:** clearing the abandoned request with `unref()` on its socket instead of destroying it. Why: the provider keeps generating, the client keeps buffering, and the request still holds memory and a connection; only `destroy` ends the work.

**Anti-pattern:** using `Promise.race`'s loser as "cancelled" anywhere new. Why: that assumption is the bug.

### Edge cases

- **Slice wins while the element is in preflight.** `realGet` is destroyed; `preflightOpenAi` returns `unreachable`; the result is discarded.
- **Slice wins during a backoff sleep.** The sleep resolves early, the loop sees the abort and returns `transport-failed`; discarded.
- **Slice wins between attempts (truncation retry about to start).** The next `realStream` sees an already-aborted signal and destroys before sending; no request reaches the provider.
- **Element settles with a win.** `ac.abort("chain element settled")` fires after `realStream` removed its listener, so nothing is destroyed; the pooled keep-alive socket is untouched.
- **Last element's slice exhausted (chain exhausted, exit 8).** Same abort; the process then exits promptly with the genuine exit 8.
- **No `--deadline`.** No race, but the element still gets a controller aborted on settle; behaviour is unchanged because a settled element has nothing left in flight.
- **Injected fakes that ignore the signal** (`runReviewFn`, `getFn`, `streamFn` in tests). They keep working: the signal is an extra key or trailing argument they never read. Their pending timers are the test's own concern, as today.
- **`main` throws.** The backstop is armed with `EXIT.OTHER`, matching today's `process.exitCode`.
- **stdout reader has gone away.** The flush callback receives an error (EPIPE) and still calls `exit(code)`.

### Failure modes

- **The holder is not (only) the abandoned request.** How you'd know: the subprocess regression test passes but production still logs the backstop line, and its `leaked handle(s)` list names something other than `TCPSocketWrap`. What it means: proceed (the backstop keeps the served exit 0 and names the handle); open a follow-up for that handle.
- **The backstop fires routinely.** How you'd know: `review-call: process still alive` lines in review run logs or `.faff/` captures after this ships. What it means: a regression in cancellation; the backstop is masking cost (2s per run), so fix the leak rather than raising the grace.
- **A provider counts aborted requests.** How you'd know: provider-side billing or rate-limit counts rise for slice-exhausted backends. What it means: proceed; an aborted request costs at most what the abandoned one cost today, and usually less.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a 127.0.0.1 server where model A streams ": keepalive" SSE comments every 50ms indefinitely and model B returns a valid "### observation: no findings" SSE body
And review-call.mjs is spawned with a two-element --backends-json chain [A, B] and --deadline 2
When B serves
Then the child exits with code 0, stdout contains "### observation: no findings", stderr does not contain "process still alive", the server observes A's request closed before the child exits, and the child exits within 3000ms of spawn
```

```
Given runReviewChain with a two-element chain, a runReviewFn fake that records each call's opts.signal, element 0 never settling and element 1 returning findings, and totalDeadlineMs 200
When the chain returns
Then element 0's recorded signal is aborted with reason message "chain slice exhausted", element 1's recorded signal is aborted, and the result exit is EXIT.OK
```

```
Given armExitBackstop(0, { graceMs: 20 }) with injected write, exit and flush seams and the test holding the event loop open
When 100ms pass
Then write was called once with a line starting "review-call: process still alive 20ms after main returned exit 0", exit was called once with 0, and the returned timer reports hasRef() === false
```

- The healthy path never fires the backstop: no existing test sees a `process still alive` line, and the regression scenario above asserts its absence.

## 6. DESIGN DECISION RATIONALE

| Decision | Options considered | Outcome |
|---|---|---|
| What holds the process open (ticket question 1) | Slice sentinel timer; first-byte timer; retry backoff sleep; pooled keep-alive socket; the abandoned backend's active HTTP request | **Chosen:** the abandoned backend's active HTTP request |
| Where cancellation lives | In each transport (self-timeouts); a whole-chain controller; one controller per chain element | **Chosen:** one `AbortController` per dispatched element in `runReviewChain` |
| When to abort | Only on the slice sentinel; also once the element settles | **Chosen:** on the sentinel, and always once the element settles |
| Merging the element signal with the first-byte controller | `AbortSignal.any`; manual `addEventListener` linking | **Chosen:** manual linking |
| FAFF-885 pass-through arity | Always pass `opts`; pass `{ signal }` only when a signal exists | **Chosen:** append `{ signal }` only when a signal exists |
| Preflight | Leave `realGet` on its 5s timeout; thread the signal | **Chosen:** thread the signal into `realGet` |
| Retry backoff | Leave it (capped by the slice); make it abort-aware | **Chosen:** abort-aware loop and `sleep` |
| Exit backstop | None (fix the leak only); immediate `process.exit`; unref'd grace timer with a loud line, CLI only | **Chosen:** unref'd 2000ms timer with a loud stderr line, CLI entry only |
| review-spawn after a hard kill (ticket question 2) | Capture child stdout and honour the child's own exit; leave it | **Chosen:** leave `review-spawn.mjs` / `killable-spawn.mjs` unchanged |
| Other callers | Add timeouts to `fan-out.mjs` / `build-judge-evidence.js`; no change | **Chosen:** no change |
| `faffter-dark-adversarial-review/SKILL.md` | Reword "abandoned at its slice"; no change | **Chosen:** no change |
| Where the tests live | All in `test/adversarial-call.test.mjs`; subprocess test in `test/impure/` | **Chosen:** unit tests in `test/adversarial-call.test.mjs`, subprocess regression in `test/impure/review-call-served-exit.test.mjs` |
| Testing the backstop | Subprocess with a deliberately leaked handle via an env hook; unit test through injected seams | **Chosen:** unit test through `armExitBackstop`'s injected seams |

**Holder (question 1).** Every timer is either cleared or unref'd: the slice sentinel (:2034), the first-byte timer (:1344), the killable-spawn timer. The backoff `sleep` is ref'd but capped by the slice end (`delay = min(delay, deadlineMs - now)`, :1380-1381), and the truncation retry after the slice gets a 1ms timeout from `perAttempt`'s `Math.max(1, …)`; neither outlives the slice by more than a moment. No `http.Agent` is configured, and pooled idle keep-alive sockets are unref'd by Node's agent. What remains is the abandoned element's live request: `res.on("data")` keeps reading (:1422) and `r.setTimeout(timeoutMs)` (:1433) is a socket inactivity timeout reset by every chunk, with `timeoutMs` about 180s here. Both GLM backends got a first byte (a breach at 60s would have logged `transport-failed`, not `slice … exhausted`), and a trickle of reasoning deltas or SSE comments (which `accumulateSse` ignores, :1185) keeps resetting the timer. chain[1] started at about 180s, so any byte after about 390s holds its socket past 570s. The local reproduction confirms the mechanism: the process stayed up until the trickling request was closed.

**Per-element controller, abort on sentinel and settle.** The chain loop is the only code that knows an element is abandoned. A whole-chain controller cannot cancel element 0 without also cancelling element 1. Aborting on settle as well costs nothing and makes the invariant simple to state and test: when an element is done, nothing it started is alive.

**Manual linking over `AbortSignal.any`.** The adopter floor is "Node 20 or later" (`AGENTS.md`); `AbortSignal.any` arrived in 20.3.0, so 20.0 to 20.2 would throw. Manual linking is three lines, works on every 20.x, and lets `streamWithFirstByte` remove its listener on settle, which avoids listener build-up across up to six attempts per element.

**Pass-through arity.** FAFF-885 requires the no-window call to be byte-for-byte the pre-FAFF-885 call, and three tests assert four arguments. That constraint is about direct callers; the chain now always has a signal, so chain-driven calls gain a fifth argument `{ signal }`. Appending only when a signal exists keeps every direct call and test unchanged while letting the slice abort work without a first-byte window. The constraint is narrowed, not dropped: the header comment says so.

**Preflight.** `realGet`'s 5s timeout bounds it, but a slice that ends during preflight would otherwise leave a request open for up to 5s after the element is abandoned. Threading the same signal is a few lines and makes "nothing survives the element" true without exceptions.

**Retry backoff.** Without the abort check, an abort-induced error could be misread (it is not transient, so it would be rethrown as `request-failed`), and a sleeping loop would wake and start one more attempt. The check costs one line per site and keeps the abandoned element quiet.

**Exit backstop.** The leak fix closes the known holder, but the incident shows the cost of any future leak is a served review recorded as a skip. A backstop in the CLI entry turns that into a served review plus a loud, diagnosable stderr line naming the handle kinds. An immediate `process.exit` would hide leaks and risk truncating stdout. The in-process `runReviewChain` / `main` have no production in-process callers (only tests import them; `eval/cli-driver.mjs` imports only `normaliseCleanRefutation`), so the CLI entry is the only place that needs it, and keeping `process.exit` out of `main` keeps it testable.

**review-spawn unchanged (question 2).** FAFF-793 deliberately maps a hard kill to exit 8 with no new verdict semantics, and the wrapper runs `stdio: "inherit"` so the target's output flows straight through; it cannot know whether findings were written. Teaching it to parse output would duplicate review-call's classification in the wrapper. With this ticket, a served review exits 0 within about 2s at worst, so the hard kill is unreachable on the served path and stays the backstop for genuinely wedged processes.

**Other callers.** `fan-out.mjs` spawns `review-call.mjs` with `--deadline`, so once a served child exits promptly the fan-out resolves promptly and an unserved child ends at its deadline. `build-judge-evidence.js` passes no deadline, so the slice abort never fires there; a served judge call now exits promptly, but an unserved trickling one can still hang. That caller needs its own deadline, which is FAFF-1244's scope, not a timeout bolted on here.

**SKILL.md.** The skill describes a hung backend as "abandoned at its slice" (:154, :258) and the wrapper's healthy path as review-call exiting well inside the budget (:246). Neither states the self-close assumption, and both are true after this fix. Per `docs/reference/skill-authoring.md` (lean, no changelog), no edit.

**Test placement.** The unit tests use the existing fakes and imports in `test/adversarial-call.test.mjs`. The regression test spawns a real child and binds a real socket, which is what `test/impure/` holds (real subprocess, OS-divergent behaviour: stdout pipe flushing and socket teardown differ between Linux and macOS). The default `node --test` glob still runs it in the Linux unit shards.

**Backstop test.** An environment-gated leak hook would put a test-only branch in production code. `armExitBackstop`'s seams are ordinary default parameters, the file's established injection pattern, and test the firing logic directly; the subprocess test then proves the leak fix independently by asserting the backstop line is absent.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none. Both ticket questions are answered above (holder: the abandoned request; review-spawn: unchanged).

**Assumptions:**

- **Assumes:** `process.getActiveResourcesInfo` exists on Node 20 (added in 17.3.0, experimental). Validation: `node -e "console.log(typeof process.getActiveResourcesInfo)"` on the Node 20 CI image prints `function`; the helper already falls back to `unknown` if it is missing or throws, so a wrong assumption only weakens the diagnostic.
- **Assumes:** a client-side `ClientRequest.destroy()` closes the socket promptly enough for the server to see `close` within the regression test's bound. Validation: the scratch reproduction observed A's request close 8ms after the slice abort.

## 8. DONE

### From WHY
- [ ] With a two-element chain where element 0 trickles forever and element 1 serves, spawned `review-call.mjs --deadline 2` exits 0 with findings on stdout within 3000ms of spawn (today it never exits on its own)
- [ ] `review-spawn.mjs`, `killable-spawn.mjs`, `fan-out.mjs` and `build-judge-evidence.js` are unchanged in the diff
- [ ] Every existing test in `test/adversarial-call.test.mjs` passes unchanged, including the FAFF-885 four-argument pass-through tests (:3384, :3394, :3459) and the FAFF-329 / FAFF-617 slice tests

### From WHAT
- [ ] `runReview`, `runReviewOpenAi` and `runReviewAnthropic` accept an optional `signal` and pass it to preflight, stream and retry
- [ ] `streamWithFirstByte` takes a seventh `signal` parameter; with no window and no signal `streamFn` gets four arguments; with no window and a signal it gets a fifth argument `{ signal }`
- [ ] `getFn` receives a fourth argument `{ signal }` only when a signal exists
- [ ] `EXIT_BACKSTOP_GRACE_MS` is exported and equals 2000; `armExitBackstop` is exported with the seams listed in section 3 and returns an unref'd timer

### From HOW (behaviour)
- [ ] Unit: `runReviewChain` with a recording `runReviewFn`, element 0 never settling and element 1 serving, `totalDeadlineMs: 200`: element 0's signal is aborted with reason message `chain slice exhausted`, element 1's signal is aborted after the win, and `exit` is `EXIT.OK`
- [ ] Unit: `runReviewChain` without `totalDeadlineMs`, one serving element: its recorded signal is aborted when the chain returns
- [ ] Unit: `runReview` against a 127.0.0.1 `http.createServer` that serves `GET /v1/models` listing the model and whose `POST /v1/chat/completions` handler writes headers and never ends the response, with the real transport and `firstByteMs` unset, given a signal aborted after 100ms: the server observes the request close and `runReview` resolves (status not `ok`) within 1000ms
- [ ] Unit: the same with `firstByteMs: 60000` (linked path): request closed and resolved within 1000ms
- [ ] Unit: `streamWithFirstByte` with a pre-aborted outer signal and a window: the fake `streamFn` receives an already-aborted `opts.signal`
- [ ] Unit: preflight abort: with the real transport against a 127.0.0.1 server whose `GET /v1/models` handler never responds, a signal aborted after 100ms makes the server observe the preflight request close and `runReview` resolve with status `unreachable` within 1000ms
- [ ] Unit: listener removal: after `realStream` (and `realGet`) settle successfully, aborting the signal destroys nothing (the request's `destroy` is not called, observed through a wrapped request or the server seeing no reset) and the signal has no remaining `abort` listener added by the transport
- [ ] Unit: `preflightOpenAi` without a signal calls `getFn` with exactly three arguments; with a signal, four
- [ ] Unit: an abort during a transient-retry backoff ends the retry loop without another `streamFn` call and resolves in under 500ms (fake `streamFn` rejects with an `ECONNRESET` error and counts calls; the signal is aborted 50ms into the 1500ms first backoff; expect 1 call and status `transport-failed`)
- [ ] Unit: `armExitBackstop(0, { graceMs: 20, write, exit, flush })` calls `write` once with a line starting `review-call: process still alive 20ms after main returned exit 0` and containing `leaked handle(s):`, then `exit(0)` once; `timer.hasRef()` is false
- [ ] Unit: the catch-path wiring is exercised: the CLI entry's `.then`/`.catch` handlers are extracted into an exported helper (or the entry is structured so a test can drive it) and a rejected `main` sets `process.exitCode` to `EXIT.OTHER` before arming `armExitBackstop(EXIT.OTHER)`
- [ ] The CLI entry arms `armExitBackstop(code)` after setting `process.exitCode`, and `armExitBackstop(EXIT.OTHER)` on the catch path; `main` and `runReviewChain` contain no `process.exit`
- [ ] Abort error messages never match `/timed out/`

### From HOW (regression, `test/impure/review-call-served-exit.test.mjs`)
- [ ] An in-process 127.0.0.1 server serves `GET /v1/models` listing models `A` and `B`; `POST /v1/chat/completions` for `A` writes `: keepalive\n\n` every 50ms and records when its request closes; for `B` it returns one `data:` chunk with `### observation: no findings` and `finish_reason: "stop"`, then `data: [DONE]`
- [ ] The child is started with async `spawn` (not `spawnSync`, which would block the in-process server), `stdio: ["ignore", "pipe", "pipe"]`, args `--backends-json <tmp> --system <tmp> --diff <tmp> --deadline 2`
- [ ] Assertions: exit code 0; stdout contains `### observation: no findings`; stderr does not contain `process still alive`; A's request closed before the child's `exit`; elapsed under 3000ms (the backstop would push it past about 3000ms, so the test proves the leak fix, not the backstop)
- [ ] A second case with `first_byte_timeout: 0` on both backends meets the same assertions
- [ ] The test kills the child if it is still alive at 10s and always clears its intervals and closes the server (`closeAllConnections`), so a regression fails fast instead of hanging the file; the file runs in under 5s

### From HOW (prose)
- [ ] The comment at `review-call.mjs` :2029-2031 states that the element signal is aborted on a slice win and the request destroyed (FAFF-1239); no remaining comment claims the abandoned socket self-closes
- [ ] The `streamWithFirstByte` header comment and the `realStream` abort comment describe the signal-only pass-through and both abort sources
- [ ] `faffter-dark-adversarial-review/SKILL.md` is unchanged and `faff validate-adapters` still passes

### Integration smoke test

```
1. start server: A trickles ": keepalive" forever, B serves "### observation: no findings"
2. spawn node review-call.mjs --backends-json [A, B] --system s --diff d --deadline 2
3. at about 1s: stderr "[chain] openai/A slice 1s exhausted → advancing (exit 8)"; server sees A's request close
4. B serves; stdout carries the findings; main returns 0
5. child exits 0 at about 1.1s; no "process still alive" line
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (P4):** No issues.
  - The cancellation fix (the cause) and the CLI exit backstop (the defence) ship together: the regression test proves the fix by asserting the backstop line is absent, and the backstop alone would hide the leak.
  - One production file, three unit tests and one `test/impure/` file fit a single 1 to 3 day unit, consistent with `build-tier: complex`.
  - No sibling must ship with it: FAFF-1240 (parser run-on), FAFF-1243 (eval fixtures), FAFF-1204 (routing) and FAFF-1228 (empty 200 diagnosis) each have their own outcome and done-bar.
- **Workstream fit (P1 + P5):** No issues for this ticket; one loose-accumulation observation.
  - FAFF-1239, FAFF-1240, FAFF-1228 and FAFF-1067 sit project-less and share one outcome: "an adversarial review from a non-Claude backend is recorded as what actually happened" (served, clean, faulted or skipped), not as a parse or lifecycle artefact.
  - What to do: let the next `/faff-plot rehome` pass propose an outcome-led home for that cluster. FAFF-1243 and FAFF-1204 are adjacent, not shared.
- **Surfaced dependencies (P6):** two edges added at prep.
  - FAFF-1228 plans a same-backend retry inside the stream functions this spec reshapes (`realStream`, `streamWithFirstByte`, `streamWithTransportRetry`). A retry written without the abort check would reintroduce this leak. Linked: FAFF-1228 is now blocked by FAFF-1239.
  - FAFF-1067 reworks the first-byte timestamp on the `onFirstByte` / `streamWithFirstByte` seam this spec links to the outer signal. Linked as related.
  - The out-of-scope line for `fan-out.mjs` / `build-judge-evidence.js` timeouts pointed at FAFF-793's deferred scope, which has no open owner; reworded at prep to say why no timeout is needed once a served child exits promptly.
- **Risk profile (P7):** No issues; no spike needed.
  - The core unknown (what holds the process open) is settled by a local reproduction and a scratch prototype (exit 0 at 1049ms, request closed at 1041ms).
  - The two remaining platform assumptions (`process.getActiveResourcesInfo` on Node 20, prompt `destroy()` teardown) each carry a check and a safe fallback; manual signal linking avoids the Node 20.0 to 20.2 `AbortSignal.any` gap.

confidence: high
build-tier: complex
spec-review: accept (agent, after round 1: one minor objection (architectural) fixed in place under the operator's standing fix-minors-and-build preference)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" },
    { "marker": "assumes" }
  ] }
```
