signal: fail

## Findings

### scope: Out-of-scope comment typo fix in multiply

src/function.mjs:1 changes the comment from "Calculte product." to "Calculate product.". The spec covers only the multiply implementation and its test and says no documentation cleanup was requested. At low appetite any out-of-scope line fails the scope check. Revert the comment change; the `a * b` fix and its test are correct and stay.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Out-of-scope comment typo fix in multiply","location":"src/function.mjs:1","action":"Revert the comment to its original text and keep only the a * b change and test.","location_present":true,"action_present":true,"severity":"minor","disposition":"open","source":"standard"}]}
```