## Situation

The provider may deliver the same event twice. The existing job table supports a unique-key constraint. This records ADRWORK-1, Deduplicate webhook jobs.

## Decision

Use a unique delivery key in the existing job table to deduplicate webhook jobs. Reuse the table's unique-key constraint to prevent a second job for the same delivery key.

## Trade-offs

- The same delivery key is inserted once; a second enqueue is acknowledged without creating another job.
- Deduplication depends on the delivery key and the existing job table.
- Ordering of different events is unchanged.

## Follow-up

Preserve the duplicate-enqueue behaviour in later changes. Any change to ordering of different events requires separate work.

---

Self-review: The supplied duplicate-event test passes and supports the stated single-job behaviour. The body does not claim changes to event ordering. The supplied custom sections are retained in order.

confidence: high