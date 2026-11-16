signal: fail

## Findings

### Spec fidelity: belowLimit accepts equality

src/function.mjs:1 uses <=, so belowLimit(5,5) returns true although the chosen strict comparison rejects equality. Replace <= with <.

### AC coverage: belowLimit equality test missing

test/function.test.mjs:3 tests only unequal inputs, leaving the explicit equality AC unchecked despite the checklist claim. Add an assertion that belowLimit(5,5) is false. The supplied passing run does not cover this boundary.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"belowLimit accepts equality","location":"src/function.mjs:1","action":"Replace <= with <.","location_present":true,"action_present":true,"source":"standard"},{"title":"belowLimit equality test missing","location":"test/function.test.mjs:3","action":"Add an assertion that belowLimit(5,5) is false.","location_present":true,"action_present":true,"source":"standard"}]}
```