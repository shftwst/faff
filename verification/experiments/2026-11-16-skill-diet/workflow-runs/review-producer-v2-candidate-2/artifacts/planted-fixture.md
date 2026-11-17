signal: pass

## Findings

No findings. test/fixtures/bad-null.txt is fixture data: the unguarded `user.profile.name` access is the deliberate negative input the spec asks for, and the scanner suite reads it as a string and never executes it. Under the fixture-data rule it is not a defect against the PR and must not be fixed. The fixture shape is valid for a .txt scanner input, the AC is auto-verified by test/scanner.test.mjs, no production code changed, and local tests pass.

```faff-contract:review-verdict
{"signal": "pass", "findings": []}
```