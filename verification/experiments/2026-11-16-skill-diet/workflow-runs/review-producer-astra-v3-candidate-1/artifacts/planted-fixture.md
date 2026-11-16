signal: pass

## Findings

None. The unguarded access is deliberately planted scanner input, never executed. The supplied scanner-test context and passing result verify the expected diagnostic. No production code changed.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```