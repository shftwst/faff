# ADR 0054 — Per-lane engine mapping implies per-lane transport selection

- **Status:** Proposed
- **Date:** 2026-07-11
- **Issue:** FAFF-422

## Context

Per-lane model selection (the `models:` map) grew up over a closed Claude-family Agent-token vocabulary, and every producer dispatch is an in-harness Agent-tool subagent. Cheap-judgement, pure-data-in producers (`methodology` issue-critique, `intake` discovery) burn a Claude token per dispatch even though a configured local engine (e.g. ollama over Tailscale) could serve them. Reaching a non-Anthropic engine means leaving the Agent-tool harness — so admitting engine values into the lane vocabulary forces a decision about *which execution vehicle* a lane value selects, not merely which model. The repo already carries two bespoke direct-API consumers (the adversarial reviewer's engine block, the eval driver's one-shot ollama path — the driver-fork precedent) that stay authoritative for their own lanes.

## Decision

A `models.*` lane value selects the transport, not just the model:

- **Claude-family Agent-token** (`inherit|sonnet|opus|haiku|fable`) → in-harness Agent-tool subagent dispatch (`model` param), never a spawned process — byte-for-byte the pre-existing path.
- **Local engine + pure-data-in producer** (`engine:<name>`, v1 allowlist `methodology` | `intake`) → out-of-session direct-API one-shot via `faff engine call`, resolved from a name-keyed top-level `engines:` map. The `engine:` prefix keeps the lane value a scalar, so the closed-vocabulary lane machinery extends rather than forks.
- **Local engine + tool-needing producer** → spawned `claude -p` env-redirect — not built here; the follow-up extends *this same decision* with a third branch rather than making a new one.

The producer-dispatch vs chaining-handoff rule is unchanged — this decision forks only the producer-dispatch *vehicle*, keyed on the lane value's shape; the orchestrator still consumes the producer's output and resumes.

The fork is fail-loud everywhere: an invalid, non-allowlisted, or unreachable engine terminates the dispatch with a named error — never a silent fall-back to the session model, and no fallback chain. The one-shot transport is a fresh, small helper (the eval one-shot pattern) rather than a generalisation of the review helper, whose exit taxonomy encodes review-verdict routing; the bespoke engine blocks (adversarial reviewer, eval driver) compose with this decision and are not subsumed by it. This is the next incremental extraction of the per-role engine vision onto today's flat lanes (factory-first, extract-don't-fork), and the transport counterpart of per-lane effort routing mirroring the model lanes.

## Consequences

- Every future lane that admits an engine value inherits this fork: the lane value's *shape* (Agent-token vs `engine:<name>`) decides the vehicle, and the capability boundary (pure-data-in vs tool-needing) decides which non-Anthropic transport is legal. Widening the allowlist is a deliberate act at both enforcement points (read-time vocabulary + dispatch-time guard), never a config-only drift.
- A degraded dispatch is always visible: callers park/surface on a named engine failure instead of absorbing it into a session-model re-run. Resilience-by-fallback-chain is deliberately unavailable in this lane.
- The `engines:` map is the single home for engine definitions and is reusable by the follow-up transport branch; per-engine tuning (reasoning toggles, timeouts) lives in the engine object, so Agent-tool knobs (`effort.<lane>`) are refused on engine-valued lanes rather than silently ignored. **Revisited by FAFF-705 (ADR-0098 / ADR-0099):** the blanket refusal was a not-built-yet placeholder, not a principled no. A non-`inherit` `effort.<lane>` is now CARRIED onto graded-effort engine transports (openai-family `reasoning_effort`, codex `-c model_reasoning_effort`) — capability derived from the transport family (ADR-0098) and mapped at dispatch without forking the closed effort vocabulary (ADR-0099). The refusal survives, capability-gated, only for non-graded families (ollama) and the graded-effort × `reasoning_off` contradiction.
- Three direct-API consumers now coexist (adversarial reviewer, eval driver, `faff engine call`); extraction of a shared transport module is deferred until the tool-needing branch makes the semantics converge.
