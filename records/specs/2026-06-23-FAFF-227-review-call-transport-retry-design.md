# FAFF-227 — review-call.mjs: bounded transport-error retry, no unmapped exit

> Spec: faffter-dark-nlspec · 2026-06-23 · interactive · confidence: high. Full spec on Linear FAFF-227.

This spec is for the build agent and the reviewer. It hardens the adversarial-review backend helper `review-call.mjs` so a transient provider transport fault is retried, and a persistent one maps to a *documented* exit instead of the catch-all `EXIT.OTHER` (1) that an autonomous orchestrator can't interpret.

## 1. WHY — Problem and Principles

**The load-bearing model.** `review-call.mjs` already classifies *preflight* failures and *truncation* into documented exits; the gap is the **streaming phase**. A transport fault that occurs *after* a good preflight — HTTP 5xx, a dropped socket, a stream timeout — is neither truncation nor auth, so both orchestrations rethrow it to the top-level `.catch`, which sets `EXIT.OTHER` (1). Exit 1 is **not** in the skill's exit→verdict table, so a flaky-provider blip surfaces as an *uninterpretable* result to an unattended run.

**Problem statement.** Status quo: a mid-stream transient fault → unmapped exit 1, no retry (the FAFF-226 spike hit a 504 → exit 1; a manual retry succeeded). Pain: an autonomous orchestrator (FAFF-201's build loop) can't tell flaky-infra from a real review failure. This change adds a bounded transport retry and routes any persistent transport failure through the existing documented unreachable-exit path.

**Design principles.**

- **No uninterpretable exit on infra.** After this change, `EXIT.OTHER` (1) is reserved for genuine programmer error; *no* transport/infra condition may end there. Every exit the helper can return must be in the skill's exit→verdict table.
- **Retry transient, never terminal.** Only transient transport faults retry. A 4xx (esp. 401/403 → auth), a usage error, a model-not-served — these are terminal and must never be retried (retrying broken credentials or a bad model name wastes budget and muddies the signal).
- **Respect the caller's budget.** Retries + backoff must observe the overall `--timeout`, not multiply it unboundedly.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node (zero-dep) | The helper to harden |
| `review-call.mjs:22` `EXIT` constants | — | `OK:0, OTHER:1, USAGE:2, NOT_SERVED:4, UNREACHABLE:5, DEFAULT_HOST_UNREACHABLE:6, AUTH:7` |
| `review-call.mjs:266-285` `runReviewOpenAi` / the ollama path | — | preflight → stream → truncation retry; `catch` handles only `isAuthError` then rethrows |
| `review-call.mjs:355-362` `main()` unreachable mapping via `unreachableExit({hostSource})` | — | the documented exit path to reuse (respects FAFF-213 host-source) |
| `faffter-dark-adversarial-review/SKILL.md` ~150-159 | — | exit→verdict table to update |
| FAFF-183, FAFF-213 | — | prior `review-call.mjs` hardening (preflight robustness, host-source provenance) |

**Scope statement.** A localized fix inside one helper + its SKILL.md exit table + unit tests; no behavioural change to preflight, truncation, or any caller.

## 2. OUT OF SCOPE

- **A general retry framework.** Excluded — this is a targeted transport retry in two orchestration functions. Extension point: if more call sites need it, lift `withTransportRetry` into a shared helper later.
- **Provider-specific quirks beyond 5xx/socket faults.** Excluded — only the transient classes named here. Extension point: extend `isTransientTransport`.
- **Preflight behaviour.** Unchanged — preflight unreachable already maps to exit 5/6 correctly.
- **The truncation retry.** Unchanged — composes with the new transport retry; a regression test guards it.
- **FAFF-201's orchestrator-side flaky-infra posture.** Excluded — that's the consumer's concern; this fixes the source.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Transient transport fault | A retryable network/server condition during streaming: HTTP 5xx, `ECONNRESET`/`ETIMEDOUT`/`EPIPE`/"socket hang up", or a stream timeout. |
| Terminal fault | A non-retryable condition: HTTP 4xx (incl. 401/403 auth), usage error, model-not-served. |

**New predicate** (mirrors the existing `isAuthError`):

```
FUNCTION isTransientTransport(err) -> bool:
  msg := err.message (and err.code if present)
  TRUE  if msg matches /^HTTP 5\d\d/                         # 5xx from realGet/realStream reject
        or err.code in { ECONNRESET, ETIMEDOUT, EPIPE }
        or msg contains "socket hang up"
        or msg contains "timed out"                          # realStream / preflight timeout text
  FALSE otherwise                                            # 4xx, auth, usage, model-not-served, anything unrecognised
```

**Retry wrapper** (applied around the streaming call in BOTH `runReviewOpenAi` and the ollama orchestration):

```
RECORD RetryPolicy:
  attempts:   int   # total attempts incl. first; DEFAULT 3 (i.e. 2 retries)
  base_ms:    int   # backoff base; DEFAULT 1500
  # delay before retry k (1-indexed retry) = base_ms * 2^(k-1), capped so total stays within --timeout
```

**New result status.** The orchestration returns `status: "transport-failed"` (alongside the existing `ok` / `auth-failed` / `unreachable` / `model-not-served`) when transport retries are exhausted.

## 4. HOW — Behavior

**Approach.** Wrap only the *stream* call in a bounded retry that fires solely on `isTransientTransport`. Truncation retry stays nested inside a successful stream as today. On exhaustion, surface `transport-failed` and let `main()` route it through the existing `unreachableExit({hostSource})` — so it lands on a documented exit, never `OTHER`.

```
PROCEDURE stream_with_transport_retry(streamCall, policy, deadline):
  for attempt in 1..policy.attempts:
    try:
      return await streamCall()                 # streamCall = streamOnce(+truncation retry) as today
    catch e:
      if not isTransientTransport(e): throw e    # terminal (auth/4xx/usage) → out immediately, unchanged
      if attempt == policy.attempts: return TRANSPORT_FAILED(e)   # exhausted
      delay = min(policy.base_ms * 2^(attempt-1), remaining(deadline))
      if delay <= 0: return TRANSPORT_FAILED(e)  # no budget left to retry
      await sleep(delay)
```

- In `runReviewOpenAi` / ollama: replace the bare stream call with `stream_with_transport_retry(...)`; keep the existing `catch (isAuthError)` branch (auth can surface mid-stream too). A `TRANSPORT_FAILED` result becomes `return { status: "transport-failed", note: e.message }`.
- In `main()`: handle `status === "transport-failed"` by routing through the **same** `unreachableExit({ hostSource })` used for preflight-unreachable — config → `EXIT.UNREACHABLE` (5, pass+skip with a skip finding); default → `EXIT.DEFAULT_HOST_UNREACHABLE` (6, needs-human). Emit a **distinct** stderr note (e.g. `mid-stream transport failure after N attempts (…)`) so logs separate it from a preflight unreachable.

**Edge cases & precedence.**

- **Auth error mid-stream** (401/403) → terminal, `auth-failed` → `EXIT.AUTH` (7). Never retried. (Precedence: auth check before transient check.)
- **4xx other than auth** → terminal; not transient; rethrow → currently `OTHER`. **Chosen:** leave non-auth 4xx as-is (a 4xx is a request/our-bug fault, genuinely `OTHER`-class) — only 5xx/socket/timeout are transient. (Documented so the reviewer doesn't expect 4xx retried.)
- **Budget exhausted before a retry** → return `transport-failed` immediately (don't sleep past `--timeout`).
- **Truncation after a transport retry** → the truncation retry still fires within the successful attempt; unchanged.

**Failure modes.**

- **Over-retrying a non-transient fault.** If `isTransientTransport` is too broad it could retry a real error, wasting budget. *How you'd know:* a unit test feeding a 4xx/usage/auth error asserts zero retries; if it retries, the predicate is wrong. *What it means:* tighten the predicate — default to FALSE on anything unrecognised (terminal), never TRUE.
- **Silently skipping review on a truly-down provider.** Mapping exhausted transport to exit 5 (pass+skip) means a persistently-flaky configured provider downgrades the adversarial pass to a skip-with-finding. *How you'd know:* the skip finding appears in the verdict. *What it means:* acceptable and intended (same as the existing exit-5 "don't block on infra; explicit config is the human's call"); the host-source=default case still escalates to needs-human (6).

**Anti-pattern:** retrying on any caught error. Why: retrying auth/usage/4xx wastes the token+time budget and can mask a real fault — gate strictly on `isTransientTransport`, default-terminal.

## 5. DESIGN DECISION RATIONALE

**How to retry transient transport faults?** Options: (a) no retry (status quo); (b) bounded retry on a strict transient predicate; (c) general retry framework. (a) leaves the flaky-infra gap; (c) is over-built for two call sites. **Chosen:** (b) — `isTransientTransport` predicate + a small bounded retry (default 3 attempts, exponential backoff from ~1.5s, capped by `--timeout`) wrapping the stream call in both orchestrations, composing with the existing truncation retry.

**Where does a persistent transport failure exit?** Options: keep `OTHER` (1, undocumented); a new dedicated code; reuse the unreachable path (5/6). `OTHER` is the bug. **Chosen:** reuse `unreachableExit({hostSource})` (5 pass+skip / 6 needs-human) — documented semantics, respects FAFF-213 host-source provenance, and guarantees no transport condition lands on the unmapped exit 1. A distinct stderr note keeps it debuggable.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.**

- **Punt:** whether to add a **dedicated** exit code (e.g. `8 = transient-transport-exhausted`) for observability/metrics, vs reusing `5`/`6` — needs human. Reusing the unreachable path is the safe, fully-specced default (this spec builds on it); a dedicated code is a non-blocking observability nicety that would also need a new row in the exit→verdict table. Does not gate the build.

**Assumptions.**

- **Assumes:** the existing injectable `streamFn` / `getFn` parameters on `runReviewOpenAi` / the ollama orchestration are sufficient to unit-test retry behaviour without new test infra. **Validate:** confirm a test can pass a `streamFn` that throws-then-succeeds and one that always-throws (the params are already in the signatures at `review-call.mjs:268`).

## 7. DONE — Definition of Done

### From WHY / principles
- [ ] No transport/infra condition can exit `EXIT.OTHER` (1); every exit the helper returns is in the SKILL.md exit→verdict table.
- [ ] Retries + backoff never exceed the `--timeout` budget (delay capped by remaining time; no sleep when budget ≤ 0).

### From WHAT (predicate + policy)
- [ ] `isTransientTransport(e)` returns TRUE for HTTP 5xx, `ECONNRESET`/`ETIMEDOUT`/`EPIPE`/"socket hang up"/timeout; FALSE for HTTP 4xx, auth, usage, model-not-served, and unrecognised errors. Unit-tested across those cases.
- [ ] Retry policy defaults: 3 total attempts (2 retries), exponential backoff — configurable constants, not magic numbers scattered.

### From HOW (behaviour)
- [ ] Both `runReviewOpenAi` and the ollama orchestration retry transient transport faults around the stream call; a `streamFn` that throws a transient fault once then succeeds yields a successful (`ok`) review. (Injected-`streamFn` test.)
- [ ] A `streamFn` that always throws a transient fault yields `status: "transport-failed"` → `main()` returns `EXIT.UNREACHABLE` (5) when `--host-source config`, `EXIT.DEFAULT_HOST_UNREACHABLE` (6) when `default` — **never** `EXIT.OTHER` (1). (Injected-`streamFn` test asserting the exit.)
- [ ] An auth error (401/403) mid-stream is NOT retried → `EXIT.AUTH` (7); a non-auth 4xx is NOT retried. (Test.)
- [ ] The existing truncation retry behaviour is unchanged. (Regression test.)
- [ ] A distinct stderr note distinguishes a mid-stream transport failure from a preflight unreachable.

### From docs
- [ ] `faffter-dark-adversarial-review/SKILL.md` exit→verdict table documents the transport-failure mapping and states `OTHER` (1) is now reserved for genuine programmer error (not flaky infra).

**Integration smoke test:**

```
inject streamFn = throws("HTTP 504") once, then yields valid findings
run runReviewOpenAi(... streamFn ...)  => status "ok", findings present   # retry worked

inject streamFn = always throws("HTTP 504")
run main(--host-source config ... streamFn ...)  => exit 5 (not 1)        # mapped, pass+skip
```
