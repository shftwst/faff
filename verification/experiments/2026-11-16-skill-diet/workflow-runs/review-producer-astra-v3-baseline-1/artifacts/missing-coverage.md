signal: fail

## Findings

### AC coverage: Mixed-case conversion lacks a test
At test/function.test.mjs:3, only uppercase input is tested. AC2 explicitly requires automated mixed-case coverage. Add an assertion such as lower('AbC') === 'abc'. The implementation otherwise matches the stated input assumptions.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Mixed-case conversion lacks a test","location":"test/function.test.mjs:3","action":"Add an automated assertion that lower('AbC') returns 'abc'.","location_present":true,"action_present":true,"source":"standard"}]}
```