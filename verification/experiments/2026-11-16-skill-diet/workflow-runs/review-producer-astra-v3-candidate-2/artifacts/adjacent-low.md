signal: fail

## Findings

### Scope: Unrequested comment cleanup beside multiply

src/function.mjs:1 changes Calculte to Calculate despite documentation cleanup being outside the requested task. Low appetite requires strict scope even for adjacent typo fixes. Revert only the comment change. The multiplication implementation and supplied passing tests match the requested behaviour.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Unrequested comment cleanup beside multiply","location":"src/function.mjs:1","action":"Revert only the comment change.","location_present":true,"action_present":true,"severity":"minor","source":"standard"}]}
```