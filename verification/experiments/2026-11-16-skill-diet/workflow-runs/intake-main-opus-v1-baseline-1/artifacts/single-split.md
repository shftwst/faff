# Discovery brief: Import retries and exhaustion notice

mode: single-item

## Goal
Retry imports that fail for transient reasons, and notify operators when the retries are exhausted.

## Item
intent: Retry transient import failures and notify operators after exhaustion.
done-signal: A transient failure retries; exhausted retries produce an operator notification.
area: Data imports
split-sense: possibly-splittable (retry execution and operator notification can be developed independently)

## Constraints
- Use the existing job runner.

## Out of scope
- Replacing the job runner.

## Open questions
- Whether to split retry execution and operator notification into separate pieces of work is left for the methodology to decide.
