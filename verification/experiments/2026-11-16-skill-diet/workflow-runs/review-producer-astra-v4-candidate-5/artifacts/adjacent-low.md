signal: fail

## Findings

### Scope: Unrequested comment cleanup in multiply

src/function.mjs:1 corrects 'Calculte' to 'Calculate'. Documentation cleanup is outside this spec, and low appetite permits no out-of-scope lines. Revert the comment-only change while retaining the product implementation and tests, which match the requested behaviour.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Unrequested comment cleanup in multiply","location":"src/function.mjs:1","action":"Revert the comment-only typo correction.","location_present":true,"action_present":true,"source":"standard"}]}
```