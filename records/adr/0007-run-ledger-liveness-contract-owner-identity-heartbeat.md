# ADR 0007 — Run-ledger liveness contract — owner identity + heartbeat

- **Status:** Accepted
- **Date:** 2026-06-22
- **Issue:** FAFF-205

## Context

The `runcheck --hook` Stop hook is registered globally for the repo and fires on every session's turn-end, auditing the newest `.faff/runs/*/run-ledger.json`. A ledger showing issues `admitted` with no terminal `outcome` is ambiguous between two states it could not tell apart: (a) a genuinely abandoned/deferred queue — the run owner is gone, which is exactly what `runcheck` exists to catch; and (b) a normal in-flight queue an orchestrator is actively draining right now (an issue can sit mid-graft for many minutes during the slow review/merge phase, writing nothing). Because the ledger carried no notion of *who owns the run* or *whether anyone still holds it*, a parallel beep-boop drain's legitimately in-flight ledger looked identical to (a), and the hook repeatedly false-blocked unrelated concurrent sessions (observed twice on 2026-06-22). The check needs a way to recognise an actively-held run without weakening its ability to catch a truly abandoned one, and without a non-owner ever having to write to a foreign run's ledger.

## Decision

The run ledger gains an optional `owner` object — `status` (`"running"` while held, `"done"` at orchestrator exit), `last_heartbeat` (refreshed by the owner across the whole graft lifecycle), and optional `pid`, `session_id`, `started_at`. A run is **held / live** iff its ledger carries `status:"running"` and a `last_heartbeat` fresher than the staleness threshold (`FAFF_RUN_HEARTBEAT_STALE_SECS`, default 900s); otherwise it is **abandoned**. The `runcheck --hook` firing condition becomes: fire only when the resolved run is one the current session **owns** (the backstop) **or** is **abandoned** — and stay silent for a foreign run a live owner still holds. An absent `owner` (legacy ledger) is treated as unowned/abandoned, so pre-existing ledgers audit exactly as before.

## Consequences

- The ledger schema is now part of a contract shared by every writer (the orchestrator, which must stamp and refresh `owner`) and every reader (`runcheck --hook`, and any future ledger consumer). The orchestrator must refresh the heartbeat across the whole lifecycle — including the multi-minute review/merge wait — or the false-block recurs; this is why the heartbeat is lifecycle-spanning, not boundary-only.
- The check is *narrowed, never blinded*: a genuinely abandoned run (owner gone, `status≠running`, or stale heartbeat) is still caught, with a bounded blind window (≤ `STALE_SECS`) after a crash before the heartbeat goes stale.
- Non-owning sessions never need to mutate a foreign ledger to satisfy the hook — the hook simply does not fire — closing the clobber surface a human hit by injecting `unreached-budget` into a live ledger.
- The threshold is env-tunable for slow review backends; the default (900s) sits above typical review waits and is the sole substantive punt left to operators.
- Scope is deliberately host-local: the `owner` record could later carry a host id if cross-host run ownership ever becomes real, but this ADR does not solve that seam.
