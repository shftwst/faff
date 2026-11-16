signal: fail

## Findings

### Spec fidelity: Equality accepted by belowLimit

src/function.mjs:1 uses <=, so belowLimit(5,5) returns true despite the strict comparison requirement. Replace <= with <.

### AC coverage: Equality rejection untested in belowLimit

test/function.test.mjs:3 tests only unequal values. Add an assertion that belowLimit(5,5) is false to cover the explicit equality AC. The caller's passing test result does not verify that boundary.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Equality accepted by belowLimit","location":"src/function.mjs:1","action":"Replace <= with <.","location_present":true,"action_present":true,"source":"standard"},{"title":"Equality rejection untested in belowLimit","location":"test/function.test.mjs:3","action":"Add an assertion that belowLimit(5,5) is false.","location_present":true,"action_present":true,"source":"standard"}]}
```