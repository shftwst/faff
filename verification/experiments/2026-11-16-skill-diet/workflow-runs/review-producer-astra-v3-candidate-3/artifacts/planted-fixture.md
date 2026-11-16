signal: pass

## Findings

None. test/fixtures/bad-null.txt contains the deliberately unguarded access required by the spec. The scanner consumes it as a string, never executes it, and the caller reports the expected diagnostic test passed. No fixture-shape or production-code defect is present.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```