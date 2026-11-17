signal: fail

## Findings

### AC coverage: Mixed-case conversion untested
At test/function.test.mjs:3, only uppercase input is tested. AC2 explicitly requires an automated mixed-case test and remains unverified in the checklist. Add an assertion such as lower('AbC') === 'abc'. The implementation matches the string-only, non-null spec; no null guard is required.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Mixed-case conversion untested","location":"test/function.test.mjs:3","action":"Add an automated assertion that lower('AbC') returns 'abc'.","location_present":true,"action_present":true,"source":"standard"}]}
```