# ADR 0093 — Deterministic scope decision in front of an LLM gate

- **Status:** Accepted
- **Provenance:** human
- **Date:** 2026-08-02
- **Issue:** FAFF-710

## Context

faff runs an always-on slot-conformance gate on configured slot occupants (gateway → _Slot conformance validation_). It has two halves: a deterministic structural lint (`faff validate-adapters`, CI) and a semantic Validate — an LLM reading the occupant's prose against the fixed contract. The gate scoped *which* occupants reached the semantic half by a prose rule: "the configured occupant differs from the slot's default name."

That scope decision — "does this occupant need the LLM check at all?" — is itself a judgement made by an LLM reading prose, and it is a pure function of its inputs (the occupant name, the slot, and the set of skills faff ships). Because the deciding step was non-deterministic, the same repo with the same config reached different verdicts under different harnesses (FAFF-710: a `/faff-prep` refused under Codex, passed under Claude Code) — the divergence came from a non-deterministic gate firing where a mechanical classification should have decided. The CLI half already had the right classification (`REGISTRY` membership in `validate-adapters.js`); the runtime half consulted no code.

## Decision

A decision that scopes whether an LLM gate runs — when it is a pure function of its inputs — belongs in a deterministic tool, not in the LLM's own prose reading. The gate's scope decision must be the exit code of a tool, so it is identical across harnesses by construction; the LLM gate then runs only on the occupants the tool classified as needing it.

Applied to slot-conformance (FAFF-710): the runtime gate consults `faff validate-adapters --is-bundled <occupant> --slot <slot>` — a pure `REGISTRY`/`SLOT_TYPES` membership check — before deciding whether to invoke the semantic Validate. Exit 0 (a bundled first-party skill in a slot it is registered for) skips the LLM; exit 1 (foreign, or a bundled skill in the wrong slot) runs it; the predicate reuses `REGISTRY` as the single source of truth rather than a parallel list. The semantic Validate itself stays LLM-driven — judging a genuinely foreign skill's prose against the contract needs understanding — but only for occupants the deterministic scope decision routed to it.

## Consequences

- The scope decision in front of this gate no longer diverges by harness — it is a tool's exit code, satisfying faff's "same input, same output ⇒ a tool" tenet.
- The pattern generalises: any future gate whose "should this run?" decision is a pure function of its inputs should express that decision as a deterministic tool, keeping the LLM for the judgement that genuinely needs taste. New LLM gates should not re-introduce a prose scope rule where a mechanical classification is available.
- `REGISTRY` becomes load-bearing for the runtime gate as well as the CLI lint; the two halves now share one classification, and a new bundled skill must be registered in the single `REGISTRY` (already enforced by the CI structural lint) to be exempted at runtime.
- The fail-safe direction is fixed: any classification uncertainty (predicate unresolvable, name not found) routes to *validate*, never to *exempt* — the tool narrows the gate's scope, it never disables it.
