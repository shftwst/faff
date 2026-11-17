# SPEC-4: Validate import row limits

> Spec: faffter-dark-nlspec · 2026-11-16 · interactive · claude-code/unknown · faff 0.45.0 · confidence: high. Full spec on Linear SPEC-4.

This spec addresses SPEC-4 for the build agent and human reviewers.

## 1. WHY
A length check rejects oversized imports before side effects. Validation currently accepts every array. Limit imports to 1000 rows while preserving the existing result shape.

Reference context:

| System | Language | Relevance |
|---|---|---|
| src/validate-import.ts | TypeScript | Existing interface or implementation used by this change |

## 2. OUT OF SCOPE
- **Latency dashboard**: excluded because reporting does not affect enforcement; extend src/metrics.ts separately.

## 3. WHAT
RECORD ImportValidation:
  valid: boolean, mutable result field.
  error: optional string, mutable result field.
validateImport(rows) returns ImportValidation. Limit:1000 rows.

## 4. HOW
PROCEDURE validateImport(rows):
  1. IF length >1000: return {valid:false,error:"row-limit"}.
  2. ELSE: return {valid:true}.
Do not import or mutate rows.

## Scenarios
```
Given an array of 1000 rows
When validation runs
Then it returns valid true without mutating rows
```
```
Given an array of 1001 rows
When validation runs
Then it returns valid false and error row-limit without importing rows
```

## 6. DESIGN DECISION RATIONALE
**Validate before or during import?** Before avoids side effects; during can partially import. **Chosen:** validate length before any import.

## 7. OPEN QUESTIONS AND ASSUMPTIONS
**Punt:** Latency dashboard (non-blocking) (decides: product). Dashboard design is deferred under OUT OF SCOPE and does not affect row-limit enforcement.

## 8. DONE
### From WHY / WHAT / HOW
- [ ] Arrays with at most 1000 rows MUST return valid true.
- [ ] Larger arrays MUST return valid false and error row-limit.
- [ ] Validation MUST preserve the return shape and MUST NOT mutate or import rows.

Integration smoke test: validate 1000 and 1001 rows and compare results and unchanged inputs.

## Review record
Supplied completed review: no blocker, major or minor findings. No resolution changes or dismissed findings.

confidence: high
build-tier: standard
admissibility: admissible

```faff-contract:spec-readiness
{"confidence": "high", "decisions": [{"marker": "chosen"}, {"marker": "punt"}]}
```
