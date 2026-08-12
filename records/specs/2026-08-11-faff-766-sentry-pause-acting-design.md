# Spec — FAFF-766: Sentry pause-acting for unattended L3 — bench a thrashing build, keep draining

> Spec: faffter-dark-nlspec · 2026-08-11 · autonomous · confidence: high. Full spec on Linear FAFF-766.

This is the buildable spec for **FAFF-766** (slice 2 of FAFF-763), for the build agent that will implement it and the humans reviewing that build. It extends the attendedness-keyed Sentry acting model that slice 1 (FAFF-765, merged PR #621, ADR-0103) introduced for `abort` to the neighbouring safe-stop intervention, `pause`, at the one locus where pause is actionable — the cooperative `faff sentry check` checkpoint. It changes one small predicate, re-keys one handling-table row and its sibling restatements, and extends existing tests. It builds no new subsystem and adds no config key.

---

## 1. WHY — Problem and Principles

**The load-bearing model.** `abort` and `pause` are the two members of one intervention *class* — **safe stops**. `abort` stops the whole run (resumable); `pause` is strictly gentler: it *parks one implicated issue* and keeps draining the rest. Slice 1 re-keyed `abort`'s acting decision from the L4-mint proxy onto the real axis, **attendedness** — an *unattended* run acts, an *attended* run stays advisory because the human is the kill-switch. This slice asks the same question for `pause` and gives the same answer: an unattended run should *act* on `pause` (park the named issue, continue), not merely log it. That is the whole change — pause joins abort on the attendedness axis; `correct` (redirect) and `surface` (run-scoped log) do not.

**Problem statement.** Today `pause` is L4-only-acts: an unattended L3 `/faff-beep-boop` drain that trips `fix-review-thrash` (the respec treadmill) on a build only *logs* it and lets that bad build burn wall-clock/budget until the whole run eventually trips an `abort` — killing everything, when benching the one thrashing issue and draining the rest is strictly better. This slice makes the cooperative checkpoint's `pause` handling act for an unattended L3 run — parking the verdict-named issue(s) via the shared park protocol and continuing the queue.

### Design principles

**Pause is architecturally clean where abort's poller limitation is not.** `fix-review-thrash` / `scope-drift` / member-scoped `wall-clock-runaway` are detected at the *cooperative between-units checkpoint*, where the orchestrator LLM can actually park an issue. The detached `sentry-poller` — the lane that catches a run which stops reaching checkpoints — cannot park (it is a pure timer with no orchestrator judgement), and by construction *never acts on `surface`/`pause`/`correct` at any level* (`sentry-poller.js` lines 183-189). Pause-acting therefore lives **only** at the cooperative locus, and this slice does not touch the poller at all.

**Pause is less destructive than abort — so it rides abort's declaration a fortiori.** An operator who declared unattended and thereby armed the whole-run `abort` kill-switch has, by that same declaration, opted into the gentler per-issue park. A separate off-switch that let the harsher stop act while the gentler one stayed disabled would be incoherent (see Design Decision 1).

**The L4 lazy short-circuit is preserved verbatim (ADR-0034).** Any predicate this slice introduces for pause must not disturb `actsOnSentryAbort`'s L4-first, config-free short-circuit; the un-subvertable-by-construction property survives because the shared acting condition is the same one abort already uses.

**The consult never forks on level/attendedness — only the handling does.** `faff sentry check` computes the intervention identically at every level (the same invariant slice 1 preserved). Only the *handling* of a `pause` intervention gains an attendedness branch.

**Scope statement.** This is slice 2 of FAFF-763 ("de-level the Sentry act by intervention CLASS, not by the L4 mint"): abort was slice 1; pause is slice 2; `correct` stays authority-gated (FAFF-326) and is out of the class entirely.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/sentry.js` (~L196-215) | JS | The acting resolvers — `declaredUnattendedFromConfig`, `actsOnSentryAbort`; this slice adds the pause sibling here |
| `plugin/skills/faff-beep-boop/SKILL.md` (~L103-121, 234, 253, 682) | Prose (SKILL) | The cooperative checkpoint handling table + its sibling restatements — the acting locus this slice re-keys |
| `plugin/skills/faff/bin/lib/sentry-poller.js` (~L153-192) | JS | The detached lane — **byte-unchanged**; never acts on pause at any level |
| `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md` (~L47-67) | Prose (SKILL) | Sibling executor; its member-park is orthogonal (see OUT OF SCOPE + DD) |
| `test/sentry.test.mjs` (~L1295-1401) | JS test | The abort-acting truth table this slice mirrors for pause |
| `records/adr/0103-…attendedness….md` | ADR | Slice 1's decision record; this slice amends it to add pause to the axis |

---

## 2. OUT OF SCOPE

- **The detached `sentry-poller` (`sentry-poller.js`).** — *Why:* it cannot park an issue (no orchestrator judgement) and never acts on `surface`/`pause`/`correct` at any level by construction; pause is a cooperative-checkpoint intervention only. *Must stay byte-unchanged* (a regression test at DONE pins this). *Extension point:* none — the poller deliberately has no pause branch.
- **`correct` (FAFF-326, Channel A — redirect).** — *Why:* `correct` is a *redirect* (abort-and-narrow), not a safe stop; it stays authority-gated via the child `corrective-integrity` probe with no coupling to attendedness or `ledger.level`. *Extension point:* `CORRECTABLE_SIGNAL` / the authority upgrade path in `sentry.js` — untouched here.
- **`surface` (FAFF-767, `budget-metering-degraded`).** — *Why:* it is a run-scoped log+`/faff-wtf` write that never parks an issue; there is nothing to de-level. Stays level-agnostic exactly as today.
- **`abort` behaviour (slice 1 / FAFF-765).** — *Why:* already keyed on attendedness and shipped; `actsOnSentryAbort`'s body and the poller's abort dispatch are unchanged. *Extension point:* this slice references, does not modify, that resolver.
- **Any new config key.** — *Why:* pause rides the existing `autonomous.unattended` declaration (and its `autonomous.sentry_acting` alias), both already registered in `DEFAULTS`, the `config defaults --selftest` expected-keys list, and the run banner (Design Decision 1). *Extension point:* a future opt-out sub-switch is a documented Punt, not built here.
- **`sentry.*` threshold re-tuning.** — *Why:* the acting *decision* changes, not the trip *thresholds*; which signals produce `pause` is unchanged.
- **The concurrency-parallel executor's member-park.** — *Why:* it already parks liveness-dead members at *every* level as orchestrator housekeeping (recording reality + preserving WIP), a narrower and orthogonal mechanism; this slice does not widen or narrow it (Design Decision 4). *Extension point:* `faffter-dark-concurrency-parallel/SKILL.md` member-park procedure — scanned for lockstep, but its pause handling is not the L4-only-acts row this slice re-keys.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

### Vocabulary

| Term | Definition |
|---|---|
| **Safe stop** | The intervention class `{abort, pause}` — an unattended run acts; both keyed on attendedness. `abort` stops the run; `pause` parks one issue and drains on. |
| **Pause (acts)** | Park the verdict-named implicated issue(s) via the shared park protocol, then continue the queue. Issue-scoped, reversible, not a run-level stop. |
| **Advisory (pause)** | Log the trip + surface the verdicts, take no park action — the attended-L3 posture, unchanged. |
| **Implicated issue(s)** | The issue/member the pause verdict names in its evidence — `worst.issue` for `fix-review-thrash`, the drifting member for `scope-drift`, the stalled member for member-scoped `wall-clock-runaway`. |

### Which signals produce a `pause` intervention

Precision matters here (the current line-117 prose "(thrash / repeated-failure are issue-scoped)" is slightly imprecise). Per `sentry.js` `SIGNAL_TRIP_INTERVENTION` (~L144-159) and the ascending ladder `["continue","surface","pause","correct","abort"]`, the interventions that map to **`pause`** — and therefore fall under this slice — are:

- **`fix-review-thrash`** → `pause` (the canonical AC signal; evidence names `worst.issue`).
- **`scope-drift`** → `pause` (FAFF-764, member-scoped).
- **member-scoped `wall-clock-runaway`** → capped to `pause` (FAFF-327/FAFF-553, in-flight grace).

`repeated-identical-failure` maps to **`abort`**, not `pause` — so it is **already** handled by slice 1's abort-acting for an unattended L3 and is *not* in this slice's remit. The spec's language must say "the pause-mapped signals," never "thrash / repeated-failure."

### Predicates (in `sentry.js`)

The abort resolver is unchanged. This slice adds a pause sibling that reuses abort's already-verified acting condition as the single source of the unattended-stop truth, so the L4-first lazy short-circuit lives in exactly one place.

```
# EXISTING — slice 1, UNCHANGED (ADR-0034 lazy L4-first; do not touch the body).
FUNCTION actsOnSentryAbort(ledger, cfg) -> Bool:
  RETURN (ledger != null AND ledger.level === "L4")   # L4 = one sufficient unattended case, lazy
      OR declaredUnattendedFromConfig(cfg)             # declared unattended (L3)

# NEW (FAFF-766) — pause is a safe stop: same acting condition as abort.
# Delegates to the existing resolver so there is ONE copy of the unattended-stop
# condition and the L4 short-circuit is inherited verbatim, never re-implemented.
FUNCTION actsOnSentryPause(ledger, cfg) -> Bool:
  RETURN actsOnSentryAbort(ledger, cfg)
```

`actsOnSentryPause` is added to the `module.exports` list alongside `actsOnSentryAbort` (sentry.js ~L1550) so it is unit-testable. No signature divergence from the abort resolver — same `(ledger, cfg)` shape.

**Truth table (born-verifiable, identical to abort's by construction):**

| `ledger.level` | declared unattended (`autonomous.unattended` / `sentry_acting` alias) | config state | `actsOnSentryPause` |
|---|---|---|---|
| `L4` | any / unread | any (incl. faulted) | **true** (lazy short-circuit, config never read) |
| `L3` | `true` (any literal spelling, either key) | readable | **true** |
| `L3` | `false` / typo / unset | readable | **false** (advisory) |
| `L3` | — | malformed / fault → `{}` | **false** (fail-safe OFF) |
| null / `{}` | unset | — | **false** |

### Config surface

**No change.** `autonomous.unattended` (default `"false"`, config.js ~L182) and its retained alias `autonomous.sentry_acting` (~L174) are already registered in `DEFAULTS`, already in the `config defaults --selftest` expected-keys list (~L1872-1876), and already echoed in the run banner (~L1985). Pause reads the same declaration; nothing new to register or echo.

---

## 4. HOW — Behavior

Three edits, no new subsystem: one predicate added to `sentry.js`, the cooperative locus's prose re-keyed (handling table row + its in-lockstep restatements), and tests extended. The poller and config are untouched.

### The pause-handling decision (cooperative checkpoint only)

**Behaviour summary:** at the between-units `faff sentry check` checkpoint, a tripped `pause` verdict now parks the implicated issue for an *unattended* run (L4, or a declared-unattended L3) exactly as the current L4 cell already does; an *attended* L3 keeps logging+surfacing.

```
PROCEDURE handle_pause_intervention(ledger, cfg, verdict):
  1. acts := actsOnSentryPause(ledger, cfg)          # L4 short-circuits before any cfg read
  2. IF acts:
       a. FOR each implicated issue the verdict names (fix-review-thrash: worst.issue;
          scope-drift / member wall-clock: the named member):
            i.   faff label add <issue> faff-parked   (+ the descriptor's tracker write)
            ii.  post a park comment: cause (the tripped signal + evidence),
                 what was attempted, what a human must do
            iii. write a .faff/logs park entry
       b. continue the queue — pause is NOT a run-level stop; launch the next unit
  3. ELSE (attended L3):
       a. log the trip + surface the verdicts
       b. take NO park action; continue the queue
```

The park itself is the **shared park protocol** (gateway) — this slice does not introduce a new park path; it routes the pause verdict into the one that already exists (the same `faff-parked` label op + tracker comment + `.faff/logs` entry every other park uses).

### The prose edits (cooperative locus — `faff-beep-boop/SKILL.md`)

These restatements of the acting rule **must move in lockstep** or `faff validate-adapters` flags a duplicated-block drift:

1. **Handling table `pause` row (~L117).** Non-L4 cell changes from `"log + surface, proceed"` to the attendedness-keyed form, mirroring the abort row (~L119): *"log + surface, proceed — **unless the run declared unattended** (`autonomous.unattended`, or the `sentry_acting` alias), then act exactly as the L4 cell (park the implicated issue(s) the verdict names, continue the queue)."* Also fix the L4 cell's imprecise parenthetical `"(thrash / repeated-failure are issue-scoped)"` → `"(fix-review-thrash / scope-drift / member-scoped wall-clock-runaway are issue/member-scoped)"`.
2. **The per-intervention prose (~L111).** `"surface/pause/correct stay L4-only-acts"` → a run acts on **`abort` and `pause`** iff unattended; **`surface`/`correct`** stay L4-only-acts. Drop the "de-levelling `pause` is FAFF-766" forward-reference (now done).
3. **The acting-decision invariant (~L121).** Change from "The `abort` row alone keys on the acting decision" to: the **`abort` and `pause`** rows key on the acting decision (attendedness); a declared-unattended L3 reads the L4 cell for both — it stops the run on `abort` and parks the implicated issue on `pause`. `surface`/`correct` are unaffected (L4-only); `correct` stays authority-gated per FAFF-326.
4. **Between-units checkpoint restatement (~L234).** `"surface/pause/correct stay L4-only"` → `"surface/correct stay L4-only; an unattended run also acts on pause (parks the implicated issue, continues) — FAFF-766."`
5. **Wave-logging note (~L253).** The parenthetical "the consult is advisory except where the run acts on `abort`" → "…except where the run acts on `abort` (run-stop) or `pause` (parks the implicated issue, continues)." Exit reasons are **unchanged** — pause is not a run-level stop, so no new `Stop reason` token.
6. **Stop-reason narrative note (~L682).** Currently: "(A `pause` parks the implicated issue(s) and continues; not a run-level stop, and **L4-only** regardless of the attendedness declaration.)" → "(A `pause` parks the implicated issue(s) and continues — for an unattended run: L4, or an L3 that declared `autonomous.unattended` / the `sentry_acting` alias; an attended L3 logs + surfaces. Not a run-level stop.)"

### Edge cases and fallback precedence

- **Config fault at the checkpoint:** `declaredUnattendedFromConfig({})` → false → an L3 stays advisory (fail-safe OFF); an L4 ledger already short-circuited to acting before the read — identical to abort.
- **Both keys set / conflicting:** OR semantics via the shared `declaredUnattendedFromConfig` — either positive assertion arms pause; a `false` on one key never overrides a `true` on the other.
- **A pause verdict naming multiple implicated issues:** park each named issue; continue the queue after all are parked. (Member-scoped verdicts name one; `fix-review-thrash` names `worst.issue`.)
- **A pause-parked issue that recurs across runs:** handled transparently by the **existing** FAFF-336 repeat-park machinery — `faff park-history` counts parks by root-cause class over a rolling window and, at 3+, demotes the issue and marks `faff-repeat-parked`. No net-new work here (see Assumptions).

### Failure modes — how the approach falls over, and how you'd notice

- **The failure:** the pause verdict's evidence does not name a parkable issue (e.g. a run-scoped signal mis-mapped to `pause`), so "park the implicated issue" has no target. **How you'd know:** the park step finds no `worst.issue`/member id in the verdict evidence. **What it means:** proceed — fall back to the advisory branch (log + surface, continue) rather than parking a guessed issue; this is the safe direction and mirrors the poller's "never act without a named target." The pause-mapped signals in §3 all carry an issue/member in evidence by construction, so this is a defence-in-depth fallback, not an expected path.
- **The failure:** re-keying the pause row silently perturbs the poller (which must never act on pause). **How you'd know:** the `sentry-poller.test.mjs` pause-is-advisory-at-every-level case would fail. **What it means:** abandon that edit — the poller is out of scope and byte-unchanged; a diff there is a scope breach.

**Anti-pattern:** adding a pause branch to `sentry-poller.js` `decideTick`. Why: the poller has no orchestrator judgement to park an issue and never acts on pause at any level by construction; pause-acting is cooperative-checkpoint-only.

**Anti-pattern:** giving pause its own copy of the `(L4) || declaredUnattendedFromConfig` condition. Why: it would fork the L4 lazy short-circuit into two places to keep in sync; `actsOnSentryPause` must delegate to the one resolver.

---

## 5. Scenarios — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an unattended L3 /faff-beep-boop drain (autonomous.unattended: true) whose build on ISSUE-X trips fix-review-thrash (the respec treadmill) at a between-units checkpoint
When the cooperative faff sentry check returns a `pause` intervention naming ISSUE-X as worst.issue
Then ISSUE-X is parked via the shared park protocol (faff-parked label + park comment + .faff/logs entry) and the run continues draining the remaining queue — it does NOT let ISSUE-X thrash until a whole-run abort
```

```
Given an attended L3 drain that declares neither autonomous.unattended nor the sentry_acting alias
When any pause-mapped trip fires (fix-review-thrash, scope-drift, or member-scoped wall-clock-runaway)
Then no issue is parked, the trip is logged + surfaced, and the queue continues — the attended-L3 pause posture is unchanged
```

- The detached `sentry-poller` is byte-unchanged: a `pause` intervention on a declared-unattended L3 tick still yields `advisory-trip` (never a park/dispatch action) — asserted against `sentry-poller.test.mjs`.
- `actsOnSentryPause(ledger, cfg)` equals `actsOnSentryAbort(ledger, cfg)` across the full truth table (L4 lazy short-circuit, unattended-L3 acts via either key, attended-L3 advisory, fail-closed on fault) — asserted in `test/sentry.test.mjs`.
- No `sentry.*` threshold value and no `SIGNAL_TRIP_INTERVENTION` mapping changes as part of this slice.

---

## 6. Design Decision Rationale

**1. Does pause-acting ride slice 1's unattended declaration, or need its own knob?**
- *Options:* (a) ride the existing `autonomous.unattended` / `sentry_acting` declaration; (b) add a new `autonomous.pause_acting` knob.
- *Pros of (a):* slice 1's design doc (FAFF-765 §2) explicitly names FAFF-766 as the extension point for "the same `unattended`-derived predicate"; parent FAFF-763 frames the de-levelling by intervention CLASS (abort + pause are both safe stops); pause is strictly *less* destructive than abort, so an operator who armed abort-acting gets pause-acting a fortiori. *Cons of (b):* a separate off-switch would let the harsher stop (abort) act while the gentler stop (pause) stayed disabled — incoherent; and it adds config surface for no v1 need.
- **Chosen:** ride the existing `autonomous.unattended` / `sentry_acting` declaration; **no new knob**. `actsOnSentryPause` delegates to `actsOnSentryAbort`, so the two safe stops share one declaration and one L4 short-circuit.
- **Punt:** a future opt-out sub-switch `autonomous.pause_acting: false` (keep abort-acting, disable only pause-acting), mirroring slice 1's alias-retirement punt. *(decides: product)* — non-blocking; the v1 shape is "rides the shared declaration."

**2. JS predicate design — prose-only re-key, or a shared/exported predicate?**
- *Options:* (a) reword the beep-boop pause row's Non-L4 cell to key on attendedness with **no JS change** (pause-acting is prose-driven and the poller ignores pause, so no runtime code strictly *needs* a pause predicate); (b) add an exported `actsOnSentryPause(ledger, cfg)` that the reworded prose references and a unit test covers.
- *Pros of (b):* the acceptance asks for selftest/eval validation, and a prose-only change leaves nothing to unit-test; it matches parent FAFF-763's "by intervention class" framing and slice 1's testability reframe; single-sources the acting condition. *Cons of (b):* one more exported symbol. *Pros of (a):* zero JS diff. *Cons of (a):* the acting condition then exists only in prose — not machine-checkable, and the truth-table AC has nothing to bind to.
- **Chosen:** (b) — add `actsOnSentryPause(ledger, cfg)` **delegating to** `actsOnSentryAbort`, exported and truth-table-tested. Delegation (not a copied body) keeps abort's ADR-0034 lazy-L4 short-circuit in exactly one place and leaves abort's function byte-unchanged. A rename to a shared `actsOnUnattendedStop` with abort as an alias was considered and rejected: it would edit abort's definition for no behavioural gain, against the "abort byte-unchanged" guardrail.

**3. The eval-sweep acceptance criterion.**
- *Options:* (a) gate on a literal separate "eval sweep" harness; (b) reframe as unit/selftest coverage + accumulated advisory telemetry as calibration evidence, as slice 1 did.
- **Chosen:** (b) — there is no literal separate eval-sweep harness to gate on; validate via the `actsOnSentryPause` truth-table unit test at the cooperative locus, the poller-unchanged regression test, and the advisory telemetry the attended path keeps emitting as calibration data. This is the same reframe slice 1's spec-review approved.

**4. Interaction with the concurrency-parallel executor's member-park.**
- *Context:* `faffter-dark-concurrency-parallel/SKILL.md` already parks liveness-dead members on a member-scoped `pause` at *every* level, framed as orchestrator housekeeping (recording reality + preserving WIP), gated on a confirmed member boundary.
- **Chosen:** leave the parallel member-park unchanged. It is a narrower, orthogonal mechanism (boundary-confirmed liveness-dead members only, not the general `fix-review-thrash`-on-a-live-build case) and already justified independent of attendedness. This slice re-keys only the *sequential* cooperative checkpoint's `pause` row; the parallel sibling is scanned for lockstep but carries no "pause is L4-only-acts" statement to correct (its abort restatements are already FAFF-765-current).

---

## 7. Open Questions and Assumptions

**Open Questions (Punts):**
- **Punt:** a future opt-out sub-switch `autonomous.pause_acting: false` — keep abort-acting but disable pause-acting. *(decides: product)* *Recommended default:* do not add it in v1; pause rides the shared unattended declaration. Revisit only if an operator reports wanting whole-run abort armed while per-issue park stays advisory.

**Assumptions:**
- **Assumes:** the shared park protocol and the FAFF-336 repeat-park machinery exist and handle a pause-parked issue transparently. *Validation:* `grep -rn "park-history\|faff-parked\|faff-repeat-parked" plugin/skills/faff/bin/lib/` — confirmed present (`park-history.js`, the `faff-parked` and `faff-repeat-parked` labels in `labels.js`; `faff park-history` computes repeat-parked at 3+ parks of the same root-cause class within the rolling window). A pause-parked issue that recurs across runs is demoted by that existing seam with **no net-new work** in this slice.
- **Assumes:** `actsOnSentryAbort` and `declaredUnattendedFromConfig` are exported from `sentry.js` for `actsOnSentryPause` to delegate to and for the test to import. *Validation:* confirmed in `sentry.js` `module.exports` (~L1550) and consumed by `test/sentry.test.mjs`.

---

## 8. DONE — Definition of Done

### From WHY
- [ ] An unattended L3 `/faff-beep-boop` run that trips `fix-review-thrash` on a build parks that issue (via the shared park protocol) and continues the queue — it does not let the build thrash until a whole-run `abort`.
- [ ] An attended L3 run (neither `autonomous.unattended` nor the `sentry_acting` alias declared) is unchanged on a pause-mapped trip: no park, log + surface, continue.
- [ ] Pause acts for the same *unattended* set as abort (L4, or a declared-unattended L3), and for no other.

### From WHAT (predicate)
- [ ] `actsOnSentryPause(ledger, cfg)` exists in `sentry.js`, delegates to `actsOnSentryAbort(ledger, cfg)`, and is added to `module.exports`.
- [ ] `actsOnSentryAbort`'s body is byte-unchanged (L4-first lazy short-circuit intact).
- [ ] No new config key is added; `config.js` `DEFAULTS`, the `config defaults --selftest` list, and the run banner are unchanged.
- [ ] No `SIGNAL_TRIP_INTERVENTION` mapping and no `sentry.*` threshold value changes.

### From HOW (cooperative locus prose)
- [ ] `faff-beep-boop/SKILL.md` pause row (~L117) Non-L4 cell re-keyed to act on the unattended declaration exactly as the abort row; the imprecise "(thrash / repeated-failure are issue-scoped)" parenthetical corrected to the pause-mapped signals.
- [ ] The per-intervention prose (~L111), the acting-decision invariant (~L121), the between-units restatement (~L234), the wave-logging note (~L253), and the Stop-reason narrative note (~L682) all updated in lockstep so pause acts for unattended; `surface`/`correct` remain L4-only; the "de-levelling pause is FAFF-766" forward-reference is removed.
- [ ] `faff validate-adapters` passes (no duplicated-block drift across the re-keyed restatements).
- [ ] `faffter-dark-concurrency-parallel/SKILL.md` scanned: its member-park is unchanged and carries no stale "pause is L4-only-acts" statement.

### From scope guardrails
- [ ] `sentry-poller.js` is byte-unchanged (never acts on pause at any level).
- [ ] `correct` handling and `surface` handling are byte-unchanged.
- [ ] `abort` behaviour (slice 1) is byte-unchanged.

### From tests
- [ ] `test/sentry.test.mjs` extended: an `actsOnSentryPause` truth table (L4 lazy short-circuit with a would-throw config, unattended-L3 acts via the canonical key, alias still acts, attended-L3 advisory, fail-closed on every non-affirmative/fault) — plus an assertion that `actsOnSentryPause` agrees with `actsOnSentryAbort` across the table.
- [ ] `test/sentry-poller.test.mjs` extended (or an existing case pinned): a `pause` intervention on a declared-unattended L3 tick still yields `advisory-trip` — the poller never acts on pause.

### From docs / ADR
- [ ] `docs/guide/unattended.md` updated: the unattended declaration now arms both `abort` (whole-run) and `pause` (per-issue park); `surface`/`correct` stay L4-only.
- [ ] ADR-0103 amended (at graft, via the `adr` slot) to record `pause` joining the attendedness-keyed safe-stop class alongside `abort`, confirming the L4 short-circuit (ADR-0034) and the poller's pause-never-acts property survive.

### Integration smoke test

```
1. Set autonomous.unattended: true in the base .faffrc.yaml of a test run.
2. Drive a build whose sentry check evaluates to a `pause` intervention naming ISSUE-X (fix-review-thrash fixture).
3. At the cooperative checkpoint, assert actsOnSentryPause(ledger, cfg) === true, ISSUE-X gets the faff-parked label + a park comment + a .faff/logs entry, and the drain proceeds to the next unit (no run-level stop).
4. Assert a detached poller tick on the same pause payload returns action:"advisory-trip" (poller unchanged).
5. Flip to attended (unset both keys) and repeat step 2–3: assert no park occurs, the trip is logged+surfaced, and the queue continues.
```

---

confidence: high

**In-context self-review (fresh-reasoning pass against the codebase — no blockers, no majors).** Verified every claim: `actsOnSentryAbort`/`declaredUnattendedFromConfig`/exports (sentry.js L196-215, L1550); the poller's pause-never-acts construction (sentry-poller.js L183-189); the handling table + all five sibling restatements at the exact lines cited (beep-boop L111/117/121/234/253/682); the abort-acting truth-table test shape (sentry.test.mjs L1295-1401); config keys already registered (config.js L174/182/1874-1876/1985); the park machinery (park-history.js, labels.js `faff-parked`/`faff-repeat-parked`); ADR-0103 as slice 1's record. The `actsOnSentryPause`-delegates-to-`actsOnSentryAbort` shape matches slice 1's one-resolver convention and keeps abort byte-unchanged; the sole Punt (opt-out sub-switch) is genuinely a future product call, non-blocking; the one Assumes (FAFF-336 repeat-park) is codebase-confirmed. Concurrency-parallel member-park is orthogonal and correctly left unchanged. All decisions are marked; DONE mirrors the body 1:1. Nothing surfaced that caps the rating.

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "punt" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
