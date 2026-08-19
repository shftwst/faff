# First-byte deadline so a buffering backend fails over as fast as an unreachable one

> Spec: faffter-dark-nlspec · 2026-08-19 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-885.

This spec addresses FAFF-885 (bug: `review-call.mjs` idle-hangs the full `--timeout` against a backend that buffers its whole response instead of streaming incrementally) for the build agent implementing it and the human reviewers gating it. It describes a bounded fix inside `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` and its config feeder `plugin/skills/faff/bin/lib/adversarial-backends.js`: add a first-byte deadline that detects a connect-then-silence backend and fails it over immediately, so a reachable-but-buffering backend stops costing its whole per-attempt budget before the chain advances.

## 1. WHY — Problem and Principles

**The load-bearing model.** `realStream` (review-call.mjs:640-658) bounds a stream attempt with `r.setTimeout(timeoutMs, ...)`. That is a socket-inactivity timer: Node resets it on the request write and on every `res.on('data')` chunk. On a healthy incremental stream the steady drip of chunks keeps resetting it, so a long generation stays alive. There is no signal distinguishing "time to the first byte" from "gap between later bytes" anywhere in the transport. A backend that buffers its entire response and flushes nothing until generation is done (an LM Studio or MLX server behind the ollama wire) produces no `data` event until the very end, so the inactivity timer never gets reset and silently degrades into a hard deadline at the full `timeoutMs`. The fix is a separate first-byte deadline that measures only the time to the first byte, and fails the backend over the moment that window is breached.

**Problem statement.** Today a reachable-but-buffering primary throws `stream timed out after Nms` only after burning its full per-attempt budget, and `isTransientTransport` (line 570-578) classifies that text transient and retries it, so the backend idles its whole slice before the chain advances, whereas an unreachable backend fails over instantly. This change gives the transport a distinct first-byte window so a connect-then-silence backend is detected in seconds and handed off, not minutes. The observable pain it removes: a single buffering backend burning roughly `3 × timeout` of wall clock (about 6 minutes under the default 120s timeout) doing nothing before failover.

