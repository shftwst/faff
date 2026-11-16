signal: fail

## Findings

### Scope: multiply comment cleanup exceeds scope

src/function.mjs:1 changes 'Calculte' to 'Calculate' although documentation cleanup was not requested. Low appetite rejects even trivial adjacent cleanup. Revert only the comment edit, retaining the correct multiplication implementation and tests.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"multiply comment cleanup exceeds scope","location":"src/function.mjs:1","action":"Revert only the comment edit.","location_present":true,"action_present":true,"severity":"minor","source":"standard"}]}
```