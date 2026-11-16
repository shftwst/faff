signal: fail

## Findings

### Spec fidelity: Equality accepted by belowLimit
At src/function.mjs:1, <= returns true for belowLimit(5,5), contrary to the chosen strict comparison. Replace <= with <.

### AC coverage: Equality rejection lacks a test
At test/function.test.mjs:3, tests exercise only unequal inputs. Add an assertion that belowLimit(5,5) is false. The caller's passing tests do not establish this AC.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Equality accepted by belowLimit","location":"src/function.mjs:1","action":"Replace <= with <.","location_present":true,"action_present":true,"source":"standard"},{"title":"Equality rejection lacks a test","location":"test/function.test.mjs:3","action":"Assert that belowLimit(5,5) returns false.","location_present":true,"action_present":true,"source":"standard"}]}
```