# ADR 0106 — Interim harness+model identity resolver as the thin first seam

- **Status:** Proposed
- **Provenance:** loop
- **Date:** 2026-08-11
- **Issue:** FAFF-703

## Context

Faff records *who* produced a spec (producer skill) and *how* (interactive/autonomous mode), but never *which harness and model* stood behind the work. That gap is invisible on a single-harness history, but the moment work is produced under Codex, Fable, or any other driver there is no standing marker to answer "which harness/model produced this spec/build/merge?" — exactly what retrospective learning and cross-harness QA need.

The natural home for a uniform `{harness, model}` identity is the FAFF-483 harness-abstraction interface. FAFF-483 is Todo with zero code; its own blocking spike (FAFF-482) only just landed. Hard-depending on it defers all attribution value behind an unscoped dependency, with no committed date.

## Decision

Ship a minimal interim resolver, `faff harness identify [--json]`, as the thin first identity seam rather than waiting on FAFF-483. It returns `{harness, model, source}` deterministically and fail-quiet (harness resolves from config → env signal → the `CURRENT_HARNESS` default, which FAFF-483 already promoted from `backends.js` into `harness.js`; model resolves from an in-flight engine-dispatch context → an explicit declaration → the literal `"unknown"`). Every artifact writer (prep marker, run-ledger, merge-record, provenance stamp) calls this one resolver rather than re-deriving identity itself.

The resolver's output shape is deliberately the interface FAFF-483 later implements behind: formalisation becomes a re-home of this function's internals, not a rewrite of its callers.

## Consequences

- Faff gets harness attribution now, model attribution best-effort now, without waiting on FAFF-483.
- FAFF-483, when it lands, absorbs `resolveHarnessIdentity()`'s implementation and inherits its callers unchanged — the `{harness, model, source}` contract is the seam it must preserve.
- The harness-declares-model requirement (should a non-`unknown` model be mandatory?) is explicitly *not* settled here — it stays open, owned by FAFF-483's later interface decision.
- A future harness adds itself by extending the resolver's env-signal branch and `HARNESS_IDS`, not by inventing a parallel identity path.
