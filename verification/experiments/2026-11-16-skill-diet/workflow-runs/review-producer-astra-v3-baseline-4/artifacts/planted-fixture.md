signal: pass

## Findings

None. test/fixtures/bad-null.txt contains the deliberately unguarded access required by the spec. The scanner reads it as text, never executes it, and the caller reports the expected diagnostic test passed. No fixture-shape defect or production change is present.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```