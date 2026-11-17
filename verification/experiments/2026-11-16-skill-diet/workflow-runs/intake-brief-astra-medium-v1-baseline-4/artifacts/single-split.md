# Discovery brief: Import retries and exhaustion notifications

mode: single-item

## Goal
Retry transient import failures and notify operators when retries are exhausted.

## Item
intent: Retry transient import failures and notify operators after exhaustion.
done-signal: A transient failure retries; exhausted retries produce an operator notification.
area: Data imports
split-sense: possibly-splittable (retry execution and operator notification can be developed independently)

## Constraints
- Use the existing job runner.
- No current priority override is specified.

## Out of scope
- Replacing the job runner.

## Open questions
- The methodology should decide whether retry execution and operator notification should be split.
