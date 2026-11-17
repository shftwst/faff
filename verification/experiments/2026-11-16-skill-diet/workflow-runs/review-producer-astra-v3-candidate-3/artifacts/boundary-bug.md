signal: fail

## Findings

### Spec fidelity: belowLimit accepts equality

src/function.mjs:1 uses <=, so belowLimit(5,5) returns true despite the strict comparison requirement. Replace <= with <.

### AC coverage: belowLimit equality test is missing

test/function.test.mjs tests only values below and above the limit. Add an assertion that belowLimit(5,5) is false to verify the explicit equality AC. The supplied passing result does not establish that AC.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"belowLimit accepts equality","location":"src/function.mjs:1","action":"Replace <= with <.","location_present":true,"action_present":true,"source":"standard"},{"title":"belowLimit equality test is missing","location":"test/function.test.mjs","action":"Add an assertion that belowLimit(5,5) is false.","location_present":true,"action_present":true,"source":"standard"}]}
```