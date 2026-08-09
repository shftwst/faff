# ADR 0100 — Graded-effort capability is derived from the transport family

- **Status:** Proposed
- **Provenance:** loop
- **Date:** 2026-08-09
- **Issue:** FAFF-705

## Context

FAFF-705 lifts the FAFF-422/ADR-0054 blanket refusal of a non-`inherit` `effort.<lane>` on an engine-valued lane, so a GPT/Codex subscription-seat lane can pick reasoning effort (`low|medium|high|xhigh|max`), not just toggle `reasoning_off`. But not every engine transport carries a graded reasoning-effort dial: the openai-compatible `reasoning_effort` request field and codex exec's `-c model_reasoning_effort` do; ollama's wire format carries only the on/off `think:false`. The lift therefore needs a single, authoritative answer to "can this engine carry graded effort?" — and there are two ways to declare it: a new per-backend field an operator sets (FAFF-593 floated one, mirroring `reasoning_off`), or a property derived from the provider family that `ENGINE_PROVIDER_FAMILY` already assigns.

## Decision

Graded-effort capability is DERIVED from the transport family, not a hand-set per-backend flag. A single constant `EFFORT_GRADED_FAMILIES = { openai, codex }` sits beside `ENGINE_PROVIDER_FAMILY` in `config.js` and is keyed off the same family strings that map already assigns. `resolveEngineForLane` consults it as the sole capability source: a graded `effort.<lane>` on a graded-effort family is carried on the resolved record; a graded effort on a non-graded family (ollama) is refused at resolve with a capability-specific message naming the missing transport and the remedy (`reasoning_off`, or point the lane at a graded-effort engine). No new field is added to the Backend record.

## Consequences

- Effort-tunability of an engine lane can never drift out of sync with its transport: adding a provider to `ENGINE_PROVIDER_FAMILY` under an existing family inherits that family's graded-effort capability automatically, with no second place to update and no way for an operator to mis-set it.
- A future transport family that needs a per-engine effort cap BELOW its family default (a genuine per-backend nuance the family constant can't express) is the one case that would justify reopening this — the extension point is a `BACKEND_RECORD_KEYS` field, explicitly deferred here (FAFF-593's speculative field, rejected until a concrete need exists).
- This amends ADR-0054's consequence that "Agent-tool knobs (`effort.<lane>`) are refused on engine-valued lanes": the refusal is now capability-gated by family, not blanket. Paired with ADR-0099 (effort maps at dispatch, never forks the vocabulary).
