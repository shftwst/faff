# FAFF-767 — Budget blindness at L3: trip `budget-metering-degraded` off the L4 gate + a run-scoped surface intervention

> Spec: faffter-dark-nlspec · 2026-08-10 · autonomous · confidence: high. Full spec on Linear FAFF-767.

Slice 3 of FAFF-763. Independent of slices 1–2 — it touches one signal's detection gate (`evalBudgetMeteringDegraded`) and that signal's mapped intervention, nothing else in the sentry surface.

## Why

The sentry watchdog's `budget-metering-degraded` predicate (FAFF-447) exists to catch the case where token metering silently falls back to `tokens_source: "estimate"` — the run has gone blind on spend. Today it only fires on a **running L4 ledger**: `evalBudgetMeteringDegraded` returns `null` unless `ledger.level === "L4"` (`plugin/skills/faff/bin/lib/sentry.js:387`).

But an unattended **L3** `/faff-beep-boop` run leans on its budget ceiling (`max_attempts` / `tokens`, `at_ceiling: stop`) as its runaway backstop, and if metering degrades to `estimate` that backstop is quietly defeated with nobody watching. The exposure is the same mechanism as L4 — it is simply never evaluated at L3. Fail-safe direction: knowing you went blind on spend is strictly better than not.

Second, the intervention shape is wrong. `budget-metering-degraded` maps to `pause` (`SIGNAL_TRIP_INTERVENTION`, `sentry.js:141`), and `pause`'s handling is "park the implicated issue(s) the verdict names" (`faff-beep-boop/SKILL.md:116`; sentry-poller advisory branch `sentry-poller.js:174`). But this signal is **run-scoped** — it is evaluated off the ledger and carries no `scope`/`member`, so it names no issue. On an *acting* run (L4, or an L3 that set `autonomous.sentry_acting: true`) `pause` therefore parks nothing: a silent no-op. A run-scoped condition has been shoehorned into an issue-scoped intervention.

## What

Two coupled changes, both inside the sentry lane:

1. **Detect at L3 too** — drop the `ledger.level === "L4"` gate in `evalBudgetMeteringDegraded` so a degraded meter trips on an L3 run as well. Every other guard (running owner, `tokens_source === "estimate"`, elapsed past the exposure threshold) is unchanged.
2. **Run-scoped surface, not issue-`pause`** — give the tripped signal a distinct run-level *surface* intervention that writes to the run log + the `/faff-wtf`-visible surface (the existing advisory-escalation channel the container/branch-protection preflights already use), never attempting to park a named issue. Keep it strictly non-`abort`/non-`correct`: a blind meter is a blind spot, not a proven breach, so a co-tripping hard-evidence `budget-breach` still wins the ladder-max and routes to `abort`.

### Acceptance criteria

- `budget-metering-degraded` trips on an L3 `/faff-beep-boop` run (`ledger.level` absent or `"L3"`) whose running ledger reads `tokens_source: "estimate"` past `sentry.estimate_metering_exposure_secs` — the `l4Running(...)` selftest for the L4 case is joined by an L3 case that now trips (the existing `sentry.js:1001` "level:L3 … → null" assertion is inverted to assert a trip).
- The tripped signal's aggregate intervention is the new run-scoped `surface` value, and its handling writes a run-scoped surface (run log + `/faff-wtf`), never a `faff label add … faff-parked` on any issue.
- A co-tripping `budget-breach` still yields aggregate intervention `abort` (hard evidence wins the ladder-max), and the `budget-metering-degraded` verdict is still present in `verdicts[]` (the existing `sentry.js:1068` assertion holds under the new mapping).
- `budget-metering-degraded` alone never yields `abort` or `correct` at any level.
- The detached `sentry-poller` classifies a lone `surface` trip as an advisory-trip (logged, no dispatch), exactly as it does `pause`/`correct` today — it never dispatches an abort off it.

## How

The change is confined to the sentry lane. Named surfaces and the decisions on each:

**The detection gate (`sentry.js` `evalBudgetMeteringDegraded`, ~line 384).**

**Chosen:** delete the single line `if (!ledger || ledger.level !== "L4") return null;` (line 387) while keeping the ownerless/`!budget`/non-`estimate`/within-window guards. The predicate becomes level-agnostic; `sentryRunElapsedSecs` already reads elapsed off `ledger.owner.started_at` with no level dependency, so no other line in the function changes. Rationale: fail-safe direction — the ticket's stated intent, and the un-fired state was the *only* thing tying this signal to L4.

**The intervention value + ladder position.**

**Chosen:** introduce a new intervention `surface`, inserted into `SENTRY_INTERVENTIONS` between `continue` and `pause` → `["continue", "surface", "pause", "correct", "abort"]`, and remap `SIGNAL_TRIP_INTERVENTION["budget-metering-degraded"]` from `"pause"` to `"surface"`. Rationale: the ladder is severity-ascending and every comparison uses relative `indexOf`, so inserting the softest trip-response as index 1 preserves all existing orderings (continue < surface < pause < correct < abort) — a co-tripping `pause`/`correct`/`abort` always out-ranks `surface` in the ladder-max, which is exactly AC3. `surface` is the correct altitude: it is a *softer* response than parking one issue, and it is run-scoped by nature.

Considered and rejected: overloading `pause` and detecting "run-scoped ⇒ surface" inside the beep-boop/poller handlers (Option B). Rejected because the ticket asks for a *distinct* intervention, and overloading `pause` leaves the verdict's own name lying about what it does.

**Naming — `surface` not `escalate`.**

