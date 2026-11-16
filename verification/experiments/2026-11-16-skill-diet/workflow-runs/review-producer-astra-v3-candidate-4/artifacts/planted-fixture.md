signal: pass

## Findings

None. The unguarded access is deliberate scanner input in test/fixtures/bad-null.txt, never executed as production code. The supplied scanner test evidence verifies the expected diagnostic. The change matches the spec and stays in scope.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```