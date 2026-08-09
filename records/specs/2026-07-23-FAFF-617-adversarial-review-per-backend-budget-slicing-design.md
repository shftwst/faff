# Per-backend wall-clock budget slicing so a hung primary can't starve the adversarial fallback chain

> Spec: faffter-dark-nlspec · 2026-07-23 · autonomous · confidence: high. Full spec on Linear FAFF-617.

This spec addresses FAFF-617 for the build agent implementing it and the human reviewers gating it. It describes a bounded fix inside `plugin/skills/faffter-dark-adversarial-review/review-call.mjs`: the adversarial-review fallback chain must divide its total wall-clock budget among its backends so that one slow or hung backend cannot consume the whole `--deadline` before the healthy fallbacks are ever dispatched.

## 1. WHY — Problem and Principles

**The load-bearing model.** Today the whole chain shares one absolute deadline (`hardDeadlineMs = start + totalDeadlineMs`) that every backend is handed in full. So the *first* backend is allowed to spend the *entire* budget. The fix is to give each backend only a *slice* of what remains — divided by how many backends are still to try — so a hung primary is abandoned at its slice boundary and the fallbacks still fit inside the deadline.

**Problem statement.** In autonomous run run-20260722-153543-beepboop-full the Phase-2 adversarial second opinion repeatedly returned `skipped-deadline` (exit 8) even though healthy fallbacks (gemini, ollama) were reachable: the primary nvidia backend hung, and because its per-attempt timeout equalled the whole-chain deadline, it ate the budget before `runReviewChain` ever advanced to backend 2. The fallback chain FAFF-232 built to survive a single-provider outage never advanced. This change makes a hung primary fail over to a healthy fallback *within* the deadline, so the second opinion is obtained rather than skipped.

**Design principles.**

**Fail-over within the deadline, not after it.** The chain exists to survive one backend failing. A budget policy that lets the first backend consume the whole deadline structurally defeats that. Every backend that has not yet been tried must be guaranteed a non-zero dispatch window while budget remains.

**Back-compatible by construction.** A single-backend chain, and any chain run with no `--deadline`, must behave byte-for-byte as today. The slice of a lone remaining backend is the whole remaining budget, so the single-backend and unbounded paths are unchanged without a special case.

**The slice enforces the timeout, not a rewrite.** The per-attempt idle clamp already computes `min(timeoutMs, hardDeadlineMs − now)`. Once `hardDeadlineMs` is the per-backend slice, an over-large per-backend `timeout` (e.g. `480` on a `160s` slice) is clamped to the slice automatically. We do not mutate the configured `timeout` value; the slice subsumes it.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node (ESM, zero-dep) | The file changed — `runReviewChain` (the fallback loop), the per-family `perAttempt` clamp, `main` (chain assembly + CLI). |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | Markdown | The `--timeout` / `--deadline` documentation (the `~6×timeout` worst-case note) that the new per-backend semantics must be reconciled against. |
| `plugin/skills/faff/bin/lib/adversarial-backends.js` | Node | Assembles the `--backends-json` chain; each element may carry its own `timeout`. Where the misconfigured `timeout: 480` originates. |
| `test/adversarial-call.test.mjs` | Node test | Where `runReviewChain` deadline behaviour is unit-tested (injectable clock `nowFn`, stub `runReviewFn`). |

**Scope statement.** This is the budget-tuning fix in the FAFF-232 fallback-chain family (FAFF-227 transport retry, FAFF-228 rate-limit mapping, FAFF-329 total deadline, FAFF-414 non-transient throw) — the one gap none of them closed: the chain exists, but the deadline was undivided, so it could refuse to advance.

## 2. OUT OF SCOPE

