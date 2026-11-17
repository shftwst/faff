signal: fail

## Findings

### AC coverage: Mixed-case conversion untested in lower

test/function.test.mjs:3 covers uppercase input only. AC2 explicitly requires automated coverage for mixed-case input, and the checklist confirms it is unverified. Add an assertion that lower('AbC') equals 'abc'. The implementation otherwise matches the string-only, non-null spec.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Mixed-case conversion untested in lower","location":"test/function.test.mjs:3","action":"Add an assertion that lower('AbC') equals 'abc'.","location_present":true,"action_present":true,"source":"standard"}]}
```