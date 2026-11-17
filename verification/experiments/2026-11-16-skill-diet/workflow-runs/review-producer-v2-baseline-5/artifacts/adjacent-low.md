signal: fail

## Findings

### scope: Out-of-scope comment typo fix in multiply
src/function.mjs:1 changes the comment from "Calculte product." to "Calculate product.". The spec limits the task to the implementation and its test and says no documentation cleanup was requested. At low appetite any out-of-scope line is a fail. Revert the comment change and keep only the return a * b change and the test.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Out-of-scope comment typo fix in multiply","location":"src/function.mjs:1","action":"Revert the comment edit, leaving only the multiply implementation change and the test.","location_present":true,"action_present":true,"severity":"minor","disposition":"open","source":"standard"}]}
```