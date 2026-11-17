# Discovery brief: Import retries and operator notification

mode: single-item

## Goal
Retry transient import failures and notify operators after retries are exhausted.

## Item
intent: Retry transient import failures and notify operators after exhaustion.
done-signal: A transient failure retries; exhausted retries produce an operator notification.
area: Data imports.
split-sense: possibly-splittable (retry execution and operator notification can be developed independently; methodology decides whether to split).

## Constraints
- Use the existing job runner.

## Out of scope
- Replacing the job runner.

## Open questions
- Methodology should decide whether retry execution and operator notification should be split.
