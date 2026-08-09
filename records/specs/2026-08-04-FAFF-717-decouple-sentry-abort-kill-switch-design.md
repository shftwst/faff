# FAFF-717 spec: decouple the Sentry ABORT kill-switch from the L4 mint (`autonomous.sentry_acting`)

> Spec: faffter-dark-nlspec · 2026-08-04 · interactive · confidence: high. Full spec on Linear FAFF-717.

## 1. WHY: problem and principle

Sentry's **abort** (the kill-switch) fires only on an L4-minted ledger. The decision is re-derived from `ledger.level === "L4"` at each locus (the detached poller's `decideTick`, and beep-boop's "The interrupt" handling table). An **unattended L3 run on CI** breaks the human-on-the-loop premise that L3's advisory-only Sentry rests on: nobody is watching overnight, yet a derailing run only gets *logged*, never *killed*. The pinch is sharpest for the **self-directed faff-on-faff watcher** (`l3-watcher.yml`): L4 refuses a self-directed run, so that watcher *structurally cannot* be L4 and can never get the kill-switch, however unattended it is.

This ticket **decouples the abort kill-switch from the L4 mint**: an unattended L3 run can opt into `abort` via a config knob, without the rest of the L4 mandate. Scope is deliberately **the abort intervention only**. `pause` and `correct` stay L4-only-acts (they are the finer adversarial *steering* L4 owns; the abort is the *safety* need an unattended run has), and the **holdout** is out of scope (see below). Budget-at-ceiling is *already* tunable at L3 (`budget.at_ceiling: escalate`), so no change there.

## 2. WHAT: design

**Chosen: the knob gates the `abort` row ONLY, and `pause`/`correct` stay L4-only.** This is the scope decision the rest of the design turns on. Sentry's handling table has an *acts* column covering three interventions: `pause` (park the implicated issue), `correct` (author narrowing), and `abort` (the run-level kill-switch). This ticket adds the knob to **`abort` alone**. The detached poller already matches this by construction, since it only ever dispatches on `abort` (`pause`/`correct` return `advisory-trip` unconditionally), so the poller change is purely "the abort gate now includes the knob." The **cooperative** handling table (beep-boop) must NOT flip its whole acts column: an L3-with-knob run keeps advisory `pause`/`correct` (it does not newly auto-park or auto-narrow) and gains only the abort kill-switch. Naming reflects the scope: the resolver is `actsOnSentryAbort`, not a generic "acts."

**Chosen: add `autonomous.sentry_acting` (default `"false"`), fail-safe, so only a literal `true` enables the L3 abort.** Mirror `autonomous.engine_bounded` exactly at the three real sites: a `DEFAULTS` entry (`"autonomous.sentry_acting": "false"`, `config.js` near line 153); add the key to the `config defaults --selftest` **expected** array (`config.js` near line 1676); add `"sentry_acting"` to the `config resolved` autonomous-knob echo loop (`config.js` near line 1768, alongside `require_container`, `require_branch_protection`, `engine_bounded`), which is the operator's typo-detection surface, so a set value must be echoed back. The resolver `sentryActingFromConfig(cfg)` lives in **`sentry.js`** (alongside `actsOnSentryAbort`, not in `config.js`), mirroring `engineBoundedFromConfig`'s exact fail-closed form: `raw === true || String(raw).trim().toLowerCase() === "true"`, otherwise `false`. Fail-direction rationale: the un-fired state is the documented L3 **advisory** posture, the abort is a **resumable ledger-mark** (not destructive), and runaway spend is independently bounded by `budget.at_ceiling`; so an ambiguous or typo'd config resolving to the known L3 semantics is the safe, no-surprise default, and a typo silently making runs abortable is the genuine hazard. (L4 abort is unaffected: `level === "L4"` always aborts, knob or no knob.)

**Chosen: a single resolver `actsOnSentryAbort(ledger, cfg)` = `ledger.level === "L4" || sentryActingFromConfig(cfg)`, exported from `sentry.js`.** This is the one place the abort-acting decision resolves; the poller and the prose abort-restatements point at this rule instead of each re-deriving `level === "L4"`. The `||` is **lazy**, so an `L4` ledger short-circuits and never reads config, and a config fault therefore cannot regress the L4 kill-switch.

