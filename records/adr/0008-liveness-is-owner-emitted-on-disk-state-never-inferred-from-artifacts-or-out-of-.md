# ADR 0008 — Liveness is owner-emitted on-disk state, never inferred from artifacts or out-of-band probes

- **Status:** Accepted
- **Date:** 2026-06-22
- **Issue:** FAFF-205

## Context

FAFF-205 needs `runcheck --hook` to distinguish an actively-held run from an abandoned one. Several signals were available: a worktree/file-mtime heuristic ("recent activity ⇒ in-flight"); a tracker read ("are the admitted issues still In Progress?"); a foreign-process probe (`kill -0` the owner pid); or an on-disk heartbeat the owner writes. The mtime heuristic is provably wrong — during the slow review/merge phase the build commits, pushes, then runs a multi-minute review writing nothing to the worktree, so an mtime snapshot mis-classifies an actively-merging graft as stalled (the documented second recurrence). A tracker read or network probe would break `runcheck`'s pure-function CLI invariant (it audits externalised on-disk state only, like `prepcheck`), and a foreign-host pid is meaningless to probe.

## Decision

The liveness signal is **on-disk state emitted by the run owner** — the `owner.status` + `owner.last_heartbeat` fields the orchestrator writes to the ledger across the whole graft lifecycle (assembly → build → review → merge → housekeeping) — read by the hook. It is **never** inferred from artifact timestamps (worktree/file mtime), and **never** sourced from an out-of-band probe (no tracker read, no network call, no `kill -0` of a foreign pid as the contract). A same-host, same-machine dead-pid check may be used **only** as a best-effort corroborator that *shortens* the abandoned-detection window — never as the primary or sole signal. The contract is the heartbeat age; the pid is an optional accelerator gated on the pid looking local.

## Consequences

- The pure-function CLI invariant is extended to the new liveness signal: `runcheck` still makes no tracker call and no network call, and probes no process it does not own. This keeps the hook portable and side-effect-free.
- The heartbeat **must** span the whole lifecycle, including the review/merge wait — this is the load-bearing reason the orchestrator refreshes it there explicitly rather than only at issue boundaries. A quiet worktree mid-review is *normal in-flight*, not stalled.
- A crashed owner that left `status:"running"` + a recent heartbeat looks held for at most `STALE_SECS` (bounded blind window); the same-host dead-pid corroborator usually collapses this to near-instant when the pid is present and local.
- Missing or unparseable heartbeat is treated as **not held** (fail-safe toward firing) — the check never silently passes a possibly-abandoned run.
- Future liveness needs (e.g. cross-host) must add new owner-emitted on-disk fields, not reintroduce inference or out-of-band probes.
