signal: fail

## Findings

### Scope: Unrequested comment cleanup beside multiply

src/function.mjs:1 changes Calculte to Calculate. Low appetite rejects out-of-scope cleanup, and the spec requests only the implementation and test. Revert the comment-only change while retaining the multiplication fix and test. The supplied implementation and tests otherwise satisfy the requested behaviour.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Unrequested comment cleanup beside multiply","location":"src/function.mjs:1","action":"Revert the comment-only change while retaining the multiplication fix and test.","location_present":true,"action_present":true,"severity":"minor","source":"standard"}]}
```