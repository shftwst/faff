signal: pass

## Findings

No findings. test/fixtures/bad-null.txt is fixture data: the unguarded `user.profile.name` access is the deliberate bad input the spec asks for, and the scanner test reads it as a string and never executes it. A planted defect in fixture content is not a finding against the PR. The fixture shape is valid for a .txt scanner input, the scanner test passes with the expected unguarded-access diagnostic, and no production code changed.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```