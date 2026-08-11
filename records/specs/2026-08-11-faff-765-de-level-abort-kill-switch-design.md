# Spec — FAFF-765: De-level the abort kill-switch — act for unattended runs, not the L4 mint

> Spec: faffter-dark-nlspec · 2026-08-10 · autonomous · confidence: medium. Full spec on Linear FAFF-765.

This is the buildable spec for **FAFF-765** (slice 1 of FAFF-763), for the build agent that will implement it and the humans reviewing that build. It re-keys the Sentry `abort` kill-switch from the L4-mint proxy onto the real axis — **attendedness** — so an unattended L3 drain gets a live, resumable kill-switch. It changes one predicate, threads one declared signal, updates the two acting loci's prose, and extends existing tests. It builds no new subsystem.

---

## 1. WHY — Problem and Principles

**The load-bearing model.** The Sentry `abort` kill-switch already has exactly one decision resolver, `actsOnSentryAbort(ledger, cfg)`, that both acting loci consult: `(ledger.level === "L4") || sentryActingFromConfig(cfg)`. Today it asks *"was this run L4-minted, or did it opt into the FAFF-717 knob?"*. The right question is *"is anyone watching this run?"* — because the kill-switch exists to stop a run that has gone wrong **when no human is at the keyboard to stop it themselves**. This spec swaps the question the resolver asks (attendedness) without changing its structure (one resolver, two loci, lazy L4 short-circuit).

**Problem statement.** The `abort` kill-switch acts only for an L4-minted run or an L3 run that set `autonomous.sentry_acting` — but the L4 mint is too narrow a proxy for "unattended", and the two runs that *cannot* obtain the L4 mint (the self-directed faff-on-faff watcher, which L4 refuses per ADR-0069; and an L3-on-CI drain) are exactly the unattended runs that ran unprotected in the FAFF-763 incident, where an L3 drain was hard-killed by the runner's `timeout-minutes` cap while the sentry only logged `advisory-trip`, orphaning a stale claim. This change makes `abort` act for any **unattended** run — keyed on a declared attendedness posture, with the L4 mint folded in as one sufficient (always-unattended) case — while an **attended** L3 run stays advisory (the human is the kill-switch).

### Design principles

**The L4 kill-switch must never regress.** ADR-0034 fixes the kill-switch as un-subvertable *by construction*: an L4 run's abort authority cannot depend on any channel a fault (or the supervised agent) can perturb. The current `||` is lazy by design — an L4 ledger short-circuits before any config is read, so a malformed `.faffrc` can never disable an L4 abort. **This ordering is load-bearing and MUST survive:** the L4 disjunct stays first, evaluated before any config read, exactly as today. Any refactor that reads config first, or that folds L4 into a config-derived value, is rejected.

**Fail-safe direction is OFF (attended/advisory).** The un-fired state is the documented L3 advisory posture; an abort is a *resumable* ledger-mark, so the cost of a false negative (an unattended run that stayed advisory) is a paused night, while a false positive (an attended run newly auto-aborted, or a config typo silently making runs abortable) is a surprise stop on watched work. Every unrecognised / unset / faulted config value MUST resolve to **attended → advisory**, mirroring the existing `sentryActingFromConfig` fail-closed reader.

**Deterministic tools over prose; declare, don't sniff.** The unattended signal is an operator/caller **declaration** resolved from config, never an ambient-environment auto-detection. ADR-0095 already fixes unattended-on-CI as *admission criteria the operator asserts*, not a mechanism faff sniffs; no CI-env / TTY detector exists anywhere in the codebase, the detached poller has no TTY to read, and an env sniff would be net-new and spoofable. (See Design Decision 1.)

**The consult never forks on level — only the handling does.** `faff sentry check` computes the intervention identically at every level (shared prose stays single-homed; `sentrycheck.test.mjs` proves it). Only the *handling* of an `abort` intervention consults the acting predicate. This change touches the handling predicate only.

**Scope statement.** This is the core behaviour change at the heart of FAFF-763's autonomy-model correction: re-key the abort-acts predicate onto declared attendedness and thread that signal through both acting loci and their tests.

