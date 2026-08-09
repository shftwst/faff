# FAFF-447 — Sentry kill-switch reacts to the L4 estimate-only budget-metering degrade

> Spec: faffter-dark-nlspec · 2026-07-14 · autonomous · confidence: high. Full spec on Linear FAFF-447.

This spec addresses FAFF-447 for the build agent and human reviewers: it teaches `faff sentry check` a new v1 derailment predicate — `budget-metering-degraded` — that trips whenever a live **L4** run has been running on **estimate-only** budget metering (`tokens_source: "estimate"`) for longer than a configurable exposure window, mapping to the `pause` intervention. FAFF-428 (DONE, PR #325) made the meter loud at mint (refuse-or-warn) and mid-run (`warnings[]`); this closes the named follow-up — Sentry currently stays blind to that degrade between checkpoints. L1–L3 and measured-transcript L4 runs are unaffected.

## 1. WHY — Problem and Principles

**Load-bearing model:** Sentry (`plugin/skills/faff/bin/lib/sentry.js`) is the L4 supervisory lane — it reads the orchestrator's out-of-band surface (events + ledger + a **consumed** `faff budget check`) at every between-units checkpoint and emits `DerailmentVerdicts` + an intervention. FAFF-428 made `faff budget check` loud about an estimate-only degrade (`tokens_source: "estimate"` + a `warnings[]` entry at L4), but named its own scope boundary explicitly: *"Sentry visibility of the degrade — `sentryReadBudget` reads only `{breached, outcome}`; teaching the kill-switch to react to `tokens_source`/`warnings` is a follow-up."* Today, an L4 run that is (a) minted under the opt-in `budget.on_estimate_only: warn` posture, or (b) degrades mid-run (a measurable mint whose transcript later vanishes — the exact "persistent net" FAFF-428's mid-run warning names) can burn against a real ceiling for the rest of the run with no supervisory signal at all: the ceiling's own instrument is reading a figure that under-reports ~10×, and nothing watches for that.

**Problem:** `sentryReadBudget` extracts only `{breached, outcome}` from the child `faff budget check --json` call, discarding `tokens_source` — the one field that names the degrade. `evaluateDerailment`'s six-and-fleet predicate set has no signal keyed on it at all.

**Design principles:**

**Consume, never re-derive.** Same posture as `budget-breach`: Sentry reads the ALREADY-COMPUTED `tokens_source` off the consumed `faff budget check` JSON — no new token/cost math, no new I/O. The one-line extension is plumbing a field sentry already receives the payload for, not a new child call.

**A blind spot is a `pause`, not an `abort`.** `SIGNAL_TRIP_INTERVENTION`'s existing ladder maps hard-evidence trips (`budget-breach`, `wall-clock-runaway`, `repeated-identical-failure`, `forbidden-side-effect-attempt`) to `abort` and one soft signal (`fix-review-thrash`, a no-progress loop) to `pause`. Estimate-only metering is exactly the `fix-review-thrash` shape: real cause for a human/operator look, but — critically — the run has NOT been proven to have breached anything; the meter has merely stopped being trustworthy. Routing it to `abort` would kill runs that may be perfectly healthy purely because their observability degraded. `pause` (park the run's current dispatch, keep the ledger resumable, surface it) is the correct severity — never a weakening of any existing `abort` route (this signal only ever contributes `pause` to the ladder-max).

**A predicate, not a policy engine.** The exposure "threshold/escalation per governance profile" the ticket names resolves to exactly the existing `sentry.*` config mechanism (`thrash_n`, `failure_k`, `stall_window_secs`, `run_elapsed_ceiling_secs` today) — one more `sentry.*` key, no new governance-profile abstraction. `evaluateDerailment` stays a pure fold over the normalized surface; the aggregation ladder is untouched except for one new entry.

