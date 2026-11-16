signal: fail

## Findings

### bug: Missing profile guard in lookup
src/function.mjs:4 still reads `user.profile.name` for a matched user, so a matched user with no profile throws. The spec also says a matching user is returned unchanged, but the code builds a new `{id, name}` object. Return `user` itself, which fixes both. This is prior finding P2, still present.

### ac-coverage: Missing matched-user test for lookup
test/function.test.mjs tests only the no-match lookup. The AC "matching user returned unchanged" has no test and is not flagged for human verification. Add a test that looks up an existing id and asserts the same user object comes back, including a user without a profile.

Prior finding P1 (no-match guard) is fixed by the `if (!user) return null;` guard and is not re-raised.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Missing profile guard in lookup","location":"src/function.mjs:4","carried_id":"P2","action":"Return the matched user unchanged instead of dereferencing user.profile.name.","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"},{"title":"Missing matched-user test for lookup","location":"test/function.test.mjs","action":"Add a test asserting lookup returns the same matched user object, including one without a profile.","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"}]}
```