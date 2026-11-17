signal: fail

## Findings

### Spec fidelity: Equality accepted by belowLimit

src/function.mjs:1 uses <=, so belowLimit(5,5) returns true despite the strict comparison requirement. Replace <= with <.

### AC coverage: Equality rejection lacks a test

test/function.test.mjs:4 ends without testing equality. Add an assertion that belowLimit(5,5) returns false; the supplied passing tests do not verify this AC.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Equality accepted by belowLimit","location":"src/function.mjs:1","action":"Replace <= with <.","location_present":true,"action_present":true,"source":"standard"},{"title":"Equality rejection lacks a test","location":"test/function.test.mjs:4","action":"Add an assertion that belowLimit(5,5) returns false.","location_present":true,"action_present":true,"source":"standard"}]}
```