**Reference context:**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/sentry.js` | `normalizeSentrySignals` (~133: closed-allowlist sanitizer, the AC5 structural heart), `evalWallClock`/`sentryRunElapsedSecs` (~175–215: the run-elapsed-since-`owner.started_at` shape this predicate mirrors), `SIGNAL_TRIP_INTERVENTION`/`SENTRY_INTERVENTIONS` (~89–103: the ladder), `SENTRY_THRESHOLD_DEFAULTS`/`sentryThresholds` (~109–127), `sentryReadBudget` (~465–484: the CONSUME boundary that currently drops `tokens_source`), `evaluateDerailment` (~385–424: the aggregation fold) |
| `plugin/skills/faff/bin/lib/budget.js` | `computeBudgetState` (~275–297: already returns `tokens_source` — untouched by this spec), FAFF-428's L4 mid-run warning (~671–684) — the shipped degrade signal this predicate watches for |
| `records/specs/2026-07-12-FAFF-428-...-design.md` | Section 2 OUT OF SCOPE names this exact follow-up and its extension point (`sentryReadBudget`) |
| `plugin/skills/faff-beep-boop/SKILL.md` | The sentry handling table (~90–95): `pause` already routes to "park the implicated issue(s)... continue the queue" at L4, "log + surface" elsewhere — this predicate needs NO new row, it rides the existing `pause` row byte-for-byte |
| `test/sentry.test.mjs`, `test/budget.test.mjs` | AC3's config-threshold test pattern (~171–181) and FAFF-428's L4-ledger fixture pattern (~636–654) — the patterns this spec extends |

**Scope:** a CLI-internal change to `sentry.js` (one new pure predicate + one plumbing line in `sentryReadBudget` + one new config threshold) plus its tests and one `docs/guide/cli.md` row. No skill-prose control-flow change (the existing `pause`/non-L4-advisory handling table already covers every intervention this predicate can produce), no tracker behaviour change, no `budget.js` change.

## 2. OUT OF SCOPE

- **Any new intervention above `pause`.** `abort`/`correct` are unreachable from this signal — an estimate-only run is a blind spot, not a proven breach; if the SAME run also breaches (or has been running estimate-only long enough to also stall/thrash on other grounds), the CO-OCCURRING signal's own mapped intervention still wins the ladder-max exactly as today — this spec adds no escalation path.
- **Auto-correcting the metering** (forcing a transcript re-resolve, retrying the session lookup, etc.) — purely a supervisory *signal*; the fix for the meter itself is FAFF-428's territory (mint-time refuse/warn), already shipped.
- **A new governance-profile abstraction.** The ticket's "threshold/escalation per governance profile" phrase resolves to the existing `sentry.*` config key mechanism — no new profile/policy layer is introduced.
- **Changing `budget check`'s own output shape or exit codes.** `computeBudgetState`/`cmdBudget` are untouched; `tokens_source` already exists in the JSON today (FAFF-408/425).
- **Per-member (fleet, FAFF-327) attribution of this signal.** Estimate-only metering is a RUN-level property (one meter, one ledger) — unlike `fix-review-thrash`/`repeated-identical-failure`, there is no per-issue attribution to carry; this predicate never sets `scope`/`member`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| estimate-only metering | `faff budget check`'s `tokens_source === "estimate"` (FAFF-428's shipped degrade — transcripts unreadable, spend is `attempts × est_tokens_per_attempt`) |
| exposure | how long (wall-clock, since the run's `owner.started_at`) an L4 run has been live while its meter reads `tokens_source: "estimate"` — approximated by run-elapsed (no separate "degrade start" timestamp exists anywhere on the ledger; run-elapsed is the same proxy `wall-clock-runaway`'s `run_elapsed_ceiling_secs` already uses) |
| `budget-metering-degraded` | the new v1 signal name; trips `pause` |

**New/changed shapes (pseudocode):**

```
SIGNAL_TRIP_INTERVENTION (additive entry):
  "budget-metering-degraded": "pause"

DERAILMENT_SIGNALS (additive member):
  "budget-metering-degraded"

SENTRY_THRESHOLD_DEFAULTS (additive key):
  estimate_metering_exposure_secs: 1800   // 30 min — config: sentry.estimate_metering_exposure_secs

normalizeSentrySignals's budget sub-object (additive field):
  budget.tokens_source: string | null     // sanitized: string passthrough, else null (mirrors `outcome`'s
                                           // string-or-default sanitization; closed-allowlist, never trusts a
                                           // foreign shape)

