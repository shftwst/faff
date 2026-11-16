signal: fail

## Findings

### spec-fidelity: Inclusive comparison in belowLimit
src/function.mjs:1 returns `value <= limit`, so `belowLimit(5, 5)` returns true. The spec chooses a strict `value < limit` and the AC says equality is rejected. Change the comparison to `value < limit`.

### ac-coverage: Missing equality test for belowLimit
test/function.test.mjs tests only 4 and 6 against a limit of 5. The AC "equality is rejected" has no test, which is why the boundary defect above passed. Add `assert.equal(belowLimit(5,5), false);`.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Inclusive comparison in belowLimit","location":"src/function.mjs:1","action":"Change the comparison from value <= limit to value < limit.","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"},{"title":"Missing equality test for belowLimit","location":"test/function.test.mjs","action":"Add an assertion that belowLimit(5,5) returns false.","location_present":true,"action_present":true,"severity":"minor","disposition":"open","source":"standard"}]}
```