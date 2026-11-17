signal: fail

## Findings

### scope: Out-of-scope comment typo fix in src/function.mjs
src/function.mjs:1 changes the comment from `// Calculte product.` to `// Calculate product.`. The spec limits the task to the multiply implementation and its test and says no documentation cleanup was requested. At low appetite any out-of-scope line fails the scope check. Revert the comment change. The `a * b` fix and its tests are correct and in scope.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Out-of-scope comment typo fix in src/function.mjs","location":"src/function.mjs:1","action":"Revert the comment back to its original text.","location_present":true,"action_present":true,"severity":"minor","disposition":"open","source":"standard"}]}
```