- **Per-attempt hang cap (idle / no-first-byte timeout).** — A backend that accepts the TCP connection then never streams a byte currently keeps its socket alive up to the per-stream timeout (its per-chunk activity resets the idle timer, but a stalled connection with *no* activity is bounded only by the stream timeout). A dedicated "no first byte within N seconds → fail fast" cap is a separate resilience improvement. It is excluded because the slice fix already bounds a hung backend's damage to one slice and guarantees fail-over within the deadline (the acceptance criterion) — fast-failing the hang *sooner* is a latency optimisation, not a correctness gap. **Extension point:** `realStream` in `review-call.mjs` (add an idle/first-byte timer distinct from the overall `setTimeout`).
- **Changing the default `--deadline` / `--timeout` values, or the config's per-backend `timeout: 480`.** — The values are the human's tunables. This fix makes the *division* of the budget safe regardless of the values; retuning the defaults is a separate config decision. The loud config warning (WHAT below) surfaces a bad combination without changing it. **Extension point:** `.faffrc.yaml` `backends.*.timeout` and `faffter_dark.adversarial.deadline`.
- **Restructuring the exit-code taxonomy or the deadline exit (8) semantics.** — Exit 8 (`skipped-deadline`) still fires when the *whole* chain genuinely can't produce findings inside the total budget. This change only prevents *one* backend from monopolising that budget; it does not add or retire an exit code. **Extension point:** the `EXIT` map and `mapResultExit` / `mandatoryRemap`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Total deadline | `totalDeadlineMs` — the whole-chain wall-clock ceiling from `--deadline`. Unchanged. |
| Per-backend slice | The wall-clock a single backend is granted: the budget still remaining, divided by the number of backends still to try (including the current one). |
| Remaining backends | At loop index `i` in a chain of length `n`: `n − i`. |
| Worst-case multiplier | ~6 — the `3 attempts × 2 streamOnce` composition (TRANSPORT_RETRY.attempts = 3), the factor between one `--timeout` and one backend's worst-case wall-clock. |

**The per-backend slice (the core interface change).** Inside `runReviewChain`, for the backend at index `i`:

```
remaining      = totalDeadlineMs − (now() − start)     # budget left against the total
backendsLeft   = n − i                                  # this backend + the untried ones
sliceMs        = floor(remaining / backendsLeft)        # this backend's wall-clock grant
backendDeadline = now() + sliceMs                       # absolute per-backend deadline
```

- `backendDeadline` (not the shared `start + totalDeadlineMs`) is passed to the backend as `hardDeadlineMs`, and is the ceiling the mid-call `Promise.race` timer counts down to.
- The division is **work-conserving**: `remaining` is recomputed each iteration, so a backend that finishes (or fails) fast returns its unspent budget to be re-divided among the backends still to try.
- **Edge cases fall out of the formula, no special case:**
  - `n = 1` (single-backend chain): `backendsLeft = 1`, `sliceMs = remaining = totalDeadlineMs` — byte-for-byte today.
  - Last backend (`i = n − 1`): `backendsLeft = 1`, `sliceMs = remaining` — it gets everything left, correctly (no reason to under-budget the final attempt).
  - No `totalDeadlineMs` (unbounded): slicing is not computed at all; `hardDeadlineMs` stays `undefined` — byte-for-byte today.

**Design decision — dynamic division vs static `totalDeadlineMs / n`.**

- *Static* (`totalDeadlineMs / n`, computed once): simpler, but a fast primary that fails in 2s wastes its unused 158s — the fallbacks are still capped at their static `160s`.
- *Dynamic* (`remaining / (n − i)`, recomputed per iteration): a fast failure hands its slack to the survivors; guarantees each untried backend an equal share of *whatever is actually left*. Only marginally more code (recompute `remaining` in the loop, which the loop already reads for its deadline gate).

**Chosen:** dynamic division — `remaining / (n − i)`, recomputed each iteration. The work-conserving behaviour is strictly better for the failure modes this fix targets (a fast-failing primary should leave *more* room for the fallback, not the same fixed slice) and costs one extra arithmetic expression.

**The config-warning helper (a new pure function).** A pure, advisory, non-gating check surfaced once before the chain runs:

```
PROCEDURE budgetWarnings(chain, totalDeadlineMs, multiplier = 6):
  # returns [] or a list of human-readable warning strings; never throws, never gates
  IF totalDeadlineMs is not a number: return []
  n = chain.length
  perBackendBudget = totalDeadlineMs / n
  FOR each backend b in chain:
    t = b.timeoutMs   # already ms
    IF t is a number AND t * multiplier >= perBackendBudget:
      collect "backend <provider>/<model>: timeout <t/1000>s × ~6 worst-case (~<6t/1000>s)
               >= per-backend budget <perBackendBudget/1000>s (deadline <deadline>s / <n> backends)
               — retries/truncation may be cut short; lower this backend's timeout or raise --deadline"
  return collected
```

