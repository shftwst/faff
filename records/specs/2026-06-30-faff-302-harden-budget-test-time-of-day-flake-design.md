# Harden `budget.test.mjs` against the time-of-day flake — a hermetic clock seam for `faff budget check`

> Spec: faffter-dark-nlspec · 2026-06-30 · interactive · confidence: high. Full spec on Linear FAFF-302.

## Why

`faff budget check` computes two time-based fields against the live wall clock — `spent.elapsed_ms` (`Date.now() − run start`) and `spent.until_epoch` (the resolved `--until HH:MM` stop-wall) — by reading `const nowMs = Date.now()` directly (`plugin/skills/faff/bin/faff:2384`). The fixtures in `test/budget.test.mjs` anchor the run to a fixed absolute `started_at` (`baseLedger`, `2026-06-23T15:00:00Z`, line 64). This is the **same absolute-timestamp-vs-real-`Date.now()` fragility class** FAFF-301 just removed from the sentry test: any field derived from `now` drifts with the time of day the suite runs at, so a late-day CI run can compute time-based state the fixtures never anticipated and false-red the release `validate` — exactly the failure mode that blocked the 0.7.0 gate via the sentry AC5 flake. The budget peer is currently latent (no existing test asserts on a time-derived field), but the fixture carries the hazard and a future assertion on `elapsed_ms`/`until` would inherit it. This is a pre-emptive hardening that mirrors the just-shipped FAFF-301 fix at its source.

## What

Add a hermetic, **explicit-flag-only** clock seam to `faff budget check` and pin the clock in the test, byte-for-byte mirroring the FAFF-301 sentry pattern.

1. **`faff budget check` gains a clock seam (it has none today).** New `resolveBudgetNow(get)` helper — a direct structural twin of `resolveSentryNow` (`bin/faff:~8245`): precedence `--now-ms <epoch-ms>` > `--now <ISO>` > `Date.now()` (the unchanged production default); an injected-but-unparseable value is a hard error → exit 2 with a stderr reason, never a silent `Date.now()` fall-through. `cmdBudget` replaces `const nowMs = Date.now()` (line 2384) with the resolved value and returns 2 on the error.
2. **Explicit-flag-only, no ambient/env form.** Mirror FAFF-301's adversarial-review conclusion: no `$FAFF_NOW_MS` ambient channel — the only override is a per-invocation flag the orchestrator/test types, so an isolated build subagent has no inherited clock surface.
3. **Help/usage text.** Extend the `budget check` synopsis (the `cmdBudget` usage string and the top-of-help line) to document `[--now-ms MS | --now ISO]` with the same "HERMETIC test/diagnostic-only" framing the sentry help line carries.
4. **Pin the clock in `test/budget.test.mjs` + add late-day coverage.** Add a test that runs `budget check` at several pinned late-day clocks (run start +6h / +21h) via `--now-ms` and asserts the verdict (`breached`/`outcome`) and the time-derived fields are **invariant across the pinned clocks and across repeat runs**.

## How

**Chosen:** Add the seam to `faff budget check` rather than mock `Date.now()` in the test. The sentry fix established the house pattern (a real CLI seam, hermetic + explicit-flag-only); a process-global `Date.now` stub in `budget.test.mjs` would not survive the `spawnSync` child-process boundary the suite uses. Mirror `resolveSentryNow` exactly for one-pattern consistency.

**Chosen:** Mirror FAFF-301's flag names exactly — `--now-ms` / `--now`, same precedence and same exit-2-on-unparseable.

**Chosen:** Keep the seam explicit-flag-only with no ambient/env form, per FAFF-301's adversarial review.

**Chosen:** The late-day coverage asserts **time-invariance of the verdict**, not a manufactured `until` breach. `untilToEpoch` always rolls the `--until HH:MM` wall forward to its next occurrence, so `now_epoch ≥ until_epoch` does not fire within a single CLI invocation; the honest, born-verifiable assertion is "the verdict and time-derived fields are identical at +6h and +21h and on repeat runs".

**Chosen:** Do **not** add an order-insensitive `breached` compare. Unlike sentry, `breached` is emitted in fixed `BUDGET_DIMENSIONS` order from a single invocation, so a plain `deepEqual` is already deterministic. The issue's order-insensitivity clause is conditional and does not hold here.

**Chosen:** Resolve the carried-forward open question in this slice — audit complete. `test/budget.test.mjs` is the only remaining peer with this flake class: `heartbeat`/`runcheck-gate`/`prepcheck` use a relative `isoAgo` helper (hermetic by construction), `faff-tidy-repeat-park` already injects `--now`, and `run-done.test.mjs` has no time handling. No follow-up ticket needed.

## Done — acceptance criteria (born-verifiable)

1. `faff budget check --now-ms <ms>` and `--now <ISO>` pin the clock used for `elapsed_ms`/`until_epoch`; precedence `--now-ms` > `--now` > `Date.now()`; an unparseable injected value exits 2 with a stderr reason (no silent fall-through). Verified by new selftest/test rows mirroring the sentry seam.
2. `test/budget.test.mjs` passes deterministically under pinned late-day clocks (run start +6h and +21h) and on repeat runs — the verdict (`breached`/`outcome`) and time-derived fields are invariant across pinned clocks. Zero failures.
3. Production behaviour byte-unchanged: with no clock flag, `faff budget check` uses real `Date.now()`. `node plugin/skills/faff/bin/faff budget --selftest` passes and the full `node --test test/` suite is green.
4. The `budget check` help/usage text documents `[--now-ms MS | --now ISO]` as hermetic/test-only.

confidence: high
