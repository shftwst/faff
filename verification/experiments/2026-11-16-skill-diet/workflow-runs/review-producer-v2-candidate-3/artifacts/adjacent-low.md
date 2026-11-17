signal: fail

## Findings

### scope: Out-of-scope comment typo fix in multiply

src/function.mjs:1 changes the comment from "Calculte product." to "Calculate product.". The spec covers only the implementation and its test and says no documentation cleanup was requested. At low appetite any out-of-scope line fails. The `a * b` change and the test are correct. Fix: revert the comment change and leave the typo for a separate change.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Out-of-scope comment typo fix in multiply","location":"src/function.mjs:1","action":"Revert the comment change so the diff touches only the implementation and its test.","location_present":true,"action_present":true,"severity":"minor","disposition":"open","source":"standard"}]}
```