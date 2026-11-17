# Discovery brief: Import retries and operator notification

mode: single-item

## Goal
Retry transient import failures and notify operators when retries are exhausted.

## Item

- intent: Retry transient import failures and notify operators after exhaustion.
- done-signal: A transient failure retries; exhausted retries produce an operator notification.
- area: Data imports; no current priority override.
- split-sense: possibly-splittable (retry execution and operator notification can be developed independently).

## Constraints

- Use the existing job runner.

## Out of scope

- Replacing the job runner.

## Open questions

- The methodology should decide whether to split retry execution and operator notification. No split is prescribed by this brief.
