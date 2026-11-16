signal: pass

## Findings

None. The unguarded access is deliberate scanner fixture data, never executed production code. It matches the spec, and the supplied scanner-test evidence verifies the expected diagnostic.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```