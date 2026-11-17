# ADR 0001 — Use a durable retry ledger

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-11-16
- **Issue:** ADRWORK-1

## Context

ADR-0041, Use transient retry records, stores attempt history transiently and loses it after restart.

## Decision

Keep retry attempts in the existing durable database so attempt history survives restart.

## Consequences

The retry count and next-attempt time survive the tested restart. The caller must record any supersession metadata; this body does not change ADR-0041 status.

Self-review: The consequences match the supplied implementation evidence; no unverified behaviour is claimed.

confidence: high
