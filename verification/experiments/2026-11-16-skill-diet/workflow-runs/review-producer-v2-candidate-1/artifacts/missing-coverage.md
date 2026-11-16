signal: fail

## Findings

### ac-coverage: Missing mixed-case test for lower

The spec requires automated tests for both ACs. test/function.test.mjs tests only uppercase input (`lower('ABC')`); AC2, mixed-case input, has no test, and the checklist shows it neither auto-verified nor flagged for human verification. Add a mixed-case assertion such as `assert.equal(lower('aBc'), 'abc')`.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Missing mixed-case test for lower","location":"test/function.test.mjs","action":"Add assert.equal(lower('aBc'), 'abc') to cover AC2.","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"}]}
```