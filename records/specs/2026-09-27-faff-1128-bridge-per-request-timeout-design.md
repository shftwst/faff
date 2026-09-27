# Spec: FAFF-1128 - per-request timeout for the Node reflection bridge

> Spec: faffter-dark-nlspec · 2026-09-26 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1128.

This is the buildable spec for FAFF-1128. It is written for the build agent that will edit `plugin/skills/faff/bin/faff-bridge-node.mjs`, its wire-contract doc, and its tests, and for the human reviewers gating the change. It ships no new runnable surface: one existing file, one normative doc, and test coverage.

## 1. WHY - Problem and Principles

**The model this turns on.** The bridge answers each RPC on a single-threaded event loop, and three of its dispatch paths finish by `await`-ing a thenable the reflected SUT returned. An `await` with no deadline hands the request's completion entirely to the SUT: if the returned promise never settles, the request never completes, and because the bridge processes that request to completion before the socket is freed, the whole session stays wedged for the process lifetime. The fix is to wrap each of those three awaits in a bounded `Promise.race` so a never-settling thenable resolves to a wire fault after a deadline instead of hanging forever. Because JavaScript cannot cancel a promise and the reflected op accepts no abort signal, the deadline frees the *request and socket*, not the underlying op; the orphaned op is reaped later at run scope.

**Problem statement.** Today `dispatch(req, state)` awaits a returned thenable with no bound (`open` line 224, `call` line 242, `call_static` line 256), so a SUT op that returns a never-resolving promise hangs the request and the session until the process dies. The evaluator's run `--deadline` and the env's teardown SLA eventually reap it, but only at run scope, minutes later. This change adds a bridge-side per-request deadline that fail-fasts the hung op as a wire fault, freeing the session immediately.

**Design principles.**

- **The two failure planes stay disjoint.** A `WireError` is an INFRASTRUCTURE fault the evaluator reads as `needs-human`; a `result.outcome=="threw"` is SUT evidence to assert on (`session-rpc-wire.md` lines 100, 18). A timeout is invoked-but-never-settled: an infra fault, not SUT evidence. It MUST land on the WireError plane, never as a synthetic `threw`. Any implementation that maps a timeout to `resultThrew(...)` is wrong by construction.

- **Preserve the pre-invocation invariant of `dispatch_unavailable`.** The file already states (line 27) that `dispatch_unavailable` is decided entirely before invocation and every failure from invocation onward is `threw`. A timeout is a third category that breaks that binary, so it must not be forced onto either existing code without a decision (see D1).

- **Mirror the shipped timeout shape, drop what does not apply.** `streamWithFirstByte` (review-call.mjs lines 1258-1278) is the house pattern: pass-through unless a positive finite window is set, arm a `setTimeout`, `timer.unref()`, `Promise.race([work, breach])`, swallow the loser branch, always clear the timer. Reuse that shape. Do not copy its `AbortController`: `streamWithFirstByte` aborts a real `fetch` socket, but a reflected SUT op accepts no signal, so an `AbortController` here would be inert code (see D4).

- **No new operator surface for an automation gap.** The bridge stays config-resolution-free (it reads CLI flags only). The tunable's home is the central `DEFAULTS` map; the composing occupant passes it through. This ticket adds no manual verb or operator step.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff-bridge-node.mjs` | Node ESM | The bridge; the only file whose behaviour changes. |
| `docs/reference/session-rpc-wire.md` | Markdown (normative) | The wire contract; the WireError enum + Appendix A catalogue must stay in sync with the bridge. |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node ESM | `streamWithFirstByte` - the timeout pattern to mirror (race, `unref`, swallow-loser). |
| `plugin/skills/faff/bin/lib/config.js` | Node ESM | `DEFAULTS` map; `_secs` scalar convention; home for `bridge.request_timeout_secs`. |
| `test/faff-bridge-node.test.mjs` | Node test | Pure-core seam via `mkState()` + inline MANIFEST/SUT. |
| `test/impure/faff-bridge-node.test.mjs` | Node test | Real-TCP seam via `realListen` on port 0. |

**Scope statement.** This is a bridge-side, per-request fail-fast on a single `open`/`call`/`call_static` invocation, orthogonal to the evaluator's whole-run deadline and the env's stand-up/teardown SLA.