sentryReadBudget (additive field on its return value):
  { breached, outcome, tokens_source }    // tokens_source forwarded verbatim from the child JSON when a
                                           // string, else null — the ONE line this spec plumbs through the
                                           // existing CONSUME boundary

FUNCTION evalBudgetMeteringDegraded(ledger, budget, nowMs, th):   # PURE, mirrors evalWallClock's shape
  owner = ledger && ledger.owner
  IF !owner OR owner.status != "running": RETURN null   # only a live owner can be "currently" degraded
  IF ledger.level != "L4": RETURN null                   # L1-L3 estimate-fallback is an unwarned count-idiom (FAFF-428 parity)
  IF !budget OR budget.tokens_source != "estimate": RETURN null
  elapsed = sentryRunElapsedSecs(ledger, nowMs)           # reused, not re-derived
  IF elapsed == null OR elapsed <= th.estimate_metering_exposure_secs: RETURN null
  RETURN { signal: "budget-metering-degraded", severity: "trip",
           evidence: { tokens_source: "estimate", run_elapsed_secs: round(elapsed),
                       exposure_threshold_secs: th.estimate_metering_exposure_secs } }
```

**Design decisions** (rationale in section 6): new predicate vs. folding into `budget-breach` — **Chosen:**; trigger shape (L4 + estimate + run-elapsed exposure) — **Chosen:**; intervention mapping (`pause`, never `abort`/`correct`) — **Chosen:**; threshold key + default — **Chosen:**; plumbing point (`sentryReadBudget` + `normalizeSentrySignals`, not a new child call) — **Chosen:**; ADR-worthiness — **Chosen:** (not warranted).

## 4. HOW — Behavior

**The plumbing (`sentryReadBudget`).** The child-consult function gains one forwarded field on its success path — no new child invocation, no new own-fault branch:

```
PROCEDURE sentryReadBudget (change):
  ON child success (status 0, parseable stdout, outcome != "indeterminate"):
    RETURN { breached, outcome, tokens_source: typeof j.tokens_source === "string" ? j.tokens_source : null }
  ON own-fault branches (non-zero exit / unparseable / thrown):
    RETURN { breached: [], outcome: "indeterminate", tokens_source: null }   # unchanged control flow —
      # cmdSentry already short-circuits to sentryIndeterminate on outcome:"indeterminate" BEFORE this
      # predicate would ever see the budget object, so tokens_source:null here is shape-consistency only.
```

- The `--budget-json` hermetic test hook is untouched — it already assigns the FULL parsed JSON as `budget` (bypassing `sentryReadBudget` entirely), so a test injecting `tokens_source` flows through exactly as `breached`/`outcome` do today.

**The predicate (`evalBudgetMeteringDegraded`).** Wired into `evaluateDerailment` alongside the other budget-adjacent pushes:

```
PROCEDURE evaluateDerailment (addition, after push(evalBudgetBreach(...))):
  push(evalBudgetMeteringDegraded(s.ledger, s.budget, s.now_ms, th))
