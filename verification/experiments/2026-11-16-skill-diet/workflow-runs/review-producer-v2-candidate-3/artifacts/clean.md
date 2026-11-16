signal: pass

## Findings

No findings. `double` in src/function.mjs multiplies by 2 as the spec chooses, test/function.test.mjs covers the positive, zero and negative inputs the AC names, local tests pass, and only the two in-scope files changed.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```