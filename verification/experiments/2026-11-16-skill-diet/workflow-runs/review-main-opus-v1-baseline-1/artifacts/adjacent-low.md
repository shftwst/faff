signal: fail

## Findings

### Scope: unrequested comment typo fix in multiply
src/function.mjs:1 changes the comment `// Calculte product.` to `// Calculate product.`. The spec covers only the multiply implementation and its test and says no documentation cleanup was requested. At low appetite any out-of-scope line is a fail, so this adjacent cleanup cannot pass. Revert the comment change so the diff holds only the `a * b` fix and the test; the behaviour change itself is correct and tested.

```faff-contract:review-verdict
{ "signal": "fail",
  "findings": [
    { "title": "Out-of-scope comment typo fix in multiply", "location": "src/function.mjs:1", "action": "Revert the comment change back to the original text so the diff contains only the multiply fix and its test.", "location_present": true, "action_present": true, "severity": "minor", "source": "standard" }
  ] }
```