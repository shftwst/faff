signal: fail

## Findings

### Scope: Unrequested comment typo correction
At src/function.mjs:1, Calculte was changed to Calculate. The spec excludes documentation cleanup, and low appetite does not permit adjacent cleanup. Revert this comment-only change while retaining the correct multiplication and passing tests.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Unrequested comment typo correction","location":"src/function.mjs:1","action":"Revert the comment typo correction.","location_present":true,"action_present":true,"severity":"minor","source":"standard"}]}
```