## 2. OUT OF SCOPE

- **Wiring the composing occupant to read and pass the flag.** The bridge's command line is composed by the env code-interface branch (FAFF-1105), not by the bridge. This ticket declares the `bridge.request_timeout_secs` default and the `--request-timeout-secs` flag; making the occupant read it via `faff config get` and append it to the argv is FAFF-1105's follow-on. *Extension point:* the env-compose code-interface branch that builds the bridge argv (`--manifest --module --host --port --wire`).

- **Cancelling the orphaned SUT op.** A timed-out promise keeps running in the background until process teardown; JavaScript cannot cancel it and the reflected op takes no abort signal. Freeing the *request/session/socket* is the goal; reaping the op is run-teardown's job. *Extension point:* a future runtime that plumbs an `AbortSignal` into the reflected call surface.

- **Bounding a synchronous busy-loop op.** A synchronous op that never returns blocks the event loop, so no in-process timer can fire. Only an async (thenable) hang is in reach. *Extension point:* a worker-thread or subprocess isolation model for the reflective invocation.

- **The evaluator's reading of the new WireError code.** How the evaluator maps `dispatch_timeout` to `needs-human` is the evaluator RPC-reading ticket's (not yet shipped). This ticket only emits the code and documents it. *Extension point:* the evaluator's WireError-to-verdict mapping.

- **Replacing run-level deadlines.** No change to the evaluator `--deadline` (exit 8) or the env health-poll/teardown SLA. This is additive and per-request.

- **The threw plane.** No change to `resultThrew`, `toThrownError`, `respondWithValue`, or the `NonJSONReturn` handling.

## 3. WHAT - Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Per-request timeout | A deadline bounding a single `open`/`call`/`call_static` invocation's thenable await, after which the request resolves to a wire fault. |
| Pass-through | The behaviour when no positive finite timeout is configured: the await is unbounded, byte-for-byte the FAFF-1104 behaviour. |
| Orphaned op | A timed-out invocation's promise that keeps running in the background until process teardown. |
| Breach | The timer branch of the `Promise.race` winning, producing the timeout fault. |

**Config default (config.js `DEFAULTS`).**

```
KEY "bridge.request_timeout_secs":
  type: string scalar (seconds), mirroring producer_tick_max_secs / operation_deadline_secs
  default: "120"                 # see D3
  meaning: the per-request deadline the composing occupant passes to the bridge
```

`bridge` is a **new top-level config namespace**, so declaring the `DEFAULTS` entry alone is not enough to make the value settable. Register it too, or the tunability claim in D3 is false:

```
config.js:
  WRITABLE_NAMESPACES += "bridge"     # so `config set bridge.request_timeout_secs N` passes the typo guard
                                       # (RECOGNISED_NAMESPACES derives from this, so the known-key lint follows)
.faffrc.example.yaml:
  add a bridge.request_timeout_secs example line   # required by configSetSelftest's example-drift check
                                                     # once bridge is WRITABLE
```

**Bridge CLI flag (`parseBridgeArgs`).**

```
FLAG --request-timeout-secs N     # optional; spec arity 1
  parsed to a Number
  absent OR non-positive OR non-finite -> disabled (pass-through)
  positive finite                       -> armed; internal deadline = N * 1000 ms
```

**State extension (the injectable seam - D6).**

```
RECORD BridgeState (extended):
  wireMajor: Int
  allowlist: Allowlist
  moduleRoot: Object
  sessions: Map
  requestTimeoutMs: Int | undefined     # undefined => pass-through
  timers: { set: fn, clear: fn }        # defaults { set:setTimeout, clear:clearTimeout }; injected in unit tests
```

**WireError code (the enum, two places - D1).**

```
ENUM WireError.code (extended):
  malformed_request | unknown_method | unknown_session
  | unsupported_version | dispatch_unavailable
  | dispatch_timeout                    # NEW: invoked but never settled within the deadline
```

`dispatch_timeout` is added to `WIRE_ERROR_CODES` (faff-bridge-node.mjs lines 50-52) AND to the `RECORD WireError` enum + Appendix A catalogue in `session-rpc-wire.md` (lines 95-96, 249-255). Terminal: yes.