---

## 2. OUT OF SCOPE

- **Pause-acting for unattended L3 (FAFF-766).** — `pause`/`correct` stay **L4-only-acts** regardless of the unattended declaration. *Extension point:* the same `unattended`-derived predicate this slice introduces is what FAFF-766 will read for the pause branch.
- **De-levelling `correct` (FAFF-326).** — `correct` STAYS authority-gated via the child `corrective-integrity` probe, with no coupling to `actsOnSentryAbort` or `ledger.level`. Byte-unchanged by this slice.
- **A CI-env / attendedness auto-detector.** — no ambient sniff of TTY, CI vars, or container state is built (Design Decision 1).
- **A run-ledger attendedness field written at L1–L3 mint.** — the unattended signal is config-resolved, not stamped into the ledger (Design Decision 6).
- **Retiring the `autonomous.sentry_acting` key.** — kept as a working back-compat alias this slice (Design Decision 2).
- **Re-tuning the `sentry.*` thresholds.** — current thresholds are kept (Design Decision 4 / Open Question).

---

## 3. WHAT — Vocabulary, Types, and Interfaces

### Vocabulary

| Term | Definition |
|---|---|
| **Attended** | A human is on the loop and *is* the kill-switch. The default posture when nothing is declared. Sentry stays **advisory** (logs + surfaces, no dispatch action). |
| **Unattended** | No human on the loop. Declared, or implied by an L4 mint. Sentry `abort` **acts** (whole-run, resumable). |
| **Declared unattended** | An L3 run whose config asserts the unattended posture (`autonomous.unattended: true`, or the `autonomous.sentry_acting: true` alias). |
| **Acts (abort)** | Marks the ledger `aborted-resumable` and stops dispatch — never a hard reset; the run is re-enterable. |
| **Advisory** | Logs the trip as `advisory-trip` (shared telemetry + the threshold-calibration feed) and takes no dispatch action. |

### Types and predicates

```
# Config-resolved, fail-closed reader (NEW — generalises sentryActingFromConfig).
FUNCTION declaredUnattendedFromConfig(cfg) -> Bool:
  RETURN literalTrue(dig(cfg, "autonomous.unattended"))
      OR literalTrue(dig(cfg, "autonomous.sentry_acting"))   # back-compat alias

# literalTrue: raw === true OR String(raw).trim().toLowerCase() === "true"

# The SINGLE abort-acting resolver (shape unchanged; second disjunct re-keyed).
# CONSTRAINT: the L4 disjunct MUST be first and MUST short-circuit before any config read.
FUNCTION actsOnSentryAbort(ledger, cfg) -> Bool:
  RETURN (ledger != null AND ledger.level === "L4")     # L4 = one sufficient unattended case
      OR declaredUnattendedFromConfig(cfg)              # declared unattended (L3)
```

**Truth table (the born-verifiable heart):**

| `ledger.level` | `autonomous.unattended` | `autonomous.sentry_acting` (alias) | config state | `actsOnSentryAbort` |
|---|---|---|---|---|
| `L4` | any / unread | any / unread | any (incl. faulted) | **true** (lazy short-circuit, config never read) |
| `L3` | `true` (any literal spelling) | — | readable | **true** |
| `L3` | unset | `true` (any literal spelling) | readable | **true** (alias) |
| `L3` | `false` / typo / unset | `false` / typo / unset | readable | **false** (advisory) |
| `L3` | — | — | **malformed / fault → `{}`** | **false** (fail-safe OFF) |
| null / no `level` | `true` | — | readable | **true** |
| null / `{}` | unset | unset | — | **false** |

### Config surface

- **New canonical key:** `autonomous.unattended` — declared attendedness posture. Default `"false"` in the `DEFAULTS` registry. Fail-safe OFF.
- **Retained alias:** `autonomous.sentry_acting` — unchanged default `"false"`; still asserts unattended (OR semantics).
- **Run-banner echo:** the `config resolved` banner loop adds `unattended` alongside `sentry_acting`.

