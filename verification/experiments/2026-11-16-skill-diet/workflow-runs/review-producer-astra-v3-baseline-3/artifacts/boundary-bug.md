signal: fail

## Findings

### Spec fidelity: Equality accepted by belowLimit
At src/function.mjs:1, <= returns true for belowLimit(5,5), contrary to the chosen strict comparison. Replace <= with <.

### AC coverage: Missing equality assertion
At test/function.test.mjs:4, tests cover values below and above the limit but omit the explicit equality AC. Add an assertion that belowLimit(5,5) is false. The supplied passing run does not verify this boundary.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Equality accepted by belowLimit","location":"src/function.mjs:1","action":"Replace <= with <.","location_present":true,"action_present":true,"severity":"major","source":"standard"},{"title":"Missing equality assertion","location":"test/function.test.mjs:4","action":"Assert that belowLimit(5,5) is false.","location_present":true,"action_present":true,"severity":"major","source":"standard"}]}
```