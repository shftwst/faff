signal: fail

## Findings

### ac-coverage: Missing mixed-case test for lower
test/function.test.mjs tests only the uppercase input 'ABC'. AC2 (mixed-case converts to lowercase) is testable and the spec requires an automated test for it, but none exists and the checklist marks it neither auto-verified nor human-verified. Add a case such as assert.equal(lower('AbC'), 'abc').

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Missing mixed-case test for lower","location":"test/function.test.mjs","action":"Add assert.equal(lower('AbC'), 'abc') to cover AC2.","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"}]}
```