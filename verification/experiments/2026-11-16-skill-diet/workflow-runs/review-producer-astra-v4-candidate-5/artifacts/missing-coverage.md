signal: fail

## Findings

### AC coverage: Missing mixed-case test for lower

test/function.test.mjs:3 covers uppercase only. AC2 explicitly requires an automated mixed-case test and the checklist confirms it is unverified. Add an assertion that lower('AbC') equals 'abc'. The implementation matches the stated string-only, non-null assumption.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Missing mixed-case test for lower","location":"test/function.test.mjs:3","action":"Add an assertion that lower('AbC') equals 'abc'.","location_present":true,"action_present":true,"source":"standard"}]}
```