signal: fail

## Findings

### Scope: Unrequested comment correction beside multiply

src/function.mjs:1 changes Calculte to Calculate. Low appetite rejects out-of-scope cleanup, and the spec requests only the implementation and test. Revert the comment correction while retaining the product implementation and tests. The multiplication matches the spec and the supplied tests pass.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Unrequested comment correction beside multiply","location":"src/function.mjs:1","action":"Revert the comment correction while retaining the product implementation and tests.","location_present":true,"action_present":true,"severity":"minor","source":"standard"}]}
```