**Chosen: the poller threads the abort-acting decision as a fact, keeping `decideTick` pure and fail-safe on a config fault.** `decideTick` stays a pure function of `facts`. `gatherFacts` (already impure) resolves the repo root via `findRoot(runDir)`, then reads config **guarded**: a malformed `.faffrc` must not throw mid-tick, so a config-read fault fails safe to `actsOnSentryAbort` computed from the `level === "L4"` value alone (off for L3, unchanged for L4), never a fault, never a coerced abort. It computes `facts.actsOnSentryAbort = actsOnSentryAbort(ledger, safeCfg)`. `decideTick`'s abort gate keys on `facts.actsOnSentryAbort` (was `facts.isL4`); `pause`/`correct` stay `advisory-trip` unconditionally (unchanged). Backward-compat is exact: `L4` aborts; `L3` without the knob is advisory-trip; the new path is `L3` with the knob aborts.

**Chosen: the prose handling changes only the ABORT restatements, at every locus, and the beep-boop table is restructured so an L3+knob run reads as acting, not advisory.** The "L4-only aborts" rule is restated at more sites than a first pass sees; each abort-relevant one gains "or `autonomous.sentry_acting: true`" (all line numbers are `faff-beep-boop/SKILL.md` unless named otherwise, and approximate, so re-grep at build):

- near line 101, the primary rule statement directly above the table ("Only L4 acts; a non-L4 run logs + surfaces … no dispatch action"): qualify it so an acting run (L4, or L3 with `sentry_acting`) dispatches on abort, while the *consult* is never forked on level.
- near lines 103 to 108, the interrupt table's **abort row**, restructured to key on the acting decision (acts or advisory) rather than the L4 or Non-L4 columns, so an L3+knob run is not mis-filed under Non-L4 advisory.
- near line 216, the between-units restatement.
- near line 235, the "advisory outside L4" consult-logging line, clarified: the *consult* is always advisory-logged, and *abort acting* is L4-or-knob.
- near line 378, the poller-spawn line ("only acts (aborts) on an L4-minted or `sentry_acting` ledger").
- near line 664, the terminal stop-reasons list ("(L4 only) … `Stop reason: sentry-abort`"): broaden to acting runs (L4, or L3 with `sentry_acting`), since an L3+knob abort produces the same `sentry-abort` stop reason.
- `faffter-dark-concurrency-parallel/SKILL.md` near lines 49 and 67, the executor's run-scoped-abort foil.

The `pause`/`correct` rows and the member-park-at-every-level behaviour are untouched. The invariant "don't fork the *consult* on level" is preserved throughout; only the abort *handling* gains the knob. The build re-greps `L4`, `isL4`, "L4 only", and "advisory outside L4" across both SKILL.md files to catch any restatement this list missed, since the enumeration is the starting set, not a closed one.

**Chosen: the holdout stays out of scope, deferred with its reason recorded.** This ticket decouples the **abort kill-switch** only. A holdout opt-in for L3 is *not* in v1 because the code-blind holdout is still preview (code-blindness is attested, not physically enforced, since the evaluator cage is built but not wired, FAFF-597), and it needs a running system to evaluate, a no-op on a CLI or skills repo. The ticket's verification axis is explicitly **deferred**, not silently dropped, recorded here and on the ticket for a future slice.

**Chosen: the self-directed L3 watcher is the motivating consumer, documented where the Sentry posture is.** The faff-on-faff `l3-watcher.yml` (which cannot be L4) can set `autonomous.sentry_acting: true` to gain the kill-switch. A brief note in `docs/guide/unattended.md`, where the L3 and L4 posture lives, names the knob and its effect: an unattended L3 run gains the Sentry *abort* kill-switch, while `pause`/`correct` stay advisory. Guide prose stays reference-free (the knob name is not a `FAFF-NNN` or `ADR-NNN` reference).

**Assumes:** the config, sentry, and poller shapes are as mapped (`engineBoundedFromConfig` at `lights-out.js:309`; poller `gatherFacts` and `decideTick`; the abort restatements enumerated above); the run-ledger schema is open, so **no ledger field is stamped** (the decision is threaded through `gatherFacts` from config, not persisted), and schema and runcheck are untouched; `sentry abort` itself does not gate on level (the gating is in the callers), so the abort verb is untouched.

## 3. HOW: acceptance

