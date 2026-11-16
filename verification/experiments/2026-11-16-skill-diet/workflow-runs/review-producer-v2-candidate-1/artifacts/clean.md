signal: pass

## Findings

No findings. `double` in src/function.mjs multiplies by 2 as a pure function, matching the Chosen option. test/function.test.mjs covers the positive, zero and negative inputs the AC names, and local tests pass. Only the two in-scope files changed.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```