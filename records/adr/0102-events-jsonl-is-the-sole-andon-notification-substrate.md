# ADR 0102 — events.jsonl is the sole andon notification substrate

- **Status:** Proposed
- **Provenance:** loop
- **Date:** 2026-08-11
- **Issue:** FAFF-386

## Context

The andon has to learn about run-critical moments (park, Sentry trip, budget breach) from somewhere. The two live candidates were: (a) a watcher daemon or a set of per-event-type call sites (`faff andon notify --type park ...`) sprinkled through the orchestrator's prose at each place a critical condition is decided, or (b) a pump that reads the run's existing `events.jsonl` — already the hard-floor, append-only, single-writer, monotonic-`seq` record of everything that happens in a run (FAFF-35). A daemon is a new long-lived process class faff doesn't otherwise have. Per-site calls multiply seams (one per checkpoint, easy to miss one) and can't dedupe a persisting condition (a budget stays breached across many checkpoints; a sentry trip stays tripped) without inventing a second piece of state to track "have I already told the human about this."

## Decision

`events.jsonl` is the sole substrate the andon classifies against. `faff andon pump` is a cursor-based reader: it reads events with `seq >= cursor`, classifies each against the closed `park` / `sentry-trip` / `budget-checkpoint(breached≠[])` / `run-end` set, and advances its own per-run cursor (`andon-state.json`) only past what it fully handled. The one additive change to the log itself is a new `sentry-trip` member of `EVENT_TYPES` (schema stays 1, not issue-scoped) that the orchestrator appends when `faff sentry check` first observes `tripped: true`; the other two classes need no new event types (`park` events already exist, and every `budget-checkpoint` event already embeds `BudgetState.breached`). The pump never re-runs `faff sentry check` or `faff budget check` itself to re-derive trip/breach state — if a condition isn't in `events.jsonl`, the andon does not know about it.

## Consequences

- Adding a pump call at a new checkpoint (beep-boop step 8.1, run-end) is idempotent and cheap — the cursor makes repeated calls a no-op once caught up, so the wiring is "add one line," not "add one line and reason about double-notification."
- A run-critical condition that never gets appended to `events.jsonl` is permanently invisible to the andon (e.g. if the orchestrator's `sentry-trip` append is dropped in a future refactor). This is an accepted, unenforced prose seam — the same trust level every other beep-boop event append already has — and its failure mode is auditable after the fact via `faff audit` (a tripped run with no corresponding `sentry-trip` event), not prevented structurally.
- Any future run-critical signal (the spec names a fully-down adversarial-review chain as a candidate, and declines to add it as a class because it already surfaces via `park`) must arrive as an event-log entry before the andon can classify it — a design constraint on every future critical-event source, not just this ticket's three.
- The dedupe key is per-condition, not per-event: a persisting breach or trip notifies once per distinct dimension/signal set, never once per checkpoint. This is what stops a 3am notification storm, but it means the pump carries its own `notified` list in `andon-state.json` — a second piece of state beyond the cursor, scoped per run.
