signal: fail

## Findings

### spec-fidelity: Non-strict comparison in belowLimit
src/function.mjs:1 uses value <= limit, but the spec chooses a strict value < limit and the AC says equality is rejected. belowLimit(5,5) returns true. Change the comparison to value < limit.

### ac-coverage: Missing equality test for belowLimit
test/function.test.mjs covers below and above the limit but not equality, so the AC "equality is rejected" has no automated test and the boundary defect passed. Add assert.equal(belowLimit(5,5), false).

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Non-strict comparison in belowLimit","location":"src/function.mjs:1","action":"Change value <= limit to value < limit.","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"},{"title":"Missing equality test for belowLimit","location":"test/function.test.mjs","action":"Add assert.equal(belowLimit(5,5), false).","location_present":true,"action_present":true,"severity":"minor","disposition":"open","source":"standard"}]}
```