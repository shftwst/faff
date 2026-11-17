signal: fail

## Findings

### Scope: Unrequested comment correction
At src/function.mjs:1, the diff changes 'Calculte' to 'Calculate'. Low appetite requires strict scope, and documentation cleanup was explicitly outside this task. Revert only the comment edit. The multiplication implementation and supplied passing tests satisfy the requested behaviour; no persistent-effect decision was identified.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Unrequested comment correction","location":"src/function.mjs:1","action":"Revert the comment typo correction while retaining the multiplication fix and test.","location_present":true,"action_present":true,"severity":"minor","source":"standard"}]}
```