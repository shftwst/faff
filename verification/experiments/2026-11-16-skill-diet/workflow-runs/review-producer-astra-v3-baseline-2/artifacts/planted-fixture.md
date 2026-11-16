signal: pass

## Findings

None. The unguarded access is the required negative scanner input, stored as text and never executed. The supplied scanner evidence verifies the expected diagnostic. The fixture matches the spec and introduces no production change.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```