- **Chosen:** emit the warnings to **stderr** in `main`, after the chain is assembled and before `runReviewChain` is called. Advisory only — it never changes an exit code and never blocks dispatch. It is where all three inputs (the assembled `chain`, each element's `timeoutMs`, and `a.totalDeadlineMs`) already converge.
- Rationale: the slice fix makes a bad `timeout`/`deadline` combination *non-fatal* (fail-over still happens), but a `timeout` set so high that no single backend can complete its full retry composition inside its slice is still a real misconfiguration the operator should see — it silently truncates retries. The warning gives visibility without imposing a value.

**Public surface.** The CLI flags (`--timeout`, `--deadline`, `--backends-json`), the exit codes, and every exported pure function keep their signatures. `budgetWarnings` is a **new** exported pure function (unit-tested directly, like its siblings). `runReviewChain`'s signature is unchanged — the slice is computed internally from the `totalDeadlineMs` it already receives.

## 4. HOW — Behavior

**Architecture and approach.** The change is localised to three seams, all in `review-call.mjs`:

1. **`runReviewChain`** — replace the single shared `hardDeadlineMs` and the full-`remaining` race timer with a per-backend slice computed at the top of each iteration.
2. **`main`** — call `budgetWarnings` after chain assembly, write any warnings to stderr, then dispatch as today.
3. **`budgetWarnings`** — the new pure helper.

The per-family `perAttempt` clamp in `runReviewOllama` / `runReviewOpenAi` / `runReviewAnthropic` needs **no change**: it already computes `min(timeoutMs, hardDeadlineMs − now)`, so once it is handed the per-backend `backendDeadline` as `hardDeadlineMs`, it clamps each attempt to the slice for free.

**Behavior summary.** For each backend in chain order, grant it an equal share of the remaining total budget; abandon it at its slice; advance to the next backend, which is re-granted an equal share of the (now smaller) remaining budget. A hung primary loses its slice, not the whole deadline.

**Pseudocode — the revised chain loop (the ambiguity point):**

```
PROCEDURE runReviewChain(chain, shared):
  start = now()
  n = chain.length
  totalDeadlineMs = shared.totalDeadlineMs        # may be undefined (unbounded)
  failureClasses = []
  FOR i in 0..n-1:
    # deadline gate — no NEW backend starts once the TOTAL budget is spent (unchanged)
    IF totalDeadlineMs is a number AND now() - start >= totalDeadlineMs:
       return deadline-exhausted result (needs-human-class fault dominates, else EXIT.DEADLINE)

    b = chain[i]
    ... existing per-element config-fault guards (missing model/host, unset key) — unchanged ...

    # NEW: per-backend slice
    IF totalDeadlineMs is a number:
       remaining      = totalDeadlineMs - (now() - start)
       sliceMs        = floor(remaining / (n - i))
       backendDeadline = now() + sliceMs            # absolute, passed as hardDeadlineMs
    ELSE:
       backendDeadline = undefined                  # unbounded — byte-for-byte today

    callReview = () => runReviewFn({ ..., hardDeadlineMs: backendDeadline })

    IF totalDeadlineMs is a number:
       # race against the SLICE, not the full remaining
       raceMs = sliceMs
       result = Promise.race([ safeCall(callReview), deadlineSentinelAfter(raceMs) ])
       IF result is the sentinel:
          # this backend used its whole slice → advance (record DEADLINE-class), do NOT
          # terminate the chain while untried backends and total budget remain
          ... see "the per-backend-slice-vs-total-deadline distinction" below ...
    ELSE:
       result = await safeCall(callReview)

    ... existing exit mapping, OK-shape validation, advance/return — unchanged ...
  return chainTerminalExit(failureClasses)
```

**Edge cases and error handling.**

- **A backend exhausts its slice while total budget and untried backends remain** — this is the crux. When the per-backend race fires but `now() − start < totalDeadlineMs` and `i < n − 1`, the chain must **advance** to the next backend (recording a DEADLINE-class failure for this one), not terminate. Termination at `EXIT.DEADLINE` still happens only via the **top-of-loop total-budget gate** (all budget spent) or the chain-exhausted return (every backend tried). This is the behavioural inversion from today, where the single mid-call race *was* the whole-deadline race and firing it meant the whole budget was gone.
- **Slice underflow.** If `remaining ≤ 0` at the slice computation, the top-of-loop gate has already returned; defensively, a computed `sliceMs ≤ 0` is treated as "no budget" and routes exactly as the top-of-loop gate (return, needs-human-class dominates else DEADLINE).
- **Fault classes are unchanged.** `unreachable` / `auth-failed` / `model-not-served` / `transport-failed` / `malformed` still advance the chain and still map through `mapResultExit` / `chainTerminalExit` exactly as today — the slice only changes *how long* a backend may run before being abandoned, not *how* a returned status is classified.
- **`mandatoryRemap` (L4) is untouched.** A mandatory chain that genuinely exhausts all backends inside the total budget with only no-opinion classes still fails closed to exit 9. The slice makes exhaustion *less* likely (fallbacks now actually run) but does not change the terminal remap.

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure:** the per-backend race no longer distinguishes "this backend timed out" from "the whole deadline is gone", so a naive port could terminate the chain on the *first* slice expiry (reproducing today's bug with extra steps) instead of advancing.
  - **How you'd know:** the acceptance scenario (Scenario 1) would still return exit 8 with only backend 1 attempted; the `[chain] … → advancing` stderr line for the hung backend would be absent.
  - **What it means:** the advance-on-slice-expiry branch is the load-bearing part of the change — it must be covered by a test that asserts the *second* backend was dispatched after the first's slice expired (see Scenarios).
- **The failure:** floor division could grant a `0ms` slice on a nearly-spent budget, dispatching a backend that instantly times out.
  - **How you'd know:** a test with `remaining` just above zero and `n − i > 1` would show a backend dispatched with a sub-second window and immediately abandoned.
  - **What it means:** the slice-underflow guard (route as the total-budget gate when `sliceMs ≤ 0`) covers it; proceed.

**Anti-pattern:** mutating each backend's configured `timeoutMs` down to the slice. Why: it duplicates what the existing `perAttempt` clamp already does with `hardDeadlineMs`, and it would corrupt the configured value for logging/inheritance. Pass the slice as `hardDeadlineMs`; leave `timeoutMs` as configured.

**Anti-pattern:** making `budgetWarnings` gate or change an exit code. Why: a high timeout is now non-fatal (fail-over still happens); escalating a warning to a block would re-introduce a way for a config value to disable the review. It is advisory stderr only.

## 5. SCENARIOS — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a 3-backend chain (primary + two healthy fallbacks) and --deadline 480,
  where the primary hangs (never returns, never streams)
When runReviewChain runs with an injected clock
Then the primary is abandoned at its ~160s slice (deadline/3),
  the chain advances and dispatches backend 2 within the deadline,
  and the result is the fallback's findings (exit 0) — never exit 8 / skipped-deadline
```

```
Given a single-backend chain and --deadline 480 (n = 1)
When runReviewChain runs
Then that backend is granted the whole 480s budget (slice == remaining),
  i.e. behaviour is byte-for-byte identical to the pre-change single-backend path
```

- The chain is dispatched with **no `--deadline`** (`totalDeadlineMs` undefined) → no slicing is computed, `hardDeadlineMs` stays `undefined`, behaviour is byte-for-byte today (assertion).
- `budgetWarnings` returns a non-empty warning for the shipped config (`timeout 480 × 6 ≥ 480/3 = 160`) and an empty list when `timeout × 6 < deadline / n` (assertion).
- The final composed budget invariant: the sum of granted slices never exceeds `totalDeadlineMs` (assertion — the total deadline still bounds the chain).

## 6. DESIGN DECISION RATIONALE

**How should the total deadline be divided among backends?**
- *Undivided (today):* each backend handed the whole remaining budget. Con: the first backend can starve every fallback — the bug.
- *Static equal shares (`deadline / n`):* safe but wastes a fast failure's slack.
- *Dynamic equal shares (`remaining / (n − i)`):* safe and work-conserving.
- **Chosen:** dynamic equal shares. Guarantees every untried backend a non-zero window while budget remains, and re-divides a fast failure's slack to the survivors — directly serving the "fail-over within the deadline" principle.

**Should the fix also enforce `timeout < deadline / num_backends` by rewriting the timeout?**
- *Rewrite the configured timeout:* redundant — the `perAttempt` clamp already bounds each attempt to `hardDeadlineMs − now`; once `hardDeadlineMs` is the slice, the clamp does this. Rewriting also corrupts the value for logging/inheritance.
- **Chosen:** do not rewrite. The slice (via `hardDeadlineMs`) structurally enforces the bound; a separate **advisory warning** (`budgetWarnings`) surfaces the misconfiguration to the human without changing behaviour.

**Where does the config warning live?**
- *In `faff adversarial-backends` (emit time):* it has the backend list but not the resolved `--deadline` (a separate `faff config get`), so it can't compute `deadline / n`.
- **Chosen:** in `review-call.mjs main`, after chain assembly — the one place the assembled chain (with per-element `timeoutMs`) and `a.totalDeadlineMs` both exist. A new exported pure `budgetWarnings` keeps the logic unit-testable and side-effect-free; `main` does the stderr write.

**Temporal anchor.** At the time of writing, `TRANSPORT_RETRY.attempts = 3`, giving the ~6× worst-case multiplier (3 attempts × 2 `streamOnce`). If that composition changes, the `multiplier` default in `budgetWarnings` should track it.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — the approach is settled within the existing FAFF-329 deadline machinery.

**Assumptions.**

- **Assumes:** `review-call.mjs`'s `runReviewChain` continues to receive `totalDeadlineMs` via `shared` and an injectable `nowFn` clock (both present today — FAFF-329). *Validation:* confirm `runReviewChain(chain, shared)` reads `shared.totalDeadlineMs` and `shared.nowFn` before editing (lines ~900–903).
- **Assumes:** each chain element carries its own `timeoutMs` (ms) after the `--backends-json` mapper runs (present today — `main` maps `b.timeout` seconds → `timeoutMs`). *Validation:* confirm the mapper at the `--backends-json` branch sets `timeoutMs` per element before relying on it in `budgetWarnings`.

## 8. DONE — Definition of Done

### From WHY
- [ ] A hung primary in a multi-backend chain fails over to a healthy fallback within `--deadline`; the second opinion is the fallback's findings (exit 0), not `skipped-deadline` (exit 8) — the acceptance criterion.

### From WHAT / HOW (per-backend slice)
- [ ] `runReviewChain` grants each backend `floor(remaining / (n − i))` ms as its `hardDeadlineMs`, recomputing `remaining` each iteration.
- [ ] The mid-call race times a backend out against its **slice**, not the full remaining budget.
- [ ] On a slice expiry with total budget and untried backends remaining, the chain **advances** (records a DEADLINE-class failure) rather than terminating.
- [ ] Chain termination at `EXIT.DEADLINE` still occurs only via the top-of-loop total-budget gate or full chain exhaustion.
- [ ] A `sliceMs ≤ 0` computation routes exactly as the top-of-loop total-budget gate (no zero-window dispatch).

### From WHAT / HOW (back-compat)
- [ ] A single-backend chain with `--deadline` set behaves byte-for-byte as before (slice == remaining).
- [ ] A chain run with no `--deadline` computes no slice and is byte-for-byte as before (`hardDeadlineMs` undefined).
- [ ] The sum of granted slices never exceeds `totalDeadlineMs`.

### From WHAT (config warning)
- [ ] `budgetWarnings(chain, totalDeadlineMs)` is an exported pure function returning warning strings (empty when no backend's `timeout × 6 ≥ deadline / n`, non-empty for the shipped `timeout 480 / deadline 480 / 3 backends` config).
- [ ] `main` writes any `budgetWarnings` to stderr before dispatch; it never changes an exit code or blocks dispatch.

### From SKILL.md
- [ ] The `--timeout` / `--deadline` documentation in `SKILL.md` is updated to state the per-backend slice semantics (each backend gets `deadline / remaining-backends`, not the whole deadline) so the doc matches shipped behaviour.

### Tests
- [ ] A `runReviewChain` test with an injected clock asserts the acceptance scenario: hung primary abandoned at its slice, backend 2 dispatched, exit 0 from the fallback.
- [ ] A test asserts single-backend and no-deadline paths are unchanged.
- [ ] `budgetWarnings` is unit-tested directly (warning present for the bad combo, absent for a good one).

**Integration smoke test:**
```
Build a 3-element chain with a stub runReviewFn where element 0 blocks past its slice
  and element 1 returns findings; run runReviewChain with totalDeadlineMs and an injected
  nowFn; assert exit === OK, winnerIndex === 1, and failureClasses records the deadline-class
  skip of element 0.
```

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
