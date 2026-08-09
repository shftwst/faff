# ADR 0015 — Deterministic faff heartbeat CLI primitive — the single sanctioned owner.last_heartbeat write path

- **Status:** Superseded by ADR-0055
- **Date:** 2026-06-26
- **Issue:** FAFF-234

## Context

The run-ledger liveness contract (ADR 0007) judges a run live (`held`) while its `owner.last_heartbeat` is fresher than the staleness window (default 900s); ADR 0008 fixes that liveness is owner-emitted on-disk state, never inferred from worktree mtimes or out-of-band probes. Both ADRs left the heartbeat *write* as prose: the orchestrator hand-edited the ledger JSON, and the only prose covering a long quiet phase was beep-boop's orchestrator-side "review/merge wait". That assumption broke when builds moved to isolated subagents (FAFF-201): a build subagent running a multi-minute adversarial review or gate ladder has no mandate — and no tool — to refresh the heartbeat mid-step, so a single ~10-minute graft (build + adversarial review; longer once L4 holdout eval lands) can let the heartbeat age past the window. The run then reads stale and a foreign session's Stop hook treats a live run as abandoned (false-block, or a tempting-but-wrong "reconcile as dead"). The heartbeat gates a safety mechanism, so a prose-only, hand-rolled, easily-skipped write is the wrong substrate for it.

## Decision

A deterministic `faff heartbeat [RUN_DIR]` CLI primitive is the **single sanctioned write path** for `owner.last_heartbeat`. It re-reads the ledger immediately before mutating **only** that one field and writes back atomically (tmp + rename) — a field-merge that cannot clobber a concurrent outcome write under the sequential single-active-writer model. It is guarded solely on `owner.status === "running"` (a done/unowned/absent run is a soft no-op, exit 0; a malformed ledger is a loud exit 2) — no env-ownership proof, because the only callers are the run's own orchestrator and its build subagents (the Stop hook calls `runcheck`, never `heartbeat`). Every refresh site routes through it: faff-graft's long sub-steps (Step 7.5 gate ladder; Step 9 review entry / between adversarial phases / after; holdout before/after), both concurrency executors, and beep-boop, each passing `RUN_DIR` explicitly. Ticks are emitted at agent-controlled sub-step **boundaries** between blocking calls — not a periodic ticker (an agent has no background thread mid-call), which bounds heartbeat age by the longest single blocking call, well under the window. This **extends** ADR 0007 (it supplies the write tool the contract assumed) and **honours** ADR 0008 (the write stays an explicit on-disk write by the run's own agents); it revises neither — the read path (`runIsHeld`) and the ownership model are unchanged.

## Consequences

- The heartbeat write is now testable and identical run-to-run: a quiet-but-live build is no longer at the mercy of an agent remembering to hand-edit the ledger, closing the false-abandonment / false-Stop-block hole.
- Every present and future heartbeat refresh must call `faff heartbeat` rather than serialize the ledger by hand — the primitive owns the field-merge + atomic-write discipline so callers cannot reintroduce the load-modify-save clobber.
- The window stays static and env-tunable (`FAFF_RUN_HEARTBEAT_STALE_SECS`); auto-scaling it to observed sub-step durations was deliberately deferred, since boundary ticks already bound heartbeat age below the static window.
- Concurrent multi-writer safety under the parallel executor is out of scope: with more than one active subagent a field-merge can still interleave with an outcome write. The named extension point is a dedicated single-value heartbeat file decoupled from ledger content, adopted only if parallel write contention is ever observed; the sequential default has a single active writer and is fully correct.
- A second ledger field ever needing CLI writes would generalise the field-merge helper introduced here rather than adding a general ledger-mutation API.
