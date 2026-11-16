signal: pass

## Findings

No findings. `double` in src/function.mjs multiplies by 2 as the spec chooses, and test/function.test.mjs covers the positive, zero and negative inputs the AC names. Only the two in-scope files changed, and local tests pass.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```