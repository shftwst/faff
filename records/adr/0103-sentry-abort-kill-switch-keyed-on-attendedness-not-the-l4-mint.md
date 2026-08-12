# ADR 0103 — Sentry abort kill-switch keyed on attendedness, not the L4 mint

- **Status:** Proposed
- **Provenance:** loop
- **Date:** 2026-08-11
- **Issue:** FAFF-765
- **Amended:** 2026-08-11 by FAFF-766 — `pause` joins `abort` on the attendedness axis (see amendment note at the end of Decision and Consequences below).

## Context

The Sentry `abort` kill-switch exists to stop a run that has gone wrong when no human is
at the keyboard to stop it. Its single acting resolver, `actsOnSentryAbort(ledger, cfg)`,
answered a proxy question — *"was this run L4-minted, or did it set the FAFF-717
`autonomous.sentry_acting` knob?"* The L4 mint is too narrow a proxy for the real axis,
**attendedness**: the two runs that most need a live kill-switch but *cannot* obtain the
L4 mint are exactly the unattended ones — the self-directed faff-on-faff watcher (L4
refuses a self-directed run, ADR-0069) and an L3-on-CI drain. Both ran unprotected in the
FAFF-763 incident, where an L3 drain was hard-killed by the runner's `timeout-minutes` cap
while the sentry only logged `advisory-trip`, orphaning a stale claim.

Two prior decisions constrain any fix. **ADR-0034** fixes the L4 kill-switch as
un-subvertable *by construction* — its abort authority must not depend on any channel a
fault or the supervised agent can perturb; the current lazy `||` (an L4 ledger
short-circuits before any config is read) is how that property holds. **ADR-0044 pt5/pt8**
recorded the narrower "only L4-minted runs act" model this slice erodes. **ADR-0095** fixes
unattended-on-CI as admission criteria the operator *asserts*, not ambient state faff
sniffs — and no CI-env / TTY detector exists in the codebase (the detached poller has no
TTY to read).

## Decision

Re-key `actsOnSentryAbort`'s second disjunct from the L4-mint proxy onto **declared
attendedness**, keeping the resolver's shape (one resolver, two acting loci, lazy L4
short-circuit) exactly:

`actsOnSentryAbort(ledger, cfg) = (ledger?.level === "L4") || declaredUnattendedFromConfig(cfg)`

- **Attendedness is the acting axis.** An **unattended** run acts on `abort` (resumable,
  whole-run); an **attended** run stays advisory (the human is the kill-switch). The L4
  mint is folded in as one sufficient, always-unattended case — the **first** disjunct,
  evaluated before any config read, so a config fault can never regress the L4 kill-switch
  (ADR-0034 preserved verbatim). This **amends ADR-0044 pt5/pt8**: "only L4-minted runs
  act" becomes "any *unattended* run acts"; the rest of ADR-0044 stands.
- **Declared, not auto-detected (no env sniff).** Attendedness is an operator/caller
  declaration resolved from config via the canonical `autonomous.unattended` key, with the
  shipped `autonomous.sentry_acting` retained as a fail-safe-OFF back-compat **alias**
  (OR semantics — either positive assertion asserts unattended; a `false` on one key never
  silently overrides a `true` on the other). Consistent with ADR-0095. Fail-safe direction
  is **OFF (attended → advisory)**: every unrecognised / unset / faulted value resolves to
  attended, since an abort is a resumable ledger-mark (a false negative costs a paused
  night) while a false positive surprises watched work.
- **Scope is the abort row only.** `surface`/`pause`/`correct` stay L4-only-acts —
  de-levelling `pause` is FAFF-766 (which reads this same `unattended` signal), and
  `correct` stays authority-gated per FAFF-326. The `sentry check` consult never forks on
  level/attendedness; only the abort *handling* consults the resolver.

**Amendment (FAFF-766, 2026-08-11).** `pause` joins `abort` on this same attendedness
axis — the two now form the **safe-stop class**. `abort` stops the whole run
(resumable); `pause` is strictly gentler: it parks one implicated issue (named by the
verdict's evidence — `worst.issue` for `fix-review-thrash`, the drifting/stalled member
for `scope-drift` / member-scoped `wall-clock-runaway`) and keeps draining the rest of
the queue. The new resolver `actsOnSentryPause(ledger, cfg)` **delegates verbatim to
`actsOnSentryAbort`** — one shared L4-first lazy short-circuit, never a second copy —
so an operator who declared unattended (and thereby armed the whole-run abort
kill-switch) gets the gentler per-issue park *a fortiori*; no separate knob was added
(a documented, non-blocking Punt for a future `autonomous.pause_acting: false`
opt-out). `surface` and `correct` are unaffected by this amendment and remain
L4-only-acts (`correct` stays authority-gated per FAFF-326). This amendment does not
touch `actsOnSentryAbort`'s body (byte-unchanged) or the cooperative-checkpoint-only
scope of pause-acting — the detached `sentry-poller` still never acts on `pause` at any
level (it has no orchestrator judgement to park an issue with), a property this
amendment leaves untouched and unit-tested.

## Consequences

- The durable acting model FAFF-766 (pause-acting) and later FAFF-763 slices build on is
  now **attendedness**, surfaced through the `unattended`-derived predicate this slice
  introduces — the extension point for any future attendedness source (a run-ledger field,
  or, were it ever wanted, an OR-ed `unattendedFromEnv()`), deliberately not built here.
- ADR-0034's un-subvertable-by-construction property is **confirmed to survive**: the L4
  disjunct stays first and config-free; the re-key touches only the non-L4 branch.
- ADR-0044 pt5/pt8 are amended (not wholly superseded — ADR-0044's other points stand), so
  no `faff adr supersede` back-ref is written.
- The `autonomous.sentry_acting` alias is kept indefinitely (one extra OR term, cheap);
  its eventual retirement is a later config-migration slice (an Open Question, *decides:
  product*). Threshold calibration against accumulated advisory telemetry is likewise
  deferred (*decides: qa*); this slice keeps current `sentry.*` thresholds unchanged,
  relying on the resumable-abort design + telemetry.
- The reference self-directed watcher (`operations/ci/l3-watcher.yml`) now declares
  `autonomous.unattended: true`, so it gains the live kill-switch it could never obtain via
  the L4 mint.
- **(FAFF-766 amendment.)** The `unattended`-derived predicate this ADR introduces is now
  shared by two acting resolvers, `actsOnSentryAbort` and `actsOnSentryPause` (the
  latter delegating to the former), so a single declaration arms both safe stops. An
  unattended L3 run that trips `fix-review-thrash` no longer has to thrash until a
  whole-run `abort` — the implicated issue is parked and the drain continues. The
  poller's pause-never-acts property (this ADR's original text) is unchanged and
  re-confirmed by a regression test.
