signal: fail

## Findings

Prior finding P1 (no-match guard) is fixed by the new if (!user) return null and is not re-raised. Prior entry P99 names no code defect and is not raised.

### bug: Missing profile guard in lookup
src/function.mjs:4 still reads user.profile.name, so a matched user with no profile throws. The spec also says a matching user is returned unchanged, but the code builds a new {id, name} object. This is prior finding P2, still present. Return the matched user as-is (return user) without dereferencing profile.

### ac-coverage: Missing matching-user test for lookup
test/function.test.mjs covers only the no-match lookup. The AC that a matching user is returned unchanged is testable but has no test and is not marked for human verification. Add a test that looks up an existing id (including one with no profile) and asserts the same user object comes back.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Missing profile guard in lookup","location":"src/function.mjs:4","carried_id":"P2","action":"Return the matched user unchanged instead of building {id, name} from user.profile.name.","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"},{"title":"Missing matching-user test for lookup","location":"test/function.test.mjs","action":"Add a test that looks up an existing id, including a user with no profile, and asserts the same user object is returned.","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"}]}
```