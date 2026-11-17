# ADR 0001 — Deduplicate webhook jobs

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-11-16
- **Issue:** ADRWORK-1

## Situation

Webhook deliveries may repeat; the existing job table supports a unique key.

## Decision

Use a unique delivery key in the existing job table to prevent duplicate jobs.

## Trade-offs

Delivery-key storage is retained; different-event ordering remains unchanged.

## Follow-up

Keep the duplicate-event regression test. Do not infer ordering guarantees from deduplication.

Self-review: The consequences match the supplied implementation evidence; no unverified behaviour is claimed.

confidence: high
