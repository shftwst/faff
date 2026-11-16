signal: fail

## Findings

### AC coverage: lower mixed-case test missing

test/function.test.mjs:3 covers uppercase only. AC2 explicitly requires automated mixed-case coverage, and the checklist confirms it is unverified. Add an assertion that lower('AbC') returns 'abc'. The implementation matches the string-only, non-null spec; the supplied passing test run does not satisfy AC2.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"lower mixed-case test missing","location":"test/function.test.mjs:3","action":"Add an assertion that lower('AbC') returns 'abc'.","location_present":true,"action_present":true,"source":"standard"}]}
```