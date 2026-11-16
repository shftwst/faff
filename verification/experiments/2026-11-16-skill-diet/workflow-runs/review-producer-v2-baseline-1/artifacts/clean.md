signal: pass

## Findings

No findings. `double` in src/function.mjs multiplies by 2 as the spec chooses, test/function.test.mjs covers positive, zero and negative inputs, the diff stays inside the two in-scope files, and nothing needs a human decision.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```