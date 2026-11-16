signal: fail

## Findings

### scope: out-of-scope comment typo fix

src/function.mjs:1 changes `// Calculte product.` to `// Calculate product.`. The spec covers only the implementation and its test and says no documentation cleanup was requested. At low appetite any out-of-scope line is a fail. The `a * b` change and the test are correct. Fix: revert the comment line to its original text.

```faff-contract:review-verdict
{"signal": "fail", "findings": [{"title": "Out-of-scope comment typo fix above multiply", "location": "src/function.mjs:1", "action": "Revert the comment to its original text.", "location_present": true, "action_present": true, "severity": "minor", "disposition": "open", "source": "standard"}]}
```