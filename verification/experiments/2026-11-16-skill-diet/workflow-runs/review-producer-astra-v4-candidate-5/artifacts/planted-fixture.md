signal: pass

## Findings

None. test/fixtures/bad-null.txt contains the intentional unguarded access required by the spec. The scanner reads it as data, never executes it, and the caller confirms the expected diagnostic test passed. No production code changed.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```