**Design decisions.** See section 6 for D1-D6 with markers. The load-bearing one for the wire contract is D1 (`dispatch_timeout` vs reusing `dispatch_unavailable`).

## 4. HOW - Behaviour

**Architecture.** A single module-private helper wraps the thenable await at all three invocation sites. It mirrors `streamWithFirstByte`: pass-through when the deadline is not armed, otherwise race the work against a timer that rejects a private sentinel. The sentinel is discriminated in each site's existing `catch` and mapped to a `dispatch_timeout` WireError; every other rejection stays `threw`, unchanged.

**Behaviour summary.** `raceToDeadline` returns the work promise untouched when no deadline is set, and otherwise resolves to whichever of the work or the timer settles first, always clearing the timer and swallowing a late loser rejection.

```
FUNCTION raceToDeadline(workPromise, timeoutMs, timers):
  1. IF timeoutMs is not a positive finite number:
       RETURN workPromise                         # pass-through, no timer armed
  2. LET timer
  3. breach = new Promise((_, reject):
       timer = timers.set(() => reject(new TimeoutBreachError(timeoutMs)), timeoutMs)
       IF timer.unref is a function: timer.unref())   # never keeps the process alive
  4. workPromise.then(clear, clear)                # swallow loser + always clear
       where clear = () => IF timer: timers.clear(timer); timer = undefined
  5. RETURN Promise.race([workPromise, breach])
```

`TimeoutBreachError` is a module-private sentinel class (mirroring `FirstByteBreachError`), so the `catch` can tell a timeout from a genuine SUT rejection.

**The three wrapped sites.** Each keeps its existing `try/catch`; only the awaited value and the catch discrimination change.

```
PROCEDURE call_site (call, line ~240-246; call_static ~254-260 identical shape):
  1. r = session.instance[op](...args)            # unchanged: may hang synchronously - out of reach
  2. IF r is thenable:
       r = await raceToDeadline(r, state.requestTimeoutMs, state.timers)
  3. RETURN respondWithValue(wire, id, r)
  CATCH err:
    a. IF err instanceof TimeoutBreachError:
         RETURN wireError(wire, id, "dispatch_timeout",
                          `op did not settle within ${state.requestTimeoutMs}ms`)
    b. ELSE RETURN resultThrew(wire, id, toThrownError(err))

PROCEDURE open_site (line ~222-230):
  1. instance = construct(...)                     # unchanged
  2. IF instance is thenable:
       instance = await raceToDeadline(instance, state.requestTimeoutMs, state.timers)
  3. mint session, store, RETURN returned{ session_id }
  CATCH err:
    a. IF err instanceof TimeoutBreachError:
         RETURN wireError(..., "dispatch_timeout", ...)   # mint NO session (no instance to address)
    b. ELSE RETURN resultThrew(...)
```

**Wiring the deadline into state.** `main()` computes `requestTimeoutMs` from the parsed flag and threads it plus `timers` into the state object (line ~333):

```
requestTimeoutMs = (secs is finite AND secs > 0) ? secs * 1000 : undefined
state = { ...existing, requestTimeoutMs, timers: io.timers || { set:setTimeout, clear:clearTimeout } }
```

**Session semantics on timeout (D5).** On a `call` timeout the session is RETAINED in `sessions`, not auto-closed. The socket is released by the normal HTTP path (the handler sends the 200 WireError, lines 349-350). A later `close(session_id)` disposes it through the existing idempotent path. On an `open` timeout no session is minted (there is no settled instance to address), matching the ctor-throw rule (line 226 mints, line 229 does not).

**Edge cases.**

- **No deadline configured** (flag absent/non-positive): `raceToDeadline` is pass-through; behaviour is byte-for-byte FAFF-1104. The impure suite's existing tests must still pass unchanged.
- **Op settles just before the timer fires**: `Promise.race` resolves to the work value; the loser timer is cleared in step 4; no `dispatch_timeout`.
- **Op settles just after the timer fires**: breach wins; the work promise's later settle is swallowed by the step-4 handler, so no `unhandledRejection`.
- **Synchronous return** (non-thenable): step 2's guard skips the race entirely; instant, no timer.
- **A rejected (not hung) thenable**: rejects fast, caught as a normal SUT throw, stays `threw` - the timeout never enters it.

