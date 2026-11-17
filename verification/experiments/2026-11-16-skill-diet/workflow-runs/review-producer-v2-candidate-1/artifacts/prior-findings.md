signal: fail

## Findings

Prior P1 (missing no-match guard) is fixed: line 3 now returns null when no user matches, and the no-match test covers it. P99 is not a code defect and is not raised.

### bug: Missing profile guard in lookup

Still present (prior P2). src/function.mjs:4 reads `user.profile.name`, so a matched user with no profile throws. Return the matched user without dereferencing `profile`.

### spec-fidelity: Matched user reshaped in lookup

src/function.mjs:4 returns a new `{id, name}` object. The spec says a matching user is returned unchanged. Return `user` itself.

### ac-coverage: Missing matched-user test for lookup

The AC "matching user returned unchanged" has no test and no human-verification flag; test/function.test.mjs only checks the no-match case. Add a test that looks up an existing id and asserts the same user object is returned, including a user without a profile.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Missing profile guard in lookup","location":"src/function.mjs:4","carried_id":"P2","action":"Return the matched user without dereferencing profile.","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"},{"title":"Matched user reshaped in lookup","location":"src/function.mjs:4","action":"Return user itself instead of a new {id, name} object.","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"},{"title":"Missing matched-user test for lookup","location":"test/function.test.mjs","action":"Add a test asserting lookup returns the same user object for an existing id, including one without a profile.","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"}]}
```