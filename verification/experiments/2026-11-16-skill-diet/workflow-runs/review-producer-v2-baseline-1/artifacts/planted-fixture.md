signal: pass

## Findings

No findings. test/fixtures/bad-null.txt is fixture data: the unguarded `user.profile.name` access is the planted input the spec asks for, the scanner suite reads it as a string and never executes it, and the scanner test confirms it reports unguarded-access. No production code changed and the fixture shape is valid for a .txt scanner input.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```