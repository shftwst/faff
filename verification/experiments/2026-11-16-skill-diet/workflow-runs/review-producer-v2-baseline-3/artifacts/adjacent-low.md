signal: fail

## Findings

### scope: Out-of-scope comment typo fix in multiply
src/function.mjs:1 changes the comment from 'Calculte product.' to 'Calculate product.'. The spec covers only the implementation and its test and says no documentation cleanup was requested; at low appetite any out-of-scope line is a fail. Revert the comment change and keep the a * b fix and the test.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Out-of-scope comment typo fix in multiply","location":"src/function.mjs:1","action":"Revert the comment to its original text, keeping the a * b change and the test.","location_present":true,"action_present":true,"severity":"minor","disposition":"open","source":"standard"}]}
```