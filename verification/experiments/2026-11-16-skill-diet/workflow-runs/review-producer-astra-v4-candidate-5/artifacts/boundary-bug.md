signal: fail

## Findings

### Spec fidelity: Equality accepted by belowLimit

src/function.mjs:1 uses <=, so belowLimit(5,5) returns true despite the strict comparison requirement. Replace <= with <.

### AC coverage: Missing equality test for belowLimit

test/function.test.mjs:3 tests only unequal inputs. Add an assertion that belowLimit(5,5) is false to cover the explicit equality AC. Passing caller tests do not verify that boundary.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Equality accepted by belowLimit","location":"src/function.mjs:1","action":"Replace <= with <.","location_present":true,"action_present":true,"source":"standard"},{"title":"Missing equality test for belowLimit","location":"test/function.test.mjs:3","action":"Add an assertion that belowLimit(5,5) is false.","location_present":true,"action_present":true,"source":"standard"}]}
```