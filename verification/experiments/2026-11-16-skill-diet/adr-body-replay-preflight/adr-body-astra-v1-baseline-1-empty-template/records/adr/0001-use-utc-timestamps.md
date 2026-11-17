# ADR 0001 — Use UTC timestamps

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-11-16
- **Issue:** ADRWORK-1

## Context

Exports from two regions need comparable timestamps.

## Decision

Store event timestamps in UTC for a shared convention.

## Consequences

The serializer emits UTC and two conversion tests pass. Retention and scheduling remain unchanged.

Self-review: The consequences match the supplied implementation evidence; no unverified behaviour is claimed.

confidence: high
