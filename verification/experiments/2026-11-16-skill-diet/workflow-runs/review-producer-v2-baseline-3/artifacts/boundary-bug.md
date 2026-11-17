signal: fail

## Findings

### spec-fidelity: Non-strict comparison in belowLimit
src/function.mjs:1 returns value <= limit, so belowLimit(5,5) is true. The spec chooses strict value < limit and the AC says equality is rejected. Change the comparison to value < limit.

### ac-coverage: Missing equality test for belowLimit
test/function.test.mjs tests only 4 and 6 against a limit of 5, so the equality AC has no test and the boundary defect passes. Add assert.equal(belowLimit(5,5), false).

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Non-strict comparison in belowLimit","location":"src/function.mjs:1","action":"Change value <= limit to value < limit.","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"},{"title":"Missing equality test for belowLimit","location":"test/function.test.mjs","action":"Add assert.equal(belowLimit(5,5), false).","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"}]}
```