signal: fail

## Findings

### Scope: Unrequested comment typo cleanup
At src/function.mjs:1, the diff changes 'Calculte' to 'Calculate'. The spec excludes documentation cleanup, and low appetite requires strict scope. Revert the comment edit while retaining the correct multiplication implementation and passing tests.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Unrequested comment typo cleanup","location":"src/function.mjs:1","action":"Revert the comment typo edit while retaining the implementation and tests.","location_present":true,"action_present":true,"source":"standard","severity":"minor"}]}
```