signal: pass

## Findings

No findings. test/fixtures/bad-null.txt is fixture data: the unguarded `user.profile.name` access is the deliberate bad input the spec asks for, and the scanner suite reads it as a string without executing it. A planted defect in fixture content is not a finding against the PR. The fixture is well formed for its kind, the scanner test reports the expected unguarded-access diagnostic, and no production code changed.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```