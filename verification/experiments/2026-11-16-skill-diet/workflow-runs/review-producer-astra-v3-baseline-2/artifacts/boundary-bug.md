signal: fail

## Findings

### Spec fidelity: Equality accepted by belowLimit
At src/function.mjs:1, <= returns true for belowLimit(5,5), contrary to the chosen strict comparison. Replace <= with <.

### AC coverage: Equality rejection untested
At test/function.test.mjs:4, the tests cover only values below and above the limit. Add an assertion that belowLimit(5,5) is false to cover the explicit equality AC. The supplied passing result does not verify that boundary.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Equality accepted by belowLimit","location":"src/function.mjs:1","action":"Replace <= with <.","location_present":true,"action_present":true,"source":"standard"},{"title":"Equality rejection untested","location":"test/function.test.mjs:4","action":"Add an assertion that belowLimit(5,5) returns false.","location_present":true,"action_present":true,"source":"standard"}]}
```