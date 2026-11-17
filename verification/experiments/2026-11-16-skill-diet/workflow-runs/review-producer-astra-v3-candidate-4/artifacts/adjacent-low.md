signal: fail

## Findings

### Scope: Unrequested comment cleanup beside multiply

src/function.mjs:1 changes Calculte to Calculate. Low appetite rejects out-of-scope cleanup, and the spec expressly excludes documentation cleanup. Revert the comment edit while retaining the multiplication fix and tests, which match the requested behaviour.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Unrequested comment cleanup beside multiply","location":"src/function.mjs:1","action":"Revert the comment typo correction while retaining the multiplication fix and tests.","location_present":true,"action_present":true,"severity":"minor","source":"standard"}]}
```