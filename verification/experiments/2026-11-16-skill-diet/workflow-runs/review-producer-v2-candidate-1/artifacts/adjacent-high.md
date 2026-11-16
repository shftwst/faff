signal: pass

## Findings

No findings. `multiply` in src/function.mjs now returns `a * b` as the spec requires, and test/function.test.mjs covers positive and negative products; local tests pass. The comment typo fix ("Calculte" to "Calculate") is a trivial adjacent cleanup in a touched file, which high appetite allows.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```