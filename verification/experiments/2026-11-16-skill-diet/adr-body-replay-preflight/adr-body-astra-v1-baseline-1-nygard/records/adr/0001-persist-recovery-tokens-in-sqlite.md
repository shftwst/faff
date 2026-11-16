# ADR 0001 — Persist recovery tokens in SQLite

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-11-16
- **Issue:** ADRWORK-1

## Context

The local recovery service needs token state to survive a restart and already uses SQLite.

## Decision

Use the existing SQLite database for recovery tokens so acknowledgements follow persisted rows.

## Consequences

Later recovery work must use the token rows. Restart behaviour is verified; multi-host operation and throughput remain unverified.

Self-review: The consequences match the supplied implementation evidence; no unverified behaviour is claimed.

confidence: high
