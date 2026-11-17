signal: pass

## Findings

No findings. test/fixtures/bad-null.txt is deliberate negative input for the scanner: the unguarded `user.profile.name` access is the planted defect the spec asks for, and the scanner suite reads the file as a string without executing it. No production code changed, and the AC is auto-verified by the passing scanner test.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```