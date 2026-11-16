signal: fail

## Findings

### ac-coverage: Missing mixed-case test for lower

AC2 (mixed-case input converts to lowercase) is testable and the spec requires an automated test for it, but test/function.test.mjs only asserts `lower('ABC')`. The Step-8 checklist marks AC2 as neither auto-verified nor flagged for human verification. Fix: add an assertion such as `assert.equal(lower('AbC'), 'abc')`.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Missing mixed-case test for lower","location":"test/function.test.mjs","action":"Add an assertion such as assert.equal(lower('AbC'), 'abc').","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"}]}
```