signal: fail

## Findings

### AC coverage: Missing mixed-case test for lower

test/function.test.mjs:3 tests uppercase input only. AC2 explicitly requires an automated mixed-case test, and the checklist confirms it is unverified. Add an assertion that lower('AbC') returns 'abc'. The implementation otherwise matches the strings-only, non-null spec.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Missing mixed-case test for lower","location":"test/function.test.mjs:3","action":"Add an assertion that lower('AbC') returns 'abc'.","location_present":true,"action_present":true,"source":"standard"}]}
```