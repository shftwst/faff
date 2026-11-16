signal: pass

## Findings

None. test/fixtures/bad-null.txt is fixture data: its unguarded user.profile.name access is the planted input the scanner test expects, and the suite reads it as a string without executing it. The fixture shape is valid for a .txt scanner fixture, no production code changed, and the scanner test reports the expected unguarded-access diagnostic.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```