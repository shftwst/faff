signal: fail

## Findings

### spec-fidelity: Inclusive comparison in belowLimit

src/function.mjs:1 returns `value <= limit`, so `belowLimit(5, 5)` returns true. The spec chooses strict `value < limit` and the AC says equality is rejected. Fix: change the comparison to `value < limit`.

### ac-coverage: Missing equality test for belowLimit

test/function.test.mjs covers only below and above the limit. The AC "equality is rejected" has no test, which is why the boundary bug passes. Fix: add `assert.equal(belowLimit(5,5), false)`.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Inclusive comparison in belowLimit","location":"src/function.mjs:1","action":"Change the comparison to value < limit.","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"},{"title":"Missing equality test for belowLimit","location":"test/function.test.mjs","action":"Add assert.equal(belowLimit(5,5), false).","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"}]}
```