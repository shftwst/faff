signal: fail

## Findings

### Spec fidelity: Equality accepted by belowLimit

src/function.mjs:1 uses <=, so belowLimit(5,5) returns true despite the strict-limit requirement. Change the comparison to <.

### AC coverage: Missing equality test for belowLimit

test/function.test.mjs:3 tests only values below and above the limit. Add an assertion that belowLimit(5,5) is false. The supplied passing tests do not verify the equality AC.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Equality accepted by belowLimit","location":"src/function.mjs:1","action":"Change the comparison to <.","location_present":true,"action_present":true,"source":"standard"},{"title":"Missing equality test for belowLimit","location":"test/function.test.mjs:3","action":"Add an assertion that belowLimit(5,5) is false.","location_present":true,"action_present":true,"source":"standard"}]}
```