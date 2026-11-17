signal: fail

## Findings

### Scope: Unrequested comment correction beside multiply

src/function.mjs:1 changes Calculte to Calculate. Low appetite prohibits even trivial out-of-scope cleanup, and this spec requests no documentation cleanup. Revert only the comment correction. The multiplication change matches the spec and its supplied tests pass.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Unrequested comment correction beside multiply","location":"src/function.mjs:1","action":"Revert only the comment correction.","location_present":true,"action_present":true,"severity":"minor","source":"standard"}]}
```