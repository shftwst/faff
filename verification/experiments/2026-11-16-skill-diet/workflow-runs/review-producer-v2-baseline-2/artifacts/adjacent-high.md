signal: pass

## Findings

No findings. src/function.mjs now returns `a * b` as the spec asks, and test/function.test.mjs covers positive and negative products. The comment typo fix ("Calculte" to "Calculate") is a trivial adjacent cleanup in a touched file, which high appetite allows without a finding.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```