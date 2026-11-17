signal: fail

## Findings

### AC coverage: no automated test for mixed-case input
The spec requires automated tests for both ACs. test/function.test.mjs covers AC1 (`lower('ABC')`) only; AC2, mixed-case input, has no test, and the Step-8 checklist marks it neither auto-verified nor needing human verification. The implementation in src/function.mjs looks correct, but the AC is untested. Add a case such as `assert.equal(lower('AbC'), 'abc');`.

```faff-contract:review-verdict
{ "signal": "fail",
  "findings": [
    { "title": "Missing mixed-case test for lower", "location": "test/function.test.mjs", "action": "Add assert.equal(lower('AbC'), 'abc') to cover AC2.", "location_present": true, "action_present": true, "severity": "major", "source": "standard" }
  ] }
```