- `autonomous.sentry_acting` added to `config.js` `DEFAULTS` (`"false"`), the `config defaults --selftest` **expected** array, and the `config resolved` autonomous-knob echo loop. `sentryActingFromConfig(cfg)` in `sentry.js`, fail-closed (only literal `true` returns true).
- `actsOnSentryAbort(ledger, cfg)` exported from `sentry.js`: `level === "L4" || sentryActingFromConfig(cfg)`, lazy so L4 never reads config.
- `sentry-poller.js`: `gatherFacts` resolves the root via `findRoot(runDir)`, reads config **guarded** (fault means off, never a coerced abort, L4 unaffected), computes `facts.actsOnSentryAbort`; `decideTick`'s abort gate keys on it; `pause`/`correct` stay advisory; the consult is untouched. Backward-compat exact.
- Prose: the **abort** restatements at all enumerated loci gain "or `autonomous.sentry_acting:true`"; the beep-boop abort row is restructured to key on acts or advisory (not L4 or Non-L4) so an L3+knob run reads as acting; `pause`/`correct` and "don't fork the consult on level" are untouched.
- Holdout explicitly **deferred** (recorded, with reason); only the abort kill-switch ships.
- `docs/guide/unattended.md` note names the knob (L3 gains the *abort* kill-switch; pause and correct stay advisory), reference-free.
- Tests: a `decideTick` selftest case (`actsOnSentryAbort:true` on a non-L4 ledger with a tripped abort yields `abort`); an integration test in `test/sentry-poller.test.mjs` mirroring the L3-advisory test but with `autonomous.sentry_acting:true`, where the ledger reaches `aborted-resumable`; existing `decideTick` selftest cases updated from `isL4` to `actsOnSentryAbort` on the abort gate; `sentryActingFromConfig` fail-safe cases (unset, typo, "yes", "1" all false; `true` and `"true"` both true); a config-fault-in-gatherFacts case that stays advisory (never a coerced abort).
- `node --test` green; the sentry-poller selftest and any sentry selftest green.

### Scenarios

```
Given an unattended L3 run (ledger level:"L3") with config autonomous.sentry_acting:true
When the detached poller sees a stale heartbeat and sentry check returns intervention:"abort"
Then the poller runs `faff sentry abort` and the ledger reaches aborted-resumable: the kill-switch fires on L3.
```

```
Given the same L3 run WITHOUT the knob (unset, or a typo'd value)
When sentry check returns abort
Then the poller logs advisory-trip and the ledger is byte-identical: the L3 default is unchanged (fail-safe off).
```

```
Given an L3+knob run whose cooperative checkpoint returns intervention:"pause" or "correct"
When the handling table is consulted
Then it stays advisory (logs and surfaces): the knob is the abort kill-switch only; pause and correct remain L4-only.
```

```
Given a malformed .faffrc while the detached poller ticks on an L3 ledger
When gatherFacts reads config
Then the fault fails safe to advisory (no coerced abort), and an L4 ledger's abort is unaffected (it never reads config).
```

## 4. DONE: definition of done

- [ ] Knob gates the **abort** row only; `pause`/`correct` stay L4-only (scope decision honored in poller and prose).
- [ ] `autonomous.sentry_acting` in `DEFAULTS` (`"false"`) plus `config defaults --selftest` expected plus `config resolved` echo loop; `sentryActingFromConfig` in `sentry.js`, fail-closed (only literal `true`).
- [ ] `actsOnSentryAbort(ledger, cfg)` in `sentry.js` (`level==="L4" || sentryActingFromConfig`, lazy so L4 skips config).
- [ ] `sentry-poller.js`: `gatherFacts` uses `findRoot` plus a guarded config read (fault means off, L4 unaffected) to set `facts.actsOnSentryAbort`; `decideTick` abort gate keys on it; pause and correct advisory; consult untouched; backward-compat exact.
- [ ] Prose abort restatements at all enumerated loci gain the knob; beep-boop abort row restructured (acts or advisory, not L4 or Non-L4); consult-not-forked invariant preserved.
- [ ] Holdout deferred (recorded with reason); only the abort kill-switch ships.
- [ ] `docs/guide/unattended.md` note names the knob (reference-free).
- [ ] Tests: `decideTick` non-L4 with acting yields abort; integration L3+knob reaches aborted-resumable; existing cases updated to `actsOnSentryAbort`; `sentryActingFromConfig` fail-safe cases; config-fault stays advisory. `node --test` and sentry-poller selftest green.

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```
