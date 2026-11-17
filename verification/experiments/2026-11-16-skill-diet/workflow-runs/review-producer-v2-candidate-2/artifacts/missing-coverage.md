signal: fail

## Findings

### ac-coverage: no automated test for mixed-case input

The spec requires automated tests for both ACs. test/function.test.mjs covers only AC1 (`lower('ABC')`). AC2 (mixed-case converts to lowercase) has no test, and the Step-8 checklist marks it neither auto-verified nor flagged for human verification. AC2 is testable, so the gap is a fail. The implementation in src/function.mjs is otherwise correct. Fix: add a mixed-case assertion such as `assert.equal(lower('AbC'), 'abc');`.

```faff-contract:review-verdict
{"signal": "fail", "findings": [{"title": "Missing mixed-case test for lower", "location": "test/function.test.mjs", "action": "Add assert.equal(lower('AbC'), 'abc') to cover AC2.", "location_present": true, "action_present": true, "severity": "major", "disposition": "open", "source": "standard"}]}
```