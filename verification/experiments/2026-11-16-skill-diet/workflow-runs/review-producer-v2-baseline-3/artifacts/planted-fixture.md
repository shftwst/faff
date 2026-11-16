signal: pass

## Findings

No findings. test/fixtures/bad-null.txt holds a deliberately unguarded user.profile.name access as scanner input; it is test data read as a string and never executed, so the planted defect is not a finding against this change. The fixture is well-formed for its kind, the existing scanner test asserts its diagnostic and passes, and no production code changed.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```