# Spec — FAFF-301: Harden the AC5 sentry test against a time-of-day flake

> Spec: faffter-dark-nlspec · 2026-06-29 · interactive · confidence: high. Full spec on Linear FAFF-301.

This is the build spec for FAFF-301, a flaky-test bug fix. Audience: the build agent that will harden `test/sentry.test.mjs`, and the human reviewers gating the release. It turns a time-of-day false-red on the release validate gate into a deterministic test by removing the test's dependency on the ambient wall clock.

## 1. WHY — Problem and Principles

**The load-bearing model.** `faff sentry check` is a *pure evaluator over a live snapshot*: every call samples the ambient clock (`now_ms: Date.now()`) and folds it into the verdict set — a midnight-anchored fixture looks "fresh" at 02:00 and "21h overdue" at 20:47. AC5 runs the evaluator **twice in separate subprocesses** and asserts the two verdict arrays are equal. Two independent clock samples over an absolute-time fixture are not equal late in the day — that is the whole bug. The fix is to take the ambient clock out of the test's hands.

**Problem statement.** `test/sentry.test.mjs` AC5 is environment-flaky: it false-failed the 0.7.0 release-branch `validate` run (2026-06-29 20:47Z) and passed on re-run with identical code, blocking the release gate. The kill-switch behaviour is correct — only the test's coupling to the time of day at which it runs is wrong. This change makes the test deterministic regardless of when (in the day, in the year) it runs.

**Design principles.**

- **The fix is the test, never the kill-switch.** `faff sentry check`'s production evaluation logic (`evaluateDerailment`, `evalWallClock`, the thresholds) is correct and must not change behaviour. The only sanctioned production change is a **hermetic, test-only clock-injection seam** — it must not widen the surface a build subagent could use to suppress a trip in production.
- **Deterministic tools over ambient state.** A time-sensitive CLI command must be drivable from an injected clock, not the wall clock — exactly as `faff park-history` already requires `--now` ("no ambient clock → fully deterministic"). This spec extends that established pattern to `sentry check`; it does not invent a new one.
- **Preserve AC5's intent, do not dilute it.** AC5 exists to prove the kill is *un-subvertable*: a real budget-breach trips `abort`, and no input the build subagent controls flips that verdict. The hardening must keep proving exactly that — and, because it adds a new input (the clock seam), must additionally prove that input cannot suppress the abort either.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `test/sentry.test.mjs` | Node test (`.mjs`) | The test under repair — AC5 (~L213-232), AC2 (~L81-101), AC1's order-insensitive `signals.sort()` pattern (~L69) |
| `plugin/skills/faff/bin/faff` → `cmdSentry` (~L8245) | Node CLI | Where `now_ms: Date.now()` is sampled (~L8268) and where the `--budget-json` hermetic hook is already parsed (~L8263) — the injection site |
| `plugin/skills/faff/bin/faff` → `evalWallClock` (~L8088) | Node CLI | Emits the wall-clock verdict whose `heartbeat_age_secs`/`run_elapsed_secs` evidence drifts between two clock samples |
| `plugin/skills/faff/bin/faff` → `cmdParkHistory` (~L4457) | Node CLI | The in-repo precedent: an injected `--now <ISO>`, no ambient clock — the model this fix mirrors |

**Scope statement.** This sits in the L4 supervisory-lane test suite (FAFF-49 Sentry); it is a robustness fix to that suite plus the minimal CLI seam the suite needs to be deterministic.

## 2. OUT OF SCOPE

