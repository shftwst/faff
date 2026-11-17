# Validate import row limits

This spec addresses SPEC-4: reject import arrays above 1000 rows without importing or mutating their contents. It is for the build agent and human reviewers.

## WHY

Check array length before any import work. `validateImport` currently accepts every input, so arrays above the required limit pass validation. Enforcing the limit prevents excessive work while preserving the existing caller interface.

**Side effects:** Validation MUST NOT import or mutate rows.

**Reference context:** `src/validate-import.ts` is TypeScript; `validateImport(rows)` currently returns `{ valid: true }`. Callers accept `{valid:boolean,error?:string}`. This change stays within that validation function.

## OUT OF SCOPE

- **Latency dashboard:** Reporting is unrelated to enforcing the limit. Future dashboard work would extend `src/metrics.ts`. The Latency dashboard design decision is deferred as Punt (non-blocking) under Open Questions and does not affect row-limit enforcement.

## WHAT

```
RECORD ValidationResult:
  valid: Boolean
  error: optional String

INTERFACE validateImport:
  input: rows, an array inspected without mutation
  output: ValidationResult
```

Accept arrays with at most 1000 rows, including an empty array. Reject arrays with more than 1000 rows with `valid` false and `error` equal to `row-limit`. Preserve the existing return shape; accepted arrays retain the current `{valid:true}` response. Validation does not import or mutate rows.

## HOW

Inspect length before any import work, and return the validation result without changing the input.

```
PROCEDURE validateImport(rows):
  1. IF length(rows) > 1000:
     Return RECORD { valid: false, error: 'row-limit' }.
  2. OTHERWISE:
     Return RECORD { valid: true }.
  3. Do not import rows or mutate the array or its rows on either path.
```

**Anti-pattern:** Import or truncate rows to enforce the limit. Why: Validation must have no import or mutation side effects.

## Scenarios

```
Given an array containing exactly 1000 rows
When validateImport is called
Then it returns valid true
And the array and its rows remain unchanged
And no rows are imported
```

```
Given an array containing 1001 rows
When validateImport is called
Then it returns valid false and error row-limit
And the array and its rows remain unchanged
And no rows are imported
```

## DESIGN DECISION RATIONALE

**When should the row limit be checked?**

- **Before import:** Rejects excessive work without side effects.
- **During or after import:** Allows import side effects before validation completes.

**Chosen:** Validate length before any import to reject excessive work without side effects.

**When should dashboard design be settled?**

Dashboard design is unrelated to enforcing array length. Defer it to product rather than coupling reporting design to this validation change; the Punt is collected below.

## OPEN QUESTIONS AND ASSUMPTIONS

### Open Questions

**Punt:** Latency dashboard (non-blocking). Dashboard design is deferred under OUT OF SCOPE, with extension point `src/metrics.ts`; it does not affect row-limit enforcement (decides: product).

The supplied completed Punt scan reports one eligible non-blocking Punt and zero blocking open Punts. Exclude the eligible dashboard Punt from the confidence count.

### Assumptions

No external assumptions are declared.

## DONE

### From WHY and WHAT

- [ ] Arrays with 0 through 1000 rows return `{valid:true}`.
- [ ] Arrays with more than 1000 rows return `{valid:false,error:'row-limit'}`.
- [ ] Results preserve the existing `{valid:boolean,error?:string}` return shape.

### From HOW

- [ ] Both acceptance and rejection paths leave the array and its rows unchanged and perform no import work.

### Integration smoke test

```
PROCEDURE smoke_check_row_limit:
  1. Create arrays of 1000 and 1001 rows and capture their original contents.
  2. Call validateImport on each array.
  3. Assert the first result is { valid: true }.
  4. Assert the second result is { valid: false, error: 'row-limit' }.
  5. Assert both inputs are unchanged and no import work occurred.
```

## Review record

The supplied inherited review is complete: 0 blocker, 0 major, 0 minor findings. All supplied facts were checked; no changes beyond the snapshot are authorised. No fixes or dismissals are required. The eligible non-blocking Latency dashboard Punt remains deferred as supplied.

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"punt"}]}
```