```

- `s.ledger` is already the UNFILTERED raw ledger object inside `normalizeSentrySignals` (the same object `evalWallClock`/`sentryInflightMembers` already read `owner`/`outcomes` off of) — `ledger.level` needs no new plumbing.
- `s.budget` is the sanitized `{breached, outcome, tokens_source}` object — the one new field flows through the existing closed-allowlist sanitizer.
- Aggregation: `SIGNAL_TRIP_INTERVENTION["budget-metering-degraded"] = "pause"`. No `CORRECTABLE_SIGNAL` change — only `fix-review-thrash` ever upgrades to `correct`, so this signal stays `pause` even when `authority: "available"`. The ladder-max fold is untouched: a co-tripping `abort`-mapped signal (e.g. a genuine `budget-breach` on the SAME degraded run) still wins, exactly as today.

**Threshold resolution (`sentryThresholds`).** One additive line, same shape as the existing four:

```
estimate_metering_exposure_secs: num(dig(cfg, "sentry.estimate_metering_exposure_secs"), d.estimate_metering_exposure_secs)
```

- Non-positive/non-numeric config value falls back to the 1800s default (the existing `num()` helper's fail-safe-toward-default rule — unchanged, reused verbatim).

**Handling (`faff-beep-boop/SKILL.md`).** No prose change: the existing table's `pause` row ("park the implicated issue(s)... continue the queue" at L4, "log + surface" elsewhere) already covers this signal's only reachable intervention. `budget-metering-degraded` is RUN-scoped, not issue-scoped (no `member`/`scope` field) — the orchestrator's existing pause handling for a run-scoped (non-thrash/non-repeated-failure) verdict already degrades sensibly (surfaces the verdict; a run-scoped pause with no named issue is a "look at the run" signal, not a per-issue park instruction) — verify during build that the beep-boop pause-handling prose doesn't assume every `pause` verdict names an issue; if it does, this is a one-line prose clarification, not a control-flow change.

**Edge cases:**

- A `pause`-worthy run whose owner is NOT `"running"` (e.g. `done`, `aborted-resumable`) → no verdict (mirrors `evalWallClock`'s "only a RUNNING owner can run away" guard — a finished run cannot currently be blind).
- A non-L4 ledger (or a ledger with no `level` field at all — every pre-L4 run) with `tokens_source: "estimate"` → no verdict, regardless of elapsed time (L1–L3 estimate-fallback stays the unwarned count-idiom FAFF-428 already established).
- `tokens_source: "transcript"` (measured) past the exposure window → no verdict — the predicate is keyed purely on the degrade flag, never on elapsed time alone.
- `budget.outcome === "indeterminate"` (a budget consult own-fault) → `cmdSentry` already short-circuits to `sentryIndeterminate` (exit 3) before `evaluateDerailment` is ever called — this predicate is unreachable on that path, consistent with every other predicate.
- Exactly at the threshold (`elapsed === th.estimate_metering_exposure_secs`) → no trip (`>` not `>=`, mirroring `evalWallClock`'s `age > th.stall_window_secs` strict-inequality convention).
- `sentry.estimate_metering_exposure_secs: 0` or negative or non-numeric → falls back to the 1800s default (never a vacuous always-on/never-on threshold — the shared `num()` helper's existing rule).

**Failure modes:**

- **An operator sets the exposure threshold very high (or very low) to normalise/over-trigger the degrade.** How you'd know: `budget-metering-degraded` verdicts accumulating (or never appearing) in run summaries/audit. What it means: operator choice, exactly as today's other `sentry.*` thresholds — the config is explicit, human-set, and visible in the JSON `thresholds` block every `sentry check` call already returns.
- **A run degrades, gets paused, an operator resumes it without fixing the transcript.** How you'd know: `budget-metering-degraded` trips again at the next checkpoint (elapsed keeps growing since `owner.started_at` never resets on a `pause`/resume — the run was never aborted). What it means: this is intentional — `pause` is a repeatable advisory, not a one-shot; the operator must fix the meter (or explicitly accept via `budget.on_estimate_only: warn`, which they already did to get here) to stop seeing it.

**Anti-pattern:** mapping this signal to `abort`. Why: an unmetered run is not a PROVEN breach — aborting it purely for degraded observability would kill healthy runs; a co-occurring genuine breach already gets its own `abort` via `budget-breach`.

**Anti-pattern:** deriving a new "time since degrade began" ledger field. Why: no such timestamp exists today and none is needed — run-elapsed-since-`started_at` is the same proxy `wall-clock-runaway`'s `run_elapsed_ceiling_secs` already uses, and introducing a new mint-time field would touch `lights-out.js`'s mint block for a threshold that doesn't need that precision (a fixed run-relative exposure window is the honest, minimal signal).

## 5. SCENARIOS

```
Given a running L4 run ledger (owner.status: "running", started_at more than
  sentry.estimate_metering_exposure_secs seconds ago) whose consumed budget check
  reports tokens_source: "estimate"
When faff sentry check --json runs
Then verdicts include { signal: "budget-metering-degraded", severity: "trip" },
  and intervention is at least "pause"