---

## 4. HOW — Behavior

One resolver, two loci, unchanged shapes:

1. **`sentry.js`** — introduce `declaredUnattendedFromConfig(cfg)` (generalising the current `sentryActingFromConfig`, which becomes/remains the alias-reader), and re-point `actsOnSentryAbort`'s second disjunct at it. The L4 disjunct and the lazy `||` are untouched. Export the resolver as today.
2. **Cooperative locus (`faff-beep-boop/SKILL.md`)** — the handling table's `abort` row and its invariant re-key from "L4 or `sentry_acting`" onto "unattended (L4, or an L3 that declared unattended)". `surface`/`pause`/`correct` rows stay L4-only. Sibling restatements updated in lockstep.
3. **Detached locus (`sentry-poller.js`)** — no logic change to `decideTick` (it already gates on the pure `facts.actsOnSentryAbort`); `gatherFacts` continues to resolve that fact via the same guarded `readGovernanceConfig` → `actsOnSentryAbort(ledger, cfg)` path, now yielding the re-keyed value. Comments updated.
4. **Config + docs + reference** — `config.js` registers the key and echoes it; `unattended.md` and `l3-watcher.yml` are updated so the reference self-directed watcher actually declares unattended.

### The abort-handling decision (both loci, shared semantics)

```
PROCEDURE handle_abort_intervention(ledger, cfg):
  1. acts := actsOnSentryAbort(ledger, cfg)              # L4 short-circuits before any cfg read
  2. IF acts:
       a. run `faff sentry abort --run-dir <run-dir>`
       b. ledger → aborted-resumable, owner.status → aborted-resumable
       c. launch nothing further; surface the verdicts
  3. ELSE (attended L3):
       a. log `advisory-trip` + surface verdicts
       b. take NO dispatch action; the run continues
```

### Edge cases and fallback precedence

- **Config fault mid-tick (poller):** `readGovernanceConfig` throws → caught → `cfg = {}` → `declaredUnattendedFromConfig({})` false → L3 stays advisory; an L4 ledger already short-circuited to acting before the read.
- **Both keys set, conflicting:** OR semantics — either `true` asserts unattended.
- **`autonomous.unattended: false` with `sentry_acting: true`:** unattended (the alias still asserts) — a `false` never silently overrides a set alias (both are positive assertions OR-ed together).
- **Alias precedence:** neither key "wins" — they are OR-ed.

---

