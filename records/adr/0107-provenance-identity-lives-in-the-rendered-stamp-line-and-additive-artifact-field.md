# ADR 0107 — Provenance identity lives in the rendered stamp line and additive artifact fields, never the closed spec-readiness contract JSON

- **Status:** Proposed
- **Provenance:** loop
- **Date:** 2026-08-11
- **Issue:** FAFF-703

## Context

FAFF-703 (see ADR 0106) adds a `{harness, model}` identity to faff's durable artifacts. One of those artifacts, the spec provenance stamp, sits directly beside the `faff-contract:spec-readiness` JSON block that `faff-prep` emits and `computeSpecReadiness` validates under a closed schema (`additionalProperties:false`, a fixed required-field set). It would be easy to fold the new identity fields into that same JSON block since the writer is already touching that neighbourhood.

## Decision

Harness/model identity is written only to the rendered provenance stamp line (prose) and to additive, schema-open artifacts (`.faff/prep/<ISSUE>.json`, the run-ledger `owner` block, `merge-record.json`) — **never** into the `faff-contract:spec-readiness` JSON. Nothing in the spec-readiness gate branches on harness or model; it is provenance metadata, not a gate input. Extending the closed contract would force a four-file lockstep (schema + `computeSpecReadiness` + `CONTRACT_DESCRIBES` + selftest fixtures) for a field the gate never reads.

## Consequences

- `faff-contract:spec-readiness`'s schema, compute function, describe table, and selftest fixtures stay untouched by this and all future provenance work — the contract selftest is byte-identical before/after.
- Every future provenance field (harness-version, sandbox identity, etc.) follows this same boundary: stamp line + additive artifacts, never the closed gate JSON. A later change that wants to *gate* on provenance must argue for it explicitly rather than piggy-backing on this precedent.
- The stamp line's format is fixed in the gateway (`faff/SKILL.md`), so any future stamp extension is a prose lockstep across the gateway + `faff-prep`, not a schema migration.
