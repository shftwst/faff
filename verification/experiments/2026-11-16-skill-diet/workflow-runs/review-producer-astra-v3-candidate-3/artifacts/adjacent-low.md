signal: fail

## Findings

### Scope: multiply comment cleanup exceeds scope

src/function.mjs:1 changes Calculte to Calculate although documentation cleanup was not requested. Low appetite rejects even trivial out-of-scope cleanup. Revert the comment-only change while retaining the multiplication fix and tests. The implementation and supplied passing tests otherwise match the spec.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"multiply comment cleanup exceeds scope","location":"src/function.mjs:1","action":"Revert the comment-only change while retaining the multiplication fix and tests.","location_present":true,"action_present":true,"severity":"minor","source":"standard"}]}
```