```

```
Given the same ledger, but started_at is WELL WITHIN the exposure window (e.g. 10s ago)
When faff sentry check --json runs
Then no "budget-metering-degraded" verdict is present
```

```
Given the same aged-past-threshold running L4 ledger, but tokens_source: "transcript"
When faff sentry check --json runs
Then no "budget-metering-degraded" verdict is present (a measured meter is never a blind spot)
```

```
Given the same aged-past-threshold estimate-only scenario, but the ledger carries no
  "level" field (or level: "L3")
When faff sentry check --json runs
Then no "budget-metering-degraded" verdict is present (L1-L3 unaffected)
```

```
Given sentry.estimate_metering_exposure_secs: 5 in .faffrc.yaml, and a running L4
  estimate-only ledger started 10s ago
When faff sentry check --json runs
Then the resolved thresholds.estimate_metering_exposure_secs is 5, and the
  "budget-metering-degraded" verdict trips (10s exceeds the tightened 5s window)
```

```
Given the same running L4 estimate-only ledger ALSO carrying a genuine budget-breach
  (outcome: "escalate")
When faff sentry check --json runs
Then intervention is "abort" (budget-breach's mapped abort wins the ladder-max; the
  co-tripping budget-metering-degraded verdict is still present in verdicts[], just
  outranked)
