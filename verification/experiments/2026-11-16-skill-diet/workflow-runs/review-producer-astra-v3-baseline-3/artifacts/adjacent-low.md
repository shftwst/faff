signal: fail

## Findings

### Scope: Unrequested comment typo correction
At src/function.mjs:1, Calculte was changed to Calculate. Low appetite disallows even trivial adjacent cleanup, and documentation cleanup is outside the stated scope. Revert the comment-only change while retaining the correct multiplication and tests. The supplied tests passed.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Unrequested comment typo correction","location":"src/function.mjs:1","action":"Revert the comment-only typo correction.","location_present":true,"action_present":true,"severity":"minor","source":"standard"}]}
```