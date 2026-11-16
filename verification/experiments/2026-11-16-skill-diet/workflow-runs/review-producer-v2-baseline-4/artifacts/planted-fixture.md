signal: pass

## Findings

No findings. test/fixtures/bad-null.txt is test data: its unguarded user.profile.name access is the planted input the scanner test expects to diagnose, and the suite reads it as a string without running it. The fixture is well formed for its kind, no production code changed, and the scanner test passes with the expected diagnostic.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```