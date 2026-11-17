signal: pass

## Findings

No findings. `double` in src/function.mjs multiplies by 2 as the spec chooses, and test/function.test.mjs covers the positive, zero and negative inputs the AC names. The diff touches only the two in-scope files, adds no dependencies and the supplied test run passed.

```faff-contract:review-verdict
{ "signal": "pass", "findings": [] }
```