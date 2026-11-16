signal: fail

## Findings

### AC coverage: Mixed-case conversion lacks a test
At test/function.test.mjs:3, only uppercase conversion is tested. AC2 explicitly requires automated mixed-case coverage and the checklist confirms it is unverified. Add an assertion that lower('AbC') returns 'abc'. The implementation otherwise matches the string-only, non-null spec.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Mixed-case conversion lacks a test","location":"test/function.test.mjs:3","action":"Add an assertion that lower('AbC') returns 'abc'.","location_present":true,"action_present":true,"source":"standard"}]}
```