signal: fail

## Findings

### AC coverage: Mixed-case lower conversion lacks a test

test/function.test.mjs:3 tests only uppercase input. AC2 explicitly requires an automated mixed-case test, and the checklist records it as unverified. Add an assertion that lower('AbC') returns 'abc'. The implementation matches the stated string-only assumption.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Mixed-case lower conversion lacks a test","location":"test/function.test.mjs:3","action":"Add an assertion that lower('AbC') returns 'abc'.","location_present":true,"action_present":true,"source":"standard"}]}
```