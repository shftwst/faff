signal: fail

## Findings

### ac-coverage: Missing mixed-case test for lower
The spec requires automated tests for both ACs. test/function.test.mjs covers AC1 (uppercase) only; AC2 (mixed-case converts to lowercase) has no test, and the AC checklist shows it as neither auto-verified nor flagged for human verification. Add an assertion such as `assert.equal(lower('AbC'),'abc');`. The implementation in src/function.mjs is correct.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Missing mixed-case test for lower","location":"test/function.test.mjs","action":"Add an assertion that lower('AbC') returns 'abc'.","location_present":true,"action_present":true,"severity":"minor","disposition":"open","source":"standard"}]}
```