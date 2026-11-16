signal: fail

## Findings

### Spec fidelity: belowLimit accepts equality

src/function.mjs:1 uses <=, so belowLimit(5,5) returns true despite the strict comparison required by the spec. Replace <= with <.

### AC coverage: belowLimit equality test missing

test/function.test.mjs:3 tests only values below and above the limit. Add an assertion that belowLimit(5,5) is false to cover the explicit equality AC. The caller's passing tests do not verify this boundary.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"belowLimit accepts equality","location":"src/function.mjs:1","action":"Replace <= with <.","location_present":true,"action_present":true,"source":"standard"},{"title":"belowLimit equality test missing","location":"test/function.test.mjs:3","action":"Add an assertion that belowLimit(5,5) is false.","location_present":true,"action_present":true,"source":"standard"}]}
```