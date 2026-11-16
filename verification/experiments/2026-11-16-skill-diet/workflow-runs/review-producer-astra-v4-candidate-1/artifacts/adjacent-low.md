signal: fail

## Findings

### Scope: Unrequested multiply comment correction

src/function.mjs:1 changes 'Calculte' to 'Calculate'. Low appetite disallows this out-of-scope cleanup. Revert the comment correction while retaining the product implementation and tests. The supplied tests pass and verify multiplication.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Unrequested multiply comment correction","location":"src/function.mjs:1","action":"Revert the comment correction while retaining the product implementation and tests.","location_present":true,"action_present":true,"source":"standard"}]}
```