**Anti-pattern:** mapping a timeout to `resultThrew(...)` with a synthetic error type. Why: it violates the disjoint-planes rule; the evaluator would read a hang as SUT evidence to assert on instead of an infra fault to escalate.

**Anti-pattern:** adding an `AbortController` to mirror `streamWithFirstByte` verbatim. Why: the reflected op holds no signal, so `abort()` cannot stop it; the controller would be dead code that implies a cancellation the bridge cannot deliver.

**Anti-pattern:** auto-closing the session on a `call` timeout. Why: it opens a second disposal path that races the orphaned op's late settle and complicates the idempotent-close guarantee; retention plus run-teardown is simpler and correct.

**Failure modes.**

- **The failure:** a synchronous busy-loop op blocks the event loop, so the timer callback never runs and the request still hangs. **How you would know:** an impure test with a synchronous non-returning op never receives a response even with a small deadline set. **What it means:** narrow, not abandon - the ticket targets a hung *thenable*; document the synchronous case as out of reach (section 2) rather than claim coverage it does not have.

- **The failure:** the orphaned op keeps mutating shared state or holding handles after the breach, so a retained session is observably inconsistent. **How you would know:** state read by a follow-up call on a timed-out session disagrees with the wire history. **What it means:** proceed - the evaluator reads `dispatch_timeout` as `needs-human` and stops asserting; inconsistency is bounded by the per-env bridge lifetime and teardown.

