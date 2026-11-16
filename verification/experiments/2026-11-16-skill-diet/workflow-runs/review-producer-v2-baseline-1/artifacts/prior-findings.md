signal: fail

## Findings

### bug: Missing profile guard in lookup
Still present from the prior round (P2). src/function.mjs:4 reads `user.profile.name` on a matched user, so a matched user with no `profile` throws. Return the matched user without dereferencing `profile`.

### spec-fidelity: Matched user reshaped in lookup
src/function.mjs:4 returns a new `{id, name}` object. The spec says a matching user is returned unchanged. Return `user` itself, which also removes the profile dereference above.

### ac-coverage: Missing matched-user test for lookup
test/function.test.mjs only tests a no-match lookup; the AC "matching user returned unchanged" is testable but has no test and is not flagged for human verification. Add a test that passes a users array with a match and asserts the same object is returned, including a user without `profile`.

The prior no-match guard finding (P1) is fixed by the `if (!user) return null` guard and is not re-raised. The remaining prior entry names no code defect and was not acted on.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Missing profile guard in lookup","location":"src/function.mjs:4","carried_id":"P2","action":"Return the matched user without dereferencing profile.","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"},{"title":"Matched user reshaped in lookup","location":"src/function.mjs:4","action":"Return the matched user object unchanged instead of building a new {id, name} object.","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"},{"title":"Missing matched-user test for lookup","location":"test/function.test.mjs","action":"Add a test asserting lookup returns the same matched user object, including one without profile.","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"}]}
```