```

Assertions (non-functional): a clean measured (or non-L4, or within-window) run's `sentry check` JSON is byte-identical to today; every existing `sentry --selftest` / `node --test` assertion stays green; `authority: "available"` never upgrades this signal past `pause` (only `fix-review-thrash` upgrades, unchanged).

## 6. DESIGN DECISION RATIONALE

**New predicate vs. folding the degrade into `budget-breach`?** Options: (a) a new, distinct signal (`budget-metering-degraded`); (b) extend `evalBudgetBreach` to also fire on `tokens_source === "estimate"` alone. **Chosen:** (a) — `budget-breach` is a CONSUMED, exact mirror of `faff budget check`'s `{breached, outcome}` (AC2's own invariant: "no token/cost counter re-implemented in sentry"); conflating a metering-honesty signal into it would blur that mirror and force `budget-breach`'s severity/evidence shape to carry an unrelated concept. A distinct signal keeps each predicate's evidence self-describing and keeps `budget-breach`'s existing tests (which assert byte-identity with the budget CLI's reading) untouched.

**Trigger shape — what counts as "exposure"?** Options: (a) run-elapsed-since-`started_at` (reuses `sentryRunElapsedSecs`, the `wall-clock-runaway` run-elapsed proxy); (b) a new mint-time "degrade started at" ledger field, exposure = now − that; (c) no threshold at all — trip on ANY estimate-only L4 tick. **Chosen:** (a) — no new ledger-write surface, reuses an existing pure helper, and the ticket explicitly asks for a "configurable exposure threshold" (ruling out (c), an always-on trip that would fire on the very first checkpoint after an operator's own explicit `warn`-posture opt-in, making that opt-in nearly self-defeating). (b) would require touching `lights-out.js`'s mint block and gain no meaningful precision over (a) for a supervisory (not billing-precision) signal.

**Intervention mapping — how severe?** Options: (a) `pause` (mirrors `fix-review-thrash`'s no-progress-loop severity: real, but not proven-fatal); (b) `abort` (mirrors `budget-breach`'s hard-evidence severity); (c) `warn`-only (advisory, never escalates past `continue` — mirrors `scope-drift`). **Chosen:** (a) — per the ticket's own framing ("react to the degrade... rather than staying blind to it," but explicitly NOT proposing an abort), and because a blind meter is not a proven overrun: `abort` would be a false-severity response to an observability gap, while `warn`-only would fail the ticket's ask for a genuinely *watchable, actionable* signal (warn-severity verdicts never escalate past `continue` — no `pause` ever reaches the operator's dispatch loop). `pause` is the one rung that is both actionable (parks/surfaces, per the existing handling table) and honest about what is actually known (a degraded instrument, not a confirmed breach).

**Threshold key + default?** Options: (a) `sentry.estimate_metering_exposure_secs`, default 1800 (30 min); (b) reuse `sentry.stall_window_secs` (900s, already the heartbeat-staleness window) — conflates two different concepts (liveness vs. metering honesty) under one knob; (c) reuse `sentry.run_elapsed_ceiling_secs` (4h) — too coarse; a run could burn 3.9 unmetered hours before ever surfacing. **Chosen:** (a) — a dedicated key named for what it measures, independently tunable per governance profile (the ticket's own phrase) without perturbing the unrelated liveness/run-elapsed knobs; 1800s is long enough that a brief post-mint hiccup doesn't spuriously pause a healthy run, short enough that a genuinely degraded run surfaces well inside a typical multi-hour L4 session.

**Where does `tokens_source` enter the evaluator?** Options: (a) forward it through the EXISTING `sentryReadBudget` consult (one field, no new child call); (b) a second, dedicated child call just for `tokens_source`. **Chosen:** (a) — `sentryReadBudget` already spawns `faff budget check --json` and parses its JSON; `tokens_source` is already in that payload (FAFF-408/425 shipped it). Adding a second child invocation would double the process-spawn cost per checkpoint for a field the first call already returns.

**Is this ADR-worthy?** FAFF-428 minted the durable "L4 spend governor must be measurable" ADR candidate. This ticket is the follow-up WIRING of an already-shipped signal into an already-existing, documented-as-extensible evaluator (the sentry.js banner literally frames new predicates as "slots into the existing evaluator"), using the existing `sentry.*` config mechanism and the existing intervention ladder verbatim. **Chosen:** not ADR-worthy — it establishes no new durable architectural rule; it exercises the rule FAFF-428's ADR already established (a degraded meter must be surfaced, now one hop further down the supervisory chain) via the mechanism the sentry.js docstring already documents as the intended extension path.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none blocking — every decision above carries a **Chosen:** marker.

**Assumptions:**

- **Assumes:** FAFF-428 has merged (blocker relation confirms it; `git log --oneline | grep 428` → `bc02ff6 fix(FAFF-428): refuse or loudly degrade L4 budget metering when transcripts are unavailable (#325)`). `computeBudgetState`/`cmdBudget` already emit `tokens_source` on every `budget check` call — no FAFF-428 code is re-touched by this spec. Validate: `grep -n "tokens_source" plugin/skills/faff/bin/lib/budget.js` at build start (already confirmed present at spec time: `computeBudgetState`'s return shape, ~line 293).
- **Assumes:** every L4-minted ledger carries `level: "L4"` (FAFF-428's own test fixtures already rely on this — `test/budget.test.mjs`'s `baseLedger({ level: "L4" })` pattern). Validate: unchanged from FAFF-428's own assumption; the mint block in `lights-out.js` is not touched by this spec.
- **Assumes:** `sentryRunElapsedSecs` and `sentryThresholds`'s `num()` fail-safe helper are usable as-is for the new threshold (both already exported/in-module and used identically by `wall-clock-runaway`). Validate: confirmed by direct read of `sentry.js` at spec time (lines ~118–127, ~175–180).

## 8. DONE — Definition of Done

### From WHY
- [ ] A live L4 run on estimate-only metering, past the configured exposure window, produces a `budget-metering-degraded` verdict at the next `faff sentry check` and the run's dispatch loop reacts per the existing `pause` handling row (park + continue) — closing FAFF-428's named follow-up.

### From WHAT
- [ ] `SIGNAL_TRIP_INTERVENTION["budget-metering-degraded"] === "pause"`; the signal is a member of `DERAILMENT_SIGNALS`.
- [ ] `SENTRY_THRESHOLD_DEFAULTS.estimate_metering_exposure_secs === 1800`; `sentryThresholds` resolves `sentry.estimate_metering_exposure_secs` from config with the existing fail-safe-to-default `num()` rule.
- [ ] `normalizeSentrySignals`'s `budget` sub-object carries a sanitized `tokens_source` (string passthrough, else `null`).
- [ ] `sentryReadBudget` forwards `tokens_source` from the child JSON's success path; own-fault branches carry `tokens_source: null` (shape-consistency only — unreachable via `evaluateDerailment` on the indeterminate path).

### From HOW
- [ ] `evalBudgetMeteringDegraded(ledger, budget, nowMs, th)`: pure, returns `null` unless `owner.status === "running"` AND `ledger.level === "L4"` AND `budget.tokens_source === "estimate"` AND elapsed run time strictly exceeds the threshold; evidence carries `tokens_source`, `run_elapsed_secs`, `exposure_threshold_secs`.
- [ ] Wired into `evaluateDerailment` via one additive `push(...)` call; a co-tripping `abort`-mapped signal still wins the ladder-max; `authority: "available"` never upgrades this signal (only `fix-review-thrash` does, unchanged).
- [ ] A measured-transcript L4 run, an L1–L3 run (any `tokens_source`), and a within-window estimate-only L4 run each produce NO `budget-metering-degraded` verdict.

### From docs/tests (same PR — docs never go stale)
- [ ] `docs/guide/cli.md`'s `sentry` row names the new signal + its `sentry.estimate_metering_exposure_secs` threshold key + default, alongside the existing per-signal documentation.
- [ ] `test/sentry.test.mjs`: trip-past-threshold, no-trip-within-threshold, no-trip-on-measured-transcript, no-trip-on-non-L4, config-override-tightens-window (mirrors the AC3 pattern), ladder co-occurrence (abort still wins over a co-tripping budget-breach), authority-available-does-not-upgrade. `sentrySelftest` gains equivalent pure-core coverage (no child process) for `evalBudgetMeteringDegraded` directly. Full `node --test` green.
- [ ] `sentrySelftest`'s existing `Object.keys(normalizeSentrySignals(hostile))` top-level-key assertion is unaffected (the new field nests under `budget`, not a new top-level key) — verified, not modified.

**Integration smoke test:**

```
1. mkRun with owner.status:"running", started_at 40 min ago, level:"L4"
2. faff sentry check --run-dir <dir> --json --budget-json '{"breached":[],"outcome":"none","tokens_source":"estimate"}'
   → verdicts include budget-metering-degraded, intervention "pause"
3. Re-run with --budget-json '{"breached":[],"outcome":"none","tokens_source":"transcript"}'
   → no such verdict, intervention "continue"
4. Re-run against a ledger with no "level" field (same estimate budget-json)
   → no such verdict
```

## Already shipped against this surface

Done tickets matched on the sentry/budget governance surface — related groundwork, none supersedes this premise (no Done ticket wires the estimate-only degrade into Sentry):

- FAFF-49: the sentry evaluator + intervention ladder this predicate slots into.
- FAFF-428: the shipped mint-time refuse/warn + mid-run `warnings[]` degrade signal this predicate watches for; its own OUT OF SCOPE section names this exact follow-up.
- FAFF-326 (Sentry-2 Channel A): the `correct` rung this signal explicitly never reaches.
- FAFF-327: the fleet/member-scoped attribution this signal explicitly never carries (it is run-scoped by nature).
- FAFF-352: the effects→sentry bridge — the most recent precedent for "plumb one boolean/field through the existing consult without a new child call," the same shape this spec follows for `tokens_source`.
- FAFF-425: `budget check`'s `indeterminate` own-fault channel — confirmed unreachable-by-construction for this new predicate (short-circuited before `evaluateDerailment` runs).

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** No issues — a single cohesive slice: one pure predicate + one plumbing line + one config threshold + tests + one docs row. Splitting the plumbing from the predicate would ship dead code (a `tokens_source` nobody reads) or an unreachable predicate (no `tokens_source` to read) — the pairing is the minimal shippable unit.
- **Workstream fit?** No issues — closes a named, ticketed follow-up of a DONE blocker (FAFF-428); no scope creep beyond the follow-up's own stated boundary (`sentryReadBudget` reading `tokens_source`).
- **Deps surfaced?** None — FAFF-428 is DONE and its blocking edge is already a directed `blockedBy` relation on this issue (confirmed via `get_issue --includeRelations`), unlike the FAFF-427/428 sequencing gap FAFF-428's own critique flagged.
- **Risk profile?** No issues — a pure-function addition to an already-selftested, already-`node --test`-covered evaluator; no de-risking spike warranted.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
