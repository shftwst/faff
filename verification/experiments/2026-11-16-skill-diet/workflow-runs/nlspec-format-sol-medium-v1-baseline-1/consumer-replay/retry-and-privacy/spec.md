# Bound import retries

> Spec: faffter-dark-nlspec · 2026-11-16 · interactive · claude-code/unknown · faff 0.45.0 · confidence: high. Full spec on Linear SPEC-2.

This spec addresses SPEC-2: bound transient import retries while preserving results, terminal errors and payload privacy. It is for the build agent and human reviewers.

## WHY

`runImport` retries only transient import errors, with a total limit of three attempts. It currently delegates once to `importOnce`; the change adds bounded recovery inside the existing job runner without altering the caller interface.

**Caller compatibility:** Successful values and terminal error objects MUST retain their original identity.

**Reference context:**

- **`src/import.ts`:** TypeScript; `runImport(payload)` currently returns `importOnce(payload)`.
- **`src/errors.ts`:** TypeScript; defines `ImportError` with a Boolean `transient` field.
- **`src/logger.ts`:** TypeScript; provides the existing `log(event, fields)` logger.

The existing job runner continues to call `runImport`.

## OUT OF SCOPE

- **Backoff:** No timing policy is requested. A future policy would extend the retry loop in `src/import.ts`.
- **New job runner:** Retain the existing runner. Future runner changes belong in `src/runner.ts`.

## WHAT

```
INTERFACE runImport:
  input: payload, passed unchanged to importOnce
  success: original successful value
  failure: original terminal error, propagated unchanged

RECORD ImportError EXTENDS Error:
  transient: Boolean, inspected without mutation
```

An attempt is one call to `importOnce`; the initial call is attempt 1. A retry is a subsequent call. Attempt at most three times, retrying only an `ImportError` whose `transient` field is true. Any other error is permanent for this procedure.

Retry log fields MUST contain only the upcoming attempt number, 2 or 3. Logs MUST NOT contain payloads. Use the existing logger without introducing a payload-bearing event or fields.

## HOW

Keep retry ownership inside `runImport` and use the existing job runner. Retries are immediate, with no backoff.

```
PROCEDURE runImport(payload):
  1. FOR attempt FROM 1 THROUGH 3:
     a. Try importOnce(payload).
     b. On success, return the original successful value immediately.
     c. On error:
        i. IF error is not ImportError OR error.transient is not true:
           Propagate the original error immediately.
        ii. IF attempt = 3:
            Propagate the original third error immediately.
        iii. Log the upcoming attempt number only using the existing logger.
        iv. Continue immediately to the next attempt.
```

No call follows a success, permanent error or third transient error. Add repository test coverage in `test/import-retry.test.ts`; passing that file is a separate completion check.

**Anti-pattern:** Wrap or replace terminal errors. Why: The existing caller expects the original error.

## Scenarios

### Immediate success

```
Given importOnce succeeds on its first call with value V
When the existing job runner calls runImport with payload P
Then runImport returns the original value V
And importOnce is called exactly once
And no retry is logged
```

### Transient failure then success

```
Given importOnce first raises ImportError with transient true and then succeeds with value V
When the existing job runner calls runImport with payload P
Then runImport returns the original value V after exactly two calls
And the retry log contains attempt number 2 only
```

### Three transient failures

```holdout
Given the first three importOnce calls raise transient ImportError objects E1, E2 and E3
When the existing job runner calls runImport with payload P
Then runImport propagates the original error E3 after exactly three calls
And no fourth call occurs
And the retry logs contain attempt numbers 2 and 3 only
```

- **Log privacy:** Retry logs MUST NOT contain payloads; retry fields MUST contain only the attempt number.

## DESIGN DECISION RATIONALE

**Where should retries be owned?**

- **Existing `runImport`:** Preserves the caller interface and runner ownership.
- **New runner or timing policy:** Adds mechanisms outside the requested scope.

**Chosen:** Bound retries in the existing `runImport` to preserve the caller interface and runner ownership.

## OPEN QUESTIONS AND ASSUMPTIONS

None. The supplied Punt scan reports zero eligible Punts and zero blocking open Punts.

## DONE

### From WHY and WHAT

- [ ] Success returns the original successful value without further attempts.
- [ ] Permanent errors propagate immediately as the original error object.
- [ ] Only transient `ImportError` instances are retried, with at most three total calls.
- [ ] The third transient failure propagates its original error object and no fourth call occurs.
- [ ] Retry logs contain only attempt numbers and no payloads.

### From HOW

- [ ] The existing runner calls the unchanged `runImport` interface; retries occur immediately without backoff.
- [ ] `test/import-retry.test.ts` passes.

### Integration smoke test

```
PROCEDURE smoke_check_import:
  1. Arrange one transient ImportError followed by success with value V.
  2. Invoke runImport through the existing job runner.
  3. Assert the result is the original V after two importOnce calls.
  4. Assert the retry log contains only attempt number 2 and no payload.
```

## Review record

The supplied inherited review is complete: 0 blocker, 0 major, 0 minor findings. All supplied facts were checked; no changes beyond the snapshot are authorised. No review fixes, dismissals or additional Punts remain.

confidence: high
build-tier: standard
admissibility: admissible — prose scenarios: scenarios:1, scenarios:3, scenarios:5

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"}]}
```