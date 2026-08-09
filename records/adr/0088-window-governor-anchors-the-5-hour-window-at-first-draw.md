# ADR 0088 — Window governor anchors the 5-hour window at first draw

- **Status:** Proposed
- **Provenance:** loop
- **Date:** 2026-07-24
- **Issue:** FAFF-594

## Context

FAFF-594 adds a subscription-native budget governor: a rolling 5-hour token-draw
window (mirroring the shape both Claude Max and ChatGPT Plus/Pro meter, though
faff cannot observe either vendor's real window — see the spec's "a proxy is
not the meter" principle). The governor needs a concrete anchor rule: when does
the current window's 5-hour clock start?

Three candidates were on the table:

- **Anchor at run start.** Couples the window to the run's own lifecycle. A run
  that dispatches nothing yet would still be "burning" window time for no
  reason, and a long-idle run would falsely appear to have an old window.
- **Anchor at a fixed wall-clock cadence** (e.g. every 4 hours on the clock).
  Would need to know the vendor's real cadence to line up with it, and that
  cadence is exactly the thing faff cannot observe (no API for the vendor's
  actual window boundaries).
- **Anchor at the first draw recorded within the window.** No new state is
  needed at run start; a window opens only when work actually happens, mirrors
  (loosely) how the vendor's own windows are understood to open on a user's
  first request post-reset, and is the simplest rule the codebase can enforce
  without inventing a wall-clock cadence it has no way to validate.

This decision only needs to hold for the global, 5-hour-only slice FAFF-594
ships (per-backend attribution is deferred behind the unbuilt FAFF-604
telemetry seam; the weekly window is deferred behind cross-run persistence
that doesn't exist yet). It is recorded as an ADR rather than left in code
comments because it is the one genuinely debatable design call in an
otherwise mechanical slice, and future per-backend/weekly window work will
need to either inherit this precedent or deliberately diverge from it.

## Decision

The window anchors at the **first draw recorded within it** — not run start,
not a fixed wall-clock cadence.

Concretely: `faff budget check` persists `ledger.budget.window` (`anchor_epoch`,
`reset_epoch`, `tokens_at_anchor`) in the existing L4 run-ledger. When no window
state exists, or the persisted `reset_epoch` has already passed, the *next*
invocation that observes a non-zero draw opens a fresh window anchored at that
invocation's `now`. While a window is open (now < reset_epoch), draw
accumulates against the persisted anchor's baseline. `reset_epoch = anchor_epoch
+ hours * 3600 * 1000` is the `resume_at` a `park-until-window-reset` breach
reports, and the same instant `lights-out --resume` (FAFF-527) uses to decide
a re-entry is legitimate.

## Consequences

- A run that never dispatches anything never opens a window and never
  accrues window draw — the governor is inert until work actually happens.
- The window's boundary is a **faff-local proxy**, not the vendor's real
  window boundary. It will diverge from the vendor's true 5h window (the
  vendor anchors across all of the user's activity, not just faff's) —
  this is accepted, not solved, by this decision; it is inherent to
  window-mode being a proxy rather than a mirror (see the FAFF-594 spec's
  design principles).
- Future per-backend window work (behind FAFF-604) and the weekly window
  (behind durable cross-run persistence) must either reuse this same
  first-draw anchor rule per scope, or explicitly record why they diverge —
  this ADR is the precedent they inherit from or deviate against.
- Because the anchor is set lazily on first draw rather than eagerly at
  run start, a resumed run (`lights-out --resume`) that dispatches nothing
  before its window's `reset_epoch` passes will roll a fresh window on its
  first real draw after resume, not before.