**Chosen:** name the intervention `surface`. Rationale: `escalate` already names a *budget-breach* outcome (`evalBudgetBreach`, `sentry.js:261`) on a different axis; reusing the token for an intervention invites confusion at the read sites. `surface` is the verb the codebase already uses pervasively for run-log + `/faff-wtf` advisory escalation.

**The escalate target (open question #1 — resolved).**

**Chosen:** the surface target is the **run log + the `/faff-wtf`-visible surface only** — the same advisory-escalation channel the container/branch-protection preflights already write to — with a clean seam so the FAFF-386 andon push is wired on top later. Rationale (resolve-attempt from local tracker state): the ticket offered three targets — the FAFF-386 andon channel "(if shipped)", run-level surface-only, or run-level pause. As of this prep FAFF-386 (the andon channel) is **Todo — not shipped** and FAFF-472 (wire the tripped verdict to andon) is **Backlog**, so andon is not an available target; wiring to a non-existent channel would be a load-bearing external dependency this slice cannot satisfy. Run-level `pause` is rejected outright — it is the issue-scoped no-op this ticket exists to remove. Surface-only is the fail-safe, buildable answer, and it composes cleanly: **FAFF-472 is the follow-up that adds the andon push on top of this surface** once FAFF-386 lands, so no rework is thrown away.

**The L3 exposure threshold (open question #2 — resolved).**

**Chosen:** reuse the single existing `sentry.estimate_metering_exposure_secs` knob for both L3 and L4 — do not add an L3-specific threshold in v1. Rationale (resolve-attempt from local convention): the sibling fleet predicate `evalMemberStall` faced the identical "reuse or add a knob" choice and its shipped comment records the answer explicitly — "mirroring the run-level window (reused, not a new knob)" (`sentry.js:461`). One knob keeps the config surface minimal and the two levels consistent; a per-level threshold can be added later without churn if a shorter L3 run proves to want one. `evalBudgetMeteringDegraded` already reads `th.estimate_metering_exposure_secs` — no new threshold plumbing.

**The handling sites (the intervention consumers).**

**Chosen:** wire `surface` at both intervention-handling sites, action-identical regardless of run level (surface never parks and never aborts, so it has no acting/non-acting split — unlike `pause`/`correct`, which are L4-only-acts):
- `plugin/skills/faff-beep-boop/SKILL.md` handling table (~line 116) — add a `surface` row: "emit a run-scoped surface (run log + `/faff-wtf`); never park an issue, never abort; continue the queue" for both the acting and non-acting columns.
- `plugin/skills/faff/bin/lib/sentry-poller.js` (~line 174) — extend the advisory-trip branch condition so `intervention === "surface"` is classified as `advisory-trip` (logged, no dispatch), alongside `pause`/`correct`. The abort-dispatch branch (line 164) is untouched, so `surface` can never trigger a dispatch.

**Assumes:** the `/faff-wtf` run-surface + run-log advisory channel (used today by the container/branch-protection preflights and the poller's `advisory-trip` log) exists and is the sanctioned home for a run-scoped needs-attention signal. (It does — `sentry-poller.js` already writes `advisory-trip` log entries; this reuses that surface.)

**Blast radius / non-consumers (verified).** The intervention string flows to three other readers, none of which gate on the closed set and none of which need changes: `audit.js` records `last_intervention` as a free string (`audit.js:292`); `sentrycheck.js` prints it (`sentrycheck.js:110`); `sentry.js`'s own `--json`/console output pass it through (`sentry.js:873`). The `CORRECTABLE_SIGNAL` upgrade path and every member/staleness cap key off `signal`+`scope`, never off `budget-metering-degraded`, so they are inert to this change.

**Tests (`test/sentry.test.mjs` + the in-file selftests).** Update the L3 assertion (`sentry.js:1001`) from "→ null" to "→ trips"; add an aggregation assertion that a lone `budget-metering-degraded` trip yields `intervention === "surface"` (replacing/augmenting the `sentry.js:1065` "→ pause" expectation); keep the co-tripping-breach → `abort` assertion (`sentry.js:1068`) green under the new mapping; add a poller assertion that a `surface` trip is `advisory-trip`, not a dispatch.

## Done

- [ ] `evalBudgetMeteringDegraded` returns a trip for a running L3 (or level-absent) ledger reading `estimate` past the exposure window; the L4 case is unchanged.
- [ ] `budget-metering-degraded` maps to `surface`; `SENTRY_INTERVENTIONS` is `["continue","surface","pause","correct","abort"]`.
- [ ] Aggregate intervention for a lone degraded-meter trip is `surface`; for a degraded-meter + `budget-breach` co-trip it is `abort`, with both verdicts present.
- [ ] The beep-boop handling table and `sentry-poller.js` classify `surface` as a run-scoped advisory surface (log + `/faff-wtf`), never a park and never a dispatch.
- [ ] `estimate_metering_exposure_secs` remains the single knob (no L3-specific threshold added).
- [ ] `node test/sentry.test.mjs` (and the `sentry.js` selftest) pass, including the inverted L3 case and the new `surface`-mapping assertions.

## Open questions / Assumptions

Both open questions the ticket flagged for prep are **resolved** from local context (see the marked decisions above), so neither escalates:

- Escalate target → **Chosen:** run-level surface-only now (FAFF-386 andon is Todo/not-shipped; FAFF-472 wires the push later). Not a human policy call — it follows from the shipped-state of the two related tickets.
- L3 exposure threshold → **Chosen:** reuse the single `estimate_metering_exposure_secs` knob (matches the `evalMemberStall` "reuse, not a new knob" convention). Not a human policy call.
- **Assumes:** the run-log + `/faff-wtf` advisory surface is the sanctioned run-scoped escalation home (verified against the existing poller `advisory-trip` writes).

confidence: high