## 5. Scenarios — born-verifiable main objectives

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an unattended L3 /faff-beep-boop drain (autonomous.unattended: true) whose heartbeat has gone stale past the wall-clock ceiling
When the detached sentry-poller ticks and `faff sentry check` returns an `abort` intervention
Then the run-ledger is marked aborted-resumable (owner.status → aborted-resumable, no orphaned claim) and the poller logs abort-actioned, not advisory-trip
```

```
Given an attended L3 drain that declares neither autonomous.unattended nor autonomous.sentry_acting
When any `abort`-class trip fires (wall-clock-runaway, budget-breach, repeated-identical-failure, forbidden-side-effect-attempt)
Then the ledger is byte-unchanged, the trip is logged advisory-trip, and no auto-abort occurs
```

- The `correct` intervention's acting decision is byte-unchanged: it consults the `corrective-integrity` probe, never `actsOnSentryAbort` or `ledger.level`, at any attendedness.
- No `sentry.*` threshold value changes as part of this slice.

---

## 6. Design Decision Rationale

**1. The unattended signal — declared knob vs auto-detected.** **Chosen:** DECLARED (operator/caller-asserted), not env-auto-detected. Default when unasserted = **attended (advisory)**. Preserves the lazy L4 short-circuit (ADR-0034).

**2. Retire `sentry_acting` vs invert vs generalise.** **Chosen:** generalise to `autonomous.unattended` (the canonical attendedness posture) and keep `autonomous.sentry_acting` as a fail-safe-OFF back-compat **alias** (OR semantics). Inversion is rejected outright — it flips the fail-safe direction. **Punt:** the eventual retirement of the alias *(decides: product)*.

**3. Should self-directed runs auto-imply unattended?** **Chosen:** require the explicit declaration; self-directed does NOT auto-imply unattended. The reference watcher `operations/ci/l3-watcher.yml` simply declares `autonomous.unattended: true`.

**4. Threshold calibration before acting is safe.** **Chosen (conservative default):** keep current `sentry.*` thresholds unchanged this slice. **Punt:** which thresholds warrant re-tuning *(decides: qa)*.

**5. The eval-sweep acceptance criterion (reframe).** **Chosen:** reframe to unit/selftest coverage of the re-keyed predicate at both loci plus accumulated advisory telemetry as calibration evidence.

**6. Where the unattended signal lives — config-resolved vs a new ledger field.** **Chosen:** config-resolved.

**7. Predicate shape — fold L4 in vs replace it.** **Chosen:** keep `actsOnSentryAbort`'s disjunction shape, re-keying only the second disjunct. L4 stays the first, config-free disjunct.

---

## 7. Open Questions and Assumptions

**Open Questions (Punts):**

- **Punt:** Retirement of the `autonomous.sentry_acting` alias. *(decides: product)* *Recommended default:* keep the alias indefinitely, soft-deprecate in docs.
- **Punt:** `sentry.*` threshold calibration. *(decides: qa)* *Recommended default:* keep current thresholds; tune later from data.

---

## 8. DONE — Definition of Done

### From WHY
- [ ] An unattended L3 drain (declared `autonomous.unattended: true`, or the `sentry_acting` alias) aborts gracefully — resumable ledger, `owner.status` → `aborted-resumable`, no orphaned claim — on any `abort`-class trip, at both loci.
- [ ] An attended L3 drain (neither key declared) stays advisory: ledger byte-unchanged, `advisory-trip` logged, no auto-abort.
- [ ] The L4 kill-switch is unchanged and its lazy short-circuit is preserved.

### From WHAT
- [ ] `actsOnSentryAbort(ledger, cfg)` = `(ledger?.level === "L4") || declaredUnattendedFromConfig(cfg)`, L4 disjunct first.
- [ ] `declaredUnattendedFromConfig(cfg)` returns literal-true of `autonomous.unattended` OR literal-true of `autonomous.sentry_acting` (alias).
- [ ] The full truth table (§3) holds, verified by unit tests.
- [ ] `autonomous.unattended` is registered in `DEFAULTS` (`"false"`), added to the `config defaults --selftest` expected-keys list, and echoed in the run banner beside `sentry_acting`.

### From HOW (both loci)
- [ ] Cooperative locus re-keyed; `surface`/`pause`/`correct` rows unchanged (L4-only). Sibling restatements + `faffter-dark-concurrency-parallel` updated. `faff validate-adapters` passes.
- [ ] Detached locus: `decideTick` unchanged in logic; comments updated to the attendedness framing.
- [ ] `sentry.js` re-keyed comments describe the attendedness axis.

### From scope guardrails
- [ ] `correct` handling is byte-unchanged.
- [ ] `sentrycheck.test.mjs` is untouched and passes.
- [ ] No `sentry.*` threshold value changed.

### From tests
- [ ] `test/sentry.test.mjs` extended: `declaredUnattendedFromConfig`/`actsOnSentryAbort` truth table incl. the new key, the alias, the lazy-L4 short-circuit, the fail-closed non-affirmative row.
- [ ] `test/sentry-poller.test.mjs` extended: unattended-L3-aborts (canonical key), attended-L3-advisory, alias-still-acts, malformed-config-fails-safe.

### From docs / references / ADR
- [ ] `docs/guide/unattended.md` updated: `autonomous.unattended` canonical, `sentry_acting` the retained alias; framing is attendedness.
- [ ] `operations/ci/l3-watcher.yml` declares `autonomous.unattended: true`.
- [ ] An ADR records the de-levelling: amends/supersedes ADR-0044 pt5/pt8, formalises the attendedness axis, confirms ADR-0034's un-subvertable property survives.

---

confidence: medium
spec-review: approve