**Corrected arithmetic (the ticket's own numbers are loose).** State these, not the ticket's figures:

| Path | Composition | Wall clock before failover |
|---|---|---|
| Pure idle-hang, single backend | 3 transport attempts x 1 `streamOnce` (the truncation retry never runs on a hang) x `timeoutMs`, plus ~4.5s backoff | ~3 x 120s ≈ 6 min under defaults |
| Same, with `--deadline 480` (n=1) | `perAttempt()` (line 690-692) clamps each of 3 attempts to `min(120s, remaining)` | 120+120+120 ≈ 360s ≈ 6 min |
| Operator raised `--timeout 300` | 3 x 300s | ~15 min (tie any larger figure to this misconfig, never the default) |
| After this fix (fast-fail, 60s window) | one first-byte window, no retry | ~60s |

The documented "~6x timeoutMs" is the combined worst case that includes the truncation retry (`runReviewOllama.streamCall`, line 692-697); the truncation branch cannot run on a hang because `streamOnce` never returns, so the honest hang-path figure is ~3x, not 6x.

**Design principles.**

**A buffering-but-reachable backend is an availability failure, not a config fault.** The disposition of a first-byte breach must land on `transport-failed` → `unreachableExit` → `EXIT.UNREACHABLE` (5, pass+skip; `MANDATORY_OUTAGE`/9 at L4 via `mandatoryRemap`), exactly where a persistent transient exhaustion lands today. It must not escape as a raw throw, because a raw throw routes through `safeCall` → `mapThrowStatus` → `request-failed` → `EXIT.USAGE` (2), a `CHAIN_NEEDS_HUMAN` class (line 906). Fast-failing a slow server must not manufacture a needs-human park.

**Fast-fail, do not retry.** A persistently-buffering server breaches the first-byte window on every attempt, so re-entering the 3-attempt loop is pure waste (~180s instead of ~60s). The breach must break the retry loop on the first occurrence and surface `transport-failed` immediately.

**The first-byte timer must be observable through the injected transport seam.** The current seam injects `streamFn` as an opaque `(url, body, timeoutMs, headers) => Promise<string>` that resolves with the full body or rejects (see every test at test/adversarial-call.test.mjs). It exposes only the final outcome, never when bytes begin. A first-byte deadline whose timer lives only inside the real `realStream` is untestable through this seam (and `realStream` itself is never unit-tested today), so the seam must be extended to carry a first-byte signal, or the fix ships as a regression risk.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` `realStream` (640-658) | Node.js | The transport whose inactivity timer degrades to a hard deadline; extension point named by the FAFF-617 design doc |
| Same file, `streamWithTransportRetry` / `isTransientTransport` (570-608) | Node.js | The retry loop and predicate a first-byte breach must fast-fail out of |
| Same file, `runReviewOllama` / `streamOnce` (683-707) | Node.js | Where the first-byte window is armed per attempt |
| Same file, `parseArgs` (821) and `--backends-json` mapper (1177-1186) | Node.js | Where a `--first-byte-timeout` flag and per-backend `first_byte_timeout` are read |
| `plugin/skills/faff/bin/lib/adversarial-backends.js` `BACKEND_KEYS` (30) | Node.js | Where the per-backend knob is carried through `pickBackendKeys` / `inheritOptionalFromPrimary` |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` (113-129) | Markdown | Config docs where the knob and its default are stated |
| `plugin/skills/faffter-dark-adversarial-review/test/adversarial-call.test.mjs` | Node.js | The seam the DoD tests extend |

**Scope statement.** This is the deferred per-attempt hang cap named OUT OF SCOPE in the FAFF-617 design doc (records/specs/2026-07-23-FAFF-617-adversarial-review-per-backend-budget-slicing-design.md, section 2), which pointed at `realStream` as the extension point; it sits below FAFF-617's whole-chain deadline, sharpening detection latency within a single backend's slice.

## 2. OUT OF SCOPE

- **`stream:false` request mode (option b from the ticket).** What is excluded: switching `buildChatPayload` (line 77-88, currently hardcoded `stream:true`) to request a non-streamed response. Why excluded: a buffering server with `stream:true` already delivers one blob after full generation, so it behaves identically to `stream:false` at the transport level; `stream:false` adds no first-byte signal and does not close the hang. It is complementary payload cleanliness, not the mechanism. Extension point: `buildChatPayload` gains an optional `stream` override, and (only if adopted) the ollama fold is unaffected because `accumulateNdjson` (line 100-113) already parses the single-line `{message:{content}, done:true}` a `stream:false` response returns.
- **A new exit code for a buffering backend.** Why excluded: the breach reuses the existing `transport-failed` → `EXIT.UNREACHABLE` (5/6) path (the `EXIT` map at line 36 already covers it); a buffering backend is an availability failure and must route identically to an unreachable one, just sooner. Extension point: none needed; if a future issue wants buffering distinguished from unreachable in logs, the log line in `runReviewChain` carries the reason token.
- **Mid-stream stall detection.** What is excluded: a backend that flushes one early byte, resetting the first-byte window, then stalls for the rest of the generation. Why excluded: the first-byte window only measures time to the first byte; a mid-stream stall is bounded by the existing inactivity `timeoutMs` and, at the chain level, by FAFF-617's slice. Extension point: `realStream`'s inactivity timer already backstops this; a dedicated idle-gap cap distinct from both would be a separate issue.
- **openai/anthropic non-streamed `sawData` fallback parity.** What is excluded: adding the ollama analogue of the `accumulateSse`/`accumulateAnthropic` non-streamed fallback. Why excluded: unrelated to the first-byte timer; the ollama fold parses a non-streamed body correctly already (fact 7). Extension point: the ollama accumulation path if `stream:false` is ever adopted.

## 3. WHAT — Vocabulary, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| First-byte window | The maximum time a backend may take to deliver its first response byte before the attempt is abandoned. Distinct from the inactivity timeout, which governs gaps between later bytes. |
| First-byte breach | The event of the first-byte window elapsing with no byte received. Produces a marked error that fast-fails the backend. |
| Fast-fail | A per-backend disposition that surfaces `transport-failed` without retrying, so `runReviewChain` advances immediately. |

**The extended transport seam.** The injected `streamFn` gains an optional fifth argument carrying a first-byte callback and an abort signal; `realStream` gains a first-byte window, the callback, and the signal. Back-compat: when the window is unset, no first-byte timer is armed and the seam behaves byte-for-byte as today.

**Arity normalisation (load-bearing — spec-review round 1).** The three families do all route through the injected `streamFn` (confirmed), but they call it with different arity: ollama's `streamOnce` (review-call.mjs:671) calls `streamFn(url, body, timeoutMs)` with **no** headers argument, while `streamOnceOpenAi` (:724) and `streamOnceAnthropic` (:769) pass four (`..., headers`). A naive family-agnostic `streamFn(...args, opts)` therefore lands `opts` in ollama's fourth (headers) slot, so `realStream` spreads `{onFirstByte, signal}` into HTTP headers and `opts` arrives `undefined` — silently disabling first-byte on the exact ollama/LM-Studio family the bug targets. **The ollama call must be normalised to pass an explicit (empty) headers argument, so `opts` is always the fifth positional argument across all three families.** The wrapper injects `opts` at the fixed fifth position, never by spreading a variable-length arg list.

```
INTERFACE StreamFn:
  (url: string,
   body: string,
   timeoutMs: number,
   headers: Map<string,string>,           # ollama's streamOnce MUST be normalised to pass this (an empty {}) so opts lands fifth
   opts?: { onFirstByte?: () => void,      # NEW; transport calls it on first byte
            signal?: AbortSignal }          # NEW; wrapper aborts it on breach so realStream tears its socket down
  ) => Promise<string>                    # resolves full body, or rejects

FUNCTION realStream(url, body, timeoutMs, extraHeaders, opts?):
  # unchanged behaviour, PLUS:
  #  - on the first res.on('data') chunk, invoke opts.onFirstByte() exactly once
  #  - when opts.signal aborts, destroy the socket promptly (r.destroy) — the breach teardown channel
```

```
RECORD FirstByteBreachError EXTENDS Error:
  message: string          # e.g. "no first byte within 60000ms" — MUST NOT contain "timed out"
  firstByteBreach: true    # marker property; isFirstByteBreach keys on THIS, never the message

CONSTRAINT message excludes /timed out/   # so it cannot be misread by isTransientTransport's /timed out/ arm
```

**The config knob.**

```
RECORD Backend:                          # extends the existing chain element
  ... existing fields ...
  first_byte_timeout?: number            # seconds; per-backend; snake_case in config/JSON

# adversarial-backends.js BACKEND_KEYS (line 30) gains "first_byte_timeout"
# pickBackendKeys copies it when present; inheritOptionalFromPrimary lets a fallback inherit it
# review-call.mjs --backends-json mapper reads b.first_byte_timeout → firstByteMs (× 1000)
# parseArgs adds --first-byte-timeout <seconds> → a.firstByteMs; the single-backend chain element carries it
```

**Design decision — first-byte breach classification.** A breach must not retry (a buffering server breaches every attempt) and must not escape as a raw throw (that routes to needs-human). It surfaces `transport-failed`, reached after one attempt.

**Chosen:** fast-fail — `streamWithTransportRetry` recognises `isFirstByteBreach(e)`, breaks the loop without retrying, and returns its `{ ok:false, error }` sentinel, so `runReviewOllama` returns `{ status: "transport-failed" }` → `unreachableExit` → `EXIT.UNREACHABLE` (5), and the chain advances.

**Design decision — where the first-byte timer lives.** For the timer to be exercised by the injected `streamFn` (a delayed-resolve mock that never signals first byte), the deadline timer must run in the orchestration layer racing the `streamFn` promise, not solely inside `realStream`.

**Chosen:** an orchestration wrapper owns the real `setTimeout(firstByteMs)` and races it against `streamFn` plus its `onFirstByte` signal; `realStream` additionally invokes `onFirstByte` on its first chunk and tears its socket down on breach, so no real connection lingers.

## 4. HOW — Behaviour

**Architecture and approach.** A small wrapper sits between each family's `streamOnce` and the injected `streamFn`. When a first-byte window is configured, the wrapper arms a real timer and passes an `onFirstByte` callback into `streamFn`. The first byte (real: first `res.on('data')` chunk; test: an explicit `onFirstByte()` call) disarms the timer and the stream proceeds under the existing inactivity `timeoutMs`, unchanged. If the timer fires first, the wrapper rejects with a `FirstByteBreachError`, `streamWithTransportRetry` fast-fails it to `transport-failed`, and `runReviewChain` advances. When no window is configured the wrapper is a pass-through: byte-for-byte today.

The wrapper is family-agnostic (it wraps the shared `streamFn` call), so it covers ollama, the openai-compatible family, and anthropic uniformly. This matters because LM Studio also speaks the OpenAI-compatible wire, so the identical buffering hang exists on that fold; a single wrapper closes both. All three `streamOnce` variants route through the injected `streamFn` (confirmed at review-call.mjs:671, :724, :769), so one wrapper is sound — provided the ollama call is normalised to pass an explicit headers argument first (see **Arity normalisation** above; this is the single mandatory precondition for the family-agnostic wrapper).

The wrapper passes `opts` at the fixed fifth argument position (never by spreading a variable-length `args`), and owns an `AbortController` whose signal it hands into `opts` so a breach tears the real socket down rather than leaving it to linger until the inactivity `timeoutMs`.

```
PROCEDURE streamWithFirstByte(streamFn, url, body, timeoutMs, headers, firstByteMs):
  1. IF firstByteMs is not a number: RETURN streamFn(url, body, timeoutMs, headers)   # back-compat pass-through, no timer, no opts
  2. firstByteSeen = false
  3. controller = new AbortController()
  4. onFirstByte = () => { firstByteSeen = true; clear(timer) }
  5. timer = setTimeout(firstByteMs):
       IF NOT firstByteSeen:
         controller.abort()                                    # tells realStream to r.destroy its socket
         reject with FirstByteBreachError("no first byte within {firstByteMs}ms")
     # unref the timer so it never keeps the process alive (mirrors FAFF-617's sentinel)
  6. RACE streamFn(url, body, timeoutMs, headers, { onFirstByte, signal: controller.signal }) AGAINST timer:
       a. streamFn resolves  → clear(timer); RETURN body
       b. streamFn rejects    → clear(timer); rethrow (a normal transport error, unchanged path)
       c. timer fires         → reject FirstByteBreachError (fast-fail)
```

Every `streamOnce` variant (ollama normalised to pass `{}` for headers) calls the transport through this wrapper, so `opts` always lands fifth and no family spreads it into headers.

```
PROCEDURE streamWithTransportRetry(streamCall, policy, deadlineMs):   # MODIFIED loop body
  FOR attempt IN 1..policy.attempts:
    TRY: RETURN { ok: true, out: await streamCall() }
    CATCH e:
      IF isFirstByteBreach(e):        # NEW, checked BEFORE isTransientTransport
        lastErr = e
        BREAK                         # fast-fail: surface transport-failed, no retry
      IF NOT isTransientTransport(e): THROW e     # unchanged terminal path
      lastErr = e
      ... existing backoff / exhaustion ...
  RETURN { ok: false, error: lastErr }            # → runReviewOllama returns status "transport-failed"
```

```
FUNCTION isFirstByteBreach(err):
  RETURN Boolean(err && err.firstByteBreach === true)   # marker property, never message text
```

**Arming the window per attempt.** `streamOnce` (and the openai/anthropic equivalents) routes its `streamFn` call through `streamWithFirstByte`, passing `firstByteMs` resolved from the backend's `first_byte_timeout` (or the `--first-byte-timeout` default). The window is per attempt, not per slice: it is a fixed detection budget, independent of `timeoutMs` and the FAFF-617 slice.

**Interaction with FAFF-617.** Within a slice, a first-byte breach fast-fails at ~`firstByteMs`, far under the slice, so the backend hands its unspent slice back to survivors (the work-conserving division at review-call.mjs:1059). This is strictly better than FAFF-617 alone, which burns the whole slice before advancing.

**Edge cases and error handling.**

- No `firstByteMs` configured → wrapper is a pass-through; no timer; today's behaviour exactly.
- First byte arrives at t < window → timer cleared; stream continues under the existing `timeoutMs`; unchanged.
- `streamFn` rejects with an ordinary transient error before any byte → not a first-byte breach; the existing transient-retry path handles it.
- Breach on the last backend of an all-buffering chain → `transport-failed` on each → `chainTerminalExit` returns `EXIT.UNREACHABLE` (5, pass+skip), or `MANDATORY_OUTAGE` (9) at L4 via `mandatoryRemap` — identical terminal disposition to an all-unreachable chain today, reached sooner.
- Breach message must exclude "timed out"; `isFirstByteBreach` is checked before `isTransientTransport` regardless, so classification never depends on message text.

**Failure modes — how the approach falls over, and how you would notice.**

- **The failure:** the window is set too tight and fast-fails a healthy backend that is genuinely slow to its first token (a cold model load into VRAM, a long prompt-eval on a large model). The chain advances to a fallback that was not needed, quietly weakening the primary's turn. **How you would know:** `[chain] <tag> ... → advancing (exit 5)` fires on a backend that normally produces findings, and a fallback keeps winning. **What it means:** raise that backend's `first_byte_timeout`. This is why the default is generous and the knob is per-backend.
- **The failure:** a backend flushes one early keep-alive or whitespace byte, then buffers the real content. The first-byte signal fires, the window disarms, and the hang persists under `timeoutMs`. **How you would know:** the ~`timeout` idle-out returns despite a configured window. **What it means:** first-byte is necessary but not sufficient for a chunked-then-stalled server; the existing inactivity timeout and FAFF-617's slice remain the backstop. Acceptable — mid-stream stall is out of scope.
- **The failure:** a one-off first-token stall (a transient GC pause) is fast-failed with no retry, skipping an otherwise-healthy backend. **How you would know:** an intermittent, non-reproducible advance on a normally-fast backend. **What it means:** the generous default window makes a transient hiccup rarely exceed it, and the chain advances to a fallback so no gate is lost, only this backend's turn. Fast-fail beats retry overall because the dominant real case is a persistently-buffering server.

**Anti-pattern:** classifying the breach by matching its message against `isTransientTransport`. Why: the `/timed out/` arm would retry it, re-entering the 3-attempt loop against a server that breaches every time (~180s instead of ~60s). Key on the `firstByteBreach` marker property and fast-fail.

**Anti-pattern:** letting the breach escape as a raw throw out of the run function. Why: `safeCall` maps a raw throw to `request-failed` → `EXIT.USAGE` (2), a needs-human class, turning a slow server into a false park. Surface `transport-failed` instead.

**Anti-pattern:** putting the first-byte timer only inside `realStream`. Why: the injected `streamFn` seam cannot then exercise it, and `realStream` is never unit-tested, so the timer ships unverified.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a configured backend whose streamFn never signals a first byte and resolves a full valid
      findings body after a delay greater than first_byte_timeout but less than timeout
When the review runs against that backend
Then the attempt fast-fails at approximately first_byte_timeout, the result is transport-failed,
     and the elapsed time is far under the full per-attempt timeout
```

```
Given a configured backend whose streamFn signals a first byte before first_byte_timeout and then
      resolves late (after first_byte_timeout but before timeout) with a valid findings body
When the review runs against that backend
Then no first-byte breach fires and the findings are returned normally
```

```
Given a chain whose primary buffers (breaches the first-byte window) and whose fallback is healthy
When the chain runs
Then the primary is abandoned at its first-byte window, the fallback wins (exit 0, winnerIndex 1),
     and the breach-then-advance is logged
```

- No first-byte window configured: the transport path is byte-for-byte identical to today (no timer armed, streamFn called without first-byte enforcement).

## 6. Design decision rationale

**Which of first-byte deadline (a), stream:false (b), fast-failover (c) ships, and how they compose?**
- (a) first-byte deadline — the detection mechanism; nothing else gives a connect-then-silence signal.
- (b) stream:false — a buffering server already behaves as `stream:false` at the transport level, so it adds no first-byte signal and does not close the hang; payload cleanliness at most.
- (c) fast-failover — the disposition that turns a detected breach into an immediate advance.
- **Chosen:** (a) + (c) ship together; (b) is deferred (section 2). Rationale: (a) detects, (c) acts; (b) would add a config surface and change payloads without closing the gap.

**Should a first-byte breach retry (transient) or fast-fail and advance?**
- Retry: re-enters the 3-attempt loop; against a persistently-buffering server that is ~3 x the window of wasted time.
- Fast-fail: one window, then advance; a genuine one-off stall is handled by advancing to a fallback rather than by retrying the same stalled backend.
- **Chosen:** fast-fail — a buffering server breaches every attempt, so retry is pure waste, and the chain still has its fallbacks. (decides: architecture)

**Where does the first-byte timer live — orchestration wrapper or inside `realStream`?**
- Inside `realStream`: correct for the real socket but untestable through the injected `streamFn` seam, and `realStream` is unit-tested nowhere.
- Orchestration wrapper: a real timer races the `streamFn` promise plus an `onFirstByte` signal, exercisable by a delayed-resolve mock.
- **Chosen:** orchestration wrapper owns the deadline timer; `realStream` signals first-byte on its first chunk and tears its socket down on breach. This satisfies the named DoD tests and keeps real-socket cleanup correct. (decides: qa)

**Is the window per-backend configurable, and what is the default?**
- Per-backend is consistent with `timeout` already living in `BACKEND_KEYS` (adversarial-backends.js:30) and with FAFF-870's per-consumer chains, which would carry the knob for free.
- The exact default trades two harms: too tight fast-fails a slow-loading healthy backend; too loose lets a buffering server burn most of its slice.
- **Chosen:** a per-backend `first_byte_timeout` (seconds), default-on, wired through `pickBackendKeys` / `inheritOptionalFromPrimary` and the `--backends-json` mapper, plus a `--first-byte-timeout` flag and an `adversarial.first_byte_timeout` config default.
- **Punt:** the exact default seconds value (60s recommended: it covers a cold model load plus prompt-eval headroom on the referenced hardware while cutting the ~360s hang to ~60s, and stays well under the 120s inactivity timeout) — needs human tuning against real backend hardware. (decides: product)

**Family scope — ollama-only or all streaming families?**
- The buffering hang is a transport property, and LM Studio also speaks the OpenAI-compatible wire, so an ollama-only fix leaves the same bug on that fold.
- **Chosen:** a single family-agnostic wrapper covering ollama, openai-compatible, and anthropic. One wrapper, not three copies — conditional on normalising ollama's `streamOnce` to pass an explicit headers argument first (spec-review round 1), so `opts` lands fifth uniformly rather than colliding with ollama's headers slot. (decides: architecture)

At the time of writing, the seam injects `streamFn` as a monolithic `(url, body, timeoutMs, headers) => Promise<string>`; the `onFirstByte` extension is additive and optional, so existing injections keep working.

## 7. Open questions and assumptions

**Open questions.**
- The exact default `first_byte_timeout` in seconds. 60s is recommended and shippable; the value materially affects whether a slow-loading healthy backend is skipped, so a human should confirm it against real hardware before it is treated as settled. (decides: product)
- Whether the knob ships **default-on** with the recommended 60s, or **default-off first** and is flipped on only once the value is validated against real backend time-to-first-token. Default-on fixes the bug out of the box but makes the 60s guess load-bearing on day one: a legitimately slow-but-streaming backend (a large local model that takes longer than 60s to its first token) would be fast-failed and dropped from the chain even though it was working — a false-positive failover. The cheaper de-risking sequence is either default-off-then-flip, or a small measurement spike capturing actual time-to-first-token across the configured backends so the default is picked from data. (decides: product)

**Assumptions.**
- **Assumes:** a healthy streaming backend delivers its first byte well inside a 60s window under this workload (num_predict 2000, temperature 0.2). Validation: before relying on the default, run one review against a known-good streaming ollama/openai backend and confirm no first-byte breach fires; if it does, the default is too tight for that hardware and must be raised.
- **Assumes:** `realStream` can surface a first-byte signal on its first `res.on('data')` chunk and tear its socket down on an abort without disturbing the existing resolve/reject paths. Validation: confirm the `res.on('data')` handler in `realStream` (line 645-648) is reached before `res.on('end')` and that adding a one-shot `onFirstByte` call plus a socket-destroy-on-abort leaves the 2xx resolve and non-2xx reject branches unchanged.

## 8. DONE — Definition of Done

### From WHY
- [ ] A backend that connects then delivers no byte within its first-byte window fails over in ~`first_byte_timeout`, not ~`3 x timeout`; the default-config single-backend hang drops from ~360s to ~`first_byte_timeout`.
- [ ] The fix is bounded to `review-call.mjs` plus the config feeder `adversarial-backends.js` and the SKILL.md config docs.

### From WHAT (types and interfaces)
- [ ] `streamFn` accepts an optional fifth `{ onFirstByte, signal }` argument; existing four-argument injections and calls keep working unchanged.
- [ ] Ollama's `streamOnce` (review-call.mjs:671) is normalised to pass an explicit headers argument, so `opts` lands in the fifth positional slot on all three families; a regression test asserts the ollama call does not receive the `opts` object in its headers slot (no header pollution) and that a first-byte breach actually fires on the ollama path.
- [ ] `realStream` accepts a first-byte window, `onFirstByte`, and an `AbortSignal`, invokes `onFirstByte` exactly once on the first `data` chunk, and tears its socket down (`r.destroy`) when the signal aborts on breach.
- [ ] `FirstByteBreachError` carries `firstByteBreach: true` and a message that does not contain the string "timed out".
- [ ] `BACKEND_KEYS` in adversarial-backends.js includes `first_byte_timeout`; `pickBackendKeys` copies it when present and `inheritOptionalFromPrimary` lets a fallback inherit it from the primary.
- [ ] The `--backends-json` mapper reads `b.first_byte_timeout` (seconds → ms), and `parseArgs` reads `--first-byte-timeout <seconds>` for the single-backend path.

### From HOW (behaviour)
- [ ] With a window configured, a `streamFn` that never signals first byte and resolves after `first_byte_timeout < delay < timeout` produces `status: "transport-failed"`, not `ok` and not `request-failed`.
- [ ] `isFirstByteBreach` keys on the `firstByteBreach` marker property, and `streamWithTransportRetry` checks it before `isTransientTransport`, breaking the loop with no retry.
- [ ] A first-byte breach maps through `unreachableExit` to `EXIT.UNREACHABLE` (5), and at L4 through `mandatoryRemap` to `MANDATORY_OUTAGE` (9) — never `EXIT.USAGE` (2).
- [ ] A `streamFn` that signals first byte before the window then resolves late returns its findings normally, with no breach.
- [ ] With no window configured, the transport path is byte-for-byte identical to today (assert `streamFn` is called without first-byte enforcement and no timer is armed).
- [ ] The wrapper fast-fails a buffering backend on the openai-compatible family too (family-agnostic).

### From HOW (edge cases)
- [ ] In a chain, a buffering primary is abandoned at its first-byte window and a healthy fallback wins (exit 0, `winnerIndex` 1), with the breach-then-advance logged.
- [ ] An all-buffering chain terminates at `EXIT.UNREACHABLE` (5), matching an all-unreachable chain, reached in ~`n x first_byte_timeout` rather than ~`n x 3 x timeout`.

### Eval coverage
- [ ] No LLM-judgement seam is introduced or changed; no grader registration is required.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. Build a two-backend chain: primary streamFn buffers (never calls onFirstByte, resolves after
     first_byte_timeout + delta with a valid findings body); fallback streamFn resolves promptly with findings.
  2. Run runReviewChain with first_byte_timeout set and a timeout well above it.
  3. ASSERT exit == 0, winnerIndex == 1, elapsed ≈ first_byte_timeout + fallback time (not 3 × timeout),
     and the log carries the primary's breach-then-advance line.
```

## Self-review and spec-review resolution

A fresh-reasoning pass, plus the spec-review gate's round-1 objections folded in.

- **resolved (was a self-review major) — the family-agnostic scope claim is verified.** All three `streamOnce` variants route through the injected `streamFn` (review-call.mjs:671 ollama, :724 openai, :769 anthropic). The wrapper is genuinely family-agnostic; no per-family call site is needed.
- **resolved (spec-review round 1, architectural major) — the ollama arity trap.** Ollama's `streamOnce` calls `streamFn` with three args and no headers, so a naive `streamFn(...args, opts)` would land `opts` in ollama's headers slot and silently disable first-byte on the target family. The spec now mandates normalising the ollama call to pass an explicit headers argument so `opts` lands fifth uniformly, with a regression test pinning the ollama call arity (see WHAT → Arity normalisation, HOW, and the DoD).
- **resolved (spec-review round 1, infosec minor) — the socket-teardown channel.** `opts` now carries an `AbortSignal` the wrapper aborts on breach, so `realStream` can `r.destroy` its socket rather than leaving it to the inactivity `timeoutMs`. Previously the teardown was gated by the DoD but had no seam to deliver it.
- **folded (spec-review round 1, QA minor) — the regression tests pin real arity.** The DoD now requires the ollama-path tests to assert no header pollution and that a first-byte breach actually fires on the ollama call, not merely that no timer was armed against a permissive mock.
- **open (product) — default-on versus default-off-then-flip.** The knob is default-on with a recommended 60s, but the methodology risk read is that an unvalidated 60s could fast-fail a legitimately slow-but-streaming backend (a false-positive failover). Surfaced as an explicit open decision in section 7 for a human, alongside the exact-value punt.

The two round-1 design-lens objections are folded into the spec in place; the family-agnostic major is resolved by direct code confirmation. What remains open is one product decision (the default value) plus its default-on sequencing question, so the spec stays at medium: buildable, with a human call on the default before it is treated as settled.

confidence: medium
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "punt" }, { "marker": "chosen" } ] }
```
