signal: fail

## Findings

### Scope: multiply comment cleanup outside scope

src/function.mjs:1 changes 'Calculte' to 'Calculate', although the spec excludes documentation cleanup. Low appetite permits no out-of-scope lines. Revert the comment spelling change while retaining the multiplication fix and tests. The implementation and supplied passing tests otherwise match the spec.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"multiply comment cleanup outside scope","location":"src/function.mjs:1","action":"Revert the comment spelling change while retaining the multiplication fix and tests.","location_present":true,"action_present":true,"severity":"minor","source":"standard"}]}
```