# SPEC-2: Bound import retries

> Spec: faffter-dark-nlspec · 2026-11-16 · interactive · claude-code/unknown · faff 0.45.0 · confidence: high. Full spec on Linear SPEC-2.

This spec addresses SPEC-2 for the build agent and human reviewers.

## 1. WHY
A three-attempt loop bounds transient retries while preserving the caller contract. A transient failure currently ends the import. Retry it without changing the successful value or terminal error.

Reference context:

| System | Language | Relevance |
|---|---|---|
| src/import.ts | TypeScript | Existing interface or implementation used by this change |
| src/errors.ts | TypeScript | Existing interface or implementation used by this change |
| src/logger.ts | TypeScript | Existing interface or implementation used by this change |

## 2. OUT OF SCOPE
- Backoff: excluded because no timing policy was requested; extend src/import.ts retry loop.
- New job runner: excluded because existing ownership is retained; extend src/runner.ts separately.

## 3. WHAT
RECORD ImportError:
  transient: boolean, not modified by runImport. runImport(payload) returns the import value or original terminal error. The attempt counter is mutable, starts at 1 and cannot exceed 3.

## 4. HOW
PROCEDURE runImport(payload):
  1. FOR attempt FROM 1 TO 3:
     a. Call importOnce(payload); on success return its value.
     b. On ImportError with transient true and attempt <3, log attempt number only and continue immediately.
     c. Otherwise return the original error.
  2. Never log payload. No backoff or new runner. The repository test file test/import-retry.test.ts must cover these retry paths.

## Scenarios
```
Given importOnce succeeds immediately
When runImport executes
Then it returns the original successful value after one attempt
```
```
Given importOnce fails transiently once then succeeds
When runImport executes
Then it returns the successful value after two attempts
```
```holdout
Given importOnce fails transiently three times
When runImport executes
Then it returns the third original error and makes no fourth attempt
```
- Logs MUST NOT contain payloads.

## 6. DESIGN DECISION RATIONALE
**Retry wrapper or new runner?** A wrapper preserves ownership; a new runner expands scope. **Chosen:** bound retries in existing runImport.

## 7. OPEN QUESTIONS AND ASSUMPTIONS
No open questions or external assumptions.

## 8. DONE
### From WHY / WHAT / HOW
- [ ] runImport MUST make at most 3 attempts including the first.
- [ ] Success MUST return its original value.
- [ ] Only transient ImportError MUST be retried; permanent errors and third transient errors MUST return the original error.
- [ ] Retry logs MUST contain attempt number only, never payload.
- [ ] Transient retries MUST run immediately without backoff.
- [ ] The existing job runner MUST be retained.
- [ ] test/import-retry.test.ts MUST pass.

Integration smoke test: run a transient failure followed by success and check two attempts and the original value.

## Review record
Supplied completed review: no blocker, major or minor findings. No resolution changes or dismissed findings.

confidence: high
build-tier: standard
admissibility: admissible

```faff-contract:spec-readiness
{"confidence": "high", "decisions": [{"marker": "chosen"}]}
```