- **Changing any sentry evaluation behaviour** — thresholds, signal set, intervention ladder, evidence fields. Why excluded: the kill-switch is correct; this ticket is a test/flake fix. Extension point: a behavioural change would be its own ticket touching `evaluateDerailment` / the `eval*` predicates.
- **A general "mockable clock" abstraction across the whole CLI** — Why excluded: disproportionate; only `sentry check` needs the seam for this fix, and `park-history` already has its own `--now`. Extension point: if a third time-sensitive command needs it, factor a shared `resolveNow(args, env)` helper then.
- **Hardening `test/budget.test.mjs:64`** (`started_at: "2026-06-23T15:00:00Z"`) — Why excluded: `budget check` reports `elapsed_ms` from `started_at`, but that fixture breaches on `max_attempts` (not a wall-clock ceiling) so it is not currently flaky; it is a latent-fragility candidate, not this bug. Extension point: a follow-up audit ticket (noted in Open Questions) that sweeps the remaining absolute-anchored time fixtures.
- **Auditing non-sentry absolute-date test fixtures** (tidy, events, audit, mock-tracker) — Why excluded: explore confirmed they either inject `--now` already or use static timestamps never compared against the ambient clock, so they are not time-of-day fragile. Extension point: the same follow-up audit ticket.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Ambient-clock drift | Two separate `sentry check` subprocesses each sampling `Date.now()`, producing verdict evidence (`heartbeat_age_secs`, `run_elapsed_secs`) that differs by ~1s — the root of the AC5 deep-equal flake |
| Pinned clock | A deterministic "now" supplied to `sentry check` by the test, so every call in the test computes time-based evidence against the same instant |
| Hermetic seam | A test-only input that does not exist on any production call path and cannot relax a production trip |

**The clock-injection seam (new, hermetic).** `faff sentry check` gains an injected-now input, resolved with this precedence:

```
RESOLVE now_ms FOR `sentry check`:
  IF --now-ms <integer-epoch-millis> present   → Number(that)
  ELSE IF --now <ISO-8601> present             → Date.parse(that)
  ELSE IF env FAFF_NOW_MS set and parses        → Number(that)
  ELSE                                          → Date.now()     # unchanged production default
  CONSTRAINT: a non-finite / unparseable injected value is a hard error (exit 2), never a silent fall-through to Date.now()
```

**Chosen:** inject the clock via a hermetic `--now-ms` / `--now` flag (plus `FAFF_NOW_MS` env) on `sentry check`, defaulting to `Date.now()` when absent — mirroring `park-history --now` and the existing `--budget-json` hermetic hook. (Rationale in §6.) The two accepted flag forms are a convenience: `--now-ms` matches the internal `now_ms` unit; `--now <ISO>` matches `park-history`'s existing surface. An implementer may ship just one form if both ACs are met — `--now-ms` is the required one.

**Why this does not widen the subvertable surface.** The seam only sets the instant against which *time-based* signals (`wall-clock-runaway`) are computed. `budget-breach` is derived from the consumed `faff budget check` `{outcome, breached}` and carries **no** clock-derived evidence, so no value of injected-now can suppress a budget-breach trip or its resulting `abort`. AC5 asserts this directly (below). The build subagent has no production call path that passes these flags — the orchestrator owns the `sentry check` invocation.

**Order-insensitive verdict comparison (test-side).** AC5's equality check stops comparing raw arrays positionally:

```
PROCEDURE assertSameVerdicts(a, b):
  key(v) := v.signal                       # signal is the stable identity
  assert deepEqual( sortBy(a, key), sortBy(b, key) )
```

