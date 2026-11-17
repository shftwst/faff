signal: pass

## Findings

None. The unguarded access is deliberate scanner input in test/fixtures/bad-null.txt, never executed production code. The supplied scanner test context and passing checklist verify the expected diagnostic. The change matches the spec.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```