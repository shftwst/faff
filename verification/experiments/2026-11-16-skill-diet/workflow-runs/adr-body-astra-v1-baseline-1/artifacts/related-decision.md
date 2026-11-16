## Context

ADR-0041, Use transient retry records, accepted on 2026-10-20, chose transient records that lose attempt history after restart. Retry history must now survive restart. This records ADRWORK-1, Use a durable retry ledger.

## Decision

Keep retry attempts in the existing durable database to preserve attempt history across restart. This replaces the transient-record choice described in ADR-0041, Use transient retry records.

## Consequences

- Retry persistence depends on the existing durable database.
- The retry count and next-attempt time survive the tested restart.
- ADR-0041 still has Accepted status in the supplied log. Recording the supersession relationship and any status change remains with the caller; neither has been changed here.

---

Self-review: The consequences match the tested persistence of retry count and next-attempt time. The related ADR is identified by its decision subject, and the body distinguishes the replacement decision from unperformed metadata updates.

confidence: high