**Chosen:** sort verdicts by `signal` before comparing (mirroring AC1's existing `signals.sort()` at ~L69). This is defensive belt-and-braces; with the pinned clock the evidence no longer drifts, so the sorted full-object compare is now stable. (See §6 for why this alone is insufficient.)

## 4. HOW — Behavior

**Approach.** Two coordinated edits: (1) a tiny hermetic clock seam in `cmdSentry`; (2) rewrite AC5 (and lightly AC2) to pin the clock and compare order-insensitively, then exercise multiple simulated late-day clocks.

**CLI seam (production file, behaviour-preserving when absent).**

```
PROCEDURE cmdSentry(args)  [check branch, near L8268]:
  1. now_ms := resolveInjectedNow(args, process.env)   # the precedence block in §3
  2. result := evaluateDerailment({ events, ledger, budget, now_ms }, th)   # was: now_ms: Date.now()
  # everything else unchanged; absent any injected value, now_ms === Date.now() exactly as today
```

Update the `sentry` CLI help string (~L4981) to document `--now-ms` / `--now` as a hermetic test-only clock override. Mark it in the help text as test/diagnostic, not a normal operational flag.

**AC5 rewrite (test file).**

```
PROCEDURE test_AC5():
  fixtureStart := "2026-06-29T00:00:00Z"          # may stay absolute — the clock is now pinned, not ambient
  ledger := { ...budget max_attempts:1 escalate..., owner running, started_at/last_heartbeat = fixtureStart }
  FOR pinnedNow IN [ fixtureStart + 1h, + 6h, + 21h ]:        # multiple simulated late-day clocks
    base     := sentry check --run-dir rd --json --now-ms <pinnedNow>
    hostile  := sentry check --run-dir rd --json --now-ms <pinnedNow>
                  --intervention continue --suppress --outcome shipped --override continue
    assert base.intervention    == "abort"
    assert hostile.intervention == "abort"          # no subagent-shaped arg flips the verdict
    assertSameVerdicts(hostile.verdicts, base.verdicts)   # order-insensitive
  # the clock seam cannot suppress the abort either:
  evenNow := sentry check --run-dir rd --json --now-ms <fixtureStart + 1h> --now-ms <fixtureStart>   # try to look "fresh"
  assert evenNow.intervention == "abort"            # budget-breach is clock-independent
```

**Behaviour summary.** Pinning `now` to the same instant across the base and hostile calls makes their time-based evidence identical, so the deep-equal is stable; iterating several hours-after-start instants proves the test is green at any time of day; the final assertion proves the new seam can't be used to dodge the budget-breach abort.

**AC2 light hardening.**

```
PROCEDURE test_AC2():
  # same absolute fixture; pin a deterministic now so the test never depends on wall-clock time of day
  pin --now-ms <fixtureStart> (or any fixed instant within budget windows) on the `sentry check` call
  (budget check breach is attempts-based, so its own call needs no pin) for consistency and future-proofing.
  assertions unchanged: budget-breach present, evidence mirrors `faff budget check`, severity "trip".
```

**Edge cases and error handling.**

- **Unparseable injected now** → `sentry check` exits 2 (loud), never silently falls back to `Date.now()` — a fat-fingered test fixture must fail visibly, not flake quietly. (Mirrors `park-history`'s "not a parseable ISO-8601" hard error.)
- **No injected value** → byte-for-byte the current behaviour (`Date.now()`); existing non-AC5 tests and all production calls are unaffected.
- **Both `--now-ms` and `--now` supplied** → `--now-ms` wins per the precedence order; harmless.

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure:** the clock seam leaks into a production path, letting a build subagent pass `--now` to look fresh and dodge a wall-clock trip. **How you'd know:** grep for `--now`/`FAFF_NOW_MS` consumers shows only test + help; AC5's final "clock seam can't suppress abort" assertion passes. **What it means:** proceed — budget-breach (the abort driver here) is clock-independent, and the seam only moves the wall-clock reference, so even a leak cannot relax the budget-breach abort. If a future trip is made to depend *solely* on wall-clock with no independent signal, revisit.
- **The failure:** order-insensitive compare masks a real verdict-set difference (e.g. hostile call genuinely emits an extra signal). **How you'd know:** the sorted full-object deep-equal still compares evidence, not just signal names, so a genuinely different verdict still fails the assert. **What it means:** proceed — sorting by `signal` reorders, it does not drop or coarsen.

**Anti-pattern:** switching AC5 to relative fixtures (`Date.now() - 60_000`) instead of a pinned clock. Why: relative anchoring places the fixture ~60s *before* now, so the time-based signals never fire — it dodges the multi-signal case the DoD explicitly wants exercised ("a fixed now several hours after the fixture's start … multiple simulated clocks") and cannot simulate multiple clocks at all.

**Anti-pattern:** fixing only the order-insensitive compare and leaving the ambient clock. Why: the two subprocesses still sample `Date.now()` independently, so the wall-clock verdict's `heartbeat_age_secs`/`run_elapsed_secs` evidence still drifts by ~1s and the deep-equal still flakes — sorting does not equalise differing evidence numbers.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a budget-breaching run fixture anchored at a fixed start instant
When `faff sentry check` is run twice (base + hostile subagent-shaped args) with `now` pinned to the same instant several hours after the start
Then both runs return intervention "abort" and identical (order-insensitive) verdict sets
```

```
Given the same fixture
When the AC5 test iterates pinned "now" across multiple late-day offsets (e.g. start +1h, +6h, +21h) and runs repeatedly
Then every run passes with zero failures (no time-of-day dependence remains)
```

```
Given a genuine budget-breach trip
When a caller passes any clock-injection flag (`--now-ms`/`--now`) attempting to make the run look fresh
Then the intervention is still "abort" (budget-breach evidence is clock-independent)
```

```
Assertion: with no clock-injection flag or env var present, `sentry check` computes `now_ms` from `Date.now()` exactly as before (production behaviour unchanged).
Assertion: an unparseable injected clock value causes a loud exit (2), never a silent fall-through to the ambient clock.
```

## 6. DESIGN DECISION RATIONALE

**How should the test get a deterministic clock — relative fixtures, or an injected clock?**
- *Relative fixtures (`Date.now() - 60s`)* — pro: no production change; con: fixture is always ~60s old, so time-based signals never fire — it cannot exercise the multi-signal late-day trip the DoD requires, and "multiple simulated clocks" is impossible.
- *Injected clock seam* — pro: pins `now` across both subprocess calls (kills evidence drift at the root), exercises genuine late-day multi-signal trips, matches the DoD's "fixed now several hours after start / multiple simulated clocks", and mirrors the existing `park-history --now` precedent; con: a small production-file seam (mitigated: hermetic, default-`Date.now()`, cannot relax the clock-independent budget-breach abort).
- **Chosen:** injected clock seam — it is the only option that satisfies the born-verifiable DoD as written and fixes the non-determinism at its source. At the time of writing, `sentry check` samples `Date.now()` inline with no override, and `park-history` already establishes the injected-`--now` pattern in the same CLI.

**Should the verdict comparison be made order-insensitive?**
- *Leave positional* — con: brittle to any future per-call ordering or evidence difference.
- *Sort by `signal` before compare* — pro: cheap, mirrors AC1's existing `signals.sort()`; con: none material (sorting reorders, never drops).
- **Chosen:** sort by `signal` then deep-equal — defensive hardening composed with the pinned clock (which is what actually removes the drift). Note: order-insensitivity **alone** does not fix the flake — the wall-clock evidence numbers still drift between two ambient-clock samples; this refines the issue's original root-cause #2 (verdict *ordering* within a call is already deterministic by construction in `evaluateDerailment`).

**Flag form — `--now-ms`, `--now <ISO>`, or `FAFF_NOW_MS`?**
- **Chosen:** support `--now-ms` (required; matches the internal unit) with `--now <ISO>` and `FAFF_NOW_MS` as accepted aliases; precedence `--now-ms` > `--now` > env > `Date.now()`. Rationale: `--now-ms` is the simplest for the test to compute (start-epoch + offset-ms); `--now` keeps parity with `park-history`; the env var allows a whole test file to pin once if convenient.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None block the build — the two original open questions are resolved as Chosen decisions above (inject a clock; keep order-insensitivity defensively). One **follow-up** (not blocking, file separately): audit `test/budget.test.mjs:64` and any remaining absolute-anchored time fixtures for latent time-of-day fragility — `budget check` reports `elapsed_ms` from `started_at`, so a future wall-clock budget ceiling could make that fixture fragile; out of scope here because the current breach is attempts-based.

**Assumptions.**

- **Assumes:** `faff budget check` for the `max_attempts: 1 / escalate` fixture continues to return a breach whose verdict carries no clock-derived evidence. Validate: read `evalBudgetBreach` (~L8079) — its evidence is `{budget_outcome, breached}` only; confirm no `elapsed`/time field is added before relying on the clock-independence claim.
- **Assumes:** `evaluateDerailment` takes `now_ms` as an injectable parameter (it does — `now_ms` is already a field of its input object at ~L8183/L8268), so the seam is a one-line change at the call site, not a signature refactor. Validate: confirm `now_ms` flows from the `cmdSentry` call object into `evalWallClock` unchanged.

## 8. DONE — Definition of Done

### From WHY
- [ ] `node --test test/sentry.test.mjs` passes deterministically irrespective of the wall-clock time of day it is run (the time-of-day false-red is gone).

### From WHAT (the clock seam)
- [ ] `faff sentry check` accepts `--now-ms <epoch-ms>` (and/or `--now <ISO>` / `FAFF_NOW_MS`) and computes time-based verdicts against it; absent any override it uses `Date.now()` (byte-identical to current behaviour).
- [ ] An unparseable injected clock value exits 2 (loud), never silently falls back to `Date.now()`.
- [ ] The `sentry` CLI help string documents the flag(s) as hermetic/test-only.

### From WHAT (order-insensitive compare)
- [ ] AC5 compares verdict sets order-insensitively (sorted by `signal`).

### From HOW (behaviour)
- [ ] AC5 pins `now` to the same instant across its base and hostile `sentry check` calls and asserts both return `abort` with identical (order-insensitive) verdicts.
- [ ] AC5 iterates multiple simulated late-day clocks (e.g. start +1h, +6h, +21h) with zero failures.
- [ ] AC5 asserts that passing a clock-injection flag cannot suppress the budget-breach `abort` (budget-breach is clock-independent).
- [ ] AC2's `sentry check` call pins a deterministic clock; its existing budget-breach assertions still pass.

### From HOW (regression safety)
- [ ] `faff sentry --selftest` still passes.
- [ ] The full `node --test` suite is green (no other sentry test regressed by the seam).

### Integration smoke test
```
# fixture: budget max_attempts:1/escalate, owner running, started_at = S
faff sentry check --run-dir <rd> --json --now-ms <S+6h>   → intervention "abort", verdicts include budget-breach + wall-clock-runaway
faff sentry check --run-dir <rd> --json                   → intervention "abort" (ambient-clock default path still works)
```

## Methodology critique

_Methodology: faffter-dark-methodology-agile-delivery_

- **Right-sized? No issues.** One coherent 1–3 day unit — a single test file plus one small hermetic CLI seam, one concern (test robustness). Nothing to split; nothing to merge.
- **Workstream fit? No issues.** A bug fix correctly landing project-less in Backlog; it relates to FAFF-49 (Sentry, shipped) without belonging inside it. No thematic-bucket or activity-named smell.
- **Deps surfaced? No issues.** `related-to FAFF-49` is shipped, so it is context not a blocker; no implicit prerequisite is referenced. No missing `blockedBy` edge.
- **Risk profile? One thing to watch (not blocking).** What's there: the fix touches a *production* file (`bin/faff`) to repair a *test*, adding a clock-injection flag. Why it matters: a production change made for test convenience is exactly where a subvertable surface can creep in (the very property AC5 guards). What to do: the spec already de-risks this correctly — the seam is hermetic (default `Date.now()`, no production caller), and a dedicated AC proves the flag cannot suppress the clock-independent budget-breach `abort`. Keep that AC load-bearing in review; it is the evidence the risk is closed.

confidence: high
