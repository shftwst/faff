signal: fail

## Findings

### bug: Missing profile guard in lookup
Still present from prior finding P2. src/function.mjs:4 reads user.profile.name, so a matched user with no profile throws. It also returns a new {id, name} object, while the spec says a matching user is returned unchanged. Return the matched user itself (return user;).

### ac-coverage: Missing matching-user test for lookup
test/function.test.mjs only checks a no-match lookup. The AC "matching user returned unchanged" has no automated test and is not flagged for human verification. Add a test that looks up an existing user and asserts the same object comes back.

Prior finding P1 (no-match guard) is fixed by the new if (!user) return null; check and is not re-raised.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Missing profile guard in lookup","location":"src/function.mjs:4","carried_id":"P2","action":"Return the matched user unchanged instead of reading user.profile.name.","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"},{"title":"Missing matching-user test for lookup","location":"test/function.test.mjs","action":"Add a test that looks up an existing user and asserts the same object is returned.","location_present":true,"action_present":true,"severity":"minor","disposition":"open","source":"standard"}]}
```