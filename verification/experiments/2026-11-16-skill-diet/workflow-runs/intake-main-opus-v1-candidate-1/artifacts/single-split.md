# Discovery brief: Import retries and exhaustion notice

mode: single-item

## Goal
Retry imports that fail for transient reasons, and notify operators when the retries run out.

## Item
intent: Retry transient import failures and notify operators once retries are exhausted.
done-signal: A transient failure is retried; exhausted retries produce an operator notification.
area: Data imports
split-sense: possibly-splittable (retry execution; operator notification). The two can be developed independently.

## Constraints
- Use the existing job runner.

## Out of scope
- Replacing the job runner.

## Open questions
- Whether to split retry execution and operator notification into separate pieces of work is left to the methodology.
