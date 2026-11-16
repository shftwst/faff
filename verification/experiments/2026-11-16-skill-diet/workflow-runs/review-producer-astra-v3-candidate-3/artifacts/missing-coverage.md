signal: fail

## Findings

### AC coverage: lower mixed-case test is missing

test/function.test.mjs:3 covers uppercase only. AC2 explicitly requires automated mixed-case coverage and is unverified in the checklist. Add assert.equal(lower('AbC'),'abc'). The implementation otherwise matches the non-null string specification.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"lower mixed-case test is missing","location":"test/function.test.mjs:3","action":"Add assert.equal(lower('AbC'),'abc') to cover AC2.","location_present":true,"action_present":true,"source":"standard"}]}
```