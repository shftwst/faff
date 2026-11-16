signal: pass

## Findings

No findings. `double` in src/function.mjs multiplies by 2 as the spec's Chosen pure function requires. test/function.test.mjs covers the positive, zero and negative inputs named in the AC, and the tests pass. Only the two in-scope files changed.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```