# ADR 0099 — Engine-lane effort maps at dispatch, never forks the closed effort vocabulary

- **Status:** Proposed
- **Provenance:** loop
- **Date:** 2026-08-09
- **Issue:** FAFF-705

## Context

The per-lane effort surface (FAFF-416 / ADR-0050) fixes a closed, lane-uniform five-level vocabulary `EFFORT_LANE_VOCAB = inherit|low|medium|high|xhigh|max` — the same legal set for every tunable lane, validated at read (`validateEffortLane`) with no engine context. FAFF-705 routes those levels onto engine transports whose graded target is only three levels (`low|medium|high`). That mismatch could be resolved two ways: narrow the legal vocabulary per-engine (so an ollama lane rejects `high`, a three-level seat rejects `xhigh`), or keep the vocabulary uniform and reconcile the width at dispatch.

## Decision

`effort.<lane>` on an engine lane maps at DISPATCH; the closed effort vocabulary is never forked per-engine. The five-level faff token is validated uniformly at read (unchanged), carried on the resolved engine record pre-map, and translated onto the transport by a single pure helper `reasoningEffortForTransport` at the two encode sites (`buildEngineRequest` for OpenAI HTTP, `buildCodexArgv` for codex spawn): `low/medium/high` pass through, `xhigh/max` CLAMP to `high` (the ceiling), with one informational stderr note on clamp. A lane's legal effort set stays independent of which engine it points at.

## Consequences

- Read-time validation stays engine-context-free: `faff config get effort.<lane>` and `config set` never need to know a lane's engine to validate its effort token, so the vocabulary is checkable in isolation and an off-vocabulary token still fails loud at read.
- The telemetry stores the faff level (pre-clamp), not the transport-mapped level, so `economics --by effort` buckets an `xhigh` engine lane alongside an `xhigh` Agent lane — effort-requested is measured uniformly across transports.
- A future richer transport vocabulary (e.g. an OpenAI `minimal` below faff's `low` floor) is reached by extending `reasoningEffortForTransport`, never by widening `EFFORT_LANE_VOCAB` below the floor. Extends ADR-0050's lane-uniformity to the engine transports; paired with ADR-0100 (capability derived from family).