- **The failure:** the default deadline is too tight and fires on a legitimately slow op. **How you would know:** `dispatch_timeout` on ops that would have returned given more time; `needs-human` noise in verdicts. **What it means:** proceed with a tunable - `bridge.request_timeout_secs` overrides the default (D2/D3).

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a bridge state with requestTimeoutMs armed and a SUT op that returns a never-settling promise
When a call request invokes that op
Then the response carries a top-level error{ code:"dispatch_timeout" } (never a result)
And no result.outcome=="threw" is emitted for it
```

```
Given a bridge state with requestTimeoutMs armed and a SUT op that resolves within the window
When a call request invokes that op
Then the response is result{ outcome:"returned", value:<the op's value> }
And the timer is cleared (no dispatch_timeout, no dangling handle)
```

```
Given a real bridge (realListen) with a small requestTimeoutMs and a hung-thenable op
When a call request is POSTed over TCP
Then a terminal WireResponse{ error.code:"dispatch_timeout" } returns within the window
And the socket is released
And a subsequent close on that session returns an idempotent returned no-op
```

Non-functional assertions:

- The armed timer MUST be `unref`'d so it never keeps the bridge process alive.
- A late settle of a timed-out op MUST NOT surface as an `unhandledRejection`.

## 6. Design Decision Rationale

**D1 - New WireError code, or reuse `dispatch_unavailable`?**
- *Reuse `dispatch_unavailable`:* zero enum change. Con: the file states (line 27) `dispatch_unavailable` is decided *before* invocation; a timeout is *after* invocation, so reuse breaks a documented invariant and conflates two diagnostically distinct faults (could-not-invoke vs invoked-never-settled).
- *New `dispatch_timeout`:* costs the two-place enum sync + Appendix A catalogue entry + a versioning note. Pro: preserves the pre-invocation invariant, gives a human a precise diagnosis, keeps the enum honest.
- **Chosen:** add `dispatch_timeout`, terminal. It is additive within wire major 1: both bridge and evaluator ship together in the harness, the evaluator's contract maps *any* WireError to `needs-human` regardless of code, and no shipped evaluator reads the wire yet. Update `WIRE_ERROR_CODES`, the `RECORD WireError` enum, Appendix A, and add a versioning note that a new terminal code is an additive, backward-compatible extension of the closed enum. (decides: architecture)

**D2 - Where does the timeout value come from?**
- *CLI flag only:* keeps the bridge config-free but leaves no tunable home.
- *Config only:* the bridge would have to resolve config, which it never does today.
- **Chosen:** both, split by role. The bridge exposes `--request-timeout-secs` (its only interface; stays config-resolution-free). The tunable's home is `bridge.request_timeout_secs` in `DEFAULTS`, which the composing occupant reads via `faff config get` and passes through (that passthrough is a FAFF-1105 follow-on, section 2). This ticket ships the flag + the default declaration; the flag is opt-in (pass-through when absent), so the bridge's standalone behaviour is unchanged. Because `bridge` is a new top-level namespace, this ticket also registers it in `config.js` `WRITABLE_NAMESPACES` and adds the example line to `.faffrc.example.yaml`, so the value is genuinely settable/overridable, not read-only (see the config-default note in section 3). (decides: architecture)

**D3 - Default timeout value?**
- Options: match `operation_deadline_secs` (3600, too coarse for a single reflected op), match `producer_tick_max_secs` (600), or a tighter single-op bound.
- **Chosen:** `"120"` (2 minutes). Generous for one reflected op, well below any run-level deadline so it fail-fasts before run teardown, and a soft tunable revisitable via config once real usage lands. Temporal anchor: chosen with no production telemetry yet; revisit when the FAFF-1105 wiring produces real op-latency data. (decides: architecture)

**D4 - Include an `AbortController` (mirror `streamWithFirstByte` verbatim)?**
- **Chosen:** omit it. `streamWithFirstByte` aborts a real `fetch` socket; a reflected SUT op is already running and accepts no signal, so `abort()` would do nothing. Include only the race + `unref` + swallow-loser + clear shape. Adding an inert controller would imply a cancellation the bridge cannot deliver. (decides: architecture)

**D5 - Disposal and session usability after a timeout?**
- *Auto-close the session:* races the orphaned op's late settle against the idempotent-close path.
- **Chosen:** retain the session (do not auto-close) on a `call` timeout; mint no session on an `open` timeout. A later `close` disposes normally. The evaluator reads `dispatch_timeout` as `needs-human` and tears the env down anyway, so retention is harmless and avoids a second disposal path. (decides: architecture)

**D6 - The injectable-timer seam for deterministic unit tests?**
- The core has no injectable clock today (unlike `evaluate-call`'s `nowFn` or `review-call`'s injected timer), so a hung thenable cannot be unit-tested deterministically against real time.
- **Chosen:** thread `timers: { set, clear }` and `requestTimeoutMs` through `state` (the object already flowing into `dispatch`). Default to real global timers; `mkState()` injects a controllable fake whose `set` captures the callback for manual firing, making the breach deterministic with no wall-clock wait. `main()` supplies real timers via `io.timers`. (decides: qa)

## 7. Open Questions and Assumptions

**Open Questions.** None blocking.

**Assumptions.**

- **Assumes:** the evaluator's WireError handling (the evaluator RPC-reading ticket, not yet shipped) will map an unrecognised or new WireError code, including `dispatch_timeout`, to `needs-human` rather than strict-enum-rejecting it. *Validation:* that ticket is unshipped, so nothing to check in this repo today; the wire doc's versioning note (added here) records the forward-compat expectation for that ticket to honour.

## 8. DONE - Definition of Done

### From WHY
- [ ] A `call` on an op returning a never-settling thenable, with a timeout armed, returns within roughly the deadline instead of hanging the session for the process lifetime.

### From WHAT (types and interfaces)
- [ ] `parseBridgeArgs` accepts `--request-timeout-secs N`; absent, non-positive, or non-finite disables it (pass-through); positive finite sets the internal ms deadline.
- [ ] `config.js` `DEFAULTS` declares `bridge.request_timeout_secs` with default `"120"`, as a `_secs` string scalar.
- [ ] `config.js` `WRITABLE_NAMESPACES` includes `bridge`, and `.faffrc.example.yaml` carries a `bridge.request_timeout_secs` example line, so `faff config set bridge.request_timeout_secs N` succeeds and `faff config check --selftest` (the recognised-namespaces + example-drift checks) passes.
- [ ] `WIRE_ERROR_CODES` in faff-bridge-node.mjs includes `dispatch_timeout`.
- [ ] `session-rpc-wire.md` adds `dispatch_timeout` to the `RECORD WireError` enum and to the Appendix A catalogue (marked terminal), plus a versioning note that a new terminal code is an additive, backward-compatible extension.
- [ ] `state` carries `requestTimeoutMs` and `timers`; `main()` computes ms from the flag and defaults `timers` to `{ set:setTimeout, clear:clearTimeout }`.

### From HOW (behaviour)
- [ ] `raceToDeadline` is pass-through when the deadline is unset/non-positive; otherwise races work against a timer, `unref`s the timer, swallows the loser branch, and always clears the timer.
- [ ] All three await points (`open` ~224, `call` ~242, `call_static` ~256) route their thenable await through `raceToDeadline`.
- [ ] A breach is discriminated by a private `TimeoutBreachError` sentinel and mapped to `wireError(..., "dispatch_timeout", ...)`; every non-sentinel rejection stays `resultThrew(...)`.
- [ ] An `open` timeout mints no session; a `call` timeout retains the session (no auto-close).

### From HOW (edge cases)
- [ ] With no `--request-timeout-secs`, dispatch behaviour is byte-for-byte FAFF-1104 (existing pure + impure suites pass unchanged).
- [ ] An op that settles just after the breach does not raise `unhandledRejection`.
- [ ] A synchronous (non-thenable) return skips the race entirely.

### From Scenarios (tests)
- [ ] Pure-core unit test: hung-thenable `call` with an injected fake timer fires deterministically and yields `error.code=="dispatch_timeout"` (no `result`).
- [ ] Pure-core unit test: op resolving within the window yields `returned` and clears the timer.
- [ ] Pure-core unit test: hung-thenable `call_static` yields `dispatch_timeout` (holdout path).
- [ ] Impure real-TCP test: `realListen` with a small `requestTimeoutMs` and a hung op returns a terminal `dispatch_timeout` WireResponse within the window, releases the socket, and a subsequent `close` returns an idempotent no-op.
- [ ] Test pins the disjoint-planes property against a *detached late settle*: after a `call` breach, when the orphaned op finally settles, the retained session stays clean and no `result.outcome=="threw"` (nor `unhandledRejection`) surfaces for the timed-out request.

**Integration smoke test.**

```
PROCEDURE smoke:
  1. state = mkState() extended with requestTimeoutMs=50 and a hung op "hang" returning new Promise(()=>{})
  2. r = await handleRequest({ wire:W, method:"call", id:"t", session_id:<opened>, op:"hang", args:[] }, state)
  3. ASSERT r.error.code == "dispatch_timeout" AND r.result === undefined
  4. ASSERT sessions still holds the session (retained)
  5. close(session) -> result{ outcome:"returned", value:null }
```

## Methodology critique

*Lens: faffter-dark-methodology-agile-delivery (issue-critique). Surface-only — advisory, non-blocking.*

**Right-sized?** No issues. Everything the spec adds is one deliverable (the `raceToDeadline` wrap at the three sites, the flag, the default, the `dispatch_timeout` code, the injectable-timer seam) — facets of one behaviour, none shipping value alone. The occupant-side passthrough is correctly carved to FAFF-1105: the bridge fail-fasts on its own 120s default regardless, so this is independently shippable. Complex build-tier reflects the plane-correctness constraint, not scope size.

**Workstream fit?** The issue sits project-less in Backlog. Cohesive (one outcome), but loose work doesn't sequence against its siblings (FAFF-1104 merged, FAFF-1105 follow-on, FAFF-1107). Consider homing it in the project that owns the code-blind holdout bridge so it orders honestly with 1104/1105/1107.

**Deps surfaced?** Two real cross-component deps are unlinked. (1) The one `Assumes` — the unshipped evaluator maps the new `dispatch_timeout` code to needs-human — is really a correctness dependency on `faffter-noon-evaluate`: either link it, or confirm in-spec that the evaluator's default handling of an unknown WireError code already yields needs-human (which makes the Assumes safe to close). (2) FAFF-1105's passthrough depends on this flag existing, with no blocker edge — add `FAFF-1105 blockedBy FAFF-1128` so the passthrough can't be picked up early.

**Risk profile?** No de-risking spike warranted — a bounded `Promise.race` is an understood pattern with an in-repo template (`streamWithFirstByte`) and seam (`killable-spawn.mjs`). The genuine risk is semantic and inside this ticket: the timed-out op must resolve to a `dispatch_timeout` WireError (infra plane → needs-human), never a `threw` result, and because D4 keeps no AbortController the detached SUT promise may still mutate the session after a failed call. Pin both in the impure tests (assert the WireError plane, and that the disjoint-planes property survives a late-settling detached promise) rather than pulling risk into a separate ticket.

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
