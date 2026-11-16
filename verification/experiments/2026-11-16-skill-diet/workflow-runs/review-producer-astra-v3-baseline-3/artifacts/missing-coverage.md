signal: fail

## Findings

### AC coverage: Missing mixed-case test for lower
At test/function.test.mjs:3, only uppercase input is exercised. AC2 explicitly requires an automated mixed-case test, and the checklist confirms it is unverified. Add assert.equal(lower('AbC'),'abc'). The implementation otherwise matches the string-only, non-null contract.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Missing mixed-case test for lower","location":"test/function.test.mjs:3","action":"Add an automated assertion that lower('AbC') returns 'abc'.","location_present":true,"action_present":true,"severity":"major","source":"standard"}]}
```