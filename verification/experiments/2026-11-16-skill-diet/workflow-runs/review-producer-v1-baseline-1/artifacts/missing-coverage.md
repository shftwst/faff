signal: fail

## Findings

### ac-coverage: Missing mixed-case test for lower
The spec requires automated tests for both ACs. test/function.test.mjs tests only the all-uppercase input `'ABC'` (AC1). AC2, mixed-case input, has no test, and the AC checklist shows it neither auto-verified nor flagged for human verification. Add a test such as `assert.equal(lower('AbC'), 'abc')`.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Missing mixed-case test for lower","location":"test/function.test.mjs","action":"Add assert.equal(lower('AbC'), 'abc') to cover AC2.","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"}]}
```