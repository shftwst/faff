signal: fail

## Findings

### Spec fidelity: Equality accepted by belowLimit
At src/function.mjs:1, <= returns true for belowLimit(5,5), contradicting the chosen strict comparison. Replace <= with <.

### AC coverage: Equality rejection lacks a test
At test/function.test.mjs:3, tests cover only below and above the limit. Add an assertion that belowLimit(5,5) is false. Passing caller tests do not verify the equality AC. No scope or persistent-effect findings.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Equality accepted by belowLimit","location":"src/function.mjs:1","action":"Replace <= with <.","location_present":true,"action_present":true,"severity":"major","source":"standard"},{"title":"Equality rejection lacks a test","location":"test/function.test.mjs:3","action":"Assert that belowLimit(5,5) is false.","location_present":true,"action_present":true,"severity":"major","source":"standard"}]}
```