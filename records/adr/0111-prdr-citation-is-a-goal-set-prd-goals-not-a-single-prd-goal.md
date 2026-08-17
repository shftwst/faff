# ADR 0111 — PRDR citation is a goal set (PRD-goals), not a single PRD-goal

- **Status:** Accepted
- **Provenance:** loop
- **Date:** 2026-08-16
- **Issue:** FAFF-815

## Context

The two-phase YAGNI gate arbitrates one PRDR against three goal sets that must stay
distinct: the PRD's declared goals D, the goals the PRDR cites C, and the goals its DoD
actually covers V. The record carried C as a single `PRD-goal:` string, so the arbitration
collapsed C to one value and never saw V. A functional-MVP PRDR that discharges several
declared goals but names one is then indistinguishable from gold-plating, and the coverage
verdict — which reads the cited field — cannot flip `covered:true`. A one-string citation
cannot represent the set a correctly-scoped MVP legitimately serves.

## Decision

Citation is a set. The record field becomes `PRD-goals:`, a comma-separated list parsed into
`prd_goals[]` (trimmed, empties dropped). `listPrdrs` falls back to a legacy `PRD-goal:` line
when `PRD-goals:` is absent, and retains `prd_goal = prd_goals[0]` as the primary for
single-goal consumers (distance, list). The `adrField` parser is colon-anchored, so
`PRD-goal` never matches a `PRD-goals:` line and the legacy and new fields coexist with no
data migration. Coverage forms its cited set as the union of every live PRDR's `prd_goals`.

## Consequences

Every PRDR record consumer — template, parser, `prdrValidate`, coverage, trace — reads the
set. The retained `prd_goal` primary keeps distance and single-goal callers byte-identical.
Existing single-`PRD-goal:` records parse as a one-element set and validate, cover, and admit
exactly as before. Writing the widened cited set back into a record on the under-citation
admit path is deferred (a second field-writer alongside `prdrAccept` is out of scope); the
normal path has the author cite the full covered set up front.
