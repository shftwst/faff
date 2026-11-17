signal: fail

## Findings

### Scope: Unrequested comment correction
At src/function.mjs:1, the diff changes 'Calculte' to 'Calculate'. Low appetite requires strict scope, and documentation cleanup was explicitly outside this task. Revert that comment-only edit while retaining the correct multiplication implementation and its passing tests.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Unrequested comment correction","location":"src/function.mjs:1","action":"Revert the comment-only typo correction.","location_present":true,"action_present":true,"severity":"minor","source":"standard"}]}
```